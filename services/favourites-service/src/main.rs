// ============================================================
// bOOmbOOm.NOW! — favourites-service (Rust)
// Replaces services/favourites-service.js.
// Identical HTTP contract — gateway needs no changes.
// ============================================================

use std::{
    collections::{HashMap, HashSet},
    env,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use axum::{
    extract::{FromRef, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{delete, get, post},
    Router,
};
use common::{
    auth::{JwtSecret, RequireRegistered, ServiceToken},
    geo::haversine_distance,
    mongo::safe_object_id,
    service_token::ServiceTokenCache,
};
use futures_util::TryStreamExt;
use mongodb::{
    bson::{doc, Bson, DateTime as BsonDateTime, Document},
    options::IndexOptions,
    Client, Database, IndexModel,
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
    loc_service_url:   String,
    tiers_service_url: String,
}

impl Config {
    fn from_env() -> Result<Self, String> {
        let required = ["JWT_SECRET", "MONGO_URI", "LOC_SERVICE_URL", "TIERS_SERVICE_URL"];
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
            loc_service_url:   env::var("LOC_SERVICE_URL").unwrap(),
            tiers_service_url: env::var("TIERS_SERVICE_URL").unwrap(),
        })
    }
}

// ── App state ─────────────────────────────────────────────────────────────────

#[derive(Clone)]
struct AppState {
    db:                Database,
    jwt_secret:        String,
    loc_service_url:   String,
    tiers_service_url: String,
    http:              reqwest::Client,
    svc_token_cache:   Arc<ServiceTokenCache>,
    /// Permanent message-radius cache — tiers are treated as static at runtime.
    /// Matches the JS behaviour. Cleared only on service restart.
    radius_cache:      Arc<RwLock<HashMap<String, f64>>>,
}

impl FromRef<AppState> for JwtSecret {
    fn from_ref(state: &AppState) -> Self { JwtSecret(state.jwt_secret.clone()) }
}

impl FromRef<AppState> for Database {
    fn from_ref(state: &AppState) -> Self { state.db.clone() }
}

// ── DB document types ─────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct FavouriteDoc {
    #[serde(rename = "favouriteUserId")]
    favourite_user_id: String,
    #[serde(rename = "addedAt")]
    added_at:          Option<BsonDateTime>,
    #[serde(rename = "withinRange")]
    within_range:      Option<bool>,
    #[serde(rename = "withinRangeAt")]
    within_range_at:   Option<BsonDateTime>,
}

#[derive(Deserialize)]
struct RangeSyncFavDoc {
    #[serde(rename = "ownerUserId")]
    owner_user_id:     String,
    #[serde(rename = "favouriteUserId")]
    favourite_user_id: String,
}

#[derive(Deserialize)]
struct UserProfile {
    #[serde(rename = "_id")]
    id:       mongodb::bson::oid::ObjectId,
    nickname: Option<String>,
    sex:      Option<String>,
}

#[derive(Deserialize)]
struct UserTier {
    #[serde(rename = "_id")]
    id:   mongodb::bson::oid::ObjectId,
    tier: Option<String>,
}

#[derive(Deserialize)]
struct LocationEntry {
    #[serde(rename = "userId")]
    user_id: String,
    lat:     f64,
    lon:     f64,
}

