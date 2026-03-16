// ============================================================
// bOOmbOOm.NOW! — tiers-service (Rust)
// Replaces services/tiers-service.js (moved to services-node/).
// Identical HTTP contract — gateway needs no changes.
// ============================================================

use std::{
    collections::HashMap,
    env,
    sync::{Arc, LazyLock},
    time::{Duration, Instant},
};

use axum::{
    extract::{FromRef, Path, State},
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use common::auth::{AdminUser, JwtSecret, ServiceToken};
use futures_util::TryStreamExt;
use mongodb::{bson::{doc, oid::ObjectId, DateTime}, Client, Database};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::RwLock;

// ── Config ────────────────────────────────────────────────────────────────────

struct Config {
    port:       u16,
    jwt_secret: String,
    mongo_uri:  String,
    db_name:    String,
}

impl Config {
    fn from_env() -> Result<Self, String> {
        let missing: Vec<&str> = ["JWT_SECRET", "MONGO_URI"]
            .into_iter()
            .filter(|k| env::var(k).is_err())
            .collect();
        if !missing.is_empty() {
            return Err(format!("FATAL: missing env vars: {}", missing.join(", ")));
        }
        Ok(Self {
            port:       env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8080),
            jwt_secret: env::var("JWT_SECRET").unwrap(),
            mongo_uri:  env::var("MONGO_URI").unwrap(),
            db_name:    env::var("DB_NAME").unwrap_or_else(|_| "boomboom".to_string()),
        })
    }
}

// ── Tier ranks ────────────────────────────────────────────────────────────────

fn tier_rank(tier: &str) -> u32 {
    match tier {
        "guest"     => 0,
        "regular"   => 1,
        "premium"   => 2,
        "developer" => 3,
        _           => 0,
    }
}

/// Mirrors the static `TIERS` object in the JS version.
/// developer is code-only until T-01 (admin UI).
fn is_known_tier(tier: &str) -> bool {
    matches!(tier, "guest" | "regular" | "premium" | "developer")
}

// ── Feature definitions ───────────────────────────────────────────────────────

#[derive(Serialize)]
struct Feature {
    #[serde(rename = "minTier")]
    min_tier: &'static str,
}

/// TO ADD A NEW FEATURE:
///   1. Add an entry here with a min_tier.
///   2. Add the route in server.js with the feature key.
///   That's it — the gateway enforces it automatically.
static FEATURES: LazyLock<HashMap<&'static str, Feature>> = LazyLock::new(|| {
    HashMap::from([
        ("see_map",           Feature { min_tier: "guest" }),
        ("see_nearby",        Feature { min_tier: "guest" }),
        ("message_online",    Feature { min_tier: "regular" }),
        ("message_offline",   Feature { min_tier: "regular" }),
        ("message_radius",    Feature { min_tier: "regular" }),
        ("manage_favourites", Feature { min_tier: "regular" }),
    ])
});

fn can(tier: &str, feature: &str) -> bool {
    FEATURES
        .get(feature)
        .is_some_and(|f| tier_rank(tier) >= tier_rank(f.min_tier))
}

// ── Tier document ─────────────────────────────────────────────────────────────

/// Mirrors the document shape seeded by migration 004_tiers_seed.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Tier {
    name:             String,
    label:            String,
    cls:              String,
    rank:             u32,
    // Accept both camelCase (admin-API-created docs) and snake_case (migration-seeded docs).
    #[serde(alias = "nearby_radius_m")]
    nearby_radius_m:  u32,
    #[serde(alias = "message_radius_m")]
    message_radius_m: Option<u32>,
}

fn static_tiers() -> HashMap<String, Tier> {
    HashMap::from([
        ("guest".into(),     Tier { name: "guest".into(),     label: "Guest".into(),     cls: "secondary".into(), rank: 0, nearby_radius_m: 500,       message_radius_m: None }),
        ("regular".into(),   Tier { name: "regular".into(),   label: "Regular".into(),   cls: "primary".into(),   rank: 1, nearby_radius_m: 1_000,     message_radius_m: Some(1000) }),
        ("premium".into(),   Tier { name: "premium".into(),   label: "Premium".into(),   cls: "warning".into(),   rank: 2, nearby_radius_m: 23_000,    message_radius_m: Some(23_000) }),
        ("developer".into(), Tier { name: "developer".into(), label: "Developer".into(), cls: "warning".into(),   rank: 3, nearby_radius_m: 9_700_000, message_radius_m: Some(9_700_000) })
    ])
}

