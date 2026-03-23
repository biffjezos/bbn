// ============================================================
// bOOmbOOm.NOW! — auth-service (Rust, OPAQUE)
//
// Implements OPAQUE password-authenticated key exchange.
// Passwords never reach this service in any form.
// Emails are stored only as HMAC-SHA256 hashes.
//
// Required env vars:
//   JWT_SECRET           — HS256 signing key
//   SERVICE_SECRET       — inter-service token key
//   MONGO_URI            — MongoDB connection string
//   EMAIL_PEPPER         — hex string, ≥32 bytes (HMAC key for email hashing)
//   OPAQUE_SERVER_SETUP  — base64-encoded ServerSetup (generated on first run)
//
// Optional:
//   PORT         — listen port (default 8080)
//   DB_NAME      — MongoDB database (default "boomboom")
//   ADMIN_BOOTSTRAP_USER_ID — ObjectId; promotes that user to admin on startup
// ============================================================

use std::{
    collections::HashMap,
    env,
    sync::Arc,
    time::{Duration, Instant},
};

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use axum::{
    extract::{FromRef, State},
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use base64::prelude::*;
use common::auth::{
    email_db_hash, issue_guest_token, issue_user_token, ServiceSecret, ServiceToken,
    UserTokenParams,
};
use common::mongo::safe_object_id;
use mongodb::{
    bson::{doc, spec::BinarySubtype, Binary, DateTime},
    options::IndexOptions,
    Client, Database, IndexModel,
};
use opaque_ke::{
    ciphersuite::CipherSuite,
    CredentialFinalization, CredentialRequest, RegistrationRequest, RegistrationUpload,
    ServerLogin, ServerLoginParameters, ServerRegistration, ServerSetup,
};
use rand::Rng;
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use tokio::sync::Mutex;

// ── Cipher suite (must match opaque-client-wasm exactly) ──────────────────────

struct DefaultCs;

impl CipherSuite for DefaultCs {
    type OprfCs      = opaque_ke::Ristretto255;
    type KeyExchange  = opaque_ke::TripleDh<opaque_ke::Ristretto255, sha2::Sha512>;
    type Ksf         = opaque_ke::argon2::Argon2<'static>;
}

// ── Login session state (in-memory, short TTL) ────────────────────────────────

struct LoginSession {
    state:   opaque_ke::ServerLogin<DefaultCs>,
    created: Instant,
}

const LOGIN_SESSION_TTL: Duration = Duration::from_secs(120); // 2 minutes

type LoginSessions = Arc<Mutex<HashMap<String, LoginSession>>>;

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

        // OPAQUE_SERVER_SETUP: required. If absent, generate and exit with instructions.
        let opaque_setup_b64 = match env::var("OPAQUE_SERVER_SETUP") {
            Ok(v) => v,
            Err(_) => {
                let mut rng = rand::rngs::OsRng;
                let setup = ServerSetup::<DefaultCs>::new(&mut rng);
                let encoded = BASE64_STANDARD.encode(setup.serialize());
                eprintln!("[auth] FATAL: OPAQUE_SERVER_SETUP is not set.");
                eprintln!("[auth] A new server setup has been generated.");
                eprintln!("[auth] Set this env var in Railway and restart:");
                eprintln!("[auth] OPAQUE_SERVER_SETUP={encoded}");
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
struct AppState {
    db:             Database,
    jwt_secret:     String,
    service_secret: String,
    email_pepper:   String,
    opaque_setup:   Arc<ServerSetup<DefaultCs>>,
    login_sessions: LoginSessions,
}

impl FromRef<AppState> for ServiceSecret {
    fn from_ref(s: &AppState) -> Self { ServiceSecret(s.service_secret.clone()) }
}

// ── State-token encryption ────────────────────────────────────────────────────
//
// The stateToken returned to the client is a random 32-char hex string that
// keys a short-lived in-memory HashMap entry. No serialisation of OPAQUE
// internals needed; works with a single replica.

fn random_state_id() -> String {
    let bytes: [u8; 16] = rand::thread_rng().r#gen();
    hex::encode(bytes)
}

// ── AES-256-GCM helper (used for the state_token) ─────────────────────────────
//
// Derives an AES-256 key from JWT_SECRET so that state tokens are
// opaque to the client and tamper-evident, enabling future stateless
// multi-replica support without any schema change.

fn aes_key_from_jwt_secret(secret: &str) -> [u8; 32] {
    let hash = Sha256::digest(secret.as_bytes());
    hash.into()
}

// ── Valid tiers / roles ───────────────────────────────────────────────────────

const VALID_USER_TIERS: &[&str] = &["regular", "premium", "unrestricted"];
const VALID_USER_ROLES: &[&str] = &["user", "admin", "venue_manager"];

fn sanitize_tier(tier: Option<&str>) -> &str {
    tier.filter(|t| VALID_USER_TIERS.contains(t)).unwrap_or("regular")
}

fn sanitize_role(role: Option<&str>) -> &str {
    role.filter(|r| VALID_USER_ROLES.contains(r)).unwrap_or("user")
}

// ── Validate emailHash ────────────────────────────────────────────────────────

fn is_valid_email_hash(h: &str) -> bool {
    h.len() == 64 && h.chars().all(|c| c.is_ascii_hexdigit())
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async fn bootstrap_admin(db: &Database, user_id_str: &str) {
    let Some(oid) = safe_object_id(user_id_str) else {
        eprintln!("[auth] ADMIN_BOOTSTRAP_USER_ID is not a valid ObjectId — skipping bootstrap.");
        return;
    };

    let already = db
        .collection::<mongodb::bson::Document>("users")
        .find_one(doc! { "role": "admin" })
        .await
        .unwrap_or(None)
        .is_some();

    if already {
        println!("[auth] Bootstrap: admin already exists — skipped.");
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
        Ok(r) if r.matched_count == 1 => println!(
            "[auth] Bootstrap: admin promotion succeeded. User must re-login. Remove ADMIN_BOOTSTRAP_USER_ID."
        ),
        Ok(_)  => eprintln!("[auth] Bootstrap: target user for admin promotion not found. Check ADMIN_BOOTSTRAP_USER_ID."),
        Err(e) => eprintln!("[auth] Bootstrap failed: {e}"),
    }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async fn health(State(state): State<AppState>) -> impl IntoResponse {
    match state.db.run_command(doc! { "ping": 1 }).await {
        Ok(_)  => Json(json!({ "ok": true })).into_response(),
        Err(_) => (StatusCode::SERVICE_UNAVAILABLE, Json(json!({ "ok": false, "error": "DB unreachable" }))).into_response(),
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

// ── POST /auth/register/start ─────────────────────────────────────────────────

#[derive(Deserialize)]
struct RegisterStartBody {
    #[serde(rename = "emailHash")]
    email_hash:           String,
    #[serde(rename = "registrationRequest")]
    registration_request: String, // base64
}

async fn auth_register_start(
    _: ServiceToken,
    State(state): State<AppState>,
    Json(body): Json<RegisterStartBody>,
) -> impl IntoResponse {
    if !is_valid_email_hash(&body.email_hash) {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid emailHash." }))).into_response();
    }

    let req_bytes = match BASE64_STANDARD.decode(&body.registration_request) {
        Ok(b) => b,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid registrationRequest." }))).into_response(),
    };
    let reg_request = match RegistrationRequest::<DefaultCs>::deserialize(&req_bytes) {
        Ok(r) => r,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Malformed registrationRequest." }))).into_response(),
    };

    let db_key = email_db_hash(&body.email_hash, &state.email_pepper);

    let result = match ServerRegistration::<DefaultCs>::start(
        &state.opaque_setup,
        reg_request,
        db_key.as_bytes(),
    ) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[auth/register/start] opaque: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response();
        }
    };

    let response_b64 = BASE64_STANDARD.encode(result.message.serialize());
    Json(json!({ "registrationResponse": response_b64 })).into_response()
}

// ── POST /auth/register/finish ────────────────────────────────────────────────

#[derive(Deserialize)]
struct RegisterFinishBody {
    #[serde(rename = "emailHash")]
    email_hash:           String,
    #[serde(rename = "registrationUpload")]
    registration_upload:  String, // base64
    nickname:             Option<String>,
    age:                  Option<serde_json::Value>,
    sex:                  Option<String>,
    #[serde(rename = "guestId")]
    guest_id:             Option<String>,
}

async fn auth_register_finish(
    _: ServiceToken,
    State(state): State<AppState>,
    Json(body): Json<RegisterFinishBody>,
) -> impl IntoResponse {
    // ── Validate fields ───────────────────────────────────────────────────────
    if !is_valid_email_hash(&body.email_hash) {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid emailHash." }))).into_response();
    }

    // ── Finalise OPAQUE registration ──────────────────────────────────────────
    let upload_bytes = match BASE64_STANDARD.decode(&body.registration_upload) {
        Ok(b) => b,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid registrationUpload." }))).into_response(),
    };
    let upload = match RegistrationUpload::<DefaultCs>::deserialize(&upload_bytes) {
        Ok(u) => u,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Malformed registrationUpload." }))).into_response(),
    };
    let password_file = ServerRegistration::<DefaultCs>::finish(upload);
    let record_bytes  = password_file.serialize().to_vec();
    let db_email_hash = email_db_hash(&body.email_hash, &state.email_pepper);
    let opaque_binary = Binary { subtype: BinarySubtype::Generic, bytes: record_bytes };

    let (Some(nickname_raw), Some(age_val), Some(sex)) = (body.nickname, body.age, body.sex) else {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "nickname, age, sex required." }))).into_response();
    };
    let nickname = nickname_raw.trim().to_string();
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

    // ── Insert user ───────────────────────────────────────────────────────────
    // Per-user email salt — stored now, consumed by profile-data encryption
    // (items 4+5). Prevents bulk precomputation attacks even if EMAIL_PEPPER leaks:
    // each user's email must be attacked independently.
    let email_salt_bytes: [u8; 16] = rand::thread_rng().r#gen();
    let email_salt_b64 = BASE64_STANDARD.encode(email_salt_bytes);

    let insert_result = state.db
        .collection::<mongodb::bson::Document>("users")
        .insert_one(doc! {
            "emailHash":     &db_email_hash,
            "emailSalt":     &email_salt_b64,
            "nickname":      &nickname,
            "opaqueRecord":  opaque_binary,
            "age":           age as i32,
            "sex":           &sex,
            "tier":          "regular",
            "role":          "user",
            "accountType":   "user",
            "tokenVersion":  0_i32,
            "createdAt":     DateTime::now(),
        })
        .await;

    let inserted_id = match insert_result {
        Ok(r)  => match r.inserted_id.as_object_id() {
            Some(oid) => oid.to_hex(),
            None => {
                eprintln!("[auth/register/finish] insert returned non-ObjectId _id");
                return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response();
            }
        },
        Err(e) if e.to_string().contains("11000") => {
            return (StatusCode::CONFLICT, Json(json!({ "error": "Email already in use." }))).into_response();
        }
        Err(e) => {
            eprintln!("[auth/register/finish] insert: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response();
        }
    };

    // ── Migrate guest location (best-effort) ──────────────────────────────────
    if let Some(ref guest_id) = body.guest_id {
        if !guest_id.is_empty() {
            let c_locs = state.db.collection::<mongodb::bson::Document>("locations");
            let c_sess = state.db.collection::<mongodb::bson::Document>("sessions");
            let _ = tokio::join!(
                c_locs.update_one(
                    doc! { "userId": guest_id },
                    doc! { "$set": { "userId": &inserted_id, "isRegistered": true, "nickname": &nickname, "sex": &sex } },
                ),
                c_sess.delete_one(doc! { "guestId": guest_id }),
            );
        }
    }

    // ── Issue JWT ─────────────────────────────────────────────────────────────
    let token = match issue_user_token(UserTokenParams {
        sub:          &inserted_id,
        nickname:     &nickname,
        sex:          &sex,
        age:          Some(age),
        role:         "user",
        tier:         "regular",
        tv:           0,
        account_type: "user",
    }, &state.jwt_secret) {
        Ok(t)  => t,
        Err(e) => {
            eprintln!("[auth/register/finish] jwt: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response();
        }
    };

    (StatusCode::CREATED, Json(json!({
        "token":    token,
        "nickname": nickname,
        "sex":      sex,
        "tier":     "regular",
    }))).into_response()
}

// ── POST /auth/login/start ────────────────────────────────────────────────────

#[derive(Deserialize)]
struct LoginStartBody {
    #[serde(rename = "emailHash")]
    email_hash:         String,
    #[serde(rename = "credentialRequest")]
    credential_request: String, // base64
}

/// DB projection for login — only what we need.
#[derive(serde::Deserialize)]
struct UserForLogin {
    #[serde(rename = "_id")]
    id:             mongodb::bson::oid::ObjectId,
    nickname:       String,
    sex:            Option<String>,
    age:            Option<i32>,
    tier:           Option<String>,
    role:           Option<String>,
    #[serde(rename = "accountType")]
    account_type:   String,
    #[serde(rename = "tokenVersion")]
    token_version:  Option<i32>,
    #[serde(rename = "opaqueRecord")]
    opaque_record:  Binary,
}

async fn auth_login_start(
    _: ServiceToken,
    State(state): State<AppState>,
    Json(body): Json<LoginStartBody>,
) -> impl IntoResponse {
    if !is_valid_email_hash(&body.email_hash) {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid emailHash." }))).into_response();
    }

    let req_bytes = match BASE64_STANDARD.decode(&body.credential_request) {
        Ok(b) => b,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid credentialRequest." }))).into_response(),
    };
    let cred_request = match CredentialRequest::<DefaultCs>::deserialize(&req_bytes) {
        Ok(r) => r,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Malformed credentialRequest." }))).into_response(),
    };

    let db_key = email_db_hash(&body.email_hash, &state.email_pepper);

    // Look up the user. Always run ServerLogin::start (even on unknown user)
    // to avoid timing-based user enumeration.
    let user_opt = state.db
        .collection::<UserForLogin>("users")
        .find_one(doc! { "emailHash": &db_key })
        .await
        .unwrap_or(None);

    let password_file = user_opt
        .as_ref()
        .and_then(|u| ServerRegistration::<DefaultCs>::deserialize(&u.opaque_record.bytes).ok());

    let mut rng = rand::rngs::OsRng;
    let result = match ServerLogin::<DefaultCs>::start(
        &mut rng,
        &state.opaque_setup,
        password_file,
        cred_request,
        db_key.as_bytes(),
        ServerLoginParameters::default(),
    ) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[auth/login/start] opaque: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response();
        }
    };

    // Store session state in-memory, keyed by a random token.
    let state_id = random_state_id();
    {
        let mut sessions = state.login_sessions.lock().await;
        // Purge stale sessions while we have the lock.
        sessions.retain(|_, v| v.created.elapsed() < LOGIN_SESSION_TTL);
        sessions.insert(state_id.clone(), LoginSession { state: result.state, created: Instant::now() });
    }

    let response_b64 = BASE64_STANDARD.encode(result.message.serialize());
    Json(json!({
        "credentialResponse": response_b64,
        "stateToken":         state_id,
    })).into_response()
}

// ── POST /auth/login/finish ───────────────────────────────────────────────────

#[derive(Deserialize)]
struct LoginFinishBody {
    #[serde(rename = "emailHash")]
    email_hash:              String,
    #[serde(rename = "credentialFinalization")]
    credential_finalization: String, // base64
    #[serde(rename = "stateToken")]
    state_token:             String,
    #[serde(rename = "guestId")]
    guest_id:                Option<String>,
}

async fn auth_login_finish(
    _: ServiceToken,
    State(state): State<AppState>,
    Json(body): Json<LoginFinishBody>,
) -> impl IntoResponse {
    if !is_valid_email_hash(&body.email_hash) {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid emailHash." }))).into_response();
    }

    // Retrieve and consume the login session.
    let session = {
        let mut sessions = state.login_sessions.lock().await;
        sessions.retain(|_, v| v.created.elapsed() < LOGIN_SESSION_TTL);
        match sessions.remove(&body.state_token) {
            Some(s) => s,
            None => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Login session expired or not found." }))).into_response(),
        }
    };

    let fin_bytes = match BASE64_STANDARD.decode(&body.credential_finalization) {
        Ok(b) => b,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid credentialFinalization." }))).into_response(),
    };
    let finalization = match CredentialFinalization::<DefaultCs>::deserialize(&fin_bytes) {
        Ok(f) => f,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Malformed credentialFinalization." }))).into_response(),
    };

    // Verify the finalization. An incorrect password causes the client-side
    // protocol to fail before this point, but we still check server-side.
    if let Err(_) = session.state.finish(finalization, ServerLoginParameters::default()) {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Invalid credentials." }))).into_response();
    }

    // Look up the user by emailHash to build the JWT.
    let db_key = email_db_hash(&body.email_hash, &state.email_pepper);
    let user = match state.db
        .collection::<UserForLogin>("users")
        .find_one(doc! { "emailHash": &db_key })
        .await
    {
        Ok(Some(u)) => u,
        Ok(None)    => return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Invalid credentials." }))).into_response(),
        Err(e)      => {
            eprintln!("[auth/login/finish] db: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response();
        }
    };

    let tier = sanitize_tier(user.tier.as_deref()).to_string();
    let role = sanitize_role(user.role.as_deref()).to_string();
    let tv   = user.token_version.unwrap_or(0).max(0) as u32;

    // Clean up guest session (best-effort).
    if let Some(ref guest_id) = body.guest_id {
        if !guest_id.is_empty() {
            let c_locs = state.db.collection::<mongodb::bson::Document>("locations");
            let c_sess = state.db.collection::<mongodb::bson::Document>("sessions");
            let _ = tokio::join!(
                c_locs.delete_one(doc! { "userId": guest_id }),
                c_sess.delete_one(doc! { "guestId": guest_id }),
            );
        }
    }

    let token = match issue_user_token(UserTokenParams {
        sub:          &user.id.to_hex(),
        nickname:     &user.nickname,
        sex:          user.sex.as_deref().unwrap_or(""),
        age:          user.age.map(|a| a.max(0) as u32),
        role:         &role,
        tier:         &tier,
        tv,
        account_type: &user.account_type,
    }, &state.jwt_secret) {
        Ok(t)  => t,
        Err(e) => {
            eprintln!("[auth/login/finish] jwt: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response();
        }
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
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let cfg = Config::from_env().unwrap_or_else(|e| {
        eprintln!("{e}");
        std::process::exit(1);
    });

    // Load OPAQUE server setup.
    let setup_bytes = BASE64_STANDARD
        .decode(&cfg.opaque_setup_b64)
        .expect("OPAQUE_SERVER_SETUP: invalid base64");
    let opaque_setup = ServerSetup::<DefaultCs>::deserialize(&setup_bytes)
        .expect("OPAQUE_SERVER_SETUP: invalid setup data");

    let db = Client::with_uri_str(&cfg.mongo_uri)
        .await
        .expect("Failed to connect to MongoDB")
        .database(&cfg.db_name);
    println!("[auth] DB connected.");

    // Ensure TTL index on sessions.
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

    let state = AppState {
        db,
        jwt_secret:     cfg.jwt_secret,
        service_secret: cfg.service_secret,
        email_pepper:   cfg.email_pepper,
        opaque_setup:   Arc::new(opaque_setup),
        login_sessions: Arc::new(Mutex::new(HashMap::new())),
    };

    let app = Router::new()
        .route("/health",                  get(health))
        .route("/auth/guest",              post(auth_guest))
        .route("/auth/register/start",     post(auth_register_start))
        .route("/auth/register/finish",    post(auth_register_finish))
        .route("/auth/login/start",        post(auth_login_start))
        .route("/auth/login/finish",       post(auth_login_finish))
        .fallback(not_found)
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", cfg.port))
        .await
        .unwrap();
    println!("[auth] Running on :{}", cfg.port);
    axum::serve(listener, app).await.unwrap();
}
