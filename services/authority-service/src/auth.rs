// ── OPAQUE authentication handlers ───────────────────────────────────────────
//
// Ported verbatim from auth-service. All OPAQUE logic lives here.
// The JWT_SECRET / EMAIL_PEPPER env vars are the same as auth-service.

use std::{collections::HashMap, time::{Duration, Instant}};

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::post,
    Router,
};
use base64::prelude::*;
use common::auth::{issue_user_token, issue_guest_token, email_db_hash, ServiceToken, UserTokenParams};
use mongodb::bson::{doc, spec::BinarySubtype, Binary, DateTime};
use opaque_ke::{
    ciphersuite::CipherSuite,
    CredentialFinalization, CredentialRequest, RegistrationRequest, RegistrationUpload,
    ServerLogin, ServerLoginParameters, ServerRegistration, ServerSetup,
};
use rand::Rng;
use serde::Deserialize;
use serde_json::json;
use tokio::sync::Mutex;

use crate::AppState;

// ── Cipher suite ──────────────────────────────────────────────────────────────

pub struct DefaultCs;

impl CipherSuite for DefaultCs {
    type OprfCs     = opaque_ke::Ristretto255;
    type KeyExchange = opaque_ke::TripleDh<opaque_ke::Ristretto255, sha2::Sha512>;
    type Ksf        = opaque_ke::argon2::Argon2<'static>;
}

// ── Login session state ───────────────────────────────────────────────────────

pub struct LoginSession {
    pub state:   opaque_ke::ServerLogin<DefaultCs>,
    pub created: Instant,
}

pub const LOGIN_SESSION_TTL: Duration = Duration::from_secs(120);
pub type LoginSessions = std::sync::Arc<Mutex<HashMap<String, LoginSession>>>;

pub fn random_state_id() -> String {
    let bytes: [u8; 16] = rand::thread_rng().r#gen();
    hex::encode(bytes)
}

// ── Input validation ──────────────────────────────────────────────────────────

