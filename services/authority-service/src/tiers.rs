// ── Tier + feature definitions ────────────────────────────────────────────────
//
// Tier documents live in MongoDB ("tiers" collection).
// Feature definitions are a static map for now; Phase 3 will move them to DB.

use std::{
    collections::HashMap,
    sync::{Arc, LazyLock},
    time::{Duration, Instant},
};

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use common::auth::{AdminUser, JwtSecret, ServiceSecret, ServiceToken};
use futures_util::TryStreamExt;
use mongodb::{bson::{doc, DateTime}, Database};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::RwLock;

use crate::AppState;

// ── Feature definitions ───────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct Feature {
    #[serde(rename = "minTier")]
    pub min_tier: &'static str,
}

/// TO ADD A NEW FEATURE (Phase 3 will make this a DB operation):
///   1. Add an entry here with a min_tier.
///   2. Add the route in the gateway with the feature key.
pub static FEATURES: LazyLock<HashMap<&'static str, Feature>> = LazyLock::new(|| {
    HashMap::from([
        ("see_map",           Feature { min_tier: "guest" }),
        ("see_nearby",        Feature { min_tier: "guest" }),
        ("message_online",    Feature { min_tier: "regular" }),
        ("message_offline",   Feature { min_tier: "regular" }),
        ("message_radius",    Feature { min_tier: "regular" }),
        ("manage_favourites", Feature { min_tier: "regular" }),
    ])
});

// ── Tier ranks ────────────────────────────────────────────────────────────────

pub fn tier_rank(tier: &str) -> u32 {
    match tier {
        "guest"        => 0,
        "regular"      => 1,
        "premium"      => 2,
        "unrestricted" => 3,
        _              => 0,
    }
}

pub fn is_known_tier(tier: &str) -> bool {
    matches!(tier, "guest" | "regular" | "premium" | "unrestricted")
}

pub fn can(tier: &str, feature: &str) -> bool {
    FEATURES
        .get(feature)
        .is_some_and(|f| tier_rank(tier) >= tier_rank(f.min_tier))
}

/// Returns all feature names the given tier can access.
pub fn features_for_tier(tier: &str) -> Vec<String> {
    FEATURES
        .iter()
        .filter(|(_, f)| tier_rank(tier) >= tier_rank(f.min_tier))
        .map(|(k, _)| k.to_string())
        .collect()
}

// ── Tier document ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tier {
    pub name:             String,
    pub label:            String,
    pub cls:              String,
    pub rank:             u32,
    #[serde(alias = "nearby_radius_m")]
    pub nearby_radius_m:  u32,
    #[serde(alias = "message_radius_m")]
    pub message_radius_m: Option<u32>,
}

pub fn static_tiers() -> HashMap<String, Tier> {
    HashMap::from([
        ("guest".into(),        Tier { name: "guest".into(),        label: "Guest".into(),        cls: "secondary".into(), rank: 0, nearby_radius_m: 500,       message_radius_m: None }),
        ("regular".into(),      Tier { name: "regular".into(),      label: "Regular".into(),      cls: "primary".into(),   rank: 1, nearby_radius_m: 1_000,     message_radius_m: Some(1_000) }),
        ("premium".into(),      Tier { name: "premium".into(),      label: "Premium".into(),      cls: "warning".into(),   rank: 2, nearby_radius_m: 23_000,    message_radius_m: Some(23_000) }),
        ("unrestricted".into(), Tier { name: "unrestricted".into(), label: "Unrestricted".into(), cls: "warning".into(),   rank: 3, nearby_radius_m: 9_700_000, message_radius_m: Some(9_700_000) }),
    ])
}

// ── Tiers cache (60 s TTL) ────────────────────────────────────────────────────

const TIERS_CACHE_TTL: Duration = Duration::from_secs(60);

pub struct TiersCache {
    pub tiers:      HashMap<String, Tier>,
    pub expires_at: Instant,
}

