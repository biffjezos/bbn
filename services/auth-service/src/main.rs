// ============================================================
// bOOmbOOm.NOW! — auth-service (Rust)
// Replaces services/auth-service.js (moved to services-node/).
// Identical HTTP contract — gateway needs no changes.
// ============================================================

use std::{env, time::Duration};

use axum::{
    extract::{FromRef, State},
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use common::auth::{issue_guest_token, issue_user_token, ServiceSecret, ServiceToken, UserTokenParams};
use common::mongo::safe_object_id;
use mongodb::{
    bson::{doc, DateTime},
    options::IndexOptions,
    Client, Database, IndexModel,
};
use serde::Deserialize;
use serde_json::json;

// ── Config ────────────────────────────────────────────────────────────────────

struct Config {
    port:                    u16,
    jwt_secret:              String,
    service_secret:          String,
    mongo_uri:               String,
    db_name:                 String,
    admin_bootstrap_user_id: Option<String>,
}

impl Config {
    fn from_env() -> Result<Self, String> {
        let missing: Vec<&str> = ["JWT_SECRET", "SERVICE_SECRET", "MONGO_URI"]
            .into_iter()
            .filter(|k| env::var(k).is_err())
            .collect();
        if !missing.is_empty() {
            return Err(format!("FATAL: missing env vars: {}", missing.join(", ")));
        }
        Ok(Self {
            port:                    env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8080),
            jwt_secret:              env::var("JWT_SECRET").unwrap(),
            service_secret:          env::var("SERVICE_SECRET").unwrap(),
            mongo_uri:               env::var("MONGO_URI").unwrap(),
            db_name:                 env::var("DB_NAME").unwrap_or_else(|_| "boomboom".to_string()),
            admin_bootstrap_user_id: env::var("ADMIN_BOOTSTRAP_USER_ID").ok(),
        })
    }
}

// ── Valid tiers ───────────────────────────────────────────────────────────────

/// Tiers that a user account may hold.
/// Any unrecognised DB value falls back to "regular".
const VALID_USER_TIERS: &[&str] = &["regular", "premium", "unrestricted"];

fn sanitize_tier(tier: Option<&str>) -> &str {
    tier.filter(|t| VALID_USER_TIERS.contains(t))
        .unwrap_or("regular")
}

/// Roles that may be stored in the DB and reflected in the JWT.
const VALID_USER_ROLES: &[&str] = &["user", "admin", "venue_manager"];

fn sanitize_role(role: Option<&str>) -> &str {
    role.filter(|r| VALID_USER_ROLES.contains(r))
        .unwrap_or("user")
}

// ── App state ─────────────────────────────────────────────────────────────────

#[derive(Clone)]
struct AppState {
    db:             Database,
    jwt_secret:     String,
    service_secret: String,
}

impl FromRef<AppState> for ServiceSecret {
    fn from_ref(state: &AppState) -> Self { ServiceSecret(state.service_secret.clone()) }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

/// If ADMIN_BOOTSTRAP_USER_ID is set and no admin user exists yet,
/// promote that user to role=admin and bump tokenVersion.
/// This is the only path to the first admin account.
/// Remove the env var after the first successful boot.
async fn bootstrap_admin(db: &Database, user_id_str: &str) {
    let Some(oid) = safe_object_id(user_id_str) else {
        eprintln!("[auth] ADMIN_BOOTSTRAP_USER_ID '{user_id_str}' is not a valid ObjectId — skipping bootstrap.");
        return;
    };

    // If any admin already exists, do nothing
    let already_has_admin = db
        .collection::<mongodb::bson::Document>("users")
        .find_one(doc! { "role": "admin" })
        .await
        .unwrap_or(None)
        .is_some();

    if already_has_admin {
        println!("[auth] Bootstrap: admin already exists — skipped. You can remove ADMIN_BOOTSTRAP_USER_ID.");
        return;
    }

    match db
        .collection::<mongodb::bson::Document>("users")
        .update_one(
            doc! { "_id": oid },
            doc! { "$set": { "role": "admin" }, "$inc": { "tokenVersion": 1_i32 } },
        )
        .await
    {
        Ok(r) if r.matched_count == 1 => {
            println!("[auth] Bootstrap: user {user_id_str} promoted to admin. \
                      User must re-login. Remove ADMIN_BOOTSTRAP_USER_ID from env.");
        }
        Ok(_) => eprintln!("[auth] Bootstrap: user {user_id_str} not found in DB."),
        Err(e) => eprintln!("[auth] Bootstrap failed: {e}"),
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

// ── POST /auth/guest ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct GuestBody {
    #[serde(rename = "guestId")]
    guest_id: Option<String>,
}

const GUEST_TTL_MS: u64 = 15 * 60 * 1000;

async fn auth_guest(
    _: ServiceToken,
    State(state): State<AppState>,
    Json(body): Json<GuestBody>,
) -> impl IntoResponse {
    let Some(guest_id) = body.guest_id else {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid guestId." }))).into_response();
    };
    if guest_id.is_empty() || guest_id.len() > 64 {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid guestId." }))).into_response();
    }

    let upsert = state.db
        .collection::<mongodb::bson::Document>("sessions")
        .update_one(
            doc! { "guestId": &guest_id },
            doc! { "$set": { "guestId": &guest_id, "createdAt": DateTime::now() } },
        )
        .upsert(true)
        .await;

    if let Err(e) = upsert {
        eprintln!("[auth/guest] session upsert: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response();
    }

    match issue_guest_token(&guest_id, &state.jwt_secret) {
        Ok(token) => Json(json!({ "token": token, "expiresIn": GUEST_TTL_MS })).into_response(),
        Err(e) => {
            eprintln!("[auth/guest] jwt sign: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response()
        }
    }
}

// ── POST /auth/register ───────────────────────────────────────────────────────

#[derive(Deserialize)]
struct RegisterBody {
    email:    Option<String>,
    nickname: Option<String>,
    password: Option<String>,
    age:      Option<serde_json::Value>,
    sex:      Option<String>,
    #[serde(rename = "guestId")]
    guest_id: Option<String>,
}

async fn auth_register(
    _: ServiceToken,
    State(state): State<AppState>,
    Json(body): Json<RegisterBody>,
) -> impl IntoResponse {
    // ── Validate ─────────────────────────────────────────────────────────────
    let (Some(email), Some(nickname), Some(password), Some(age_val), Some(sex)) =
        (body.email, body.nickname, body.password, body.age, body.sex)
    else {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "All fields required." }))).into_response();
    };

