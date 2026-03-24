// ============================================================
// bOOmbOOm.NOW! — blocks-service (Rust)
// Replaces services/blocks-service.js.
// Identical HTTP contract — gateway needs no changes.
// Rebuild: venue_manager accepted by RequireRegistered (common).
// ============================================================

use std::env;

use axum::{
    extract::{FromRef, Path, State},
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{delete, get, post},
    Router,
};
use common::{
    auth::{JwtSecret, ServiceSecret, RegisteredByGateway, ServiceToken},
    mongo::safe_object_id,
};
use futures_util::TryStreamExt;
use mongodb::{
    bson::{doc, DateTime as BsonDateTime, Document},
    Client, Database,
};
use serde::Deserialize;
use serde_json::json;

// ── Config ────────────────────────────────────────────────────────────────────

struct Config {
    port:           u16,
    mongo_uri:      String,
    db_name:        String,
    jwt_secret:     String,
    service_secret: String,
}

impl Config {
    fn from_env() -> Result<Self, String> {
        let missing: Vec<_> = ["JWT_SECRET", "SERVICE_SECRET", "MONGO_URI"]
            .iter()
            .filter(|k| env::var(k).is_err())
            .collect();
        if !missing.is_empty() {
            return Err(format!(
                "FATAL: missing env vars: {}",
                missing.iter().map(|k| **k).collect::<Vec<_>>().join(", ")
            ));
        }
        Ok(Self {
            port:           env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8080),
            mongo_uri:      env::var("MONGO_URI").unwrap(),
            db_name:        env::var("DB_NAME").unwrap_or_else(|_| "boomboom".to_string()),
            jwt_secret:     env::var("JWT_SECRET").unwrap(),
            service_secret: env::var("SERVICE_SECRET").unwrap(),
        })
    }
}

// ── App state ─────────────────────────────────────────────────────────────────

#[derive(Clone)]
struct AppState {
    db:             Database,
    jwt_secret:     String,
    service_secret: String,
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

// ── Constants ─────────────────────────────────────────────────────────────────

const VALID_REASONS: &[&str] = &[
    "spam", "harassment", "inappropriate_content", "fake_profile", "other",
];

// ── Handlers ──────────────────────────────────────────────────────────────────

async fn health(State(state): State<AppState>) -> impl IntoResponse {
    match state.db.run_command(doc! { "ping": 1 }).await {
        Ok(_)  => Json(json!({ "ok": true })).into_response(),
        Err(_) => (StatusCode::SERVICE_UNAVAILABLE, Json(json!({ "ok": false, "error": "DB unreachable" }))).into_response(),
    }
}

// ── GET /blocks ───────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct UserProjection {
    #[serde(rename = "_id")]
    id:       mongodb::bson::oid::ObjectId,
    nickname: Option<String>,
    sex:      Option<String>,
}