pub async fn load_tiers(cache: &RwLock<Option<TiersCache>>, db: &Database) -> HashMap<String, Tier> {
    {
        let guard = cache.read().await;
        if let Some(c) = guard.as_ref() {
            if c.expires_at > Instant::now() {
                return c.tiers.clone();
            }
        }
    }
    let tiers = match db.collection::<Tier>("tiers").find(doc! {}).await {
        Err(_) => static_tiers(),
        Ok(cursor) => {
            let docs: Vec<Tier> = cursor.try_collect().await.unwrap_or_default();
            if docs.is_empty() { static_tiers() } else { docs.into_iter().map(|t| (t.name.clone(), t)).collect() }
        }
    };
    *cache.write().await = Some(TiersCache { tiers: tiers.clone(), expires_at: Instant::now() + TIERS_CACHE_TTL });
    tiers
}

// ── Admin helper ──────────────────────────────────────────────────────────────

async fn check_admin_tv(
    db:  &Database,
    sub: &str,
    tv:  u32,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    use mongodb::bson::oid::ObjectId;
    let oid = ObjectId::parse_str(sub).map_err(|_| (
        StatusCode::UNAUTHORIZED, Json(json!({ "error": "Invalid token." })),
    ))?;
    let user = db
        .collection::<mongodb::bson::Document>("users")
        .find_one(doc! { "_id": oid })
        .projection(doc! { "tokenVersion": 1 })
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))))?;
    let db_tv = user.as_ref().and_then(|u| u.get_i32("tokenVersion").ok()).unwrap_or(0) as u32;
    if db_tv != tv {
        return Err((StatusCode::UNAUTHORIZED, Json(json!({ "error": "Token revoked.", "code": "TOKEN_REVOKED" }))));
    }
    Ok(())
}

// ── Public tier handlers ──────────────────────────────────────────────────────

pub async fn tiers_info(_: ServiceToken, State(state): State<AppState>) -> Json<serde_json::Value> {
    let tiers = load_tiers(&state.tiers_cache, &state.db).await;
    let info: HashMap<&str, _> = tiers.values()
        .map(|t| (t.name.as_str(), json!({ "label": t.label, "cls": t.cls })))
        .collect();
    Json(json!({ "tiers": info }))
}

pub async fn tier_info(
    _: ServiceToken,
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    let tiers = load_tiers(&state.tiers_cache, &state.db).await;
    let Some(tier) = tiers.get(&name) else {
        return (StatusCode::NOT_FOUND, Json(json!({ "error": "Unknown tier." }))).into_response();
    };
    let tier_features = features_for_tier(&tier.name);
    Json(json!({
        "name":           tier.name,
        "label":          tier.label,
        "cls":            tier.cls,
        "nearbyRadiusM":  tier.nearby_radius_m,
        "messageRadiusM": tier.message_radius_m,
        "features":       tier_features,
    })).into_response()
}

pub async fn tiers_features(_: ServiceToken) -> Json<serde_json::Value> {
    Json(json!({ "features": &*FEATURES }))
}

#[derive(Deserialize)]
pub struct CheckBody { tier: Option<String>, feature: Option<String> }

pub async fn tiers_check(_: ServiceToken, Json(body): Json<CheckBody>) -> impl IntoResponse {
    let (Some(tier), Some(feature)) = (body.tier, body.feature) else {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "tier and feature required." }))).into_response();
    };
    if !can(&tier, &feature) {
        let min_tier = FEATURES.get(feature.as_str()).map_or("unknown", |f| f.min_tier);
        return (StatusCode::FORBIDDEN, Json(json!({
            "error":    format!("This feature requires the '{min_tier}' tier or above."),
            "yourTier": tier,
            "required": min_tier,
        }))).into_response();
    }
    Json(json!({ "allowed": true })).into_response()
}

pub async fn nearby_radius(
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

pub async fn message_radius(
    _: ServiceToken,
    State(state): State<AppState>,
    Path(tier): Path<String>,
) -> impl IntoResponse {
    if !is_known_tier(&tier) {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Unknown tier." }))).into_response();
    }
    let tiers    = load_tiers(&state.tiers_cache, &state.db).await;
    let radius_m = tiers.get(&tier).and_then(|t| t.message_radius_m).map_or(-1i64, |r| r as i64);
    Json(json!({ "tier": tier, "radiusM": radius_m })).into_response()
}

// ── Admin tier handlers ───────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TierInput {
    pub name:             Option<String>,
    pub label:            String,
    pub cls:              String,
    pub rank:             u32,
    pub nearby_radius_m:  u32,
    pub message_radius_m: Option<u32>,
}

