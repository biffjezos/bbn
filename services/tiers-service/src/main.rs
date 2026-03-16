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
use common::auth::{JwtSecret, ServiceToken};
use futures_util::TryStreamExt;
use mongodb::{bson::doc, Client, Database};
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
    nearby_radius_m:  u32,
    message_radius_m: Option<u32>,
}

fn static_tiers() -> HashMap<String, Tier> {
    HashMap::from([
        ("guest".into(),     Tier { name: "guest".into(),     label: "Guest".into(),     cls: "secondary".into(), rank: 0, nearby_radius_m: 500,        message_radius_m: None }),
        ("regular".into(),   Tier { name: "regular".into(),   label: "Regular".into(),   cls: "primary".into(),   rank: 1, nearby_radius_m: 1_000,      message_radius_m: Some(1000) }),
        ("premium".into(),   Tier { name: "premium".into(),   label: "Premium".into(),   cls: "warning".into(),   rank: 2, nearby_radius_m: 23_000_000, message_radius_m: Some(23_000_000) }),
        ("developer".into(), Tier { name: "developer".into(), label: "Developer".into(), cls: "warning".into(),   rank: 3, nearby_radius_m: 9_700_000,  message_radius_m: Some(9_700_000) })
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
        .route("/tiers/radius/nearby/{tier}",   get(nearby_radius))
        .route("/tiers/radius/message/{tier}",  get(message_radius))
        .route("/tiers/{name}/info",            get(tier_info))
        .fallback(not_found)
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", cfg.port))
        .await
        .unwrap();
    println!("[tiers] Running on :{}", cfg.port);
    axum::serve(listener, app).await.unwrap();
}