async fn get_blocks(
    _svc: ServiceToken,
    RegisteredByGateway(identity): RegisteredByGateway,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let entries: Vec<Document> = match state.db
        .collection::<Document>("blocks")
        .find(doc! { "blockerUserId": &identity.sub })
        .sort(doc! { "createdAt": -1 })
        .await
    {
        Ok(cursor) => cursor.try_collect().await.unwrap_or_default(),
        Err(e) => { eprintln!("[blocks GET] find: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };

    if entries.is_empty() {
        return Json(json!({ "blocks": [] })).into_response();
    }

    // Enrich with nickname/sex from users collection
    let oids: Vec<_> = entries
        .iter()
        .filter_map(|e| e.get_str("blockedUserId").ok())
        .filter_map(safe_object_id)
        .collect();

    let users: Vec<UserProjection> = match state.db
        .collection::<UserProjection>("users")
        .find(doc! { "_id": { "$in": &oids } })
        .projection(doc! { "_id": 1, "nickname": 1, "sex": 1 })
        .await
    {
        Ok(cursor) => cursor.try_collect().await.unwrap_or_default(),
        Err(e) => { eprintln!("[blocks GET] users find: {e}"); vec![] }
    };

    let user_map: std::collections::HashMap<String, &UserProjection> = users
        .iter()
        .map(|u| (u.id.to_hex(), u))
        .collect();

    let blocks: Vec<_> = entries
        .iter()
        .filter_map(|e| {
            let blocked_id = e.get_str("blockedUserId").ok()?.to_string();
            let reason     = e.get_str("reason").ok()?.to_string();
            let created_at = e.get_datetime("createdAt").ok().and_then(|d| d.try_to_rfc3339_string().ok());
            let profile    = user_map.get(&blocked_id);
            Some(json!({
                "userId":    blocked_id,
                "nickname":  profile.and_then(|u| u.nickname.as_deref()).unwrap_or(&blocked_id),
                "sex":       profile.and_then(|u| u.sex.as_deref()),
                "reason":    reason,
                "createdAt": created_at,
            }))
        })
        .collect();

    Json(json!({ "blocks": blocks })).into_response()
}

// ── POST /blocks/:userId ──────────────────────────────────────────────────────

#[derive(Deserialize)]
struct BlockBody {
    reason: Option<String>,
}

async fn post_block(
    _svc: ServiceToken,
    RegisteredByGateway(identity): RegisteredByGateway,
    State(state): State<AppState>,
    Path(blocked_id): Path<String>,
    Json(body): Json<BlockBody>,
) -> impl IntoResponse {
    if identity.sub == blocked_id {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Cannot block yourself." }))).into_response();
    }

    let reason = match body.reason.as_deref() {
        Some(r) if VALID_REASONS.contains(&r) => r.to_string(),
        _ => return (StatusCode::BAD_REQUEST, Json(json!({
            "error": format!("reason must be one of: {}.", VALID_REASONS.join(", "))
        }))).into_response(),
    };

    let oid = match safe_object_id(&blocked_id) {
        Some(id) => id,
        None     => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid user id." }))).into_response(),
    };

    // Verify the target user exists
    match state.db
        .collection::<Document>("users")
        .find_one(doc! { "_id": oid })
        .projection(doc! { "_id": 1 })
        .await
    {
        Ok(Some(_)) => {}
        Ok(None)    => return (StatusCode::NOT_FOUND, Json(json!({ "error": "User not found." }))).into_response(),
        Err(e)      => { eprintln!("[blocks POST] user lookup: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    }

    match state.db
        .collection::<Document>("blocks")
        .insert_one(doc! {
            "blockerUserId": &identity.sub,
            "blockedUserId": &blocked_id,
            "reason":        &reason,
            "createdAt":     BsonDateTime::now(),
        })
        .await
    {
        Ok(_)                                      => (StatusCode::CREATED, Json(json!({ "ok": true }))).into_response(),
        Err(e) if e.to_string().contains("11000") => (StatusCode::CONFLICT, Json(json!({ "error": "User is already blocked." }))).into_response(),
        Err(e) => { eprintln!("[blocks POST] insert: {e}"); (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response() }
    }
}

// ── DELETE /blocks/:userId ────────────────────────────────────────────────────

async fn delete_block(
    _svc: ServiceToken,
    RegisteredByGateway(identity): RegisteredByGateway,
    State(state): State<AppState>,
    Path(blocked_id): Path<String>,
) -> impl IntoResponse {
    match state.db
        .collection::<Document>("blocks")
        .delete_one(doc! {
            "blockerUserId": &identity.sub,
            "blockedUserId": &blocked_id,
        })
        .await
    {
        Ok(r) if r.deleted_count == 0 => (StatusCode::NOT_FOUND, Json(json!({ "error": "Block not found." }))).into_response(),
        Ok(_)  => Json(json!({ "ok": true })).into_response(),
        Err(e) => { eprintln!("[blocks DELETE] {e}"); (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response() }
    }
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
    println!("[blocks] DB connected.");

    let state = AppState { db, jwt_secret: cfg.jwt_secret, service_secret: cfg.service_secret };

    let app = Router::new()
        .route("/health",           get(health))
        .route("/blocks",           get(get_blocks))
        .route("/blocks/{user_id}", post(post_block))
        .route("/blocks/{user_id}", delete(delete_block))
        .fallback(|| async { (StatusCode::NOT_FOUND, Json(json!({ "error": "Not found." }))) })
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", cfg.port))
        .await
        .unwrap();
    println!("[blocks] Running on :{}", cfg.port);
    axum::serve(listener, app).await.unwrap();
}
