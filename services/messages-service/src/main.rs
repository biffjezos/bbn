// ============================================================
// bOOmbOOm.NOW! — messages-service (Rust)
// Replaces services/messages-service.js.
// Identical HTTP contract — gateway needs no changes.
// Rebuild: venue_manager accepted by RequireRegistered (common).
// ============================================================

use std::{env, sync::Arc, time::Duration};

use axum::{
    extract::{FromRef, Path, State},
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::get,
    Router,
};
use common::{
    auth::{JwtSecret, ServiceSecret, RequireRegistered, ServiceToken},
    geo::haversine_distance,
    mongo::safe_object_id,
    service_token::ServiceTokenCache,
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
    port:              u16,
    mongo_uri:         String,
    db_name:           String,
    jwt_secret:        String,
    service_secret:    String,
    loc_service_url:   String,
    tiers_service_url: String,
    fav_service_url:   String,
}

impl Config {
    fn from_env() -> Result<Self, String> {
        let required = ["JWT_SECRET", "SERVICE_SECRET", "MONGO_URI", "LOC_SERVICE_URL", "TIERS_SERVICE_URL", "FAV_SERVICE_URL"];
        let missing: Vec<_> = required.iter().filter(|k| env::var(k).is_err()).collect();
        if !missing.is_empty() {
            return Err(format!(
                "FATAL: missing env vars: {}",
                missing.iter().map(|k| **k).collect::<Vec<_>>().join(", ")
            ));
        }
        Ok(Self {
            port:              env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8080),
            mongo_uri:         env::var("MONGO_URI").unwrap(),
            db_name:           env::var("DB_NAME").unwrap_or_else(|_| "boomboom".to_string()),
            jwt_secret:        env::var("JWT_SECRET").unwrap(),
            service_secret:    env::var("SERVICE_SECRET").unwrap(),
            loc_service_url:   env::var("LOC_SERVICE_URL").unwrap(),
            tiers_service_url: env::var("TIERS_SERVICE_URL").unwrap(),
            fav_service_url:   env::var("FAV_SERVICE_URL").unwrap(),
        })
    }
}

// ── App state ─────────────────────────────────────────────────────────────────