// ── Tiers cache (60 s TTL) ────────────────────────────────────────────────────

const TIERS_CACHE_TTL: Duration = Duration::from_secs(60);

struct TiersCache {
    tiers:      HashMap<String, Tier>,
    expires_at: Instant,
}

async fn load_tiers(cache: &RwLock<Option<TiersCache>>, db: &Database) -> HashMap<String, Tier> {
    // Fast path — return cached data while still fresh
    {
        let guard = cache.read().await;
        if let Some(c) = guard.as_ref() {
            if c.expires_at > Instant::now() {
                return c.tiers.clone();
            }
        }
    }

    // Reload from DB, fall back to static if collection is empty or unreachable
    let tiers = match db.collection::<Tier>("tiers").find(doc! {}).await {
        Err(_) => static_tiers(),
        Ok(cursor) => {
            let docs: Vec<Tier> = cursor.try_collect().await.unwrap_or_default();
            if docs.is_empty() {
                static_tiers()
            } else {
                docs.into_iter().map(|t| (t.name.clone(), t)).collect()
            }
        }
    };

    *cache.write().await = Some(TiersCache {
        tiers:      tiers.clone(),
        expires_at: Instant::now() + TIERS_CACHE_TTL,
    });
    tiers
}

// ── App state ─────────────────────────────────────────────────────────────────

#[derive(Clone)]
struct AppState {
    db:          Database,
    jwt_secret:  JwtSecret,
    tiers_cache: Arc<RwLock<Option<TiersCache>>>,
}

impl FromRef<AppState> for JwtSecret {
    fn from_ref(state: &AppState) -> Self {
        state.jwt_secret.clone()
    }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async fn health(State(state): State<AppState>) -> impl IntoResponse {
    match state.db.run_command(doc! { "ping": 1 }).await {
        Ok(_)  => Json(json!({ "ok": true })).into_response(),
        Err(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "ok": false, "error": "DB unreachable" })),
        ).into_response(),
    }
}

/// GET /tiers/info — badge labels and colours for all tiers
async fn tiers_info(_: ServiceToken, State(state): State<AppState>) -> Json<serde_json::Value> {
    let tiers = load_tiers(&state.tiers_cache, &state.db).await;
    let info: HashMap<&str, _> = tiers
        .values()
        .map(|t| (t.name.as_str(), json!({ "label": t.label, "cls": t.cls })))
        .collect();
    Json(json!({ "tiers": info }))
}

/// GET /tiers/:name/info — full tier info for UI rendering (profile badge)
async fn tier_info(
    _: ServiceToken,
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    let tiers = load_tiers(&state.tiers_cache, &state.db).await;
    let Some(tier) = tiers.get(&name) else {
        return (StatusCode::NOT_FOUND, Json(json!({ "error": "Unknown tier." }))).into_response();
    };
    let features: Vec<&str> = FEATURES
        .keys()
        .copied()
        .filter(|&f| can(&tier.name, f))
        .collect();
    Json(json!({
        "name":           tier.name,
        "label":          tier.label,
        "cls":            tier.cls,
        "nearbyRadiusM":  tier.nearby_radius_m,
        "messageRadiusM": tier.message_radius_m,
        "features":       features,
    }))
    .into_response()
}

/// GET /tiers/features — full feature definitions (for introspection)
async fn tiers_features(_: ServiceToken) -> Json<serde_json::Value> {
    Json(json!({ "features": &*FEATURES }))
}

/// POST /tiers/check — primary tier enforcement endpoint used by gateway
/// Body: { "tier": "regular", "feature": "message_online" }
#[derive(Deserialize)]
struct CheckBody {
    tier:    Option<String>,
    feature: Option<String>,
}