pub fn is_valid_email_hash(h: &str) -> bool {
    h.len() == 64 && h.chars().all(|c| c.is_ascii_hexdigit())
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

// ── DB projection for login ───────────────────────────────────────────────────

#[derive(serde::Deserialize)]
pub struct UserForLogin {
    #[serde(rename = "_id")]
    pub id:            mongodb::bson::oid::ObjectId,
    pub nickname:      String,
    pub sex:           Option<String>,
    pub age:           Option<i32>,
    pub tier:          Option<String>,
    pub role:          Option<String>,
    #[serde(rename = "accountType")]
    pub account_type:  String,
    #[serde(rename = "tokenVersion")]
    pub token_version: Option<i32>,
    #[serde(rename = "opaqueRecord")]
    pub opaque_record: Binary,
}

const GUEST_TTL_MS: u64 = 15 * 60 * 1000;

// ── POST /auth/guest ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct GuestBody {
    #[serde(rename = "guestId")]
    guest_id: Option<String>,
}

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
        .upsert(true).await;
    if let Err(e) = upsert {
        eprintln!("[authority/guest] session upsert: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response();
    }
    match issue_guest_token(&guest_id, &state.jwt_secret) {
        Ok(token) => Json(json!({ "token": token, "expiresIn": GUEST_TTL_MS })).into_response(),
        Err(e)    => { eprintln!("[authority/guest] jwt sign: {e}"); (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response() }
    }
}

// ── POST /auth/register/start ─────────────────────────────────────────────────

#[derive(Deserialize)]
struct RegisterStartBody {
    #[serde(rename = "emailHash")]
    email_hash:           String,
    #[serde(rename = "registrationRequest")]
    registration_request: String,
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
        Ok(b)  => b,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid registrationRequest." }))).into_response(),
    };
    let reg_request = match RegistrationRequest::<DefaultCs>::deserialize(&req_bytes) {
        Ok(r)  => r,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Malformed registrationRequest." }))).into_response(),
    };
    let db_key = email_db_hash(&body.email_hash, &state.email_pepper);
    let result = match ServerRegistration::<DefaultCs>::start(&state.opaque_setup, reg_request, db_key.as_bytes()) {
        Ok(r)  => r,
        Err(e) => { eprintln!("[authority/register/start] opaque: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };
    Json(json!({ "registrationResponse": BASE64_STANDARD.encode(result.message.serialize()) })).into_response()
}

// ── POST /auth/register/finish ────────────────────────────────────────────────

#[derive(Deserialize)]
struct RegisterFinishBody {
    #[serde(rename = "emailHash")]
    email_hash:          String,
    #[serde(rename = "registrationUpload")]
    registration_upload: String,
    nickname:            Option<String>,
    age:                 Option<serde_json::Value>,
    sex:                 Option<String>,
    #[serde(rename = "guestId")]
    guest_id:            Option<String>,
}

async fn auth_register_finish(
    _: ServiceToken,
    State(state): State<AppState>,
    Json(body): Json<RegisterFinishBody>,
) -> impl IntoResponse {
    if !is_valid_email_hash(&body.email_hash) {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid emailHash." }))).into_response();
    }
    let upload_bytes = match BASE64_STANDARD.decode(&body.registration_upload) {
        Ok(b)  => b,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid registrationUpload." }))).into_response(),
    };
    let upload = match RegistrationUpload::<DefaultCs>::deserialize(&upload_bytes) {
        Ok(u)  => u,
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

    let email_salt_bytes: [u8; 16] = rand::thread_rng().r#gen();
    let email_salt_b64 = BASE64_STANDARD.encode(email_salt_bytes);

    let insert_result = state.db.collection::<mongodb::bson::Document>("users").insert_one(doc! {
        "emailHash": &db_email_hash, "emailSalt": &email_salt_b64,
        "nickname": &nickname, "opaqueRecord": opaque_binary,
        "age": age as i32, "sex": &sex,
        "tier": "regular", "role": "user", "accountType": "user",
        "tokenVersion": 0_i32, "createdAt": DateTime::now(),
    }).await;

    let inserted_id = match insert_result {
        Ok(r)  => match r.inserted_id.as_object_id() {
            Some(oid) => oid.to_hex(),
            None => { eprintln!("[authority/register/finish] non-ObjectId _id"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
        },
        Err(e) if e.to_string().contains("11000") => return (StatusCode::CONFLICT, Json(json!({ "error": "Email already in use." }))).into_response(),
        Err(e) => { eprintln!("[authority/register/finish] insert: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };

    if let Some(ref guest_id) = body.guest_id {
        if !guest_id.is_empty() {
            let c_locs = state.db.collection::<mongodb::bson::Document>("locations");
            let c_sess = state.db.collection::<mongodb::bson::Document>("sessions");
            let _ = tokio::join!(
                c_locs.update_one(doc! { "userId": guest_id }, doc! { "$set": { "userId": &inserted_id, "isRegistered": true, "nickname": &nickname, "sex": &sex } }),
                c_sess.delete_one(doc! { "guestId": guest_id }),
            );
        }
    }

    let token = match issue_user_token(UserTokenParams {
        sub: &inserted_id, nickname: &nickname, sex: &sex, age: Some(age),
        role: "user", tier: "regular", tv: 0, account_type: "user",
        ttl_secs: Some(*state.user_jwt_ttl_secs.read().unwrap()),
    }, &state.jwt_secret) {
        Ok(t)  => t,
        Err(e) => { eprintln!("[authority/register/finish] jwt: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };
    (StatusCode::CREATED, Json(json!({ "token": token, "nickname": nickname, "sex": sex, "tier": "regular" }))).into_response()
}

// ── POST /auth/login/start ────────────────────────────────────────────────────

#[derive(Deserialize)]
struct LoginStartBody {
    #[serde(rename = "emailHash")]
    email_hash:         String,
    #[serde(rename = "credentialRequest")]
    credential_request: String,
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
        Ok(b)  => b,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid credentialRequest." }))).into_response(),
    };
    let cred_request = match CredentialRequest::<DefaultCs>::deserialize(&req_bytes) {
        Ok(r)  => r,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Malformed credentialRequest." }))).into_response(),
    };
    let db_key   = email_db_hash(&body.email_hash, &state.email_pepper);
    let user_opt = state.db.collection::<UserForLogin>("users").find_one(doc! { "emailHash": &db_key }).await.unwrap_or(None);
    let password_file = user_opt.as_ref().and_then(|u| ServerRegistration::<DefaultCs>::deserialize(&u.opaque_record.bytes).ok());
    let mut rng = rand::rngs::OsRng;
    let result = match ServerLogin::<DefaultCs>::start(&mut rng, &state.opaque_setup, password_file, cred_request, db_key.as_bytes(), ServerLoginParameters::default()) {
        Ok(r)  => r,
        Err(e) => { eprintln!("[authority/login/start] opaque: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };
    let state_id = random_state_id();
    {
        let mut sessions = state.login_sessions.lock().await;
        sessions.retain(|_, v| v.created.elapsed() < LOGIN_SESSION_TTL);
        sessions.insert(state_id.clone(), LoginSession { state: result.state, created: Instant::now() });
    }
    Json(json!({ "credentialResponse": BASE64_STANDARD.encode(result.message.serialize()), "stateToken": state_id })).into_response()
}

// ── POST /auth/login/finish ───────────────────────────────────────────────────

#[derive(Deserialize)]
struct LoginFinishBody {
    #[serde(rename = "emailHash")]
    email_hash:              String,
    #[serde(rename = "credentialFinalization")]
    credential_finalization: String,
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
    let session = {
        let mut sessions = state.login_sessions.lock().await;
        sessions.retain(|_, v| v.created.elapsed() < LOGIN_SESSION_TTL);
        match sessions.remove(&body.state_token) {
            Some(s) => s,
            None    => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Login session expired or not found." }))).into_response(),
        }
    };
    let fin_bytes = match BASE64_STANDARD.decode(&body.credential_finalization) {
        Ok(b)  => b,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid credentialFinalization." }))).into_response(),
    };
    let finalization = match CredentialFinalization::<DefaultCs>::deserialize(&fin_bytes) {
        Ok(f)  => f,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Malformed credentialFinalization." }))).into_response(),
    };
    if session.state.finish(finalization, ServerLoginParameters::default()).is_err() {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Invalid credentials." }))).into_response();
    }
    let db_key = email_db_hash(&body.email_hash, &state.email_pepper);
    let user = match state.db.collection::<UserForLogin>("users").find_one(doc! { "emailHash": &db_key }).await {
        Ok(Some(u)) => u,
        Ok(None)    => return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Invalid credentials." }))).into_response(),
        Err(e)      => { eprintln!("[authority/login/finish] db: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };
    let tier = sanitize_tier(user.tier.as_deref()).to_string();
    let role = sanitize_role(user.role.as_deref()).to_string();
    let tv   = user.token_version.unwrap_or(0).max(0) as u32;

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
        sub: &user.id.to_hex(), nickname: &user.nickname,
        sex: user.sex.as_deref().unwrap_or(""), age: user.age.map(|a| a.max(0) as u32),
        role: &role, tier: &tier, tv, account_type: &user.account_type,
        ttl_secs: Some(*state.user_jwt_ttl_secs.read().unwrap()),
    }, &state.jwt_secret) {
        Ok(t)  => t,
        Err(e) => { eprintln!("[authority/login/finish] jwt: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };
    Json(json!({ "token": token, "nickname": user.nickname, "sex": user.sex.as_deref().unwrap_or(""), "tier": tier, "role": role, "accountType": user.account_type })).into_response()
}

// ── Router ────────────────────────────────────────────────────────────────────

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/guest",           post(auth_guest))
        .route("/auth/register/start",  post(auth_register_start))
        .route("/auth/register/finish", post(auth_register_finish))
        .route("/auth/login/start",     post(auth_login_start))
        .route("/auth/login/finish",    post(auth_login_finish))
}
