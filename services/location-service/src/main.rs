// ============================================================
// bOOmbOOm.NOW! — location-service (Rust)
// Replaces services/location-service.js.
// Identical HTTP contract — gateway needs no changes.
// ============================================================

mod db_store;
mod location_store;
mod store;

use std::{
    collections::{HashMap, HashSet},
    env,
    sync::Arc,
    time::Duration,
};
use location_store::Store;

use axum::{
    extract::{FromRef, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{delete, get, post, put},
    Router,
};
use common::{
    auth::{AuthedByGateway, JwtSecret, ProfileFromToken, ServiceSecret, ServiceToken},
    models::BlockDoc,
    service_token::ServiceTokenCache,
};
use futures_util::TryStreamExt;
use mongodb::{
    bson::{doc, Document},
    Client, Database,
};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::json;
use store::{LocationEntry, MemoryStore, UpsertResult};
#[allow(unused_imports)]
use db_store::DbStore;
use tokio::sync::RwLock;

// ── Config ────────────────────────────────────────────────────────────────────

fn parse_service_url(raw: &str, name: &str, allowed_host: &str) -> Result<String, String> {
    let url = Url::parse(raw)
        .map_err(|e| format!("FATAL: {name} is not a valid URL: {e}"))?;
    match url.scheme() {
        "http" | "https" => {}
        s => return Err(format!("FATAL: {name} scheme must be http or https, got '{s}'")),
    }
    let host = url.host_str().unwrap_or("");
    if host != allowed_host {
        return Err(format!(
            "FATAL: {name} host '{host}' does not match allowed host '{allowed_host}' \
             (set via {name}_ALLOWED_HOST)"
        ));
    }
    Ok(raw.trim_end_matches('/').to_string())
}

struct Config {
    port:               u16,
    mongo_uri:          String,
    db_name:            String,
    jwt_secret:         String,
    service_secret:     String,
    fav_service_url:    String,
    authority_service_url:  String,
    shard_m:            f64,
    nearby_limit:       usize,
    ttl:                Duration,
    update_interval:    Duration,
    update_distance_m:  f64,
    sweep_interval:     Duration,
    location_store:     String,   // "memory" | "db"
}

impl Config {
    fn from_env() -> Result<Self, String> {
        let required = [
            "JWT_SECRET", "SERVICE_SECRET", "MONGO_URI",
            "FAV_SERVICE_URL",       "FAV_SERVICE_ALLOWED_HOST",
            "AUTHORITY_SERVICE_URL", "AUTHORITY_SERVICE_ALLOWED_HOST",
        ];
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
            service_secret:    env::var("SERVICE_SECRET").unwrap(),
            fav_service_url:   parse_service_url(
                &env::var("FAV_SERVICE_URL").unwrap(),
                "FAV_SERVICE_URL",
                &env::var("FAV_SERVICE_ALLOWED_HOST").unwrap(),
            )?,
            authority_service_url: parse_service_url(
                &env::var("AUTHORITY_SERVICE_URL").unwrap(),
                "AUTHORITY_SERVICE_URL",
                &env::var("AUTHORITY_SERVICE_ALLOWED_HOST").unwrap(),
            )?,
            shard_m:           env::var("LOCATION_SHARD_SIZE_M")
                                   .ok().and_then(|v| v.parse().ok()).unwrap_or(2_000.0),
            nearby_limit:      env::var("LOCATION_NEARBY_LIMIT")
                                   .ok().and_then(|v| v.parse().ok()).unwrap_or(200),
            ttl:               Duration::from_secs(
                                   env::var("LOCATION_TTL_SECS")
                                       .ok().and_then(|v| v.parse().ok()).unwrap_or(600)),
            update_interval:   Duration::from_secs(
                                   env::var("LOCATION_UPDATE_INTERVAL_SECS")
                                       .ok().and_then(|v| v.parse().ok()).unwrap_or(15)),
            update_distance_m: env::var("LOCATION_UPDATE_DISTANCE_M")
                                   .ok().and_then(|v| v.parse().ok()).unwrap_or(100.0),
            sweep_interval:    Duration::from_secs(
                                   env::var("LOCATION_SWEEP_INTERVAL_SECS")
                                       .ok().and_then(|v| v.parse().ok()).unwrap_or(300)),
            location_store:    env::var("LOCATION_STORE").unwrap_or_else(|_| "memory".to_string()),
        })
    }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BLOCK_CACHE_TTL:      Duration = Duration::from_secs(30);