async fn tiers_check(
    _: ServiceToken,
    Json(body): Json<CheckBody>,
) -> impl IntoResponse {
    let (Some(tier), Some(feature)) = (body.tier, body.feature) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "tier and feature required." })),
        ).into_response();
    };

    if !can(&tier, &feature) {
        let min_tier = FEATURES.get(feature.as_str()).map_or("unknown", |f| f.min_tier);
        return (
            StatusCode::FORBIDDEN,
            Json(json!({
                "error":    format!("This feature requires the '{min_tier}' tier or above."),
                "yourTier": tier,
                "required": min_tier,
            })),
        ).into_response();
    }

    Json(json!({ "allowed": true })).into_response()
}

/// GET /tiers/radius/nearby/:tier
async fn nearby_radius(
    _: ServiceToken,
    State(state): State<AppState>,
    Path(tier): Path<String>,
) -> impl IntoResponse {
    if !is_known_tier(&tier) {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Unknown tier." }))).into_response();
    }
    let tiers    = load_tiers(&state.tiers_cache, &state.db).await;
    let radius_m = tiers.get(&tier).map_or(500, |t| t.nearby_radius_m);
    Json(json!({ "tier": tier, "radiusM": radius_m })).into_response()
}

/// GET /tiers/radius/message/:tier
/// Returns -1 to represent null/Infinity (JSON-safe, mirrors JS behaviour)
async fn message_radius(
    _: ServiceToken,
    State(state): State<AppState>,
    Path(tier): Path<String>,
) -> impl IntoResponse {
    if !is_known_tier(&tier) {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Unknown tier." }))).into_response();
    }
    let tiers    = load_tiers(&state.tiers_cache, &state.db).await;
    let radius_m = tiers
        .get(&tier)
        .and_then(|t| t.message_radius_m)
        .map_or(-1i64, |r| r as i64);
    Json(json!({ "tier": tier, "radiusM": radius_m })).into_response()
}

async fn not_found() -> impl IntoResponse {
    (StatusCode::NOT_FOUND, Json(json!({ "error": "Not found." })))
}

// ── Admin helpers ─────────────────────────────────────────────────────────────

/// Input body for admin tier create / update.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TierInput {
    /// Only required for create (POST). Ignored on update (PUT — name comes from path).
    name:             Option<String>,
    label:            String,
    cls:              String,
    rank:             u32,
    nearby_radius_m:  u32,
    message_radius_m: Option<u32>,
}

fn valid_tier_name(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.chars().next().map_or(false, |c| c.is_ascii_lowercase())
        && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

/// Verify admin tokenVersion against the users collection.
/// Called at the top of every admin handler.
async fn check_admin_tv(
    db: &Database,
    sub: &str,
    tv: u32,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    let oid = ObjectId::parse_str(sub).map_err(|_| (
        StatusCode::UNAUTHORIZED,
        Json(json!({ "error": "Invalid token." })),
    ))?;
    let user = db
        .collection::<mongodb::bson::Document>("users")
        .find_one(doc! { "_id": oid })
        .projection(doc! { "tokenVersion": 1 })
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))))?;
    let db_tv = user
        .as_ref()
        .and_then(|u| u.get_i32("tokenVersion").ok())
        .unwrap_or(0) as u32;
    if db_tv != tv {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Token revoked.", "code": "TOKEN_REVOKED" })),
        ));
    }
    Ok(())
}

// ── Admin handlers ────────────────────────────────────────────────────────────