    let nickname = nickname.trim().to_string();
    if nickname.len() < 2 || nickname.len() > 32 {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Nickname must be 2–32 characters." }))).into_response();
    }
    if !["m", "f"].contains(&sex.as_str()) {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "sex must be 'm' or 'f'." }))).into_response();
    }
    let age: u32 = match age_val.as_u64().and_then(|n| u32::try_from(n).ok()) {
        Some(n) if (18..=120).contains(&n) => n,
        _ => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Age must be 18–120." }))).into_response(),
    };
    if password.len() < 8 {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Password must be at least 8 characters." }))).into_response();
    }

    let email = email.to_lowercase();
    let email = email.trim().to_string();

    // ── Hash password (blocking) ──────────────────────────────────────────────
    let password_hash = match tokio::task::spawn_blocking(move || bcrypt::hash(password, 12)).await {
        Ok(Ok(h))  => h,
        Ok(Err(e)) => { eprintln!("[auth/register] bcrypt: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
        Err(e)     => { eprintln!("[auth/register] spawn_blocking: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };

    // ── Insert user ───────────────────────────────────────────────────────────
    let insert_result = state.db
        .collection::<mongodb::bson::Document>("users")
        .insert_one(doc! {
            "email":        &email,
            "nickname":     &nickname,
            "passwordHash": &password_hash,
            "age":          age as i32,
            "sex":          &sex,
            "tier":         "regular",
            "role":         "user",
            "accountType":  "user",
            "tokenVersion": 0_i32,
            "createdAt":    DateTime::now(),
        })
        .await;

    let inserted_id = match insert_result {
        Ok(r)  => r.inserted_id.as_object_id().unwrap().to_hex(),
        Err(e) if e.to_string().contains("11000") => {
            return (StatusCode::CONFLICT, Json(json!({ "error": "Email already in use." }))).into_response();
        }
        Err(e) => {
            eprintln!("[auth/register] insert: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response();
        }
    };

    // ── Migrate guest location (best-effort) ──────────────────────────────────
    if let Some(ref guest_id) = body.guest_id {
        if !guest_id.is_empty() {
            let locations = state.db.collection::<mongodb::bson::Document>("locations");
            let sessions  = state.db.collection::<mongodb::bson::Document>("sessions");
            let _ = tokio::join!(
                locations.update_one(
                    doc! { "userId": guest_id },
                    doc! { "$set": { "userId": &inserted_id, "isRegistered": true, "nickname": &nickname, "sex": &sex } },
                ),
                sessions.delete_one(doc! { "guestId": guest_id }),
            );
        }
    }

    // ── Issue token ───────────────────────────────────────────────────────────
    let token = match issue_user_token(UserTokenParams {
        sub:          &inserted_id,
        email:        &email,
        nickname:     &nickname,
        sex:          &sex,
        age:          Some(age),
        role:         "user",
        tier:         "regular",
        tv:           0,
        account_type: Some("user"), // always set; backfilled for old accounts by migration 007
    }, &state.jwt_secret) {
        Ok(t)  => t,
        Err(e) => { eprintln!("[auth/register] jwt sign: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };

    (StatusCode::CREATED, Json(json!({
        "token":    token,
        "nickname": nickname,
        "sex":      sex,
        "tier":     "regular",
    }))).into_response()
}

// ── POST /auth/login ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct LoginBody {
    email:    Option<String>,
    password: Option<String>,
    #[serde(rename = "guestId")]
    guest_id: Option<String>,
}

#[derive(Deserialize)]
struct UserDoc {
    #[serde(rename = "_id")]
    id:            mongodb::bson::oid::ObjectId,
    email:         String,
    nickname:      String,
    sex:           Option<String>,
    age:           Option<i32>,
    tier:          Option<String>,
    role:          Option<String>,
    #[serde(rename = "accountType")]
    account_type:  String,
    #[serde(rename = "passwordHash")]
    password_hash: String,
    #[serde(rename = "tokenVersion")]
    token_version: Option<i32>,
}

async fn auth_login(
    _: ServiceToken,
    State(state): State<AppState>,
    Json(body): Json<LoginBody>,
) -> impl IntoResponse {
    let (Some(email), Some(password)) = (body.email, body.password) else {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Email and password required." }))).into_response();
    };

    let email = email.to_lowercase();
    let email = email.trim().to_string();

    let user = match state.db
        .collection::<UserDoc>("users")
        .find_one(doc! { "email": &email })
        .await
    {
        Ok(Some(u)) => u,
        Ok(None)    => return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Invalid credentials." }))).into_response(),
        Err(e)      => { eprintln!("[auth/login] db: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };

    // ── Verify password (blocking) ────────────────────────────────────────────
    let hash = user.password_hash.clone();
    let matches = match tokio::task::spawn_blocking(move || bcrypt::verify(&password, &hash)).await {
        Ok(Ok(b))  => b,
        Ok(Err(e)) => { eprintln!("[auth/login] bcrypt verify: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
        Err(e)     => { eprintln!("[auth/login] spawn_blocking: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };
    if !matches {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Invalid credentials." }))).into_response();
    }

    // ── Sanitize tier and role from DB ────────────────────────────────────────
    let tier = sanitize_tier(user.tier.as_deref()).to_string();
    let role = sanitize_role(user.role.as_deref()).to_string();
    let tv   = user.token_version.unwrap_or(0).max(0) as u32;

    // ── Cleanup guest session (best-effort) ───────────────────────────────────
    if let Some(ref guest_id) = body.guest_id {
        if !guest_id.is_empty() {
            let locations = state.db.collection::<mongodb::bson::Document>("locations");
            let sessions  = state.db.collection::<mongodb::bson::Document>("sessions");
            let _ = tokio::join!(
                locations.delete_one(doc! { "userId": guest_id }),
                sessions.delete_one(doc! { "guestId": guest_id }),
            );
        }
    }

    // ── Issue token ───────────────────────────────────────────────────────────
    let token = match issue_user_token(UserTokenParams {
        sub:          &user.id.to_hex(),
        email:        &user.email,
        nickname:     &user.nickname,
        sex:          user.sex.as_deref().unwrap_or(""),
        age:          user.age.map(|a| a.max(0) as u32),
        role:         &role,
        tier:         &tier,
        tv,
        account_type: &user.account_type,
    }, &state.jwt_secret) {
        Ok(t)  => t,
        Err(e) => { eprintln!("[auth/login] jwt sign: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };

    Json(json!({
        "token":       token,
        "nickname":    user.nickname,
        "sex":         user.sex.as_deref().unwrap_or(""),
        "tier":        tier,
        "role":        role,
        "accountType": user.account_type,
    })).into_response()
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
    println!("[auth] DB connected.");

    // Ensure TTL index on sessions.createdAt — auto-expires guest sessions after 20 minutes.
    // create_index is idempotent: MongoDB ignores the call if the index already exists.
    {
        let idx = IndexModel::builder()
            .keys(doc! { "createdAt": 1 })
            .options(IndexOptions::builder().expire_after(Duration::from_secs(20 * 60)).build())
            .build();
        if let Err(e) = db.collection::<mongodb::bson::Document>("sessions").create_index(idx).await {
            eprintln!("[auth] sessions TTL index: {e}");
        }
    }

    if let Some(ref uid) = cfg.admin_bootstrap_user_id {
        bootstrap_admin(&db, uid).await;
    }

    let state = AppState { db, jwt_secret: cfg.jwt_secret, service_secret: cfg.service_secret };

    let app = Router::new()
        .route("/health",         get(health))
        .route("/auth/guest",     post(auth_guest))
        .route("/auth/register",  post(auth_register))
        .route("/auth/login",     post(auth_login))
        .fallback(not_found)
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", cfg.port))
        .await
        .unwrap();
    println!("[auth] Running on :{}", cfg.port);
    axum::serve(listener, app).await.unwrap();
}