const TIER_RADIUS_CACHE_TTL: Duration = Duration::from_secs(5 * 60);

// ── Cache structs ─────────────────────────────────────────────────────────────

struct BlockCacheEntry {
    ids:        HashSet<String>,
    expires_at: std::time::Instant,
}

struct TierRadiusCacheEntry {
    radius_m:   f64,
    expires_at: std::time::Instant,
}

struct NearbyCache {
    results:    Vec<store::NearbyResult>,
    expires_at: std::time::Instant,
}

// ── App state ─────────────────────────────────────────────────────────────────

/// Read-only location configuration exposed via GET /admin/config.
#[derive(Clone, Serialize)]
struct LocationAdminConfig {
    store_type:           String,
    ttl_secs:             u64,
    shard_size_m:         f64,
    update_interval_secs: u64,
    update_distance_m:    f64,
    sweep_interval_secs:  u64,
    nearby_limit:         usize,
}

#[derive(Clone)]
struct AppState {
    db:                  Database,
    store:               Arc<Store>,
    nearby_limit:        usize,
    jwt_secret:          String,
    service_secret:      String,
    fav_service_url:     String,
    authority_service_url:   String,
    http:                reqwest::Client,
    svc_token_cache:     Arc<ServiceTokenCache>,
    nearby_cache:        Arc<RwLock<HashMap<String, NearbyCache>>>,
    block_cache:         Arc<RwLock<HashMap<String, BlockCacheEntry>>>,
    tier_radius_cache:   Arc<RwLock<HashMap<String, TierRadiusCacheEntry>>>,
    admin_config:        LocationAdminConfig,
}

impl FromRef<AppState> for JwtSecret {
    fn from_ref(state: &AppState) -> Self { JwtSecret(state.jwt_secret.clone()) }
}
impl FromRef<AppState> for ServiceSecret {
    fn from_ref(state: &AppState) -> Self { ServiceSecret(state.service_secret.clone()) }
}
impl FromRef<AppState> for Database {
    fn from_ref(state: &AppState) -> Self { state.db.clone() }
}

// ── DB document types (non-location) ──────────────────────────────────────────

/// Venue document — queried from the `users` collection for nearby results.
#[derive(Deserialize, Clone)]
struct VenueDoc {
    #[serde(rename = "_id")]
    id:        mongodb::bson::oid::ObjectId,
    nickname:  Option<String>,
    #[serde(rename = "fixedLat")]
    fixed_lat: f64,
    #[serde(rename = "fixedLon")]
    fixed_lon: f64,
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
            if entry.expires_at > std::time::Instant::now() {
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
        BlockCacheEntry { ids: ids.clone(), expires_at: std::time::Instant::now() + BLOCK_CACHE_TTL },
    );

    ids
}

/// Returns the nearby radius in metres for a tier. Uses a 5-minute cache;
/// falls back to static values if tiers-service is unreachable.
async fn get_nearby_radius_m(state: &AppState, tier: &str) -> f64 {
    {
        let cache = state.tier_radius_cache.read().await;
        if let Some(entry) = cache.get(tier) {
            if entry.expires_at > std::time::Instant::now() {
                return entry.radius_m;
            }
        }
    }

    let fallback: f64 = match tier {
        "premium" => 23_000.0,
        "regular" => 1_000.0,
        _ => 500.0,
    };

    // Guard against SSRF: tier must be a safe path segment.
    if tier.is_empty() || tier.len() > 64 || !tier.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        eprintln!("[location] tier radius: invalid tier string");
        return fallback;
    }

    let svc_token = match state.svc_token_cache.get("location", &state.service_secret).await {
        Ok(t)  => t,
        Err(e) => { eprintln!("[location] tier radius: token error: {e}"); return fallback; }
    };

    let radius_m = match state.http
        .get(format!("{}/tiers/radius/nearby/{tier}", state.authority_service_url))
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
        TierRadiusCacheEntry { radius_m, expires_at: std::time::Instant::now() + TIER_RADIUS_CACHE_TTL },
    );

    radius_m
}

