// ============================================================
// bOOmbOOm.NOW! — users-service (Rust)
// Replaces services/users-service.js.
// Identical HTTP contract — gateway needs no changes.
// ============================================================

use std::env;
use std::sync::{Arc, RwLock};

use axum::{
    extract::{FromRef, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{delete, get, patch, post, put},
    Router,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use common::{
    auth::{issue_user_token, AuthToken, JwtSecret, ServiceSecret, RequireRegistered, ServiceToken, UserTokenParams},
    mongo::safe_object_id,
};
use futures_util::TryStreamExt;
use mongodb::{
    bson::{doc, Binary, DateTime as BsonDateTime, Document},
    bson::spec::BinarySubtype,
    options::ReturnDocument,
    Client, Database,
};
use opaque_ke::{CipherSuite, ServerRegistration, ServerSetup};

use serde::{Deserialize, Serialize};
use serde_json::json;

// ── OPAQUE cipher suite (must match auth-service and WASM client) ─────────────

// Server-side OPAQUE registration is stateless — the server only mediates
// the OPRF blind. No in-memory session state is needed between start/finish.
struct DefaultCs;
impl CipherSuite for DefaultCs {
    type OprfCs      = opaque_ke::Ristretto255;
    type KeyExchange = opaque_ke::TripleDh<opaque_ke::Ristretto255, sha2::Sha512>;
    type Ksf         = opaque_ke::argon2::Argon2<'static>;
}

// ── Config ────────────────────────────────────────────────────────────────────

fn is_valid_email_hash(h: &str) -> bool {
    h.len() == 64 && h.chars().all(|c| c.is_ascii_hexdigit())
}

struct Config {
    port:                   u16,
    mongo_uri:              String,
    db_name:                String,
    jwt_secret:             String,
    service_secret:         String,
    opaque_server_setup_b64: String,
}

impl Config {
    fn from_env() -> Result<Self, String> {
        let required = ["JWT_SECRET", "SERVICE_SECRET", "MONGO_URI", "OPAQUE_SERVER_SETUP"];
        let missing: Vec<_> = required.iter().filter(|k| env::var(k).is_err()).collect();
        if !missing.is_empty() {
            return Err(format!(
                "FATAL: missing env vars: {}",
                missing.iter().map(|k| **k).collect::<Vec<_>>().join(", ")
            ));
        }
        Ok(Self {
            port:                   env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(3002),
            mongo_uri:              env::var("MONGO_URI").unwrap(),
            db_name:                env::var("DB_NAME").unwrap_or_else(|_| "boomboom".to_string()),
            jwt_secret:             env::var("JWT_SECRET").unwrap(),
            service_secret:         env::var("SERVICE_SECRET").unwrap(),
            opaque_server_setup_b64: env::var("OPAQUE_SERVER_SETUP").unwrap(),
        })
    }
}

// ── App state ─────────────────────────────────────────────────────────────────

#[derive(Clone)]
struct AppState {
    db:                 Database,
    jwt_secret:         String,
    service_secret:     String,
    opaque_setup:       Arc<ServerSetup<DefaultCs>>,
    /// Cached user JWT TTL from admin_settings. Refreshed every 60 s.
    user_jwt_ttl_secs:  Arc<RwLock<u64>>,
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

// ── DB document types ─────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct UserOpaqueRecord {
    #[serde(rename = "opaqueRecord")]
    opaque_record: Option<mongodb::bson::Binary>,
}

#[derive(Deserialize)]
struct UserForToken {
    #[serde(rename = "_id")]
    id:            mongodb::bson::oid::ObjectId,
    nickname:      Option<String>,
    sex:           Option<String>,
    age:           Option<i32>,
    role:          Option<String>,
    tier:          Option<String>,
    #[serde(rename = "accountType")]
    account_type:  String,
    #[serde(rename = "tokenVersion")]
    token_version: Option<i32>,
}

#[derive(Deserialize)]
struct SearchUserDoc {
    #[serde(rename = "_id")]
    id:           mongodb::bson::oid::ObjectId,
    nickname:     Option<String>,
    age:          Option<i32>,
    sex:          Option<String>,
    #[serde(rename = "accountType")]
    account_type: String,
}

#[derive(Deserialize)]
struct ProfileDoc {
    nickname:              Option<String>,
    age:                   Option<i32>,
    sex:                   Option<String>,
    #[serde(rename = "publicKey")]
    public_key:            Option<String>,
    #[serde(rename = "accountType")]
    account_type:          String,
    #[serde(rename = "managerId")]
    manager_id:            Option<String>,
    #[serde(rename = "venueName")]
    venue_name:            Option<String>,
    description:           Option<String>,
    #[serde(rename = "openingHours")]
    opening_hours:         Option<String>,
    #[serde(rename = "locationType")]
    location_type:         Option<String>,
    address:               Option<String>,
    #[serde(rename = "canReceiveMessages")]
    can_receive_messages:  Option<bool>,
}

#[derive(Deserialize)]
struct AdminUserDoc {
    #[serde(rename = "_id")]
    id:            mongodb::bson::oid::ObjectId,
    nickname:      Option<String>,
    age:           Option<i32>,
    sex:           Option<String>,
    tier:          Option<String>,
    role:          Option<String>,
    #[serde(rename = "accountType")]
    account_type:  String,
    #[serde(rename = "managerId")]
    manager_id:    Option<String>,
    #[serde(rename = "tokenVersion")]
    token_version: Option<i32>,
    #[serde(rename = "createdAt")]
    created_at:    Option<BsonDateTime>,
}

#[derive(Deserialize)]
struct TvDoc {
    #[serde(rename = "tokenVersion")]
    token_version: Option<i32>,
}

#[derive(Deserialize)]
struct OnlineLocDoc {
    #[serde(rename = "userId")]
    user_id: String,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Escape regex special characters (matches JS behaviour).
fn regex_escape(s: &str) -> String {
    s.chars().flat_map(|c| match c {
        '.' | '+' | '?' | '^' | '$' | '{' | '}' | '(' | ')' | '|' | '[' | ']' | '\\' | '*' => {
            vec!['\\', c]
        }
        _ => vec![c],
    }).collect()
}

fn make_token(user: &UserForToken, secret: &str, ttl_secs: u64) -> Result<String, String> {
    issue_user_token(
        UserTokenParams {
            sub:          &user.id.to_hex(),
            nickname:     user.nickname.as_deref().unwrap_or(""),
            sex:          user.sex.as_deref().unwrap_or(""),
            age:          user.age.map(|a| a.max(0) as u32),
            role:         match user.role.as_deref() { Some("admin") => "admin", Some("venue_manager") => "venue_manager", _ => "user" },
            tier:         user.tier.as_deref().unwrap_or("regular"),
            tv:           user.token_version.unwrap_or(0).max(0) as u32,
            account_type: &user.account_type,
            ttl_secs:     Some(ttl_secs),
        },
        secret,
    )
    .map_err(|e| e.to_string())
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async fn health(State(state): State<AppState>) -> impl IntoResponse {
    match state.db.run_command(doc! { "ping": 1 }).await {
        Ok(_)  => Json(json!({ "ok": true })).into_response(),
        Err(_) => (StatusCode::SERVICE_UNAVAILABLE, Json(json!({ "ok": false, "error": "DB unreachable" }))).into_response(),
    }
}

// ── GET /users/me ─────────────────────────────────────────────────────────────

async fn get_me(
    _svc: ServiceToken,
    RequireRegistered(claims): RequireRegistered,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let oid = match safe_object_id(&claims.sub) {
        Some(id) => id,
        None     => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid user id." }))).into_response(),
    };

    let user: Option<Document> = match state.db.collection::<Document>("users")
        .find_one(doc! { "_id": oid })
        .projection(doc! { "passwordHash": 0 })
        .await
    {
        Ok(u)  => u,
        Err(e) => { eprintln!("[users/me GET] {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };

    match user {
        None    => (StatusCode::NOT_FOUND, Json(json!({ "error": "User not found." }))).into_response(),
        Some(d) => {
            let v: serde_json::Value = mongodb::bson::to_document(&d)
                .ok()
                .and_then(|doc| serde_json::to_value(&doc).ok())
                .unwrap_or(serde_json::Value::Null);
            Json(v).into_response()
        }
    }
}

// ── PUT /users/me ─────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct UpdateMeBody {
    nickname:              Option<String>,
    #[serde(rename = "venueName")]
    venue_name:            Option<String>,
    age:                   Option<serde_json::Value>,
    sex:                   Option<String>,
    tier:                  Option<serde_json::Value>,
    #[serde(rename = "publicKey")]
    public_key:            Option<String>,
    #[serde(rename = "encryptedPrivateKey")]
    encrypted_private_key: Option<serde_json::Value>,
}

async fn put_me(
    _svc: ServiceToken,
    RequireRegistered(claims): RequireRegistered,
    State(state): State<AppState>,
    Json(body): Json<UpdateMeBody>,
) -> impl IntoResponse {
    if body.tier.is_some() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "tier cannot be modified." }))).into_response();
    }

    let oid = match safe_object_id(&claims.sub) {
        Some(id) => id,
        None     => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(),
    };

    let mut update = doc! {};

    if let Some(nick) = body.nickname {
        let nick = nick.trim().to_string();
        if nick.len() < 2 || nick.len() > 32 {
            return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Nickname must be 2–32 characters." }))).into_response();
        }
        update.insert("nickname", &nick);
    }

    if let Some(vname) = body.venue_name {
        let vname = vname.trim().to_string();
        if vname.len() < 2 || vname.len() > 64 {
            return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Venue name must be 2–64 characters." }))).into_response();
        }
        update.insert("venueName", &vname);
        // Keep nickname in sync so map/favourites display the venue name
        update.insert("nickname", &vname);
    }

    if let Some(age_val) = body.age {
        let age: i32 = match &age_val {
            serde_json::Value::Number(n) => n.as_i64().unwrap_or(0) as i32,
            serde_json::Value::String(s) => s.parse().unwrap_or(0),
            _ => 0,
        };
        if age < 18 || age > 120 {
            return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Age must be 18-120." }))).into_response();
        }
        update.insert("age", age);
    }

    if let Some(sex) = body.sex {
        if !matches!(sex.as_str(), "m" | "f") {
            return (StatusCode::BAD_REQUEST, Json(json!({ "error": "sex must be 'm' or 'f'." }))).into_response();
        }
        update.insert("sex", sex);
    }

    // Accept key update (profile update only — not tied to password change)
    if let (Some(pk), Some(epk)) = (body.public_key, body.encrypted_private_key) {
        if let Ok(epk_bson) = mongodb::bson::to_bson(&epk) {
            update.insert("publicKey", pk);
            update.insert("encryptedPrivateKey", epk_bson);
        }
    }

    if update.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Nothing to update." }))).into_response();
    }

    if let Err(e) = state.db.collection::<Document>("users")
        .update_one(doc! { "_id": oid }, doc! { "$set": update.clone() })
        .await
    {
        eprintln!("[users/me PUT] update: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response();
    }

    // Keep location doc in sync
    let mut loc_update = doc! {};
    if let Some(sex) = update.get_str("sex").ok() { loc_update.insert("sex", sex); }
    if let Some(nick) = update.get_str("nickname").ok() { loc_update.insert("nickname", nick); }
    if let Some(vname) = update.get_str("venueName").ok() { loc_update.insert("venueName", vname); }
    if !loc_update.is_empty() {
        let _ = state.db.collection::<Document>("locations")
            .update_one(doc! { "userId": &claims.sub }, doc! { "$set": loc_update })
            .await;
    }

    Json(json!({ "ok": true })).into_response()
}

// ── DELETE /users/me ──────────────────────────────────────────────────────────

async fn cascade_delete_venue(db: &mongodb::Database, venue_id_str: &str) {
    let c_messages  = db.collection::<Document>("messages");
    let c_favourites = db.collection::<Document>("favourites");
    let c_blocks    = db.collection::<Document>("blocks");
    let c_users     = db.collection::<Document>("users");
    let oid = match safe_object_id(venue_id_str) {
        Some(id) => id,
        None     => return,
    };
    let _ = tokio::join!(
        c_messages.delete_many(doc! { "$or": [{ "fromUserId": venue_id_str }, { "toUserId": venue_id_str }] }),
        c_favourites.delete_many(doc! { "$or": [{ "ownerUserId": venue_id_str }, { "favouriteUserId": venue_id_str }] }),
        c_blocks.delete_many(doc! { "$or": [{ "blockerUserId": venue_id_str }, { "blockedUserId": venue_id_str }] }),
        c_users.delete_one(doc! { "_id": oid }),
    );
}

async fn delete_me(
    _svc: ServiceToken,
    RequireRegistered(claims): RequireRegistered,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let oid = match safe_object_id(&claims.sub) {
        Some(id) => id,
        None     => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(),
    };
    let id = &claims.sub;

    // If this is a venue manager, cascade-delete all linked venues first.
    if claims.role == "venue_manager" {
        #[derive(Deserialize)]
        struct VenueIdDoc { #[serde(rename = "_id")] id: mongodb::bson::oid::ObjectId }
        let venue_ids: Vec<String> = match state.db
            .collection::<VenueIdDoc>("users")
            .find(doc! { "accountType": "venue", "managerId": id })
            .projection(doc! { "_id": 1 })
            .await
        {
            Ok(cursor) => cursor.try_collect::<Vec<_>>().await.unwrap_or_default()
                .into_iter().map(|v| v.id.to_hex()).collect(),
            Err(e) => { eprintln!("[users/me DELETE] venue lookup: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
        };
        for vid in venue_ids {
            cascade_delete_venue(&state.db, &vid).await;
        }
    }

    let c_users     = state.db.collection::<Document>("users");
    let c_locs      = state.db.collection::<Document>("locations");
    let c_messages  = state.db.collection::<Document>("messages");
    let c_favourites = state.db.collection::<Document>("favourites");
    let (r1, r2, r3, r4) = tokio::join!(
        c_users.delete_one(doc! { "_id": oid }),
        c_locs.delete_one(doc! { "userId": id }),
        c_messages.delete_many(doc! { "$or": [{ "fromUserId": id }, { "toUserId": id }] }),
        c_favourites.delete_many(doc! { "$or": [{ "ownerUserId": id }, { "favouriteUserId": id }] }),
    );

    if r1.is_err() || r2.is_err() || r3.is_err() || r4.is_err() {
        eprintln!("[users/me DELETE] partial failure");
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response();
    }

    Json(json!({ "ok": true })).into_response()
}

// ── GET /users/search ─────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct SearchQuery {
    nickname:     Option<String>,
    #[serde(rename = "ageMin")]
    age_min:      Option<i32>,
    #[serde(rename = "ageMax")]
    age_max:      Option<i32>,
    sex:          Option<String>,
    online:       Option<String>,
    #[serde(rename = "accountType")]
    account_type: Option<String>,
}

async fn search_users(
    _svc: ServiceToken,
    RequireRegistered(_claims): RequireRegistered,
    State(state): State<AppState>,
    Query(q): Query<SearchQuery>,
) -> impl IntoResponse {
    let mut filter = doc! {};

    if let Some(nick) = q.nickname.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        let esc = regex_escape(nick);
        filter.insert("nickname", doc! { "$regex": esc, "$options": "i" });
    }

    if let Some(sex) = &q.sex {
        if matches!(sex.as_str(), "m" | "f") {
            filter.insert("sex", sex.as_str());
        }
    }

    if let Some(at) = &q.account_type {
        if matches!(at.as_str(), "user" | "venue") {
            filter.insert("accountType", at.as_str());
        }
    }

    let mut age_filter = doc! {};
    if let Some(min) = q.age_min { age_filter.insert("$gte", min); }
    if let Some(max) = q.age_max { age_filter.insert("$lte", max); }
    if !age_filter.is_empty() { filter.insert("age", age_filter); }

    let users: Vec<SearchUserDoc> = match state.db
        .collection::<SearchUserDoc>("users")
        .find(filter)
        .projection(doc! { "nickname": 1, "age": 1, "sex": 1, "accountType": 1 })
        .limit(50)
        .await
    {
        Ok(c)  => c.try_collect().await.unwrap_or_default(),
        Err(e) => { eprintln!("[users/search] {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };

    if users.is_empty() {
        return Json(json!({ "users": [] })).into_response();
    }

    let user_ids: Vec<String> = users.iter().map(|u| u.id.to_hex()).collect();
    let cutoff = BsonDateTime::from_millis(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64 - 10 * 60 * 1000,
    );

    let online_docs: Vec<OnlineLocDoc> = match state.db
        .collection::<OnlineLocDoc>("locations")
        .find(doc! { "userId": { "$in": &user_ids }, "updatedAt": { "$gt": cutoff } })
        .projection(doc! { "userId": 1 })
        .await
    {
        Ok(c)  => c.try_collect().await.unwrap_or_default(),
        Err(_) => vec![],
    };

    let online_set: std::collections::HashSet<&str> = online_docs.iter()
        .map(|l| l.user_id.as_str())
        .collect();

    let mut results: Vec<_> = users.iter().map(|u| {
        let uid = u.id.to_hex();
        // Venues have a fixed location and are always reachable — never offline.
        let is_online = u.account_type == "venue"
            || online_set.contains(uid.as_str());
        json!({
            "userId":      uid,
            "nickname":    u.nickname.as_deref(),
            "age":         u.age,
            "sex":         u.sex.as_deref(),
            "online":      is_online,
            "accountType": u.account_type,
        })
    }).collect();

    if let Some(ref online_filter) = q.online {
        results.retain(|r| {
            let is_online = r["online"].as_bool().unwrap_or(false);
            if online_filter == "yes" { is_online } else if online_filter == "no" { !is_online } else { true }
        });
    }

    Json(json!({ "users": results })).into_response()
}

// ── GET /users/:userId/profile ────────────────────────────────────────────────

async fn get_profile(
    _svc: ServiceToken,
    AuthToken(claims): AuthToken,
    State(state): State<AppState>,
    Path(user_id): Path<String>,
) -> impl IntoResponse {
    let oid = match safe_object_id(&user_id) {
        Some(id) => id,
        None     => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid userId." }))).into_response(),
    };

    // Block check — registered viewers only (guests cannot block or be blocked)
    if matches!(claims.role.as_str(), "user" | "venue_manager") {
        let viewer_id = &claims.sub;
        let target_id = &user_id;
        let block = match state.db.collection::<Document>("blocks")
            .find_one(doc! {
                "$or": [
                    { "blockerUserId": viewer_id, "blockedUserId": target_id },
                    { "blockerUserId": target_id, "blockedUserId": viewer_id },
                ],
            })
            .await
        {
            Ok(b)  => b,
            Err(e) => { eprintln!("[users/profile GET] block check: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
        };

        if let Some(ref b) = block {
            // Target blocked the viewer — 404 (no info leak)
            if b.get_str("blockerUserId").unwrap_or("") == target_id {
                return (StatusCode::NOT_FOUND, Json(json!({ "error": "User not found." }))).into_response();
            }
            // Viewer blocked the target — return profile with flag
            let user = match state.db.collection::<ProfileDoc>("users")
                .find_one(doc! { "_id": oid })
                .projection(doc! { "nickname": 1, "age": 1, "sex": 1, "publicKey": 1, "accountType": 1, "managerId": 1, "venueName": 1, "description": 1, "openingHours": 1, "locationType": 1, "address": 1, "canReceiveMessages": 1, "_id": 0 })
                .await
            {
                Ok(Some(u)) => u,
                Ok(None)    => return (StatusCode::NOT_FOUND, Json(json!({ "error": "User not found." }))).into_response(),
                Err(e)      => { eprintln!("[users/profile GET] {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
            };
            return Json(json!({
                "nickname":            user.nickname.as_deref(),
                "age":                 user.age,
                "sex":                 user.sex.as_deref(),
                "publicKey":           user.public_key.as_deref(),
                "accountType":         user.account_type,
                "managerId":           user.manager_id.as_deref(),
                "venueName":           user.venue_name.as_deref(),
                "description":         user.description.as_deref(),
                "openingHours":        user.opening_hours.as_deref(),
                "locationType":        user.location_type.as_deref(),
                "address":             user.address.as_deref(),
                "canReceiveMessages":  user.can_receive_messages.unwrap_or(true),
                "blockedByViewer":     true,
            })).into_response();
        }
    }

    let user = match state.db.collection::<ProfileDoc>("users")
        .find_one(doc! { "_id": oid })
        .projection(doc! { "nickname": 1, "age": 1, "sex": 1, "publicKey": 1, "accountType": 1, "managerId": 1, "venueName": 1, "description": 1, "openingHours": 1, "locationType": 1, "address": 1, "canReceiveMessages": 1, "_id": 0 })
        .await
    {
        Ok(Some(u)) => u,
        Ok(None)    => return (StatusCode::NOT_FOUND, Json(json!({ "error": "User not found." }))).into_response(),
        Err(e)      => { eprintln!("[users/profile GET] {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };

    Json(json!({
        "nickname":           user.nickname.as_deref(),
        "age":                user.age,
        "sex":                user.sex.as_deref(),
        "publicKey":          user.public_key.as_deref(),
        "accountType":        user.account_type,
        "managerId":          user.manager_id.as_deref(),
        "venueName":          user.venue_name.as_deref(),
        "description":        user.description.as_deref(),
        "openingHours":       user.opening_hours.as_deref(),
        "locationType":       user.location_type.as_deref(),
        "address":            user.address.as_deref(),
        "canReceiveMessages": user.can_receive_messages.unwrap_or(true),
    })).into_response()
}

// ── PUT /users/me/keys ────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct KeysBody {
    #[serde(rename = "publicKey")]
    public_key:            Option<String>,
    #[serde(rename = "encryptedPrivateKey")]
    encrypted_private_key: Option<serde_json::Value>,
}

async fn put_keys(
    _svc: ServiceToken,
    RequireRegistered(claims): RequireRegistered,
    State(state): State<AppState>,
    Json(body): Json<KeysBody>,
) -> impl IntoResponse {
    let (Some(pk), Some(epk)) = (body.public_key, body.encrypted_private_key) else {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "publicKey and encryptedPrivateKey required." }))).into_response();
    };
    let epk_bson = match mongodb::bson::to_bson(&epk) {
        Ok(b)  => b,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid encryptedPrivateKey." }))).into_response(),
    };

    let oid = match safe_object_id(&claims.sub) {
        Some(id) => id,
        None     => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(),
    };

    match state.db.collection::<Document>("users")
        .update_one(doc! { "_id": oid }, doc! { "$set": { "publicKey": pk, "encryptedPrivateKey": epk_bson } })
        .await
    {
        Ok(_)  => Json(json!({ "ok": true })).into_response(),
        Err(e) => { eprintln!("[users/me/keys PUT] {e}"); (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response() }
    }
}

// ── GET /users/me/keys ────────────────────────────────────────────────────────

async fn get_keys(
    _svc: ServiceToken,
    RequireRegistered(claims): RequireRegistered,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let oid = match safe_object_id(&claims.sub) {
        Some(id) => id,
        None     => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(),
    };

    match state.db.collection::<Document>("users")
        .find_one(doc! { "_id": oid })
        .projection(doc! { "publicKey": 1, "encryptedPrivateKey": 1, "_id": 0 })
        .await
    {
        Ok(Some(d)) => {
            let pk:  Option<&str>          = d.get_str("publicKey").ok();
            let epk: Option<serde_json::Value> = d.get("encryptedPrivateKey")
                .and_then(|b| mongodb::bson::from_bson(b.clone()).ok());
            Json(json!({ "publicKey": pk, "encryptedPrivateKey": epk })).into_response()
        }
        Ok(None)    => (StatusCode::NOT_FOUND, Json(json!({ "error": "User not found." }))).into_response(),
        Err(e)      => { eprintln!("[users/me/keys GET] {e}"); (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response() }
    }
}

// ── GET /users/me/preferences ────────────────────────────────────────────────

async fn get_preferences(
    _svc: ServiceToken,
    RequireRegistered(claims): RequireRegistered,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let oid = match safe_object_id(&claims.sub) {
        Some(id) => id,
        None     => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid user id." }))).into_response(),
    };

    let user: Option<Document> = match state.db.collection::<Document>("users")
        .find_one(doc! { "_id": oid })
        .projection(doc! { "preferences": 1 })
        .await
    {
        Ok(u)  => u,
        Err(e) => { eprintln!("[users/me/preferences GET] {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };

    let prefs        = user.as_ref().and_then(|d| d.get_document("preferences").ok());
    let map_zoom     = prefs.and_then(|p| p.get_i32("mapZoom").ok()).unwrap_or(17);
    let show_fav_pins = prefs.and_then(|p| p.get_bool("showFavPins").ok()).unwrap_or(true);

    Json(json!({ "mapZoom": map_zoom, "showFavPins": show_fav_pins })).into_response()
}

// ── PUT /users/me/preferences ────────────────────────────────────────────────

#[derive(Deserialize)]
struct PreferencesBody {
    #[serde(rename = "mapZoom")]
    map_zoom:      Option<serde_json::Value>,
    #[serde(rename = "showFavPins")]
    show_fav_pins: Option<bool>,
}

async fn put_preferences(
    _svc: ServiceToken,
    RequireRegistered(claims): RequireRegistered,
    State(state): State<AppState>,
    Json(body): Json<PreferencesBody>,
) -> impl IntoResponse {
    let oid = match safe_object_id(&claims.sub) {
        Some(id) => id,
        None     => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid user id." }))).into_response(),
    };

    let mut update = doc! {};

    if let Some(zoom_val) = body.map_zoom {
        let zoom: i32 = match &zoom_val {
            serde_json::Value::Number(n) => n.as_i64().unwrap_or(17) as i32,
            serde_json::Value::String(s) => s.parse().unwrap_or(17),
            _ => 17,
        };
        if zoom < 1 || zoom > 19 {
            return (StatusCode::BAD_REQUEST, Json(json!({ "error": "mapZoom must be 1–19." }))).into_response();
        }
        update.insert("preferences.mapZoom", zoom);
    }

    if let Some(show) = body.show_fav_pins {
        update.insert("preferences.showFavPins", show);
    }

    if update.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Nothing to update." }))).into_response();
    }

    match state.db.collection::<Document>("users")
        .update_one(doc! { "_id": oid }, doc! { "$set": update })
        .await
    {
        Ok(_)  => Json(json!({ "ok": true })).into_response(),
        Err(e) => { eprintln!("[users/me/preferences PUT] {e}"); (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response() }
    }
}

// ── GET /admin/users ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct AdminSearchQuery {
    q:            Option<String>,
    by:           Option<String>,
    #[serde(rename = "accountType")]
    account_type: Option<String>,
}

async fn admin_get_users(
    _svc: ServiceToken,
    AuthToken(claims): AuthToken,
    State(state): State<AppState>,
    Query(q): Query<AdminSearchQuery>,
) -> impl IntoResponse {
    if claims.role != "admin" {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "Admin access required.", "code": "ADMIN_REQUIRED" }))).into_response();
    }

    let mut filter = doc! {};
    if let Some(ref query_str) = q.q {
        let trimmed = query_str.trim();
        if !trimmed.is_empty() {
            match q.by.as_deref() {
                Some("id")    => {
                    match safe_object_id(trimmed) {
                        Some(oid) => { filter.insert("_id", oid); }
                        None      => return Json(json!({ "users": [] })).into_response(),
                    }
                }
                Some("role")  => { filter.insert("role", trimmed); }
                _ => {
                    let esc = regex_escape(trimmed);
                    filter.insert("nickname", doc! { "$regex": esc, "$options": "i" });
                }
            }
        }
    }

    if let Some(at) = &q.account_type {
        if matches!(at.as_str(), "user" | "venue") {
            filter.insert("accountType", at.as_str());
        }
    }

    let users: Vec<AdminUserDoc> = match state.db
        .collection::<AdminUserDoc>("users")
        .find(filter)
        .projection(doc! { "passwordHash": 0, "publicKey": 0, "encryptedPrivateKey": 0 })
        .limit(50)
        .await
    {
        Ok(c)  => c.try_collect().await.unwrap_or_default(),
        Err(e) => { eprintln!("[admin/users GET] {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };

    if users.is_empty() {
        return Json(json!({ "users": [] })).into_response();
    }

    let user_ids: Vec<String> = users.iter().map(|u| u.id.to_hex()).collect();
    let cutoff = BsonDateTime::from_millis(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64 - 10 * 60_000,
    );

    let online_docs: Vec<OnlineLocDoc> = match state.db
        .collection::<OnlineLocDoc>("locations")
        .find(doc! { "userId": { "$in": &user_ids }, "updatedAt": { "$gt": cutoff } })
        .projection(doc! { "userId": 1 })
        .await
    {
        Ok(c)  => c.try_collect().await.unwrap_or_default(),
        Err(_) => vec![],
    };

    let online_set: std::collections::HashSet<&str> = online_docs.iter()
        .map(|l| l.user_id.as_str())
        .collect();

    let result: Vec<_> = users.iter().map(|u| {
        let uid = u.id.to_hex();
        // Venues have a fixed location and are always reachable — never offline.
        let is_online = u.account_type == "venue"
            || online_set.contains(uid.as_str());
        json!({
            "userId":       uid,
            "nickname":     u.nickname.as_deref(),
            "age":          u.age,
            "sex":          u.sex.as_deref(),
            "tier":         u.tier.as_deref().unwrap_or("regular"),
            "role":         u.role.as_deref().unwrap_or("user"),
            "tokenVersion": u.token_version.unwrap_or(0),
            "accountType":  u.account_type,
            "managerId":    u.manager_id.as_deref(),
            "online":       is_online,
            "createdAt":    u.created_at.and_then(|d| d.try_to_rfc3339_string().ok()),
        })
    }).collect();

    Json(json!({ "users": result })).into_response()
}

// ── GET /admin/config ─────────────────────────────────────────────────────────

async fn admin_get_config(
    _svc: ServiceToken,
    AuthToken(claims): AuthToken,
) -> impl IntoResponse {
    if claims.role != "admin" {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "Admin access required.", "code": "ADMIN_REQUIRED" }))).into_response();
    }
    let guard_active = env::var("SELF_PROMOTION_GUARD").ok().as_deref() == Some("1");
    Json(json!({ "selfPromotionGuard": guard_active })).into_response()
}

// ── Admin settings (admin_settings collection) ────────────────────────────────

#[derive(Deserialize, Serialize)]
struct AdminSettingDoc {
    key:              String,
    value:            i64,
    section:          String,
    label:            String,
    description:      String,
    #[serde(rename = "restartRequired")]
    restart_required: bool,
}

/// Read one admin setting value from the collection (returns default on any error).
async fn read_setting(db: &Database, key: &str, default: i64) -> i64 {
    db.collection::<Document>("meta_settings")
        .find_one(doc! { "key": key })
        .await
        .ok()
        .flatten()
        .and_then(|d| d.get_i64("value").ok())
        .unwrap_or(default)
}

/// Read all admin settings and return them as a flat JSON object `{ key: value }`.
async fn load_all_settings_flat(db: &Database) -> serde_json::Value {
    let cursor = db.collection::<AdminSettingDoc>("meta_settings").find(doc! {}).await;
    let mut map = serde_json::Map::new();
    if let Ok(cursor) = cursor {
        if let Ok(docs) = cursor.try_collect::<Vec<_>>().await {
            for d in docs {
                map.insert(d.key, serde_json::Value::Number(serde_json::Number::from(d.value)));
            }
        }
    }
    serde_json::Value::Object(map)
}

/// GET /admin/settings — returns all admin settings (admin auth).
async fn admin_get_settings(
    _svc: ServiceToken,
    AuthToken(claims): AuthToken,
    State(state): State<AppState>,
) -> impl IntoResponse {
    if claims.role != "admin" {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "Admin access required.", "code": "ADMIN_REQUIRED" }))).into_response();
    }
    let cursor = state.db.collection::<AdminSettingDoc>("meta_settings")
        .find(doc! {})
        .await;
    match cursor {
        Ok(c) => match c.try_collect::<Vec<_>>().await {
            Ok(docs) => Json(json!({ "settings": docs })).into_response(),
            Err(e) => { eprintln!("[admin/settings GET] collect: {e}"); (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response() }
        },
        Err(e) => { eprintln!("[admin/settings GET] find: {e}"); (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response() }
    }
}

#[derive(Deserialize)]
struct SettingValueBody {
    value: i64,
}

/// PUT /admin/settings/:key — update one admin setting (admin auth).
async fn admin_put_setting(
    _svc: ServiceToken,
    AuthToken(claims): AuthToken,
    State(state): State<AppState>,
    Path(key): Path<String>,
    Json(body): Json<SettingValueBody>,
) -> impl IntoResponse {
    if claims.role != "admin" {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "Admin access required.", "code": "ADMIN_REQUIRED" }))).into_response();
    }
    if body.value < 0 {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "value must be non-negative." }))).into_response();
    }
    // Only allow updating keys that exist in the collection (reject unknown keys).
    let col = state.db.collection::<Document>("meta_settings");
    let exists = col.find_one(doc! { "key": &key }).await.ok().flatten().is_some();
    if !exists {
        return (StatusCode::NOT_FOUND, Json(json!({ "error": "Unknown setting key." }))).into_response();
    }
    match col.update_one(
        doc! { "key": &key },
        doc! { "$set": { "value": body.value } },
    ).await {
        Ok(_) => {
            // Refresh the in-process JWT TTL cache if the relevant key was changed.
            if key == "jwt_user_ttl_secs" {
                *state.user_jwt_ttl_secs.write().unwrap() = body.value as u64;
            }
            Json(json!({ "ok": true })).into_response()
        }
        Err(e) => { eprintln!("[admin/settings PUT] {e}"); (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response() }
    }
}

