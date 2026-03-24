// ============================================================
// bOOmbOOm.NOW! — authority-service (Rust)
//
// Merges auth-service (OPAQUE) + tiers-service into a single binary.
// Adds POST /authority/verify — the gateway's single identity-resolution call.
//
// Required env vars (same as auth-service + tiers-service):
//   JWT_SECRET           — HS256 signing key
//   SERVICE_SECRET       — inter-service token key
//   MONGO_URI            — MongoDB connection string
//   EMAIL_PEPPER         — hex string ≥32 bytes (HMAC key for email hashing)
//   OPAQUE_SERVER_SETUP  — base64-encoded ServerSetup
//
// Optional:
//   PORT                       — listen port (default 8080)
//   DB_NAME                    — MongoDB database (default "boomboom")
//   ADMIN_BOOTSTRAP_USER_ID    — ObjectId; promotes that user to admin on startup
// ============================================================

mod auth;
mod tiers;
mod verify;

use std::{
    env,
    sync::{Arc, RwLock},
    time::Duration,
};

use axum::{
    extract::{FromRef, State},
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::get,
    Router,
};
use base64::prelude::*;
use common::{
    auth::{JwtSecret, ServiceSecret},
    mongo::safe_object_id,
};
use mongodb::{bson::doc, options::IndexOptions, Client, Database, IndexModel};
use opaque_ke::ServerSetup;
use serde_json::json;
use tokio::sync::RwLock as TokioRwLock;

use auth::{DefaultCs, LoginSessions};
use tiers::{FeaturesCache, TiersCache};

// ── Config ────────────────────────────────────────────────────────────────────

struct Config {
    port:                    u16,
    jwt_secret:              String,
    service_secret:          String,
    mongo_uri:               String,
    db_name:                 String,
    email_pepper:            String,
    opaque_setup_b64:        String,
    admin_bootstrap_user_id: Option<String>,
}

impl Config {
    fn from_env() -> Result<Self, String> {
        let required = ["JWT_SECRET", "SERVICE_SECRET", "MONGO_URI", "EMAIL_PEPPER"];
        let missing: Vec<&str> = required.iter().filter(|k| env::var(k).is_err()).copied().collect();
        if !missing.is_empty() {
            return Err(format!("FATAL: missing env vars: {}", missing.join(", ")));
        }
        let opaque_setup_b64 = match env::var("OPAQUE_SERVER_SETUP") {
            Ok(v) => v,
            Err(_) => {
                let mut rng = rand::rngs::OsRng;
                let setup   = ServerSetup::<DefaultCs>::new(&mut rng);
                let encoded = BASE64_STANDARD.encode(setup.serialize());
                eprintln!("[authority] FATAL: OPAQUE_SERVER_SETUP is not set.");
                eprintln!("[authority] A new server setup has been generated.");
                eprintln!("[authority] Set this env var in Railway and restart:");
                eprintln!("[authority] OPAQUE_SERVER_SETUP={encoded}");
                std::process::exit(1);
            }
        };
        Ok(Self {
            port:                    env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8080),
            jwt_secret:              env::var("JWT_SECRET").unwrap(),
            service_secret:          env::var("SERVICE_SECRET").unwrap(),
            mongo_uri:               env::var("MONGO_URI").unwrap(),
            db_name:                 env::var("DB_NAME").unwrap_or_else(|_| "boomboom".to_string()),
            email_pepper:            env::var("EMAIL_PEPPER").unwrap(),
            opaque_setup_b64,
            admin_bootstrap_user_id: env::var("ADMIN_BOOTSTRAP_USER_ID").ok(),
        })
    }
}

// ── App state ─────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct AppState {
    pub db:                Database,
    pub jwt_secret:        String,
    pub service_secret:    String,
    pub email_pepper:      String,
    pub opaque_setup:      Arc<ServerSetup<DefaultCs>>,
    pub login_sessions:    LoginSessions,
    /// Cached user JWT TTL from admin_settings. Refreshed every 60 s.
    pub user_jwt_ttl_secs: Arc<RwLock<u64>>,
    pub tiers_cache:       Arc<TokioRwLock<Option<TiersCache>>>,
    pub features_cache:    Arc<TokioRwLock<Option<FeaturesCache>>>,
}

impl FromRef<AppState> for JwtSecret {
    fn from_ref(s: &AppState) -> Self { JwtSecret(s.jwt_secret.clone()) }
}
impl FromRef<AppState> for ServiceSecret {
    fn from_ref(s: &AppState) -> Self { ServiceSecret(s.service_secret.clone()) }
}
impl FromRef<AppState> for Database {
    fn from_ref(s: &AppState) -> Self { s.db.clone() }
}