/// Fire-and-forget range-sync notification to favourites-service.
fn notify_range_sync(state: AppState, user_id: String, lat: f64, lon: f64) {
    tokio::spawn(async move {
        let svc_token = match state.svc_token_cache.get("location", &state.service_secret).await {
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
    AuthedByGateway(identity): AuthedByGateway,
    ProfileFromToken(profile): ProfileFromToken,
    State(state): State<AppState>,
    Json(body): Json<PutLocationBody>,
) -> impl IntoResponse {
    let (Some(lat), Some(lon)) = (body.lat, body.lon) else {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Valid lat and lon required." }))).into_response();
    };
    if !(-90.0..=90.0).contains(&lat) || !(-180.0..=180.0).contains(&lon) {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Valid lat and lon required." }))).into_response();
    }

    // Venue accounts have a fixed location — GPS pushes are not accepted.
    if identity.account_type == "venue" {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Venue accounts have a fixed location." }))).into_response();
    }

    let user_id  = &identity.sub;
    let is_user  = matches!(identity.role.as_str(), "user" | "admin");
    let accuracy = if body.accuracy.as_deref() == Some("ip") { "ip" } else { "gps" };

    // First push of a session: user not yet in the store.
    let is_first_push = state.store.get_user(user_id).await.is_none();

    let entry = LocationEntry {
        user_id:       user_id.clone(),
        lat,
        lon,
        is_registered: is_user,
        sex:           profile.sex.clone(),
        nickname:      profile.nickname.clone(),
        age:           profile.age.map(|a| a as i32),
        accuracy:      accuracy.to_string(),
        updated_at:    std::time::Instant::now(),
    };

    let result = state.store.upsert(entry).await;
    let skipped = result == UpsertResult::Skipped;

    if is_user && is_first_push && !skipped {
        notify_range_sync(state, user_id.clone(), lat, lon);
    }

    Json(json!({ "ok": true, "skipped": skipped })).into_response()
}

// ── DELETE /location ──────────────────────────────────────────────────────────

async fn delete_location(
    _svc: ServiceToken,
    AuthedByGateway(identity): AuthedByGateway,
    State(state): State<AppState>,
) -> impl IntoResponse {
    state.store.remove(&identity.sub).await;
    Json(json!({ "ok": true })).into_response()
}

// ── GET /location/nearby ──────────────────────────────────────────────────────

#[derive(Deserialize)]
struct NearbyQuery {
    lat: Option<f64>,
    lon: Option<f64>,
}

async fn get_nearby(
    _svc: ServiceToken,
    AuthedByGateway(identity): AuthedByGateway,
    State(state): State<AppState>,
    Query(q): Query<NearbyQuery>,
) -> impl IntoResponse {
    let (Some(lat), Some(lon)) = (q.lat, q.lon) else {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "lat and lon query params required." }))).into_response();
    };

    // Use radius pre-resolved by authority-service when available, otherwise fall back to tiers-service.
    let radius_m = if identity.radii.nearby_m > 0 {
        identity.radii.nearby_m as f64
    } else {
        get_nearby_radius_m(&state, &identity.tier).await
    };

    // Block list (registered users only).
    let mut exclude_ids: HashSet<String> = HashSet::new();
    exclude_ids.insert(identity.sub.clone()); // never show yourself
    if matches!(identity.role.as_str(), "user" | "admin") {
        let blocked = get_blocked_ids(&state.db, &state.block_cache, &identity.sub).await;
        exclude_ids.extend(blocked);
    }

    // Favourite ids — reserved slots that bypass the limit cap.
    // Use the 2-second nearby cache to avoid hammering favourites-service.
    let cache_key = format!("fav:{}", identity.sub);
    let fav_ids: HashSet<String> = {
        let cache_r = state.nearby_cache.read().await;
        if let Some(cached) = cache_r.get(&cache_key) {
            if cached.expires_at > std::time::Instant::now() {
                // Reuse cached fav results as ids (stored as NearbyResult but we
                // only need the ids here — we re-fetch below anyway).
                cached.results.iter().map(|r| r.entry.user_id.clone()).collect()
            } else {
                HashSet::new()
            }
        } else {
            HashSet::new()
        }
    };

    // Fetch fresh fav ids if cache missed.
    let fav_ids = if fav_ids.is_empty() {
        fetch_favourite_ids(&state, &identity.sub, &identity.role).await
    } else {
        fav_ids
    };

    let nearby = state
        .store
        .nearby(lat, lon, radius_m, state.nearby_limit, &exclude_ids, &fav_ids)
        .await;

    // Include venue accounts (fixed location, always visible within range).
    // Venues are separate from the memory store — queried from the users collection.
    let venues: Vec<VenueDoc> = match state.db
        .collection::<VenueDoc>("users")
        .find(doc! { "accountType": "venue", "fixedLat": { "$exists": true }, "fixedLon": { "$exists": true } })
        .projection(doc! { "_id": 1, "nickname": 1, "fixedLat": 1, "fixedLon": 1 })
        .await
    {
        Ok(cursor) => match cursor.try_collect::<Vec<VenueDoc>>().await {
            Ok(docs) => { if docs.is_empty() { eprintln!("[location/nearby] venues: query returned 0 docs"); } docs }
            Err(e)   => { eprintln!("[location/nearby] venues: deserialize error: {e}"); vec![] }
        },
        Err(e) => { eprintln!("[location/nearby] venues: {e}"); vec![] }
    };

    let mut users: Vec<serde_json::Value> = nearby
        .iter()
        .map(|r| json!({
            "userId":       r.entry.user_id,
            "lat":          r.entry.lat,
            "lon":          r.entry.lon,
            "isRegistered": r.entry.is_registered,
            "sex":          r.entry.sex,
            "nickname":     r.entry.nickname,
            "age":          r.entry.age,
            "accuracy":     r.entry.accuracy,
            "distanceM":    r.distance_m.round() as i64,
        }))
        .collect();

    let blocked_for_venues = if matches!(identity.role.as_str(), "user" | "admin") {
        get_blocked_ids(&state.db, &state.block_cache, &identity.sub).await
    } else {
        HashSet::new()
    };

    for v in venues {
        let venue_id = v.id.to_hex();
        if venue_id == identity.sub { continue; }
        if blocked_for_venues.contains(&venue_id) { continue; }
        let dist = common::geo::haversine_distance(lat, lon, v.fixed_lat, v.fixed_lon);
        if dist <= radius_m {
            users.push(json!({
                "userId":       venue_id,
                "lat":          v.fixed_lat,
                "lon":          v.fixed_lon,
                "isRegistered": true,
                "sex":          null,
                "nickname":     v.nickname,
                "age":          null,
                "accuracy":     "fixed",
                "accountType":  "venue",
                "distanceM":    dist.round() as i64,
            }));
        }
    }

    Json(json!({ "users": users })).into_response()
}