/// GET /internal/settings — returns all admin settings as flat JSON (service token auth).
async fn internal_get_settings(
    _svc: ServiceToken,
    State(state): State<AppState>,
) -> impl IntoResponse {
    Json(load_all_settings_flat(&state.db).await).into_response()
}

// ── PATCH /admin/users/:id/tier ───────────────────────────────────────────────

#[derive(Deserialize)]
struct TierBody {
    tier: Option<String>,
}

async fn admin_patch_tier(
    _svc: ServiceToken,
    AuthToken(claims): AuthToken,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<TierBody>,
) -> impl IntoResponse {
    if claims.role != "admin" {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "Admin access required.", "code": "ADMIN_REQUIRED" }))).into_response();
    }

    if env::var("SELF_PROMOTION_GUARD").ok().as_deref() == Some("1") && claims.sub == id {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "Cannot modify your own tier.", "code": "SELF_MODIFICATION_FORBIDDEN" }))).into_response();
    }

    let oid = match safe_object_id(&id) {
        Some(o) => o,
        None    => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid userId." }))).into_response(),
    };

    let tier = match body.tier {
        Some(t) if !t.is_empty() && t.len() <= 64 => t,
        _ => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Valid tier name required." }))).into_response(),
    };

    let result = match state.db.collection::<TvDoc>("users")
        .find_one_and_update(
            doc! { "_id": oid },
            doc! { "$set": { "tier": &tier }, "$inc": { "tokenVersion": 1 } },
        )
        .return_document(ReturnDocument::After)
        .projection(doc! { "tokenVersion": 1 })
        .await
    {
        Ok(Some(u)) => u,
        Ok(None)    => return (StatusCode::NOT_FOUND, Json(json!({ "error": "User not found." }))).into_response(),
        Err(e)      => { eprintln!("[admin/tier PATCH] {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };

    // Reset withinRange for all favourites involving this user so range-sync
    // recalculates with the new tier's radius on the next location push.
    let _ = state.db.collection::<Document>("favourites")
        .update_many(
            doc! { "$or": [{ "ownerUserId": &id }, { "favouriteUserId": &id }] },
            doc! { "$unset": { "withinRange": "" } },
        )
        .await;

    Json(json!({ "ok": true, "tokenVersion": result.token_version.unwrap_or(0) })).into_response()
}

// ── PATCH /admin/users/:id/role ───────────────────────────────────────────────

#[derive(Deserialize)]
struct RoleBody {
    role: Option<String>,
}

async fn admin_patch_role(
    _svc: ServiceToken,
    AuthToken(claims): AuthToken,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<RoleBody>,
) -> impl IntoResponse {
    if claims.role != "admin" {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "Admin access required.", "code": "ADMIN_REQUIRED" }))).into_response();
    }

    if env::var("SELF_PROMOTION_GUARD").ok().as_deref() == Some("1") && claims.sub == id {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "Cannot modify your own role.", "code": "SELF_MODIFICATION_FORBIDDEN" }))).into_response();
    }

    let oid = match safe_object_id(&id) {
        Some(o) => o,
        None    => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid userId." }))).into_response(),
    };

    let role = match body.role.as_deref() {
        Some("user") | Some("admin") | Some("venue_manager") => body.role.unwrap(),
        _ => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "role must be 'user', 'admin', or 'venue_manager'." }))).into_response(),
    };

    let result = match state.db.collection::<TvDoc>("users")
        .find_one_and_update(
            doc! { "_id": oid },
            doc! { "$set": { "role": &role }, "$inc": { "tokenVersion": 1 } },
        )
        .return_document(ReturnDocument::After)
        .projection(doc! { "tokenVersion": 1 })
        .await
    {
        Ok(Some(u)) => u,
        Ok(None)    => return (StatusCode::NOT_FOUND, Json(json!({ "error": "User not found." }))).into_response(),
        Err(e)      => { eprintln!("[admin/role PATCH] {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };

    Json(json!({ "ok": true, "tokenVersion": result.token_version.unwrap_or(0) })).into_response()
}

// ── PATCH /admin/users/:id ────────────────────────────────────────────────────
// Atomically update tier and/or role in one request. When an admin patches their
// own account a fresh JWT is returned so their session stays valid.

#[derive(Deserialize)]
struct AdminPatchBody {
    tier: Option<String>,
    role: Option<String>,
}

async fn admin_patch_user(
    _svc: ServiceToken,
    AuthToken(claims): AuthToken,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<AdminPatchBody>,
) -> impl IntoResponse {
    if claims.role != "admin" {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "Admin access required.", "code": "ADMIN_REQUIRED" }))).into_response();
    }
    if env::var("SELF_PROMOTION_GUARD").ok().as_deref() == Some("1") && claims.sub == id {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "Cannot modify your own tier or role.", "code": "SELF_MODIFICATION_FORBIDDEN" }))).into_response();
    }

    let oid = match safe_object_id(&id) {
        Some(o) => o,
        None    => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid userId." }))).into_response(),
    };

    let mut set_doc = Document::new();
    if let Some(ref tier) = body.tier {
        if tier.is_empty() || tier.len() > 64 {
            return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Valid tier name required." }))).into_response();
        }
        set_doc.insert("tier", tier.as_str());
    }
    if let Some(ref role) = body.role {
        match role.as_str() {
            "user" | "admin" | "venue_manager" => { set_doc.insert("role", role.as_str()); }
            _ => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "role must be 'user', 'admin', or 'venue_manager'." }))).into_response(),
        }
    }
    if set_doc.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "No changes provided." }))).into_response();
    }

    let result = match state.db.collection::<UserForToken>("users")
        .find_one_and_update(
            doc! { "_id": oid },
            doc! { "$set": set_doc, "$inc": { "tokenVersion": 1 } },
        )
        .return_document(ReturnDocument::After)
        .projection(doc! { "nickname": 1, "sex": 1, "age": 1, "role": 1, "tier": 1, "accountType": 1, "tokenVersion": 1 })
        .await
    {
        Ok(Some(u)) => u,
        Ok(None)    => return (StatusCode::NOT_FOUND, Json(json!({ "error": "User not found." }))).into_response(),
        Err(e)      => { eprintln!("[admin/users PATCH] {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };

    let tv = result.token_version.unwrap_or(0).max(0) as u32;

    // Reset withinRange for all favourites so range-sync recalculates with the new tier.
    if body.tier.is_some() {
        let _ = state.db.collection::<Document>("favourites")
            .update_many(
                doc! { "$or": [{ "ownerUserId": &id }, { "favouriteUserId": &id }] },
                doc! { "$unset": { "withinRange": "" } },
            )
            .await;
    }

    // When admin patches their own account issue a fresh JWT so their session isn't immediately invalidated.
    if claims.sub == id {
        let ttl = *state.user_jwt_ttl_secs.read().unwrap();
        if let Ok(token) = make_token(&result, &state.jwt_secret, ttl) {
            return Json(json!({ "ok": true, "tokenVersion": tv, "token": token })).into_response();
        }
    }

    Json(json!({ "ok": true, "tokenVersion": tv })).into_response()
}

// ── PATCH /admin/venues/:id/manager ──────────────────────────────────────────

#[derive(Deserialize)]
struct ReassignManagerBody {
    #[serde(rename = "newManagerId")]
    new_manager_id: Option<String>,
}

#[derive(Deserialize)]
struct RoleOnlyDoc {
    role: Option<String>,
}

async fn admin_patch_venue_manager(
    _svc: ServiceToken,
    AuthToken(claims): AuthToken,
    State(state): State<AppState>,
    Path(venue_id): Path<String>,
    Json(body): Json<ReassignManagerBody>,
) -> impl IntoResponse {
    if claims.role != "admin" {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "Admin access required.", "code": "ADMIN_REQUIRED" }))).into_response();
    }

    let venue_oid = match safe_object_id(&venue_id) {
        Some(o) => o,
        None    => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid venue id." }))).into_response(),
    };

    let new_manager_id = match body.new_manager_id.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        Some(id) => id.to_string(),
        None     => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "newManagerId is required." }))).into_response(),
    };

    let manager_oid = match safe_object_id(&new_manager_id) {
        Some(o) => o,
        None    => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid newManagerId." }))).into_response(),
    };

    // Verify new manager exists and has the venue_manager role.
    let manager_doc = match state.db.collection::<RoleOnlyDoc>("users")
        .find_one(doc! { "_id": manager_oid })
        .projection(doc! { "role": 1 })
        .await
    {
        Ok(Some(u)) => u,
        Ok(None)    => return (StatusCode::NOT_FOUND, Json(json!({ "error": "New manager account not found." }))).into_response(),
        Err(e)      => { eprintln!("[admin/venues PATCH manager] manager lookup: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };
    if manager_doc.role.as_deref() != Some("venue_manager") {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Target account does not have the venue_manager role." }))).into_response();
    }

    // Verify venue exists.
    match state.db.collection::<Document>("users")
        .update_one(
            doc! { "_id": venue_oid, "accountType": "venue" },
            doc! { "$set": { "managerId": &new_manager_id } },
        )
        .await
    {
        Ok(r) if r.matched_count == 0 => return (StatusCode::NOT_FOUND, Json(json!({ "error": "Venue not found." }))).into_response(),
        Ok(_)  => {},
        Err(e) => { eprintln!("[admin/venues PATCH manager] update: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    }

    Json(json!({ "ok": true })).into_response()
}

// ── Manager venue endpoints ───────────────────────────────────────────────────

#[derive(Deserialize)]
struct VenueCreateBody {
    #[serde(rename = "venueName")]
    venue_name: Option<String>,
    address:    Option<String>,
    #[serde(rename = "fixedLat")]
    fixed_lat:  Option<f64>,
    #[serde(rename = "fixedLon")]
    fixed_lon:  Option<f64>,
}

#[derive(Deserialize)]
struct VenueUpdateBody {
    description:   Option<String>,
    #[serde(rename = "openingHours")]
    opening_hours: Option<String>,
    #[serde(rename = "locationType")]
    location_type: Option<String>,
    #[serde(rename = "canReceiveMessages")]
    can_receive_messages: Option<bool>,
}

#[derive(Deserialize)]
struct VenueDoc2 {
    #[serde(rename = "_id")]
    id:            mongodb::bson::oid::ObjectId,
    #[serde(rename = "venueName")]
    venue_name:    Option<String>,
    address:       Option<String>,
    #[serde(rename = "fixedLat")]
    fixed_lat:     f64,
    #[serde(rename = "fixedLon")]
    fixed_lon:     f64,
    tier:          Option<String>,
    description:   Option<String>,
    #[serde(rename = "openingHours")]
    opening_hours: Option<String>,
    #[serde(rename = "locationType")]
    location_type: Option<String>,
    #[serde(rename = "managerId")]
    manager_id:          Option<String>,
    #[serde(rename = "canReceiveMessages")]
    can_receive_messages: Option<bool>,
}

// ── GET /manager/venues ───────────────────────────────────────────────────────

async fn get_manager_venues(
    _svc: ServiceToken,
    RequireRegistered(claims): RequireRegistered,
    State(state): State<AppState>,
) -> impl IntoResponse {
    if claims.role != "venue_manager" {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "Venue manager role required." }))).into_response();
    }

    let venues: Vec<VenueDoc2> = match state.db
        .collection::<VenueDoc2>("users")
        .find(doc! { "accountType": "venue", "managerId": &claims.sub })
        .await
    {
        Ok(c)  => c.try_collect().await.unwrap_or_default(),
        Err(e) => { eprintln!("[manager/venues GET] {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };

    let list: Vec<_> = venues.iter().map(|v| json!({
        "id":                 v.id.to_hex(),
        "venueName":          v.venue_name.as_deref(),
        "address":            v.address.as_deref(),
        "fixedLat":           v.fixed_lat,
        "fixedLon":           v.fixed_lon,
        "tier":               v.tier.as_deref().unwrap_or("regular"),
        "description":        v.description.as_deref(),
        "openingHours":       v.opening_hours.as_deref(),
        "locationType":       v.location_type.as_deref(),
        "canReceiveMessages": v.can_receive_messages.unwrap_or(true),
    })).collect();

    Json(json!({ "venues": list })).into_response()
}

// ── POST /manager/venues ──────────────────────────────────────────────────────

async fn post_manager_venues(
    _svc: ServiceToken,
    RequireRegistered(claims): RequireRegistered,
    State(state): State<AppState>,
    Json(body): Json<VenueCreateBody>,
) -> impl IntoResponse {
    if claims.role != "venue_manager" {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "Venue manager role required." }))).into_response();
    }

    let venue_name = match body.venue_name.as_ref().map(|s| s.trim().to_string()) {
        Some(s) if s.len() >= 2 && s.len() <= 64 => s,
        _ => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "venueName must be 2–64 characters." }))).into_response(),
    };
    let fixed_lat = match body.fixed_lat {
        Some(v) if (-90.0..=90.0).contains(&v) => v,
        _ => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Valid fixedLat required." }))).into_response(),
    };
    let fixed_lon = match body.fixed_lon {
        Some(v) if (-180.0..=180.0).contains(&v) => v,
        _ => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Valid fixedLon required." }))).into_response(),
    };
    let address = body.address.unwrap_or_default().trim().to_string();

    // Venue limit per manager (9999 = effectively unlimited; see T-14 for tiered quotas)
    let existing_count = match state.db
        .collection::<Document>("users")
        .count_documents(doc! { "accountType": "venue", "managerId": &claims.sub })
        .await
    {
        Ok(n)  => n,
        Err(e) => { eprintln!("[manager/venues POST] count: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };
    if existing_count >= 9999 {
        return (StatusCode::CONFLICT, Json(json!({ "error": "Venue limit reached." }))).into_response();
    }

    let result = match state.db
        .collection::<Document>("users")
        .insert_one(doc! {
            "accountType":        "venue",
            "venueName":          &venue_name,
            "nickname":           &venue_name,
            "address":            &address,
            "fixedLat":           fixed_lat,
            "fixedLon":           fixed_lon,
            "managerId":          &claims.sub,
            "tier":               "regular",
            "canReceiveMessages": true,
        })
        .await
    {
        Ok(r)  => r,
        Err(e) => { eprintln!("[manager/venues POST] insert: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };

    let id = result.inserted_id.as_object_id().map(|o| o.to_hex()).unwrap_or_default();
    (StatusCode::CREATED, Json(json!({ "ok": true, "id": id }))).into_response()
}

// ── PUT /manager/venues/:id ───────────────────────────────────────────────────

async fn put_manager_venue(
    _svc: ServiceToken,
    RequireRegistered(claims): RequireRegistered,
    State(state): State<AppState>,
    Path(venue_id): Path<String>,
    Json(body): Json<VenueUpdateBody>,
) -> impl IntoResponse {
    if claims.role != "venue_manager" {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "Venue manager role required." }))).into_response();
    }

    let oid = match safe_object_id(&venue_id) {
        Some(id) => id,
        None     => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid venue id." }))).into_response(),
    };

    // Ownership check
    let existing = match state.db
        .collection::<VenueDoc2>("users")
        .find_one(doc! { "_id": oid, "accountType": "venue" })
        .await
    {
        Ok(Some(v)) => v,
        Ok(None)    => return (StatusCode::NOT_FOUND, Json(json!({ "error": "Venue not found." }))).into_response(),
        Err(e)      => { eprintln!("[manager/venues PUT] find: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };
    if existing.manager_id.as_deref() != Some(&claims.sub) {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "Not your venue." }))).into_response();
    }

    let mut update = doc! {};
    if let Some(d) = body.description          { update.insert("description",        d.trim().to_string()); }
    if let Some(o) = body.opening_hours        { update.insert("openingHours",       o.trim().to_string()); }
    if let Some(t) = body.location_type        { update.insert("locationType",       t.trim().to_string()); }
    if let Some(m) = body.can_receive_messages { update.insert("canReceiveMessages", m); }

    if update.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Nothing to update." }))).into_response();
    }

    match state.db.collection::<Document>("users")
        .update_one(doc! { "_id": oid }, doc! { "$set": update })
        .await
    {
        Ok(_)  => Json(json!({ "ok": true })).into_response(),
        Err(e) => { eprintln!("[manager/venues PUT] update: {e}"); (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response() }
    }
}