fn valid_tier_name(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.chars().next().map_or(false, |c| c.is_ascii_lowercase())
        && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

pub async fn admin_list_tiers(
    _: ServiceToken,
    admin: AdminUser,
    State(state): State<AppState>,
) -> impl IntoResponse {
    if let Err(e) = check_admin_tv(&state.db, &admin.0.sub, admin.0.tv.unwrap_or(0)).await {
        return e.into_response();
    }
    let coll = state.db.collection::<mongodb::bson::Document>("tiers");
    let count = match coll.count_documents(doc! {}).await {
        Err(e) => { eprintln!("[authority/tiers] list count: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "DB error." }))).into_response(); }
        Ok(n)  => n,
    };
    if count == 0 {
        let now  = DateTime::now();
        let mut seed: Vec<Tier> = static_tiers().into_values().collect();
        seed.sort_by_key(|t| t.rank);
        let bson_docs: Vec<mongodb::bson::Document> = seed.iter().map(|t| doc! {
            "name": &t.name, "label": &t.label, "cls": &t.cls,
            "rank": t.rank as i32, "nearbyRadiusM": t.nearby_radius_m as i32,
            "messageRadiusM": t.message_radius_m.map(|v| v as i32),
            "createdAt": now, "updatedAt": now,
        }).collect();
        let _ = coll.insert_many(bson_docs).await;
        *state.tiers_cache.write().await = None;
        return Json(json!({ "tiers": seed })).into_response();
    }
    match coll.find(doc! {}).await {
        Err(e) => { eprintln!("[authority/tiers] list find: {e}"); (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "DB error." }))).into_response() }
        Ok(cursor) => {
            let raw: Vec<mongodb::bson::Document> = cursor.try_collect().await.unwrap_or_default();
            let mut tiers: Vec<serde_json::Value> = raw.iter().map(|d| json!({
                "name": d.get_str("name").unwrap_or(""),
                "label": d.get_str("label").unwrap_or(""),
                "cls": d.get_str("cls").unwrap_or("secondary"),
                "rank": d.get_i32("rank").unwrap_or(0),
                "nearbyRadiusM": d.get_i32("nearbyRadiusM").unwrap_or(0),
                "messageRadiusM": d.get_i32("messageRadiusM").ok(),
            })).collect();
            tiers.sort_by_key(|t| t["rank"].as_i64().unwrap_or(0));
            Json(json!({ "tiers": tiers })).into_response()
        }
    }
}

pub async fn admin_create_tier(
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
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "name must start with a lowercase letter and contain only [a-z0-9_], max 64 chars." }))).into_response();
    }
    let _ = state.db.collection::<mongodb::bson::Document>("tiers")
        .update_many(doc! { "rank": { "$gte": body.rank as i32 } }, doc! { "$inc": { "rank": 1 } }).await;
    let now = DateTime::now();
    let doc = doc! {
        "name": &name, "label": &body.label, "cls": &body.cls,
        "rank": body.rank as i32, "nearbyRadiusM": body.nearby_radius_m as i32,
        "messageRadiusM": body.message_radius_m.map(|v| v as i32),
        "createdAt": now, "updatedAt": now,
    };
    match state.db.collection::<mongodb::bson::Document>("tiers").insert_one(doc).await {
        Ok(_) => { *state.tiers_cache.write().await = None; Json(json!({ "ok": true, "name": name })).into_response() }
        Err(e) if e.to_string().contains("E11000") => (StatusCode::CONFLICT, Json(json!({ "error": "A tier with that name already exists." }))).into_response(),
        Err(e) => { eprintln!("[authority/tiers] create: {e}"); (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "DB error." }))).into_response() }
    }
}

