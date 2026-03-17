// ============================================================
// bOOmbOOm.NOW! — migration-service (Rust)
// Replaces services/migration-service/migration-service.js.
// Identical HTTP contract — gateway needs no changes.
// ============================================================

use std::env;
use std::time::Duration;

use axum::{
    extract::{FromRef, State},
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use common::auth::{JwtSecret, ServiceSecret, ServiceToken};
use futures_util::TryStreamExt;
use mongodb::{
    bson::{doc, DateTime as BsonDateTime, Document},
    options::IndexOptions,
    Client, Database, IndexModel,
};
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
            port:           env::var("MIGRATION_PORT").ok()
                                .and_then(|p| p.parse().ok())
                                .unwrap_or(3099),
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
    fn from_ref(s: &AppState) -> Self { JwtSecret(s.jwt_secret.clone()) }
}
impl FromRef<AppState> for ServiceSecret {
    fn from_ref(s: &AppState) -> Self { ServiceSecret(s.service_secret.clone()) }
}
impl FromRef<AppState> for Database {
    fn from_ref(s: &AppState) -> Self { s.db.clone() }
}

// ── Migrations ────────────────────────────────────────────────────────────────

const MIGRATIONS: &[&str] = &[
    "001_indexes",
    "002_locations_2dsphere",
    "003_blocks_indexes",
    "004_tiers_seed",
];

async fn migration_001(db: &Database) -> Result<(), mongodb::error::Error> {
    let users = db.collection::<Document>("users");
    users.create_index(
        IndexModel::builder()
            .keys(doc! { "email": 1 })
            .options(IndexOptions::builder().unique(true).build())
            .build(),
    ).await?;

    let sessions = db.collection::<Document>("sessions");
    sessions.create_index(
        IndexModel::builder()
            .keys(doc! { "guestId": 1 })
            .options(IndexOptions::builder().unique(true).build())
            .build(),
    ).await?;
    sessions.create_index(
        IndexModel::builder()
            .keys(doc! { "createdAt": 1 })
            .options(IndexOptions::builder()
                .expire_after(Duration::from_secs(900)) // 15 min, matches guest JWT
                .build())
            .build(),
    ).await?;

    let favourites = db.collection::<Document>("favourites");
    favourites.create_index(
        IndexModel::builder()
            .keys(doc! { "ownerUserId": 1, "favouriteUserId": 1 })
            .options(IndexOptions::builder().unique(true).build())
            .build(),
    ).await?;

    let locations = db.collection::<Document>("locations");
    locations.create_index(
        IndexModel::builder()
            .keys(doc! { "updatedAt": 1 })
            .options(IndexOptions::builder()
                .expire_after(Duration::from_secs(600)) // 10 min
                .build())
            .build(),
    ).await?;

    let messages = db.collection::<Document>("messages");
    messages.create_index(
        IndexModel::builder()
            .keys(doc! { "expiresAt": 1 })
            .options(IndexOptions::builder()
                .expire_after(Duration::from_secs(0))
                .build())
            .build(),
    ).await?;

    Ok(())
}

async fn migration_002(db: &Database) -> Result<(), mongodb::error::Error> {
    db.collection::<Document>("locations")
        .create_index(
            IndexModel::builder()
                .keys(doc! { "location": "2dsphere" })
                .build(),
        ).await?;
    Ok(())
}

async fn migration_003(db: &Database) -> Result<(), mongodb::error::Error> {
    let blocks = db.collection::<Document>("blocks");
    blocks.create_index(
        IndexModel::builder()
            .keys(doc! { "blockerUserId": 1, "blockedUserId": 1 })
            .options(IndexOptions::builder().unique(true).build())
            .build(),
    ).await?;
    blocks.create_index(
        IndexModel::builder()
            .keys(doc! { "blockedUserId": 1 })
            .build(),
    ).await?;
    Ok(())
}

async fn migration_004(db: &Database) -> Result<(), mongodb::error::Error> {
    let tiers = db.collection::<Document>("tiers");
    tiers.create_index(
        IndexModel::builder()
            .keys(doc! { "name": 1 })
            .options(IndexOptions::builder().unique(true).build())
            .build(),
    ).await?;

    let now = BsonDateTime::now();
    let seeds: &[(&str, &str, &str, i32, Option<i32>, Option<i32>)] = &[
        ("guest",   "Guest",   "secondary", 0, Some(500),   None),
        ("regular", "Regular", "primary",   1, Some(1_000), Some(100)),
        ("premium", "Premium", "warning",   2, Some(1_000), Some(1_000)),
    ];
    for (name, label, cls, rank, nearby, message) in seeds {
        let mut tier_doc = doc! {
            "name":          *name,
            "label":         *label,
            "cls":           *cls,
            "rank":          *rank,
            "nearbyRadiusM": nearby,
            "createdAt":     now,
        };
        if let Some(m) = message {
            tier_doc.insert("messageRadiusM", *m);
        } else {
            tier_doc.insert("messageRadiusM", mongodb::bson::Bson::Null);
        }
        tiers.update_one(
            doc! { "name": *name },
            doc! { "$setOnInsert": tier_doc },
        )
        .upsert(true)
        .await?;
    }
    Ok(())
}

