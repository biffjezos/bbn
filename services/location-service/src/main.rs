// ============================================================
// bOOmbOOm.NOW! — location-service (Rust)
// Replaces services/location-service.js.
// Identical HTTP contract — gateway needs no changes.
// ============================================================

use std::{
    collections::{HashMap, HashSet},
    env,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use axum::{
    extract::{FromRef, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{delete, get, post, put},
    Router,
};
use common::{
    auth::{AuthToken, JwtSecret, ServiceToken, UserClaims},
    geo::haversine_distance,
    models::BlockDoc,
    service_token::ServiceTokenCache,
};
use futures_util::TryStreamExt;
use mongodb::{
    bson::{doc, Bson, DateTime as BsonDateTime, Document},
    Client, Database,
};
use serde::Deserialize;
use serde_json::json;
use tokio::sync::RwLock;

// ── Config ────────────────────────────────────────────────────────────────────

struct Config {
    port:              u16,
    mongo_uri:         String,
    db_name:           String,
    jwt_secret:        String,
    fav_service_url:   String,
    tiers_service_url: String,
}

impl Config {
    fn from_env() -> Result<Self, String> {
        let required = ["JWT_SECRET", "MONGO_URI", "FAV_SERVICE_URL", "TIERS_SERVICE_URL"];
        let missing: Vec<_> = required.iter().filter(|k| env::var(k).is_err()).collect();
        if !missing.is_empty() {
            return Err(format!(
                "FATAL: missing env vars: {}",
                missing.iter().map(|k| **k).collect::<Vec<_>>().join(", ")
            ));
        }
        Ok(Self {
            port:              env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8080),
            mongo_uri:         env::var("MONGO_URI").unwrap(),
            db_name:           env::var("DB_NAME").unwrap_or_else(|_| "boomboom".to_string()),
            jwt_secret:        env::var("JWT_SECRET").unwrap(),
            fav_service_url:   env::var("FAV_SERVICE_URL").unwrap(),
            tiers_service_url: env::var("TIERS_SERVICE_URL").unwrap(),
        })
    }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const UPDATE_INTERVAL:     Duration = Duration::from_secs(15);
const UPDATE_DISTANCE_M:   f64      = 100.0;
const LOCATION_TTL:        Duration = Duration::from_secs(10 * 60);
const NEARBY_CACHE_TTL:    Duration = Duration::from_millis(2_000);
const BLOCK_CACHE_TTL:     Duration = Duration::from_secs(30);
const TIER_RADIUS_CACHE_TTL: Duration = Duration::from_secs(5 * 60);

// ── Cache structs ─────────────────────────────────────────────────────────────

struct ActiveUsersCache {
    users:      Vec<LocationDoc>,
    expires_at: Instant,
}

struct BlockCacheEntry {
    ids:        HashSet<String>,
    expires_at: Instant,
}

struct TierRadiusCacheEntry {
    radius_m:   f64,
    expires_at: Instant,
}

// ── App state ─────────────────────────────────────────────────────────────────

#[derive(Clone)]
struct AppState {
    db:                  Database,
    jwt_secret:          String,
    fav_service_url:     String,
    tiers_service_url:   String,
    http:                reqwest::Client,
    svc_token_cache:     Arc<ServiceTokenCache>,
    active_users_cache:  Arc<RwLock<Option<ActiveUsersCache>>>,
    block_cache:         Arc<RwLock<HashMap<String, BlockCacheEntry>>>,
    tier_radius_cache:   Arc<RwLock<HashMap<String, TierRadiusCacheEntry>>>,
}

impl FromRef<AppState> for JwtSecret {
    fn from_ref(state: &AppState) -> Self { JwtSecret(state.jwt_secret.clone()) }
}

impl FromRef<AppState> for Database {
    fn from_ref(state: &AppState) -> Self { state.db.clone() }
}

// ── DB document types ─────────────────────────────────────────────────────────

/// Minimal projection used for the time-gate check in PUT /location.
#[derive(Deserialize)]
struct LocationCheck {
    lat:        f64,
    lon:        f64,
    #[serde(rename = "updatedAt")]
    updated_at: BsonDateTime,
}

/// Full document used for the nearby cache and response.
#[derive(Deserialize, Clone)]
struct LocationDoc {
    #[serde(rename = "userId")]
    user_id:      String,
    lat:          f64,
    lon:          f64,
    #[serde(rename = "isRegistered", default)]
    is_registered: bool,
    sex:          Option<String>,
    nickname:     Option<String>,
    age:          Option<i32>,
    accuracy:     Option<String>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Returns the set of user IDs that have a block relationship with `caller_id`
/// (either direction). Uses a 30-second in-process cache.
async fn get_blocked_ids(
    db: &Database,
    block_cache: &RwLock<HashMap<String, BlockCacheEntry>>,
    caller_id: &str,
) -> HashSet<String> {
    {
        let cache = block_cache.read().await;
        if let Some(entry) = cache.get(caller_id) {
            if entry.expires_at > Instant::now() {
                return entry.ids.clone();
            }
        }
    }

    let docs: Vec<BlockDoc> = match db
        .collection::<BlockDoc>("blocks")
        .find(doc! { "$or": [
            { "blockerUserId": caller_id },
            { "blockedUserId": caller_id },
        ]})
        .await
    {
        Ok(cursor) => cursor.try_collect().await.unwrap_or_default(),
        Err(_) => Vec::new(),
    };

    let ids: HashSet<String> = docs
        .iter()
        .map(|d| {
            if d.blocker_user_id == caller_id {
                d.blocked_user_id.clone()
            } else {
                d.blocker_user_id.clone()
            }
        })
        .collect();

    block_cache.write().await.insert(
        caller_id.to_string(),
        BlockCacheEntry { ids: ids.clone(), expires_at: Instant::now() + BLOCK_CACHE_TTL },
    );

    ids
}

/// Returns the nearby radius in metres for a tier. Uses a 5-minute cache;
/// falls back to static values if tiers-service is unreachable.
async fn get_nearby_radius_m(state: &AppState, tier: &str) -> f64 {
    {
        let cache = state.tier_radius_cache.read().await;
        if let Some(entry) = cache.get(tier) {
            if entry.expires_at > Instant::now() {
                return entry.radius_m;
            }
        }
    }

    let fallback: f64 = match tier {
        "premium" | "regular" => 1_000.0,
        _ => 500.0,
    };

    let svc_token = match state.svc_token_cache.get("location", &state.jwt_secret).await {
        Ok(t)  => t,
        Err(e) => { eprintln!("[location] tier radius: token error: {e}"); return fallback; }
    };

    let radius_m = match state.http
        .get(format!("{}/tiers/radius/nearby/{tier}", state.tiers_service_url))
        .header("X-Service-Token", &svc_token)
        .timeout(Duration::from_secs(3))
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => r
            .json::<serde_json::Value>().await
            .ok()
            .and_then(|v| v["radiusM"].as_f64())
            .unwrap_or(fallback),
        Ok(r)  => { eprintln!("[location] tiers-service radius: HTTP {}", r.status()); fallback }
        Err(e) => { eprintln!("[location] tiers-service radius: {e}"); fallback }
    };

    state.tier_radius_cache.write().await.insert(
        tier.to_string(),
        TierRadiusCacheEntry { radius_m, expires_at: Instant::now() + TIER_RADIUS_CACHE_TTL },
    );

    radius_m
}

/// Fire-and-forget range-sync notification to favourites-service.
fn notify_range_sync(state: AppState, user_id: String, lat: f64, lon: f64) {
    tokio::spawn(async move {
        let svc_token = match state.svc_token_cache.get("location", &state.jwt_secret).await {
            Ok(t)  => t,
            Err(e) => { eprintln!("[location] range-sync: token error: {e}"); return; }
        };
        if let Err(e) = state.http
            .post(format!("{}/favourites/internal/range-sync", state.fav_service_url))
            .header("X-Service-Token", &svc_token)
            .json(&json!({ "userId": user_id, "lat": lat, "lon": lon }))
            .send()
            .await
        {
            eprintln!("[location] range-sync: {e}");
        }
    });
}

/// Build the BSON document used for the $set in PUT /location upserts.
fn build_location_doc(
    user_id:  &str,
    lat:      f64,
    lon:      f64,
    is_user:  bool,
    claims:   &UserClaims,
    accuracy: &str,
) -> Document {
    let sex      = claims.sex.as_deref().map(|s| Bson::String(s.to_string())).unwrap_or(Bson::Null);
    let nickname = claims.nickname.as_deref().map(|s| Bson::String(s.to_string())).unwrap_or(Bson::Null);
    let age      = claims.age.map(|a| Bson::Int32(a as i32)).unwrap_or(Bson::Null);
    doc! {
        "userId":       user_id,
        "lat":          lat,
        "lon":          lon,
        "location": {
            "type":        "Point",
            "coordinates": [lon, lat],   // GeoJSON: [longitude, latitude]
        },
        "isRegistered": is_user,
        "sex":          sex,
        "nickname":     nickname,
        "age":          age,
        "accuracy":     accuracy,
        "updatedAt":    BsonDateTime::now(),
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async fn health(State(state): State<AppState>) -> impl IntoResponse {
    match state.db.run_command(doc! { "ping": 1 }).await {
        Ok(_)  => Json(json!({ "ok": true })).into_response(),
        Err(_) => (StatusCode::SERVICE_UNAVAILABLE, Json(json!({ "ok": false, "error": "DB unreachable" }))).into_response(),
    }
}

// ── PUT /location ─────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct PutLocationBody {
    lat:      Option<f64>,
    lon:      Option<f64>,
    accuracy: Option<String>,
}

async fn put_location(
    _svc: ServiceToken,
    AuthToken(claims): AuthToken,
    State(state): State<AppState>,
    Json(body): Json<PutLocationBody>,
) -> impl IntoResponse {
    let (Some(lat), Some(lon)) = (body.lat, body.lon) else {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Valid lat and lon required." }))).into_response();
    };
    if !(-90.0..=90.0).contains(&lat) || !(-180.0..=180.0).contains(&lon) {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Valid lat and lon required." }))).into_response();
    }

    let user_id  = &claims.sub;
    let is_user  = matches!(claims.role.as_str(), "user" | "admin");
    let accuracy = if body.accuracy.as_deref() == Some("ip") { "ip" } else { "gps" };

    let existing = match state.db
        .collection::<LocationCheck>("locations")
        .find_one(doc! { "userId": user_id })
        .projection(doc! { "lat": 1, "lon": 1, "updatedAt": 1 })
        .await
    {
        Ok(v)  => v,
        Err(e) => { eprintln!("[location PUT] find: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };

    if let Some(ref prev) = existing {
        let moved_far = haversine_distance(prev.lat, prev.lon, lat, lon) >= UPDATE_DISTANCE_M;
        if !moved_far {
            // Atomic time-gated update: only writes if the record is old enough.
            let cutoff = BsonDateTime::from_millis(now_ms() - UPDATE_INTERVAL.as_millis() as i64);
            return match state.db
                .collection::<Document>("locations")
                .update_one(
                    doc! { "userId": user_id, "updatedAt": { "$lt": cutoff } },
                    doc! { "$set": build_location_doc(user_id, lat, lon, is_user, &claims, accuracy) },
                )
                .await
            {
                Ok(r)  => Json(json!({ "ok": true, "skipped": r.matched_count == 0 })).into_response(),
                Err(e) => { eprintln!("[location PUT] time-gate: {e}"); (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response() }
            };
        }
    }

    // New user or moved far enough: unconditional upsert.
    if let Err(e) = state.db
        .collection::<Document>("locations")
        .update_one(
            doc! { "userId": user_id },
            doc! { "$set": build_location_doc(user_id, lat, lon, is_user, &claims, accuracy) },
        )
        .upsert(true)
        .await
    {
        eprintln!("[location PUT] upsert: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response();
    }

    // Range-sync on first push of a session.
    if is_user && existing.is_none() {
        notify_range_sync(state, user_id.clone(), lat, lon);
    }

    Json(json!({ "ok": true })).into_response()
}

// ── DELETE /location ──────────────────────────────────────────────────────────

async fn delete_location(
    _svc: ServiceToken,
    AuthToken(claims): AuthToken,
    State(state): State<AppState>,
) -> impl IntoResponse {
    match state.db
        .collection::<Document>("locations")
        .delete_one(doc! { "userId": &claims.sub })
        .await
    {
        Ok(_)  => Json(json!({ "ok": true })).into_response(),
        Err(e) => { eprintln!("[location DELETE] {e}"); (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response() }
    }
}

// ── GET /location/nearby ──────────────────────────────────────────────────────

#[derive(Deserialize)]
struct NearbyQuery {
    lat: Option<f64>,
    lon: Option<f64>,
}

async fn get_nearby(
    _svc: ServiceToken,
    AuthToken(claims): AuthToken,
    State(state): State<AppState>,
    Query(q): Query<NearbyQuery>,
) -> impl IntoResponse {
    let (Some(lat), Some(lon)) = (q.lat, q.lon) else {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "lat and lon query params required." }))).into_response();
    };

    // Load active users, refreshing the 2-second cache if stale.
    // Avoid holding the lock across any await point.
    let needs_refresh = state.active_users_cache.read().await
        .as_ref()
        .map_or(true, |c| c.expires_at <= Instant::now());

    if needs_refresh {
        let cutoff = BsonDateTime::from_millis(now_ms() - LOCATION_TTL.as_millis() as i64);
        match state.db
            .collection::<LocationDoc>("locations")
            .find(doc! { "updatedAt": { "$gt": cutoff } })
            .await
        {
            Ok(cursor) => match cursor.try_collect::<Vec<_>>().await {
                Ok(all) => {
                    *state.active_users_cache.write().await = Some(ActiveUsersCache {
                        users:      all,
                        expires_at: Instant::now() + NEARBY_CACHE_TTL,
                    });
                }
                Err(e) => eprintln!("[location/nearby] cursor: {e}"),
            },
            Err(e) => eprintln!("[location/nearby] find: {e}"),
        }
    }

    let mut nearby: Vec<LocationDoc> = state.active_users_cache.read().await
        .as_ref()
        .map(|c| c.users.iter().filter(|u| u.user_id != claims.sub).cloned().collect())
        .unwrap_or_default();

    // Filter out users with a block relationship (registered users only).
    if matches!(claims.role.as_str(), "user" | "admin") {
        let blocked = get_blocked_ids(&state.db, &state.block_cache, &claims.sub).await;
        if !blocked.is_empty() {
            nearby.retain(|u| !blocked.contains(&u.user_id));
        }
    }

    let tier     = claims.tier.as_deref().unwrap_or("guest");
    let radius_m = get_nearby_radius_m(&state, tier).await;

    let users: Vec<_> = nearby
        .into_iter()
        .filter_map(|u| {
            let dist = haversine_distance(lat, lon, u.lat, u.lon);
            if dist <= radius_m {
                Some(json!({
                    "userId":       u.user_id,
                    "lat":          u.lat,
                    "lon":          u.lon,
                    "isRegistered": u.is_registered,
                    "sex":          u.sex,
                    "nickname":     u.nickname,
                    "age":          u.age,
                    "accuracy":     u.accuracy.as_deref().unwrap_or("gps"),
                    "distanceM":    dist.round() as i64,
                }))
            } else {
                None
            }
        })
        .collect();

    Json(json!({ "users": users })).into_response()
}

// ── POST /location/online-batch ───────────────────────────────────────────────
// Internal: called by favourites-service only.

#[derive(Deserialize)]
struct OnlineBatchBody {
    #[serde(rename = "userIds")]
    user_ids: Vec<String>,
}

async fn post_online_batch(
    ServiceToken(svc): ServiceToken,
    State(state): State<AppState>,
    Json(body): Json<OnlineBatchBody>,
) -> impl IntoResponse {
    if svc.sub != "favourites" {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "Not authorised." }))).into_response();
    }
    if !body.user_ids.iter().all(|id| !id.is_empty()) {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "userIds must be a non-empty array of strings." }))).into_response();
    }

    let cutoff = BsonDateTime::from_millis(now_ms() - LOCATION_TTL.as_millis() as i64);
    match state.db
        .collection::<Document>("locations")
        .find(doc! { "userId": { "$in": &body.user_ids }, "updatedAt": { "$gt": cutoff } })
        .projection(doc! { "userId": 1 })
        .await
    {
        Ok(cursor) => {
            let docs: Vec<Document> = cursor.try_collect().await.unwrap_or_default();
            let online: Vec<_> = docs.iter()
                .filter_map(|d| d.get_str("userId").ok().map(|s| s.to_string()))
                .collect();
            Json(json!({ "online": online })).into_response()
        }
        Err(e) => { eprintln!("[location/online-batch] {e}"); (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response() }
    }
}