// ── Health ────────────────────────────────────────────────────────────────────

async fn health(State(state): State<AppState>) -> impl IntoResponse {
    match state.db.run_command(doc! { "ping": 1 }).await {
        Ok(_)  => Json(json!({ "ok": true })).into_response(),
        Err(_) => (StatusCode::SERVICE_UNAVAILABLE, Json(json!({ "ok": false, "error": "DB unreachable" }))).into_response(),
    }
}

async fn not_found() -> impl IntoResponse {
    (StatusCode::NOT_FOUND, Json(json!({ "error": "Not found." })))
}

// ── Admin bootstrap ───────────────────────────────────────────────────────────

async fn bootstrap_admin(db: &Database, user_id_str: &str) {
    let Some(oid) = safe_object_id(user_id_str) else {
        eprintln!("[authority] ADMIN_BOOTSTRAP_USER_ID is not a valid ObjectId — skipping.");
        return;
    };
    let already = db.collection::<mongodb::bson::Document>("users")
        .find_one(doc! { "role": "admin" }).await.unwrap_or(None).is_some();
    if already { println!("[authority] Bootstrap: admin already exists — skipped."); return; }
    match db.collection::<mongodb::bson::Document>("users")
        .update_one(doc! { "_id": oid }, doc! { "$set": { "role": "admin" }, "$inc": { "tokenVersion": 1_i32 } }).await
    {
        Ok(r) if r.matched_count == 1 => println!("[authority] Bootstrap: admin promoted. User must re-login. Remove ADMIN_BOOTSTRAP_USER_ID."),
        Ok(_)  => eprintln!("[authority] Bootstrap: target user not found."),
        Err(e) => eprintln!("[authority] Bootstrap failed: {e}"),
    }
}

// ── Main ──────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let cfg = Config::from_env().unwrap_or_else(|e| { eprintln!("{e}"); std::process::exit(1); });

    let setup_bytes = BASE64_STANDARD.decode(&cfg.opaque_setup_b64)
        .expect("OPAQUE_SERVER_SETUP: invalid base64");
    let opaque_setup = ServerSetup::<DefaultCs>::deserialize(&setup_bytes)
        .expect("OPAQUE_SERVER_SETUP: invalid setup data");

    let db = Client::with_uri_str(&cfg.mongo_uri).await
        .expect("Failed to connect to MongoDB")
        .database(&cfg.db_name);
    println!("[authority] DB connected.");

    // TTL index on login sessions
    {
        let idx = IndexModel::builder()
            .keys(doc! { "createdAt": 1 })
            .options(IndexOptions::builder().expire_after(Duration::from_secs(20 * 60)).build())
            .build();
        if let Err(e) = db.collection::<mongodb::bson::Document>("sessions").create_index(idx).await {
            eprintln!("[authority] sessions TTL index: {e}");
        }
    }

    if let Some(ref uid) = cfg.admin_bootstrap_user_id {
        bootstrap_admin(&db, uid).await;
    }

    tiers::seed_tiers(&db).await;

    // Load initial JWT TTL
    let initial_ttl = db.collection::<mongodb::bson::Document>("meta_settings")
        .find_one(doc! { "key": "jwt_user_ttl_secs" }).await.ok().flatten()
        .and_then(|d| d.get_i64("value").ok()).unwrap_or(86_400) as u64;
    let user_jwt_ttl_secs = Arc::new(RwLock::new(initial_ttl));

    let state = AppState {
        db,
        jwt_secret:        cfg.jwt_secret,
        service_secret:    cfg.service_secret,
        email_pepper:      cfg.email_pepper,
        opaque_setup:      Arc::new(opaque_setup),
        login_sessions:    Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new())),
        user_jwt_ttl_secs,
        tiers_cache:       Arc::new(TokioRwLock::new(None)),
        features_cache:    Arc::new(TokioRwLock::new(None)),
    };

    // Background: refresh JWT TTL every 60 s
    {
        let s = state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(60));
            interval.tick().await;
            loop {
                interval.tick().await;
                let v = s.db.collection::<mongodb::bson::Document>("meta_settings")
                    .find_one(doc! { "key": "jwt_user_ttl_secs" }).await.ok().flatten()
                    .and_then(|d| d.get_i64("value").ok()).unwrap_or(86_400) as u64;
                *s.user_jwt_ttl_secs.write().unwrap() = v;
            }
        });
    }

    let app = Router::new()
        .route("/health", get(health))
        .merge(auth::router())
        .merge(tiers::router())
        .merge(verify::router())
        .fallback(not_found)
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", cfg.port)).await.unwrap();
    println!("[authority] Running on :{}", cfg.port);
    axum::serve(listener, app).await.unwrap();
}