pub async fn admin_update_tier(
    _: ServiceToken,
    admin: AdminUser,
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(body): Json<TierInput>,
) -> impl IntoResponse {
    if let Err(e) = check_admin_tv(&state.db, &admin.0.sub, admin.0.tv.unwrap_or(0)).await {
        return e.into_response();
    }
    let msg_bson = body.message_radius_m.map_or(mongodb::bson::Bson::Null, |v| (v as i32).into());
    let result = state.db.collection::<mongodb::bson::Document>("tiers")
        .update_one(doc! { "name": &name }, doc! { "$set": {
            "label": &body.label, "cls": &body.cls, "rank": body.rank as i32,
            "nearbyRadiusM": body.nearby_radius_m as i32, "messageRadiusM": msg_bson,
            "updatedAt": DateTime::now(),
        }}).await;
    match result {
        Ok(r) if r.matched_count == 0 => (StatusCode::NOT_FOUND, Json(json!({ "error": "Tier not found." }))).into_response(),
        Ok(_) => { *state.tiers_cache.write().await = None; Json(json!({ "ok": true })).into_response() }
        Err(e) => { eprintln!("[authority/tiers] update: {e}"); (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "DB error." }))).into_response() }
    }
}

pub async fn admin_delete_tier(
    _: ServiceToken,
    admin: AdminUser,
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    if let Err(e) = check_admin_tv(&state.db, &admin.0.sub, admin.0.tv.unwrap_or(0)).await {
        return e.into_response();
    }
    match state.db.collection::<mongodb::bson::Document>("tiers").delete_one(doc! { "name": &name }).await {
        Ok(r) if r.deleted_count == 0 => (StatusCode::NOT_FOUND, Json(json!({ "error": "Tier not found." }))).into_response(),
        Ok(_) => { *state.tiers_cache.write().await = None; Json(json!({ "ok": true })).into_response() }
        Err(e) => { eprintln!("[authority/tiers] delete: {e}"); (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "DB error." }))).into_response() }
    }
}

// ── Startup seeder ────────────────────────────────────────────────────────────

pub async fn seed_tiers(db: &Database) {
    let col = db.collection::<mongodb::bson::Document>("tiers");
    let now = DateTime::now();
    let seeds: &[(&str, &str, &str, i32, i32, Option<i32>)] = &[
        ("guest",        "Guest",        "secondary", 0, 500,       None),
        ("regular",      "Regular",      "primary",   1, 1_000,     Some(100)),
        ("premium",      "Premium",      "warning",   2, 23_000,    Some(23_000)),
        ("unrestricted", "Unrestricted", "warning",   3, 9_700_000, Some(9_700_000)),
    ];
    let mut seeded = 0u32;
    for &(name, label, cls, rank, nearby, msg) in seeds {
        let msg_bson = msg.map_or(mongodb::bson::Bson::Null, |v| v.into());
        let update = doc! {
            "$set": { "nearbyRadiusM": nearby, "messageRadiusM": msg_bson },
            "$setOnInsert": { "name": name, "label": label, "cls": cls, "rank": rank, "createdAt": now },
        };
        match col.update_one(doc! { "name": name }, update).upsert(true).await {
            Ok(r) if r.upserted_id.is_some() => seeded += 1,
            Ok(_)  => {}
            Err(e) => eprintln!("[authority/tiers] seed warning ({name}): {e}"),
        }
    }
    if seeded > 0 { println!("[authority] Seeded {seeded} tier(s)."); }
    else          { println!("[authority] Tier radii synced."); }
}

// ── Router ────────────────────────────────────────────────────────────────────

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/tiers/info",                  get(tiers_info))
        .route("/tiers/features",              get(tiers_features))
        .route("/tiers/check",                 post(tiers_check))
        .route("/tiers/radius/nearby/{tier}",  get(nearby_radius))
        .route("/tiers/radius/message/{tier}", get(message_radius))
        .route("/tiers/{name}/info",           get(tier_info))
        .route("/admin/tiers",                 get(admin_list_tiers).post(admin_create_tier))
        .route("/admin/tiers/{name}",          axum::routing::put(admin_update_tier).delete(admin_delete_tier))
}