// ── DELETE /manager/venues/:id ────────────────────────────────────────────────

async fn delete_manager_venue(
    _svc: ServiceToken,
    RequireRegistered(claims): RequireRegistered,
    State(state): State<AppState>,
    Path(venue_id): Path<String>,
) -> impl IntoResponse {
    if claims.role != "venue_manager" {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "Venue manager role required." }))).into_response();
    }

    let oid = match safe_object_id(&venue_id) {
        Some(id) => id,
        None     => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid venue id." }))).into_response(),
    };

    // Ownership check
    let existing = match state.db
        .collection::<VenueDoc2>("users")
        .find_one(doc! { "_id": oid, "accountType": "venue" })
        .await
    {
        Ok(Some(v)) => v,
        Ok(None)    => return (StatusCode::NOT_FOUND, Json(json!({ "error": "Venue not found." }))).into_response(),
        Err(e)      => { eprintln!("[manager/venues DELETE] find: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };
    if existing.manager_id.as_deref() != Some(&claims.sub) {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "Not your venue." }))).into_response();
    }

    cascade_delete_venue(&state.db, &venue_id).await;
    Json(json!({ "ok": true })).into_response()
}

// ── POST /users/me/password/start ─────────────────────────────────────────────
//
// Server-side OPAQUE registration is stateless — the OPRF mediator only needs
// the ServerSetup and the credential identifier (userId from JWT).  No in-memory
// session is required between start and finish.