// ── GET /location/user/:userId ────────────────────────────────────────────────
// Internal: called by messages-service only (also requires a valid user JWT).

async fn get_user_location(
    ServiceToken(svc): ServiceToken,
    AuthToken(_claims): AuthToken,
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> impl IntoResponse {
    if svc.sub != "messages" {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "Not authorised." }))).into_response();
    }

    match state.db
        .collection::<LocationCheck>("locations")
        .find_one(doc! { "userId": &user_id })
        .await
    {
        Ok(Some(loc)) => Json(json!({
            "lat":       loc.lat,
            "lon":       loc.lon,
            "updatedAt": loc.updated_at.to_string(),
        })).into_response(),
        Ok(None)  => (StatusCode::NOT_FOUND, Json(json!({ "error": "Location not found." }))).into_response(),
        Err(e)    => { eprintln!("[location/user/:id] {e}"); (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response() }
    }
}

// ── Main ──────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let cfg = Config::from_env().unwrap_or_else(|e| {
        eprintln!("{e}");
        std::process::exit(1);
    });

    let db = Client::with_uri_str(&cfg.mongo_uri)
        .await
        .expect("Failed to connect to MongoDB")
        .database(&cfg.db_name);
    println!("[location] DB connected.");

    let state = AppState {
        db,
        jwt_secret:         cfg.jwt_secret,
        fav_service_url:    cfg.fav_service_url,
        tiers_service_url:  cfg.tiers_service_url,
        http:               reqwest::Client::new(),
        svc_token_cache:    Arc::new(ServiceTokenCache::new()),
        active_users_cache: Arc::new(RwLock::new(None)),
        block_cache:        Arc::new(RwLock::new(HashMap::new())),
        tier_radius_cache:  Arc::new(RwLock::new(HashMap::new())),
    };

    let app = Router::new()
        .route("/health",                   get(health))
        .route("/location",                 put(put_location))
        .route("/location",                 delete(delete_location))
        .route("/location/nearby",          get(get_nearby))
        .route("/location/online-batch",    post(post_online_batch))
        .route("/location/user/{user_id}",  get(get_user_location))
        .fallback(|| async { (StatusCode::NOT_FOUND, Json(json!({ "error": "Not found." }))) })
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", cfg.port))
        .await
        .unwrap();
    println!("[location] Running on :{}", cfg.port);
    axum::serve(listener, app).await.unwrap();
}