async fn run_migration(id: &str, db: &Database) -> Result<(), mongodb::error::Error> {
    match id {
        "001_indexes"           => migration_001(db).await,
        "002_locations_2dsphere"=> migration_002(db).await,
        "003_blocks_indexes"    => migration_003(db).await,
        "004_tiers_seed"        => migration_004(db).await,
        _                       => Ok(()), // unknown migration — skip
    }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async fn health(State(state): State<AppState>) -> impl IntoResponse {
    match state.db.run_command(doc! { "ping": 1 }).await {
        Ok(_)  => Json(json!({ "ok": true })).into_response(),
        Err(_) => (StatusCode::SERVICE_UNAVAILABLE, Json(json!({ "ok": false, "error": "DB unreachable" }))).into_response(),
    }
}

// POST /migrate/run — called by gateway on boot
async fn migrate_run(
    _: ServiceToken,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let col = state.db.collection::<Document>("_migrations");

    let applied: Vec<String> = match col.find(doc! {}).await {
        Ok(cursor) => cursor
            .try_collect::<Vec<Document>>()
            .await
            .unwrap_or_default()
            .into_iter()
            .filter_map(|d| d.get_str("id").ok().map(|s| s.to_string()))
            .collect(),
        Err(e) => {
            eprintln!("[migrations] find: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "ok": false, "error": e.to_string() }))).into_response();
        }
    };

    let applied_set: std::collections::HashSet<&str> =
        applied.iter().map(|s| s.as_str()).collect();

    let pending: Vec<&&str> = MIGRATIONS.iter().filter(|id| !applied_set.contains(**id)).collect();
    let count = pending.len();

    for id in pending {
        if let Err(e) = run_migration(id, &state.db).await {
            eprintln!("[migrations] {id} failed: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "ok": false, "error": e.to_string() }))).into_response();
        }
        if let Err(e) = col.insert_one(doc! { "id": *id, "appliedAt": BsonDateTime::now() }).await {
            eprintln!("[migrations] record {id}: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "ok": false, "error": e.to_string() }))).into_response();
        }
        println!("[migrations] Applied: {id}");
    }

    Json(json!({ "ok": true, "applied": count })).into_response()
}

// POST /migrate/reset — clears bloated/empty collections, preserves users
async fn migrate_reset(
    _: ServiceToken,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let to_drop = ["sessions", "locations", "messages", "favourites", "_migrations"];
    for name in &to_drop {
        match state.db.collection::<Document>(name).drop().await {
            Ok(_)  => println!("[migrations] Dropped: {name}"),
            Err(e) => eprintln!("[migrations] Drop {name} (ignored): {e}"),
        }
    }

    let col = state.db.collection::<Document>("_migrations");
    for id in MIGRATIONS {
        if let Err(e) = run_migration(id, &state.db).await {
            eprintln!("[migrations] reset {id}: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "ok": false, "error": e.to_string() }))).into_response();
        }
        if let Err(e) = col.insert_one(doc! { "id": *id, "appliedAt": BsonDateTime::now() }).await {
            eprintln!("[migrations] record {id}: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "ok": false, "error": e.to_string() }))).into_response();
        }
        println!("[migrations] Applied: {id}");
    }

    Json(json!({ "ok": true, "message": "Reset complete. users collection untouched." })).into_response()
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
    println!("[migrations] DB connected.");

    let state = AppState {
        db,
        jwt_secret:     cfg.jwt_secret,
        service_secret: cfg.service_secret,
    };

    let app = Router::new()
        .route("/health",        get(health))
        .route("/migrate/run",   post(migrate_run))
        .route("/migrate/reset", post(migrate_reset))
        .fallback(|| async { (StatusCode::NOT_FOUND, Json(json!({ "error": "Not found." }))) })
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", cfg.port))
        .await
        .unwrap();
    println!("[migrations] Running on :{}", cfg.port);
    axum::serve(listener, app).await.unwrap();
}