/// Fetch the caller's favourite user IDs from favourites-service.
/// Returns an empty set on any error (graceful degradation).
async fn fetch_favourite_ids(state: &AppState, sub: &str, role: &str) -> HashSet<String> {
    if !matches!(role, "user" | "admin") {
        return HashSet::new();
    }
    let svc_token = match state.svc_token_cache.get("location", &state.service_secret).await {
        Ok(t)  => t,
        Err(e) => { eprintln!("[location] fav ids: token error: {e}"); return HashSet::new(); }
    };
    match state.http
        .get(format!("{}/favourites/ids", state.fav_service_url))
        .header("X-Service-Token", &svc_token)
        .header("X-User-Id", sub)
        .timeout(Duration::from_secs(2))
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => {
            r.json::<serde_json::Value>().await
                .ok()
                .and_then(|v| v["userIds"].as_array().cloned())
                .map(|arr| arr.into_iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default()
        }
        Ok(r)  => { eprintln!("[location] fav ids: HTTP {}", r.status()); HashSet::new() }
        Err(e) => { eprintln!("[location] fav ids: {e}"); HashSet::new() }
    }
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

    // Check live users via memory store.
    let mut online: Vec<String> = state.store.online_ids(&body.user_ids).await.into_iter().collect();

    // Venues are always online — check which requested IDs are venue accounts.
    let venue_ids: HashSet<String> = match state.db
        .collection::<Document>("users")
        .find(doc! { "_id": { "$in": body.user_ids.iter().filter_map(|id| {
            mongodb::bson::oid::ObjectId::parse_str(id).ok()
        }).collect::<Vec<_>>() }, "accountType": "venue" })
        .projection(doc! { "_id": 1 })
        .await
    {
        Ok(cursor) => cursor
            .try_collect::<Vec<Document>>()
            .await
            .unwrap_or_default()
            .into_iter()
            .filter_map(|d| d.get_object_id("_id").ok().map(|oid| oid.to_hex()))
            .collect(),
        Err(e) => { eprintln!("[location/online-batch] venue lookup: {e}"); HashSet::new() }
    };

    for vid in venue_ids {
        if !online.contains(&vid) { online.push(vid); }
    }

    Json(json!({ "online": online })).into_response()
}

// ── GET /location/user/:userId ────────────────────────────────────────────────
// Internal: called by messages-service only.

