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
            port:           env::var("PORT")
                                .or_else(|_| env::var("MIGRATION_PORT"))
                                .ok()
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
    "005_rename_developer_tier",
    "006_email_index_sparse",
    "007_shard_index",
    "008_opaque_emailhash",
    "009_admin_settings",
    "010_meta_rename_and_features",
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
        ("premium", "Premium", "warning",   2, Some(23_000), Some(23_000)),
        ("unrestricted", "Unrestricted", "danger", 3, Some(9_700_000), Some(9_700_000))
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

async fn migration_005(db: &Database) -> Result<(), mongodb::error::Error> {
    db.collection::<Document>("users")
        .update_many(
            doc! { "tier": "developer" },
            doc! { "$set": { "tier": "unrestricted" } },
        ).await?;
    Ok(())
}

async fn migration_006(db: &Database) -> Result<(), mongodb::error::Error> {
    // The email unique index was created non-sparse in 001.  Venue accounts
    // are inserted into the same collection without an email field, so two
    // venue documents both end up with email=null and collide on the unique
    // constraint.  Drop and recreate the index as sparse so that only
    // documents that actually carry an email value are constrained.
    let users = db.collection::<Document>("users");
    let _ = users.drop_index("email_1").await; // ignore error if already gone
    users.create_index(
        IndexModel::builder()
            .keys(doc! { "email": 1 })
            .options(IndexOptions::builder().unique(true).sparse(true).build())
            .build(),
    ).await?;
    Ok(())
}

async fn migration_007(db: &Database) -> Result<(), mongodb::error::Error> {
    // Add a compound index on (shard_key, updatedAt) to the locations collection.
    // This index supports the DbStore backend (LOCATION_STORE=db) introduced in T-20.
    // The location collection starts from a clean slate (no existing data to backfill).
    // The 2dsphere index from migration_002 is kept — it does not conflict.
    db.collection::<Document>("locations")
        .create_index(
            IndexModel::builder()
                .keys(doc! { "shard_key": 1, "updatedAt": -1 })
                .options(IndexOptions::builder()
                    .name("shard_key_updatedAt".to_string())
                    .sparse(true)   // sparse: documents without shard_key are ignored
                    .build())
                .build(),
        ).await?;
    Ok(())
}

async fn migration_008(db: &Database) -> Result<(), mongodb::error::Error> {
    // OPAQUE migration:
    // 1. Drop the old plaintext-email indexes (001 and 006 created them).
    // 2. Create a unique sparse index on emailHash (the client-side SHA-256 hash).
    // 3. Drop the 2dsphere geo index on locations — the shard approach (T-20)
    //    replaces geo queries; geo indexing is not needed in the foreseeable future.
    let users = db.collection::<Document>("users");
    let _ = users.drop_index("email_1").await; // sparse index from migration_006; ignore if already gone

    users.create_index(
        IndexModel::builder()
            .keys(doc! { "emailHash": 1 })
            .options(IndexOptions::builder()
                .name("emailHash_1".to_string())
                .unique(true)
                .sparse(true)
                .build())
            .build(),
    ).await?;

    // Drop 2dsphere index on locations — no longer used after T-20 shard approach.
    let locations = db.collection::<Document>("locations");
    let _ = locations.drop_index("location_2dsphere").await; // ignore if already gone

    Ok(())
}

async fn migration_009(db: &Database) -> Result<(), mongodb::error::Error> {
    // Create admin_settings collection with a unique index on key.
    // Seed default values for all runtime-configurable settings.
    let col = db.collection::<Document>("admin_settings");
    col.create_index(
        IndexModel::builder()
            .keys(doc! { "key": 1 })
            .options(IndexOptions::builder().unique(true).build())
            .build(),
    ).await?;

    // Each entry: { key, value (i64), section, label, description, restart_required }
    let seeds: &[(&str, i64, &str, &str, &str, bool)] = &[
        // ── Rate limits (gateway, per IP) ──────────────────────────────────────
        ("login_rate_max",             10,       "rate_limits", "Login: max requests",              "Maximum login attempts per window (per IP).",                        false),
        ("login_rate_window_secs",     900,      "rate_limits", "Login: window (s)",                "Window size in seconds for login rate limiter.",                     false),
        ("register_rate_max",          5,        "rate_limits", "Register: max requests",           "Maximum registration attempts per window (per IP).",                 false),
        ("register_rate_window_secs",  3600,     "rate_limits", "Register: window (s)",             "Window size in seconds for register rate limiter.",                  false),
        ("api_rate_max",               120,      "rate_limits", "API: max requests",                "Maximum general API requests per window (per IP).",                  false),
        ("api_rate_window_secs",       60,       "rate_limits", "API: window (s)",                  "Window size in seconds for general API rate limiter.",               false),
        ("guest_rate_max",             40,       "rate_limits", "Guest session: max requests",      "Maximum guest-session creations per window (per IP).",               false),
        ("guest_rate_window_secs",     3600,     "rate_limits", "Guest session: window (s)",        "Window size in seconds for guest rate limiter.",                     false),
        ("msg_ip_rate_max",            30,       "rate_limits", "Msg send: max (per IP)",           "Maximum message-send requests per window at the gateway (per IP).", false),
        ("msg_ip_rate_window_secs",    60,       "rate_limits", "Msg send: window (s)",             "Window size in seconds for gateway message-send rate limiter.",      false),
        // ── Rate limits (messages-service, per user) ───────────────────────────
        ("msg_user_rate_max",          10,       "rate_limits", "Msg send: max (per user)",         "Maximum message sends per window per authenticated user.",           false),
        ("msg_user_rate_window_secs",  10,       "rate_limits", "Msg send: user window (s)",        "Window size in seconds for per-user message-send rate limiter.",     false),
        // ── Authentication ─────────────────────────────────────────────────────
        ("jwt_user_ttl_secs",          86400,    "auth",        "User JWT TTL (s)",                 "Lifetime of issued user JWTs in seconds. Default: 86 400 (24 h).",  false),
        // ── Messages ───────────────────────────────────────────────────────────
        ("message_ttl_ms",             14400000, "messages",    "Message TTL (ms)",                 "Time before stored messages are auto-deleted. Default: 4 h.",        false),
        ("message_max_chars",          4096,     "messages",    "Message max length (chars)",       "Maximum length of the E2EE ciphertext string per message.",          false),
        // ── Requests ───────────────────────────────────────────────────────────
        ("http_body_limit_bytes",      65536,    "requests",    "HTTP body limit (bytes)",          "Maximum allowed request body size at the gateway. Requires restart.", true),
    ];

    for (key, value, section, label, description, restart_required) in seeds {
        col.update_one(
            doc! { "key": *key },
            doc! { "$setOnInsert": doc! {
                "key":             *key,
                "value":           *value,
                "section":         *section,
                "label":           *label,
                "description":     *description,
                "restartRequired": *restart_required,
            }},
        )
        .upsert(true)
        .await?;
    }

    Ok(())
}