#[derive(Deserialize)]
struct NotificationDoc {
    #[serde(rename = "_id")]
    id:            mongodb::bson::oid::ObjectId,
    #[serde(rename = "fromUserId")]
    from_user_id:  String,
    #[serde(rename = "fromNickname")]
    from_nickname: Option<String>,
    #[serde(rename = "fromSex")]
    from_sex:      Option<String>,
    #[serde(rename = "type")]
    type_:         String,
    #[serde(rename = "createdAt")]
    created_at:    Option<BsonDateTime>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Fetch the message radius for a tier from tiers-service.
/// Permanently cached — tiers treated as static at runtime (matches JS).
/// Returns `None` if the call fails (caller should skip the pair).
async fn get_message_radius(state: &AppState, tier: &str) -> Option<f64> {
    {
        let cache = state.radius_cache.read().await;
        if let Some(r) = cache.get(tier) {
            return Some(*r);
        }
    }

    let svc_token = state.svc_token_cache.get("favourites", &state.jwt_secret).await.ok()?;

    let resp = state.http
        .get(format!("{}/tiers/radius/message/{tier}", state.tiers_service_url))
        .header("X-Service-Token", &svc_token)
        .timeout(Duration::from_secs(3))
        .send()
        .await
        .ok()?;

    if !resp.status().is_success() {
        eprintln!("[favourites] tiers-service message radius: HTTP {}", resp.status());
        return None;
    }

    let radius_m = resp.json::<serde_json::Value>().await.ok()
        .and_then(|v| v["radiusM"].as_f64())?;

    state.radius_cache.write().await.insert(tier.to_string(), radius_m);
    Some(radius_m)
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async fn health(State(state): State<AppState>) -> impl IntoResponse {
    match state.db.run_command(doc! { "ping": 1 }).await {
        Ok(_)  => Json(json!({ "ok": true })).into_response(),
        Err(_) => (StatusCode::SERVICE_UNAVAILABLE, Json(json!({ "ok": false, "error": "DB unreachable" }))).into_response(),
    }
}

// ── GET /favourites ───────────────────────────────────────────────────────────

async fn get_favourites(
    _svc: ServiceToken,
    RequireRegistered(claims): RequireRegistered,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let entries: Vec<FavouriteDoc> = match state.db
        .collection::<FavouriteDoc>("favourites")
        .find(doc! { "ownerUserId": &claims.sub })
        .sort(doc! { "addedAt": -1 })
        .await
    {
        Ok(c)  => c.try_collect().await.unwrap_or_default(),
        Err(e) => { eprintln!("[favourites GET] find: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };

    if entries.is_empty() {
        return Json(json!({ "favourites": [] })).into_response();
    }

    // Enrich with nickname/sex
    let oids: Vec<_> = entries.iter()
        .filter_map(|e| safe_object_id(&e.favourite_user_id))
        .collect();
    let users: Vec<UserProfile> = match state.db
        .collection::<UserProfile>("users")
        .find(doc! { "_id": { "$in": &oids } })
        .projection(doc! { "_id": 1, "nickname": 1, "sex": 1 })
        .await
    {
        Ok(c)  => c.try_collect().await.unwrap_or_default(),
        Err(_) => vec![],
    };
    let user_map: HashMap<String, &UserProfile> = users.iter()
        .map(|u| (u.id.to_hex(), u))
        .collect();

    // Check online status — degrade gracefully if location-service is unreachable
    let online_set: HashSet<String> = async {
        let svc_token = state.svc_token_cache.get("favourites", &state.jwt_secret).await
            .map_err(|e| anyhow::anyhow!(e))?;
        let fav_ids: Vec<&str> = entries.iter().map(|e| e.favourite_user_id.as_str()).collect();
        let resp = state.http
            .post(format!("{}/location/online-batch", state.loc_service_url))
            .header("X-Service-Token", &svc_token)
            .json(&json!({ "userIds": fav_ids }))
            .send()
            .await?;
        let data: serde_json::Value = resp.json().await?;
        anyhow::Ok(
            data["online"].as_array()
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default()
        )
    }
    .await
    .unwrap_or_default();

    let favourites: Vec<_> = entries.iter()
        .filter(|e| user_map.contains_key(&e.favourite_user_id))
        .map(|e| {
            let u = &user_map[&e.favourite_user_id];
            json!({
                "userId":        e.favourite_user_id,
                "nickname":      u.nickname.as_deref().unwrap_or(&e.favourite_user_id),
                "sex":           u.sex.as_deref(),
                "online":        online_set.contains(&e.favourite_user_id),
                "addedAt":       e.added_at.map(|d| d.to_string()),
                "withinRange":   e.within_range,
                "withinRangeAt": e.within_range_at.map(|d| d.to_string()),
            })
        })
        .collect();

    Json(json!({ "favourites": favourites })).into_response()
}

// ── POST /favourites/:userId ──────────────────────────────────────────────────

async fn post_favourite(
    _svc: ServiceToken,
    RequireRegistered(claims): RequireRegistered,
    State(state): State<AppState>,
    Path(favourite_user_id): Path<String>,
) -> impl IntoResponse {
    if claims.sub == favourite_user_id {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Cannot favourite yourself." }))).into_response();
    }

    let oid = match safe_object_id(&favourite_user_id) {
        Some(id) => id,
        None     => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid user id." }))).into_response(),
    };

    match state.db.collection::<Document>("users")
        .find_one(doc! { "_id": oid })
        .projection(doc! { "_id": 1 })
        .await
    {
        Ok(Some(_)) => {}
        Ok(None)    => return (StatusCode::NOT_FOUND, Json(json!({ "error": "User not found." }))).into_response(),
        Err(e)      => { eprintln!("[favourites POST] user lookup: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    }

    match state.db.collection::<Document>("favourites")
        .insert_one(doc! {
            "ownerUserId":     &claims.sub,
            "favouriteUserId": &favourite_user_id,
            "addedAt":         BsonDateTime::now(),
        })
        .await
    {
        Err(e) if e.to_string().contains("11000") =>
            return (StatusCode::CONFLICT, Json(json!({ "error": "Already in favourites." }))).into_response(),
        Err(e) => { eprintln!("[favourites POST] insert: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
        Ok(_) => {}
    }

    // Notify the favourited user — upsert so remove+re-add doesn't stack up
    let notif_result: anyhow::Result<()> = async {
        let owner_oid = safe_object_id(&claims.sub).ok_or_else(|| anyhow::anyhow!("bad oid"))?;
        let owner = state.db.collection::<UserProfile>("users")
            .find_one(doc! { "_id": owner_oid })
            .projection(doc! { "_id": 1, "nickname": 1, "sex": 1 })
            .await?
            .ok_or_else(|| anyhow::anyhow!("owner not found"))?;
        let from_sex = owner.sex.as_deref().map(Bson::from).unwrap_or(Bson::Null);
        state.db.collection::<Document>("notifications")
            .replace_one(
                doc! {
                    "recipientUserId": &favourite_user_id,
                    "fromUserId":      &claims.sub,
                    "type":            "new_favourite",
                },
                doc! {
                    "recipientUserId": &favourite_user_id,
                    "fromUserId":      &claims.sub,
                    "fromNickname":    owner.nickname.as_deref().unwrap_or(""),
                    "fromSex":         from_sex,
                    "type":            "new_favourite",
                    "createdAt":       BsonDateTime::now(),
                },
            )
            .upsert(true)
            .await?;
        Ok(())
    }.await;

    if let Err(e) = notif_result {
        eprintln!("[favourites POST] notification: {e}");
    }

    (StatusCode::CREATED, Json(json!({ "ok": true }))).into_response()
}

// ── GET /favourites/is-mutual/:userId ─────────────────────────────────────────

async fn get_is_mutual(
    _svc: ServiceToken,
    RequireRegistered(claims): RequireRegistered,
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> impl IntoResponse {
    if claims.sub == user_id {
        return Json(json!({ "mutual": false })).into_response();
    }

    let fav_coll = state.db.collection::<Document>("favourites");
    let (my_doc, their_doc) = tokio::join!(
        fav_coll.find_one(doc! { "ownerUserId": &claims.sub, "favouriteUserId": &user_id }),
        fav_coll.find_one(doc! { "ownerUserId": &user_id, "favouriteUserId": &claims.sub }),
    );

    match (my_doc, their_doc) {
        (Ok(my), Ok(their)) => Json(json!({ "mutual": my.is_some() && their.is_some() })).into_response(),
        _ => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(),
    }
}

// ── GET /favourites/pair-status ───────────────────────────────────────────────
// Internal: service-token only. Called by messages-service.

#[derive(Deserialize)]
struct PairStatusQuery {
    sender:    Option<String>,
    recipient: Option<String>,
}

async fn get_pair_status(
    _svc: ServiceToken,
    State(state): State<AppState>,
    Query(q): Query<PairStatusQuery>,
) -> impl IntoResponse {
    let (Some(sender), Some(recipient)) = (q.sender, q.recipient) else {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "sender and recipient query params required." }))).into_response();
    };

    let fav_coll = state.db.collection::<Document>("favourites");
    let (sender_doc, recip_doc) = tokio::join!(
        fav_coll.find_one(doc! { "ownerUserId": &sender,    "favouriteUserId": &recipient }),
        fav_coll.find_one(doc! { "ownerUserId": &recipient, "favouriteUserId": &sender }),
    );

    let (Ok(sender_doc), Ok(recip_doc)) = (sender_doc, recip_doc) else {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response();
    };

    let mutual       = sender_doc.is_some() && recip_doc.is_some();
    let within_range = sender_doc.and_then(|d| d.get_bool("withinRange").ok());

    Json(json!({ "mutual": mutual, "withinRange": within_range })).into_response()
}

// ── POST /favourites/internal/range-sync ──────────────────────────────────────
// Internal: service-token only. Called by location-service on each location push.

#[derive(Deserialize)]
struct RangeSyncBody {
    #[serde(rename = "userId")]
    user_id: Option<String>,
    lat:     Option<f64>,
    lon:     Option<f64>,
}

async fn post_range_sync(
    _svc: ServiceToken,
    State(state): State<AppState>,
    Json(body): Json<RangeSyncBody>,
) -> impl IntoResponse {
    let (Some(user_id), Some(lat), Some(lon)) = (body.user_id, body.lat, body.lon) else {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "userId, lat, lon required." }))).into_response();
    };

    if safe_object_id(&user_id).is_none() {
        return Json(json!({ "ok": true, "updated": 0 })).into_response();
    }

    // Find all favourite pairs involving this user
    let docs: Vec<RangeSyncFavDoc> = match state.db
        .collection::<RangeSyncFavDoc>("favourites")
        .find(doc! { "$or": [{ "ownerUserId": &user_id }, { "favouriteUserId": &user_id }] })
        .await
    {
        Ok(c)  => c.try_collect().await.unwrap_or_default(),
        Err(e) => { eprintln!("[range-sync] find favourites: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };

    if docs.is_empty() {
        return Json(json!({ "ok": true, "updated": 0 })).into_response();
    }

    // Unique IDs of the other parties
    let other_ids: Vec<String> = docs.iter()
        .map(|d| if d.owner_user_id == user_id { d.favourite_user_id.clone() } else { d.owner_user_id.clone() })
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();

    // Fetch active locations for the other users directly from DB (same instance)
    let location_ttl_ms = 10 * 60 * 1000_i64;
    let cutoff = BsonDateTime::from_millis(
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as i64 - location_ttl_ms
    );
    let other_locs: Vec<LocationEntry> = match state.db
        .collection::<LocationEntry>("locations")
        .find(doc! { "userId": { "$in": &other_ids }, "updatedAt": { "$gt": cutoff } })
        .projection(doc! { "userId": 1, "lat": 1, "lon": 1 })
        .await
    {
        Ok(c)  => c.try_collect().await.unwrap_or_default(),
        Err(e) => { eprintln!("[range-sync] find locations: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };

    if other_locs.is_empty() {
        return Json(json!({ "ok": true, "updated": 0 })).into_response();
    }

    // Fetch user's own tier
    let user_tier = {
        let oid = safe_object_id(&user_id).unwrap(); // already checked above
        state.db.collection::<Document>("users")
            .find_one(doc! { "_id": oid })
            .projection(doc! { "tier": 1 })
            .await
            .ok()
            .flatten()
            .and_then(|d| d.get_str("tier").ok().map(String::from))
            .unwrap_or_else(|| "regular".to_string())
    };

    // Fetch tiers for all other users in one query
    let other_oids: Vec<_> = other_locs.iter().filter_map(|l| safe_object_id(&l.user_id)).collect();
    let other_users: Vec<UserTier> = match state.db
        .collection::<UserTier>("users")
        .find(doc! { "_id": { "$in": &other_oids } })
        .projection(doc! { "_id": 1, "tier": 1 })
        .await
    {
        Ok(c)  => c.try_collect().await.unwrap_or_default(),
        Err(_) => vec![],
    };
    let tier_map: HashMap<String, String> = other_users.iter()
        .map(|u| (u.id.to_hex(), u.tier.clone().unwrap_or_else(|| "regular".to_string())))
        .collect();

    let mut updated = 0u32;

    for other_loc in &other_locs {
        let other_tier = tier_map.get(&other_loc.user_id)
            .map(String::as_str)
            .unwrap_or("regular");

        let (radius_a, radius_b) = tokio::join!(
            get_message_radius(&state, &user_tier),
            get_message_radius(&state, other_tier),
        );

        let (Some(radius_a), Some(radius_b)) = (radius_a, radius_b) else {
            continue; // skip pair if tiers-service is unreachable
        };

        let dist        = haversine_distance(lat, lon, other_loc.lat, other_loc.lon);
        let within_range = (radius_a == -1.0 || dist <= radius_a)
                        && (radius_b == -1.0 || dist <= radius_b);

        let range_set = if within_range {
            doc! { "withinRange": within_range, "withinRangeAt": BsonDateTime::now() }
        } else {
            doc! { "withinRange": within_range }
        };

        let fav_coll = state.db.collection::<Document>("favourites");
        let _ = tokio::join!(
            fav_coll.update_one(
                doc! { "ownerUserId": &user_id,       "favouriteUserId": &other_loc.user_id },
                doc! { "$set": range_set.clone() },
            ),
            fav_coll.update_one(
                doc! { "ownerUserId": &other_loc.user_id, "favouriteUserId": &user_id },
                doc! { "$set": range_set },
            ),
        );
        updated += 1;
    }

    Json(json!({ "ok": true, "updated": updated })).into_response()
}

// ── DELETE /favourites/:userId ────────────────────────────────────────────────

async fn delete_favourite(
    _svc: ServiceToken,
    RequireRegistered(claims): RequireRegistered,
    State(state): State<AppState>,
    Path(favourite_user_id): Path<String>,
) -> impl IntoResponse {
    match state.db.collection::<Document>("favourites")
        .delete_one(doc! { "ownerUserId": &claims.sub, "favouriteUserId": &favourite_user_id })
        .await
    {
        Ok(r) if r.deleted_count == 0 => (StatusCode::NOT_FOUND, Json(json!({ "error": "Favourite not found." }))).into_response(),
        Ok(_)  => Json(json!({ "ok": true })).into_response(),
        Err(e) => { eprintln!("[favourites DELETE] {e}"); (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response() }
    }
}

// ── GET /notifications ────────────────────────────────────────────────────────

async fn get_notifications(
    _svc: ServiceToken,
    RequireRegistered(claims): RequireRegistered,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let items: Vec<NotificationDoc> = match state.db
        .collection::<NotificationDoc>("notifications")
        .find(doc! { "recipientUserId": &claims.sub })
        .sort(doc! { "createdAt": -1 })
        .limit(20)
        .await
    {
        Ok(c)  => c.try_collect().await.unwrap_or_default(),
        Err(e) => { eprintln!("[notifications GET] {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };

    let notifications: Vec<_> = items.iter().map(|n| json!({
        "id":           n.id.to_hex(),
        "fromUserId":   n.from_user_id,
        "fromNickname": n.from_nickname.as_deref(),
        "fromSex":      n.from_sex.as_deref(),
        "type":         n.type_,
        "createdAt":    n.created_at.map(|d| d.to_string()),
    })).collect();

    Json(json!({ "notifications": notifications })).into_response()
}

// ── DELETE /notifications/:id ─────────────────────────────────────────────────

async fn delete_notification(
    _svc: ServiceToken,
    RequireRegistered(claims): RequireRegistered,
    State(state): State<AppState>,
    Path(notif_id): Path<String>,
) -> impl IntoResponse {
    let oid = match safe_object_id(&notif_id) {
        Some(id) => id,
        None     => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid notification id." }))).into_response(),
    };

    match state.db.collection::<Document>("notifications")
        .delete_one(doc! { "_id": oid, "recipientUserId": &claims.sub })
        .await
    {
        Ok(r) if r.deleted_count == 0 => (StatusCode::NOT_FOUND, Json(json!({ "error": "Notification not found." }))).into_response(),
        Ok(_)  => Json(json!({ "ok": true })).into_response(),
        Err(e) => { eprintln!("[notifications DELETE] {e}"); (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response() }
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
    println!("[favourites] DB connected.");

    // Ensure notifications TTL index (auto-expire after 30 days)
    let ttl_index = IndexModel::builder()
        .keys(doc! { "createdAt": 1 })
        .options(
            IndexOptions::builder()
                .expire_after(Duration::from_secs(30 * 24 * 3600))
                .build(),
        )
        .build();
    if let Err(e) = db.collection::<Document>("notifications").create_index(ttl_index).await {
        eprintln!("[favourites] TTL index: {e}");
    } else {
        println!("[favourites] Notifications TTL index ensured.");
    }

    let state = AppState {
        db,
        jwt_secret:        cfg.jwt_secret,
        loc_service_url:   cfg.loc_service_url,
        tiers_service_url: cfg.tiers_service_url,
        http:              reqwest::Client::new(),
        svc_token_cache:   Arc::new(ServiceTokenCache::new()),
        radius_cache:      Arc::new(RwLock::new(HashMap::new())),
    };

    let app = Router::new()
        .route("/health",                                  get(health))
        .route("/favourites",                              get(get_favourites))
        .route("/favourites/{user_id}",                    post(post_favourite))
        .route("/favourites/{user_id}",                    delete(delete_favourite))
        .route("/favourites/is-mutual/{user_id}",          get(get_is_mutual))
        .route("/favourites/pair-status",                  get(get_pair_status))
        .route("/favourites/internal/range-sync",          post(post_range_sync))
        .route("/notifications",                           get(get_notifications))
        .route("/notifications/{notif_id}",                delete(delete_notification))
        .fallback(|| async { (StatusCode::NOT_FOUND, Json(json!({ "error": "Not found." }))) })
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", cfg.port))
        .await
        .unwrap();
    println!("[favourites] Running on :{}", cfg.port);
    axum::serve(listener, app).await.unwrap();
}