async fn get_user_location(
    ServiceToken(svc): ServiceToken,
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> impl IntoResponse {
    if svc.sub != "messages" {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "Not authorised." }))).into_response();
    }

    if let Some(entry) = state.store.get_user(&user_id).await {
        return Json(json!({
            "lat":       entry.lat,
            "lon":       entry.lon,
            "updatedAt": format!("{:?}", entry.updated_at),
        })).into_response();
    }

    // Not in the live store — check if this is a venue with a fixed position.
    let oid = mongodb::bson::oid::ObjectId::parse_str(&user_id).ok();
    if let Some(oid) = oid {
        match state.db
            .collection::<VenueDoc>("users")
            .find_one(doc! { "_id": oid, "accountType": "venue", "fixedLat": { "$exists": true } })
            .await
        {
            Ok(Some(venue)) => return Json(json!({
                "lat":       venue.fixed_lat,
                "lon":       venue.fixed_lon,
                "updatedAt": "fixed",
            })).into_response(),
            Ok(None)  => {}
            Err(e) => eprintln!("[location/user/:id] venue fallback: {e}"),
        }
    }

    (StatusCode::NOT_FOUND, Json(json!({ "error": "Location not found." }))).into_response()
}

// ── GET /admin/config — read-only location config (gateway enforces admin role) ─

async fn admin_get_config(
    _svc: ServiceToken,
    State(state): State<AppState>,
) -> impl IntoResponse {
    Json(&state.admin_config).into_response()
}

// ── Main ──────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let cfg = Config::from_env().unwrap_or_else(|e| {
        eprintln!("{e}");
        std::process::exit(1);
    });

    let db = Client::with_uri_str(&cfg.mongo_uri)
        .await
        .expect("Failed to connect to MongoDB")
        .database(&cfg.db_name);
    println!("[location] DB connected.");

    // Select backend based on LOCATION_STORE env var.
    let store: Arc<Store> = match cfg.location_store.as_str() {
        "db" => {
            let col = db.collection::<mongodb::bson::Document>("locations");
            println!("[location] Store backend: db (MongoDB)");
            Arc::new(Store::Db(DbStore::new(
                col,
                cfg.shard_m,
                cfg.ttl,
                cfg.update_interval,
                cfg.update_distance_m,
            )))
        }
        _ => {
            println!("[location] Store backend: memory");
            Arc::new(Store::Memory(MemoryStore::new(
                cfg.shard_m,
                cfg.ttl,
                cfg.update_interval,
                cfg.update_distance_m,
            )))
        }
    };

    // Background sweep task.
    {
        let store_sweep = Arc::clone(&store);
        let interval = cfg.sweep_interval;
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(interval);
            ticker.tick().await; // skip immediate first tick
            loop {
                ticker.tick().await;
                store_sweep.sweep().await;
            }
        });
    }

    let admin_config = LocationAdminConfig {
        store_type:           cfg.location_store.clone(),
        ttl_secs:             cfg.ttl.as_secs(),
        shard_size_m:         cfg.shard_m,
        update_interval_secs: cfg.update_interval.as_secs(),
        update_distance_m:    cfg.update_distance_m,
        sweep_interval_secs:  cfg.sweep_interval.as_secs(),
        nearby_limit:         cfg.nearby_limit,
    };

    let state = AppState {
        db,
        store,
        nearby_limit:        cfg.nearby_limit,
        jwt_secret:          cfg.jwt_secret,
        service_secret:      cfg.service_secret,
        fav_service_url:     cfg.fav_service_url,
        authority_service_url:   cfg.authority_service_url,
        http:                reqwest::Client::new(),
        svc_token_cache:     Arc::new(ServiceTokenCache::new()),
        nearby_cache:        Arc::new(RwLock::new(HashMap::new())),
        block_cache:         Arc::new(RwLock::new(HashMap::new())),
        tier_radius_cache:   Arc::new(RwLock::new(HashMap::new())),
        admin_config,
    };

    let app = Router::new()
        .route("/health",                   get(health))
        .route("/location",                 put(put_location))
        .route("/location",                 delete(delete_location))
        .route("/location/nearby",          get(get_nearby))
        .route("/location/online-batch",    post(post_online_batch))
        .route("/location/user/{user_id}",  get(get_user_location))
        .route("/admin/config",             get(admin_get_config))
        .fallback(|| async { (StatusCode::NOT_FOUND, Json(json!({ "error": "Not found." }))) })
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", cfg.port))
        .await
        .unwrap();
    println!("[location] Running on :{}", cfg.port);
    axum::serve(listener, app).await.unwrap();
}