async fn migration_010(db: &Database) -> Result<(), mongodb::error::Error> {
    // 1. Rename tiers → meta_tiers (copy + drop)
    {
        let meta_tiers = db.collection::<Document>("meta_tiers");
        meta_tiers.create_index(
            IndexModel::builder()
                .keys(doc! { "name": 1 })
                .options(IndexOptions::builder().unique(true).build())
                .build(),
        ).await?;
        let old = db.collection::<Document>("tiers");
        let docs: Vec<Document> = match old.find(doc! {}).await {
            Ok(c) => c.try_collect().await.unwrap_or_default(),
            Err(_) => vec![],
        };
        if !docs.is_empty() { let _ = meta_tiers.insert_many(docs).await; }
        let _ = old.drop().await;
    }

    // 2. Rename admin_settings → meta_settings (copy + drop)
    {
        let meta_settings = db.collection::<Document>("meta_settings");
        meta_settings.create_index(
            IndexModel::builder()
                .keys(doc! { "key": 1 })
                .options(IndexOptions::builder().unique(true).build())
                .build(),
        ).await?;
        let old = db.collection::<Document>("admin_settings");
        let docs: Vec<Document> = match old.find(doc! {}).await {
            Ok(c) => c.try_collect().await.unwrap_or_default(),
            Err(_) => vec![],
        };
        if !docs.is_empty() { let _ = meta_settings.insert_many(docs).await; }
        let _ = old.drop().await;
    }

    // 3. Drop stale sessions TTL index so gateway can recreate with correct 15-min value (INFRA-1.2)
    let _ = db.collection::<Document>("sessions").drop_index("createdAt_1").await;

    // 4. Create meta_features collection, index, and seed defaults
    {
        let col = db.collection::<Document>("meta_features");
        col.create_index(
            IndexModel::builder()
                .keys(doc! { "name": 1 })
                .options(IndexOptions::builder().unique(true).build())
                .build(),
        ).await?;
        let now = BsonDateTime::now();
        let seeds: &[(&str, &str, &str, &str)] = &[
            ("see_map",           "See Map",           "Can access the map view.",                  "guest"),
            ("see_nearby",        "See Nearby Users",  "Can see other users on the map.",           "guest"),
            ("message_online",    "Message Online",    "Can send messages to online users.",        "regular"),
            ("message_offline",   "Message Offline",   "Can send messages to offline users.",       "regular"),
            ("message_radius",    "Message Radius",    "Has an extended message radius.",           "regular"),
            ("manage_favourites", "Manage Favourites", "Can add and remove users from favourites.", "regular"),
        ];
        for (name, label, description, min_tier) in seeds {
            col.update_one(
                doc! { "name": *name },
                doc! { "$setOnInsert": doc! {
                    "name": *name, "label": *label, "description": *description,
                    "minTier": *min_tier, "createdAt": now, "updatedAt": now,
                }},
            ).upsert(true).await?;
        }
    }

    Ok(())
}

async fn run_migration(id: &str, db: &Database) -> Result<(), mongodb::error::Error> {
    match id {
        "001_indexes"                => migration_001(db).await,
        "002_locations_2dsphere"     => migration_002(db).await,
        "003_blocks_indexes"         => migration_003(db).await,
        "004_tiers_seed"             => migration_004(db).await,
        "005_rename_developer_tier"  => migration_005(db).await,
        "006_email_index_sparse"     => migration_006(db).await,
        "007_shard_index"            => migration_007(db).await,
        "008_opaque_emailhash"       => migration_008(db).await,
        "009_admin_settings"         => migration_009(db).await,
        "010_meta_rename_and_features" => migration_010(db).await,
        _                            => Ok(()), // unknown migration — skip
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