#[derive(Clone)]
struct AppState {
    db:                Database,
    jwt_secret:        String,
    service_secret:    String,
    loc_service_url:   String,
    tiers_service_url: String,
    fav_service_url:   String,
    http:              reqwest::Client,
    svc_token_cache:   Arc<ServiceTokenCache>,
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
struct MessageDoc {
    #[serde(rename = "_id")]
    id:          mongodb::bson::oid::ObjectId,
    #[serde(rename = "fromUserId")]
    from_user_id: String,
    #[serde(rename = "toUserId")]
    to_user_id:  String,
    text:        String,
    #[serde(rename = "sentAt")]
    sent_at:     Option<BsonDateTime>,
    #[serde(rename = "expiresAt")]
    expires_at:  Option<BsonDateTime>,
}

// ── Inter-service response types ──────────────────────────────────────────────

#[derive(Deserialize)]
struct PairStatusResp {
    mutual:       bool,
    #[serde(rename = "withinRange")]
    within_range: Option<bool>,
}

#[derive(Deserialize)]
struct LocationCoords {
    lat: f64,
    lon: f64,
}

#[derive(Deserialize)]
struct TierRadiusResp {
    #[serde(rename = "radiusM")]
    radius_m: f64,
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MESSAGE_MAX_CHARS: usize = 4096;
const MESSAGE_TTL_MS:    i64   = 4 * 60 * 60 * 1000;

// ── E2EE validation ───────────────────────────────────────────────────────────

fn is_base64(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| {
        c.is_ascii_alphanumeric() || c == '+' || c == '/' || c == '='
    })
}

fn is_valid_ciphertext(text: &str) -> bool {
    let Ok(p) = serde_json::from_str::<serde_json::Value>(text) else { return false; };
    let cipher    = &p["cipher"];
    let iv_b64    = cipher["ivB64"].as_str().unwrap_or("");
    let cipher_b64 = cipher["cipherB64"].as_str().unwrap_or("");
    is_base64(iv_b64) && is_base64(cipher_b64)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn msg_to_json(m: &MessageDoc) -> serde_json::Value {
    json!({
        "_id":        m.id.to_hex(),
        "fromUserId": m.from_user_id,
        "toUserId":   m.to_user_id,
        "text":       m.text,
        "sentAt":     m.sent_at.and_then(|d| d.try_to_rfc3339_string().ok()),
        "expiresAt":  m.expires_at.and_then(|d| d.try_to_rfc3339_string().ok()),
    })
}

fn now_bson() -> BsonDateTime { BsonDateTime::now() }

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async fn health(State(state): State<AppState>) -> impl IntoResponse {
    match state.db.run_command(doc! { "ping": 1 }).await {
        Ok(_)  => Json(json!({ "ok": true })).into_response(),
        Err(_) => (StatusCode::SERVICE_UNAVAILABLE, Json(json!({ "ok": false, "error": "DB unreachable" }))).into_response(),
    }
}

// ── GET /messages ─────────────────────────────────────────────────────────────

async fn get_messages(
    _svc: ServiceToken,
    RequireRegistered(claims): RequireRegistered,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let now = now_bson();
    let docs: Vec<MessageDoc> = match state.db
        .collection::<MessageDoc>("messages")
        .find(doc! {
            "$or": [{ "fromUserId": &claims.sub }, { "toUserId": &claims.sub }],
            "expiresAt": { "$gt": now },
        })
        .sort(doc! { "sentAt": -1 })
        .await
    {
        Ok(c)  => c.try_collect().await.unwrap_or_default(),
        Err(e) => { eprintln!("[messages GET] {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };

    let messages: Vec<_> = docs.iter().map(msg_to_json).collect();
    Json(json!({ "messages": messages })).into_response()
}

// ── GET /messages/:userId ─────────────────────────────────────────────────────

async fn get_thread(
    _svc: ServiceToken,
    RequireRegistered(claims): RequireRegistered,
    State(state): State<AppState>,
    Path(other_id): Path<String>,
) -> impl IntoResponse {
    let other_oid = match safe_object_id(&other_id) {
        Some(id) => id,
        None     => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid userId." }))).into_response(),
    };

    match state.db.collection::<Document>("users")
        .find_one(doc! { "_id": other_oid })
        .projection(doc! { "_id": 1 })
        .await
    {
        Ok(Some(_)) => {}
        Ok(None)    => return (StatusCode::NOT_FOUND, Json(json!({ "error": "User not found." }))).into_response(),
        Err(e)      => { eprintln!("[messages/thread GET] user lookup: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    }

    let me = &claims.sub;
    let now = now_bson();
    let docs: Vec<MessageDoc> = match state.db
        .collection::<MessageDoc>("messages")
        .find(doc! {
            "$or": [
                { "fromUserId": me,       "toUserId": &other_id },
                { "fromUserId": &other_id, "toUserId": me },
            ],
            "expiresAt": { "$gt": now },
        })
        .sort(doc! { "sentAt": 1 })
        .await
    {
        Ok(c)  => c.try_collect().await.unwrap_or_default(),
        Err(e) => { eprintln!("[messages/thread GET] {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };

    let messages: Vec<_> = docs.iter().map(msg_to_json).collect();
    Json(json!({ "messages": messages })).into_response()
}

// ── POST /messages/:userId ────────────────────────────────────────────────────

#[derive(Deserialize)]
struct SendBody {
    text: Option<String>,
}

async fn send_message(
    _svc: ServiceToken,
    RequireRegistered(claims): RequireRegistered,
    State(state): State<AppState>,
    Path(to_id): Path<String>,
    Json(body): Json<SendBody>,
) -> impl IntoResponse {
    // ── Validate text ──
    let text = match body.text {
        Some(ref t) if !t.trim().is_empty() => t.trim().to_string(),
        _ => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "text required." }))).into_response(),
    };
    if text.len() > MESSAGE_MAX_CHARS {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": format!("Message exceeds {} characters.", MESSAGE_MAX_CHARS) }))).into_response();
    }
    if !is_valid_ciphertext(&text) {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Message must be a valid E2EE ciphertext envelope." }))).into_response();
    }

    let from_id = &claims.sub;

    let to_oid = match safe_object_id(&to_id) {
        Some(id) => id,
        None     => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid userId." }))).into_response(),
    };

    // ── Recipient must exist ──
    let to_user = match state.db.collection::<Document>("users")
        .find_one(doc! { "_id": to_oid })
        .projection(doc! { "_id": 1, "tier": 1 })
        .await
    {
        Ok(Some(u)) => u,
        Ok(None)    => return (StatusCode::NOT_FOUND, Json(json!({ "error": "Recipient not found." }))).into_response(),
        Err(e)      => { eprintln!("[messages POST] user lookup: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };

    // ── Self-message shortcut (Reminder to Yourself) ──
    if from_id == &to_id {
        let now_dt  = now_bson();
        let expires = BsonDateTime::from_millis(now_ms() + MESSAGE_TTL_MS);
        return match state.db.collection::<Document>("messages")
            .insert_one(doc! {
                "fromUserId": from_id,
                "toUserId":   &to_id,
                "text":       &text,
                "sentAt":     now_dt,
                "expiresAt":  expires,
            })
            .await
        {
            Ok(r)  => (StatusCode::CREATED, Json(json!({
                "_id":       r.inserted_id.as_object_id().map(|o| o.to_hex()),
                "expiresAt": expires.try_to_rfc3339_string().ok(),
            }))).into_response(),
            Err(e) => { eprintln!("[messages POST] self-insert: {e}"); (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response() }
        };
    }

    // ── Block check (either direction) ──
    let block_coll = state.db.collection::<Document>("blocks");
    match block_coll.find_one(doc! {
        "$or": [
            { "blockerUserId": from_id, "blockedUserId": &to_id },
            { "blockerUserId": &to_id,  "blockedUserId": from_id },
        ],
    }).await {
        Ok(Some(_)) => return (StatusCode::FORBIDDEN, Json(json!({ "error": "You cannot message this user." }))).into_response(),
        Ok(None)    => {}
        Err(e)      => { eprintln!("[messages POST] block check: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    }

    // ── Pair-status (fail closed) ──
    let svc_token = match state.svc_token_cache.get("messages", &state.service_secret).await {
        Ok(t)  => t,
        Err(e) => { eprintln!("[messages POST] svc token: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };

    let pair_status: PairStatusResp = match state.http
        .get(format!(
            "{}/favourites/pair-status?sender={}&recipient={}",
            state.fav_service_url,
            from_id,
            &to_id,
        ))
        .header("X-Service-Token", &svc_token)
        .timeout(Duration::from_secs(5))
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => match r.json().await {
            Ok(p)  => p,
            Err(e) => { eprintln!("[messages POST] pair-status parse: {e}"); return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({ "error": "Service unavailable. Try again shortly." }))).into_response(); }
        },
        Ok(r) => {
            eprintln!("[messages POST] favourites-service responded {}", r.status());
            return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({ "error": "Service unavailable. Try again shortly." }))).into_response();
        }
        Err(e) => {
            eprintln!("[messages POST] favourites-service unreachable: {e}");
            return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({ "error": "Service unavailable. Try again shortly." }))).into_response();
        }
    };

    if !pair_status.mutual {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "Both users must have each other as favourites to message." }))).into_response();
    }

    // ── Sender must be sharing location ──
    let from_resp = match state.http
        .get(format!("{}/location/user/{}", state.loc_service_url, from_id))
        .header("X-Service-Token", &svc_token)
        .timeout(Duration::from_secs(5))
        .send()
        .await
    {
        Ok(r)  => r,
        Err(e) => { eprintln!("[messages POST] location (sender): {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };

    if from_resp.status() != 200 {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "You must be sharing your location to send messages." }))).into_response();
    }

    let from_loc: LocationCoords = match from_resp.json().await {
        Ok(l)  => l,
        Err(e) => { eprintln!("[messages POST] location (sender) parse: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };

    // ── Recipient location + proximity ──
    let to_resp = match state.http
        .get(format!("{}/location/user/{}", state.loc_service_url, &to_id))
        .header("X-Service-Token", &svc_token)
        .timeout(Duration::from_secs(5))
        .send()
        .await
    {
        Ok(r)  => r,
        Err(e) => { eprintln!("[messages POST] location (recipient): {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };

    if to_resp.status() == 200 {
        // Recipient online — bidirectional proximity check
        let to_loc: LocationCoords = match to_resp.json().await {
            Ok(l)  => l,
            Err(e) => { eprintln!("[messages POST] location (recipient) parse: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
        };

        let sender_tier    = claims.tier.as_deref().unwrap_or("regular");
        let recipient_tier = to_user.get_str("tier").unwrap_or("regular");

        let (s_res, r_res) = tokio::join!(
            state.http
                .get(format!("{}/tiers/radius/message/{}", state.tiers_service_url, sender_tier))
                .header("X-Service-Token", &svc_token)
                .timeout(Duration::from_secs(5))
                .send(),
            state.http
                .get(format!("{}/tiers/radius/message/{}", state.tiers_service_url, recipient_tier))
                .header("X-Service-Token", &svc_token)
                .timeout(Duration::from_secs(5))
                .send(),
        );

        let (s_resp, r_resp) = match (s_res, r_res) {
            (Ok(s), Ok(r)) if s.status().is_success() && r.status().is_success() => (s, r),
            _ => return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({ "error": "Tier service unavailable. Try again shortly." }))).into_response(),
        };

        let (s_tier, r_tier) = match tokio::join!(
            s_resp.json::<TierRadiusResp>(),
            r_resp.json::<TierRadiusResp>(),
        ) {
            (Ok(s), Ok(r)) => (s, r),
            _ => return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({ "error": "Tier service unavailable. Try again shortly." }))).into_response(),
        };

        let dist         = haversine_distance(from_loc.lat, from_loc.lon, to_loc.lat, to_loc.lon);
        let sender_ok    = s_tier.radius_m == -1.0 || dist <= s_tier.radius_m;
        let recipient_ok = r_tier.radius_m == -1.0 || dist <= r_tier.radius_m;

        if !sender_ok || !recipient_ok {
            return (StatusCode::FORBIDDEN, Json(json!({ "error": "You are too far away to message this user." }))).into_response();
        }
    } else {
        // Recipient offline — fall back to stored withinRange flag
        if pair_status.within_range != Some(true) {
            return (StatusCode::FORBIDDEN, Json(json!({ "error": "Recipient is out of range." }))).into_response();
        }
    }

    // ── Insert message ──
    let now_dt   = now_bson();
    let expires  = BsonDateTime::from_millis(now_ms() + MESSAGE_TTL_MS);

    let result = match state.db.collection::<Document>("messages")
        .insert_one(doc! {
            "fromUserId": from_id,
            "toUserId":   &to_id,
            "text":       &text,
            "sentAt":     now_dt,
            "expiresAt":  expires,
        })
        .await
    {
        Ok(r)  => r,
        Err(e) => { eprintln!("[messages POST] insert: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };

    (StatusCode::CREATED, Json(json!({
        "_id":       result.inserted_id.as_object_id().map(|o| o.to_hex()),
        "expiresAt": expires.try_to_rfc3339_string().ok(),
    }))).into_response()
}

// ── DELETE /messages/:id ──────────────────────────────────────────────────────

async fn delete_message(
    _svc: ServiceToken,
    RequireRegistered(claims): RequireRegistered,
    State(state): State<AppState>,
    Path(msg_id_str): Path<String>,
) -> impl IntoResponse {
    let msg_oid = match safe_object_id(&msg_id_str) {
        Some(id) => id,
        None     => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid message id." }))).into_response(),
    };

    let msg = match state.db.collection::<Document>("messages")
        .find_one(doc! { "_id": msg_oid })
        .await
    {
        Ok(Some(m)) => m,
        Ok(None)    => return (StatusCode::NOT_FOUND, Json(json!({ "error": "Message not found." }))).into_response(),
        Err(e)      => { eprintln!("[messages DELETE] lookup: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
    };

    if msg.get_str("fromUserId").unwrap_or("") != claims.sub {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "Not your message." }))).into_response();
    }

    match state.db.collection::<Document>("messages")
        .delete_one(doc! { "_id": msg_oid })
        .await
    {
        Ok(_)  => Json(json!({ "ok": true })).into_response(),
        Err(e) => { eprintln!("[messages DELETE] delete: {e}"); (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response() }
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
    println!("[messages] DB connected.");

    let state = AppState {
        db,
        jwt_secret:        cfg.jwt_secret,
        service_secret:    cfg.service_secret,
        loc_service_url:   cfg.loc_service_url,
        tiers_service_url: cfg.tiers_service_url,
        fav_service_url:   cfg.fav_service_url,
        http:              reqwest::Client::new(),
        svc_token_cache:   Arc::new(ServiceTokenCache::new()),
    };

    let app = Router::new()
        .route("/health",             get(health))
        .route("/messages",           get(get_messages))
        .route("/messages/{id}", get(get_thread).post(send_message).delete(delete_message))
        .fallback(|| async { (StatusCode::NOT_FOUND, Json(json!({ "error": "Not found." }))) })
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", cfg.port))
        .await
        .unwrap();
    println!("[messages] Running on :{}", cfg.port);
    axum::serve(listener, app).await.unwrap();
}