#[derive(Deserialize)]
struct PwChangeStartBody {
    #[serde(rename = "registrationRequest")]
    registration_request: String, // base64-encoded RegistrationRequest
}

async fn users_me_password_start(
    _svc: ServiceToken,
    RequireRegistered(claims): RequireRegistered,
    State(state): State<AppState>,
    Json(body): Json<PwChangeStartBody>,
) -> impl IntoResponse {
    let req_bytes = match B64.decode(&body.registration_request) {
        Ok(b)  => b,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid registrationRequest encoding." }))).into_response(),
    };

    let reg_request = match opaque_ke::RegistrationRequest::<DefaultCs>::deserialize(&req_bytes) {
        Ok(r)  => r,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid registrationRequest." }))).into_response(),
    };

    let server_reg_start = match ServerRegistration::<DefaultCs>::start(
        &state.opaque_setup,
        reg_request,
        claims.sub.as_bytes(),
    ) {
        Ok(r)  => r,
        Err(e) => { eprintln!("[users/me/password/start] OPAQUE start: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };

    let response_b64 = B64.encode(server_reg_start.message.serialize());
    Json(json!({ "registrationResponse": response_b64 })).into_response()
}

// ── POST /users/me/password/finish ────────────────────────────────────────────

#[derive(Deserialize)]
struct PwChangeFinishBody {
    #[serde(rename = "registrationUpload")]
    registration_upload: String, // base64-encoded RegistrationUpload
    #[serde(rename = "emailHash")]
    email_hash:         Option<String>, // optional: update emailHash alongside password
}

async fn users_me_password_finish(
    _svc: ServiceToken,
    RequireRegistered(claims): RequireRegistered,
    State(state): State<AppState>,
    Json(body): Json<PwChangeFinishBody>,
) -> impl IntoResponse {
    let upload_bytes = match B64.decode(&body.registration_upload) {
        Ok(b)  => b,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid registrationUpload encoding." }))).into_response(),
    };

    let upload = match opaque_ke::RegistrationUpload::<DefaultCs>::deserialize(&upload_bytes) {
        Ok(u)  => u,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid registrationUpload." }))).into_response(),
    };

    let password_file = ServerRegistration::<DefaultCs>::finish(upload);

    let record_bytes = password_file.serialize().to_vec();
    let opaque_record = Binary { subtype: BinarySubtype::Generic, bytes: record_bytes };

    let oid = match safe_object_id(&claims.sub) {
        Some(id) => id,
        None     => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(),
    };

    // Build update — always update opaqueRecord + bump tokenVersion
    let mut set_doc = doc! { "opaqueRecord": opaque_record };

    // Optional email hash update (must be valid 64-char hex)
    if let Some(ref eh) = body.email_hash {
        if !is_valid_email_hash(eh) {
            return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid emailHash." }))).into_response();
        }
        set_doc.insert("emailHash", eh.as_str());
    }

    if let Err(e) = state.db.collection::<Document>("users")
        .update_one(
            doc! { "_id": oid },
            doc! { "$set": set_doc, "$inc": { "tokenVersion": 1 } },
        )
        .await
    {
        eprintln!("[users/me/password/finish] DB update: {e}");
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response();
    }

    // Return a fresh JWT with the new tokenVersion
    let updated = match state.db.collection::<UserForToken>("users")
        .find_one(doc! { "_id": oid })
        .projection(doc! { "opaqueRecord": 0 })
        .await
    {
        Ok(Some(u)) => u,
        Ok(None)    => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(),
        Err(e)      => { eprintln!("[users/me/password/finish] re-fetch: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };

    let ttl = *state.user_jwt_ttl_secs.read().unwrap();
    match make_token(&updated, &state.jwt_secret, ttl) {
        Ok(token) => Json(json!({ "ok": true, "token": token })).into_response(),
        Err(e)    => { eprintln!("[users/me/password/finish] token: {e}"); (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response() }
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
    println!("[users] DB connected.");

    let setup_bytes = B64.decode(&cfg.opaque_server_setup_b64)
        .expect("OPAQUE_SERVER_SETUP: invalid base64");
    let opaque_setup = Arc::new(
        ServerSetup::<DefaultCs>::deserialize(&setup_bytes)
            .expect("OPAQUE_SERVER_SETUP: invalid ServerSetup bytes"),
    );

    // Load initial JWT TTL from admin_settings (falls back to 86400 if not yet seeded).
    let initial_ttl = read_setting(&db, "jwt_user_ttl_secs", 86_400).await as u64;
    let user_jwt_ttl_secs = Arc::new(RwLock::new(initial_ttl));

    let state = AppState {
        db,
        jwt_secret:         cfg.jwt_secret,
        service_secret:     cfg.service_secret,
        opaque_setup,
        user_jwt_ttl_secs,
    };

    // Background task: refresh JWT TTL from admin_settings every 60 s.
    {
        let state2 = state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
            interval.tick().await; // skip first tick (already loaded)
            loop {
                interval.tick().await;
                let v = read_setting(&state2.db, "jwt_user_ttl_secs", 86_400).await as u64;
                *state2.user_jwt_ttl_secs.write().unwrap() = v;
            }
        });
    }

    let app = Router::new()
        .route("/health",                    get(health))
        .route("/users/me",                  get(get_me))
        .route("/users/me",                  put(put_me))
        .route("/users/me",                  delete(delete_me))
        .route("/users/search",              get(search_users))
        .route("/users/{user_id}/profile",   get(get_profile))
        .route("/users/me/keys",             put(put_keys))
        .route("/users/me/keys",             get(get_keys))
        .route("/users/me/preferences",      get(get_preferences).put(put_preferences))
        .route("/users/me/password/start",   post(users_me_password_start))
        .route("/users/me/password/finish",  post(users_me_password_finish))
        .route("/admin/config",              get(admin_get_config))
        .route("/admin/settings",            get(admin_get_settings))
        .route("/admin/settings/{key}",      put(admin_put_setting))
        .route("/admin/users",               get(admin_get_users))
        .route("/admin/users/{id}",              patch(admin_patch_user))
        .route("/admin/users/{id}/tier",         patch(admin_patch_tier))
        .route("/admin/users/{id}/role",         patch(admin_patch_role))
        .route("/admin/venues/{id}/manager",     patch(admin_patch_venue_manager))
        .route("/manager/venues",            get(get_manager_venues).post(post_manager_venues))
        .route("/manager/venues/{id}",       put(put_manager_venue).delete(delete_manager_venue))
        .route("/internal/settings",         get(internal_get_settings))
        .fallback(|| async { (StatusCode::NOT_FOUND, Json(json!({ "error": "Not found." }))) })
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", cfg.port))
        .await
        .unwrap();
    println!("[users] Running on :{}", cfg.port);
    axum::serve(listener, app).await.unwrap();
}