/// GET /admin/tiers — list all tiers fresh from DB (bypasses the 60 s read cache).
async fn admin_list_tiers(
    _: ServiceToken,
    admin: AdminUser,
    State(state): State<AppState>,
) -> impl IntoResponse {
    if let Err(e) = check_admin_tv(&state.db, &admin.0.sub, admin.0.tv.unwrap_or(0)).await {
        return e.into_response();
    }
    match state.db.collection::<Tier>("tiers").find(doc! {}).await {
        Err(e) => {
            eprintln!("[tiers] admin_list_tiers: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "DB error." }))).into_response()
        }
        Ok(cursor) => {
            let docs: Vec<Tier> = cursor.try_collect().await.unwrap_or_default();
            if docs.is_empty() {
                // Collection not seeded yet — seed static tiers now so edit/delete work immediately.
                let now = DateTime::now();
                let mut seed: Vec<Tier> = static_tiers().into_values().collect();
                seed.sort_by_key(|t| t.rank);
                let bson_docs: Vec<mongodb::bson::Document> = seed.iter().map(|t| doc! {
                    "name":           &t.name,
                    "label":          &t.label,
                    "cls":            &t.cls,
                    "rank":           t.rank as i32,
                    "nearbyRadiusM":  t.nearby_radius_m as i32,
                    "messageRadiusM": t.message_radius_m.map(|v| v as i32),
                    "createdAt":      now,
                    "updatedAt":      now,
                }).collect();
                if !bson_docs.is_empty() {
                    let _ = state.db
                        .collection::<mongodb::bson::Document>("tiers")
                        .insert_many(bson_docs)
                        .await;
                    *state.tiers_cache.write().await = None;
                }
                Json(json!({ "tiers": seed })).into_response()
            } else {
                Json(json!({ "tiers": docs })).into_response()
            }
        }
    }
}

/// POST /admin/tiers — create a new tier.
async fn admin_create_tier(
    _: ServiceToken,
    admin: AdminUser,
    State(state): State<AppState>,
    Json(body): Json<TierInput>,
) -> impl IntoResponse {
    if let Err(e) = check_admin_tv(&state.db, &admin.0.sub, admin.0.tv.unwrap_or(0)).await {
        return e.into_response();
    }
    let name = match &body.name {
        Some(n) => n.clone(),
        None => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "name is required." }))).into_response(),
    };
    if !valid_tier_name(&name) {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "error": "name must start with a lowercase letter and contain only [a-z0-9_], max 64 chars."
        }))).into_response();
    }
    // Shift any existing tiers at or above the chosen rank to make room.
    let _ = state.db
        .collection::<mongodb::bson::Document>("tiers")
        .update_many(
            doc! { "rank": { "$gte": body.rank as i32 } },
            doc! { "$inc": { "rank": 1 } },
        )
        .await;

    let now = DateTime::now();
    let doc = doc! {
        "name":            &name,
        "label":           &body.label,
        "cls":             &body.cls,
        "rank":            body.rank as i32,
        "nearbyRadiusM":   body.nearby_radius_m as i32,
        "messageRadiusM":  body.message_radius_m.map(|v| v as i32),
        "createdAt":       now,
        "updatedAt":       now,
    };
    match state.db.collection::<mongodb::bson::Document>("tiers").insert_one(doc).await {
        Ok(_) => {
            *state.tiers_cache.write().await = None;
            Json(json!({ "ok": true, "name": name })).into_response()
        }
        Err(e) if e.to_string().contains("E11000") => {
            (StatusCode::CONFLICT, Json(json!({ "error": "A tier with that name already exists." }))).into_response()
        }
        Err(e) => {
            eprintln!("[tiers] admin_create_tier: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "DB error." }))).into_response()
        }
    }
}

/// PUT /admin/tiers/:name — update an existing tier's editable fields.
async fn admin_update_tier(
    _: ServiceToken,
    admin: AdminUser,
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(body): Json<TierInput>,
) -> impl IntoResponse {
    if let Err(e) = check_admin_tv(&state.db, &admin.0.sub, admin.0.tv.unwrap_or(0)).await {
        return e.into_response();
    }
    let msg_bson = body.message_radius_m
        .map_or(mongodb::bson::Bson::Null, |v| (v as i32).into());
    let result = state.db
        .collection::<mongodb::bson::Document>("tiers")
        .update_one(
            doc! { "name": &name },
            doc! { "$set": {
                "label":           &body.label,
                "cls":             &body.cls,
                "rank":            body.rank as i32,
                "nearbyRadiusM":   body.nearby_radius_m as i32,
                "messageRadiusM":  msg_bson,
                "updatedAt":       DateTime::now(),
            }},
        )
        .await;
    match result {
        Ok(r) if r.matched_count == 0 => {
            (StatusCode::NOT_FOUND, Json(json!({ "error": "Tier not found." }))).into_response()
        }
        Ok(_) => {
            *state.tiers_cache.write().await = None;
            Json(json!({ "ok": true })).into_response()
        }
        Err(e) => {
            eprintln!("[tiers] admin_update_tier: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "DB error." }))).into_response()
        }
    }
}

/// DELETE /admin/tiers/:name — remove a tier document.
async fn admin_delete_tier(
    _: ServiceToken,
    admin: AdminUser,
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    if let Err(e) = check_admin_tv(&state.db, &admin.0.sub, admin.0.tv.unwrap_or(0)).await {
        return e.into_response();
    }
    match state.db.collection::<mongodb::bson::Document>("tiers").delete_one(doc! { "name": &name }).await {
        Ok(r) if r.deleted_count == 0 => {
            (StatusCode::NOT_FOUND, Json(json!({ "error": "Tier not found." }))).into_response()
        }
        Ok(_) => {
            *state.tiers_cache.write().await = None;
            Json(json!({ "ok": true })).into_response()
        }
        Err(e) => {
            eprintln!("[tiers] admin_delete_tier: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "DB error." }))).into_response()
        }
    }
}

// ── Startup seeder ────────────────────────────────────────────────────────────

/// Upserts the three base tiers into MongoDB on startup.
/// Uses $set for radius fields so corrections propagate to existing records,
/// and $setOnInsert for immutable fields (name, label, cls, rank, createdAt).
/// Does NOT create indexes (that remains migration 004's responsibility).
async fn seed_tiers(db: &Database) {
    let col = db.collection::<mongodb::bson::Document>("tiers");
    let now = DateTime::now();
    // (name, label, cls, rank, nearbyRadiusM, messageRadiusM)
    let seeds: &[(&str, &str, &str, i32, i32, Option<i32>)] = &[
        ("guest",   "Guest",   "secondary", 0, 500,   None),
        ("regular", "Regular", "primary",   1, 1_000, Some(100)),
        ("premium", "Premium", "warning",   2, 1_000, Some(1_000)),
    ];
    let mut seeded = 0u32;
    for &(name, label, cls, rank, nearby, msg) in seeds {
        let filter = doc! { "name": name };
        let msg_bson = msg.map_or(mongodb::bson::Bson::Null, |v| v.into());
        let update = doc! {
            "$set": {
                "nearbyRadiusM":  nearby,
                "messageRadiusM": msg_bson,
            },
            "$setOnInsert": {
                "name": name, "label": label, "cls": cls,
                "rank": rank, "createdAt": now,
            },
        };
        match col.update_one(filter, update).upsert(true).await {
            Ok(r) if r.upserted_id.is_some() => seeded += 1,
            Ok(_)  => {}
            Err(e) => eprintln!("[tiers] seed warning ({name}): {e}"),
        }
    }
    if seeded > 0 {
        println!("[tiers] Seeded {seeded} tier(s) into DB.");
    } else {
        println!("[tiers] Tier radii synced.");
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
    println!("[tiers] DB connected.");
    seed_tiers(&db).await;

    let state = AppState {
        db,
        jwt_secret:  JwtSecret(cfg.jwt_secret),
        tiers_cache: Arc::new(RwLock::new(None)),
    };

    // Route order: static segments (/tiers/info, /tiers/features, /tiers/check,
    // /tiers/radius/...) are registered before the parameterised /:name/info
    // route. Axum matches by segment count so there is no ambiguity, but
    // keeping statics first makes the intent explicit.
    let app = Router::new()
        .route("/health",                      get(health))
        .route("/tiers/info",                  get(tiers_info))
        .route("/tiers/features",              get(tiers_features))
        .route("/tiers/check",                 post(tiers_check))
        .route("/tiers/radius/nearby/{tier}",  get(nearby_radius))
        .route("/tiers/radius/message/{tier}", get(message_radius))
        .route("/tiers/{name}/info",           get(tier_info))
        // Admin — require both ServiceToken (from gateway) and AdminUser (from JWT)
        .route("/admin/tiers",       get(admin_list_tiers).post(admin_create_tier))
        .route("/admin/tiers/{name}", axum::routing::put(admin_update_tier).delete(admin_delete_tier))
        .fallback(not_found)
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", cfg.port))
        .await
        .unwrap();
    println!("[tiers] Running on :{}", cfg.port);
    axum::serve(listener, app).await.unwrap();
}
