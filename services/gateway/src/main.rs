// ============================================================
// bOOmbOOm.NOW! — gateway (Rust)
// Replaces services/server.js.
// Identical HTTP + WebSocket contract — client needs no changes.
// ============================================================

use std::{
    collections::HashMap,
    env,
    net::IpAddr,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use axum::{
    body::Bytes,
    extract::{
        ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade},
        RawQuery, State,
    },
    http::{header, HeaderMap, Method, StatusCode},
    response::{IntoResponse, Json},
    routing::{delete, get, patch, post, put},
    Router,
};
use common::{auth::decode_user_token, geo::haversine_distance, service_token::ServiceTokenCache};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::sync::mpsc;
use tower_http::cors::{AllowHeaders, AllowMethods, AllowOrigin, CorsLayer};

// ── Constants ─────────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS: &[&str] = &["https://biffjezos.github.io"];

const WS_MAX_BYTES:    usize    = 4096;
const WS_SEND_LIMIT:   u32      = 10;
const WS_SEND_WINDOW:  Duration = Duration::from_millis(10_000);
const WS_AUTH_TIMEOUT: Duration = Duration::from_millis(3_000);
const LOC_MIN_SEND_M:  f64      = 5.0;

const HEALTH_CACHE_TTL: Duration = Duration::from_secs(30);

// ── Rate limiter (fixed window, per IP) ───────────────────────────────────────

struct FixedWindow {
    max:     u32,
    window:  Duration,
    buckets: Mutex<HashMap<IpAddr, (u32, Instant)>>,
}

impl FixedWindow {
    fn new(max: u32, window: Duration) -> Arc<Self> {
        Arc::new(Self { max, window, buckets: Mutex::new(HashMap::new()) })
    }

    fn check(&self, ip: IpAddr) -> bool {
        let mut b   = self.buckets.lock().unwrap();
        let now     = Instant::now();
        let entry   = b.entry(ip).or_insert((0, now));
        if now.duration_since(entry.1) >= self.window {
            *entry = (0, now);
        }
        if entry.0 >= self.max { return false; }
        entry.0 += 1;
        true
    }
}

// ── WS message send rate (per userId, shared across connections) ──────────────

type SendBuckets = Arc<Mutex<HashMap<String, (u32, Instant)>>>;

fn ws_check_send(buckets: &SendBuckets, user_id: &str) -> bool {
    let mut b   = buckets.lock().unwrap();
    let now     = Instant::now();
    let entry   = b.entry(user_id.to_string()).or_insert((0, now));
    if now.duration_since(entry.1) >= WS_SEND_WINDOW {
        *entry = (0, now);
    }
    entry.0 += 1;
    entry.0 <= WS_SEND_LIMIT
}

// ── Health cache ──────────────────────────────────────────────────────────────

struct HealthCache {
    body:       Value,
    status:     u16,
    expires_at: Instant,
}

// ── Config ────────────────────────────────────────────────────────────────────

struct Config {
    port:           u16,
    jwt_secret:     String,
    service_secret: String,
    auth_url:       String,
    user_url:       String,
    loc_url:        String,
    msg_url:        String,
    fav_url:        String,
    tiers_url:      String,
    blocks_url:     String,
    migration_url:  String,
}

impl Config {
    fn from_env() -> Result<Self, String> {
        let required = [
            "AUTH_SERVICE_URL", "USER_SERVICE_URL", "LOC_SERVICE_URL", "MSG_SERVICE_URL",
            "FAV_SERVICE_URL", "TIERS_SERVICE_URL", "BLOCKS_SERVICE_URL",
            "MIGRATION_SERVICE_URL", "JWT_SECRET", "SERVICE_SECRET",
        ];
        let missing: Vec<_> = required.iter().filter(|k| env::var(k).is_err()).collect();
        if !missing.is_empty() {
            return Err(format!("FATAL: missing env vars: {}",
                missing.iter().map(|k| **k).collect::<Vec<_>>().join(", ")));
        }
        Ok(Self {
            port:           env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(3000),
            jwt_secret:     env::var("JWT_SECRET").unwrap(),
            service_secret: env::var("SERVICE_SECRET").unwrap(),
            auth_url:      env::var("AUTH_SERVICE_URL").unwrap(),
            user_url:      env::var("USER_SERVICE_URL").unwrap(),
            loc_url:       env::var("LOC_SERVICE_URL").unwrap(),
            msg_url:       env::var("MSG_SERVICE_URL").unwrap(),
            fav_url:       env::var("FAV_SERVICE_URL").unwrap(),
            tiers_url:     env::var("TIERS_SERVICE_URL").unwrap(),
            blocks_url:    env::var("BLOCKS_SERVICE_URL").unwrap(),
            migration_url: env::var("MIGRATION_SERVICE_URL").unwrap(),
        })
    }
}

// ── App state ─────────────────────────────────────────────────────────────────

#[derive(Clone)]
struct AppState {
    jwt_secret:      String,
    service_secret:  String,
    auth_url:        String,
    user_url:        String,
    loc_url:         String,
    msg_url:         String,
    fav_url:         String,
    tiers_url:       String,
    blocks_url:      String,
    #[allow(dead_code)]
    migration_url:   String,
    http:            reqwest::Client,
    svc_token_cache: Arc<ServiceTokenCache>,
    // Rate limiters
    lim_login:       Arc<FixedWindow>,
    lim_register:    Arc<FixedWindow>,
    lim_guest:       Arc<FixedWindow>,
    lim_api:         Arc<FixedWindow>,
    // Health cache
    health_cache:    Arc<Mutex<Option<HealthCache>>>,
    // WS send buckets
    send_buckets:    SendBuckets,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn real_ip(headers: &HeaderMap) -> IpAddr {
    headers.get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or_else(|| IpAddr::from([127, 0, 0, 1]))
}

fn auth_hdr(headers: &HeaderMap) -> String {
    headers.get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string()
}

fn rate_limited() -> axum::response::Response {
    (StatusCode::TOO_MANY_REQUESTS, Json(json!({ "error": "Too many requests." }))).into_response()
}

fn bad_gw() -> axum::response::Response {
    (StatusCode::BAD_GATEWAY, Json(json!({ "error": "Service unavailable." }))).into_response()
}

async fn get_svc_token(state: &AppState) -> Option<String> {
    state.svc_token_cache.get("gateway", &state.service_secret).await.ok()
}

// ── Proxy ─────────────────────────────────────────────────────────────────────

async fn proxy(
    state:  &AppState,
    method: Method,
    url:    String,
    auth:   String,
    body:   Option<Bytes>,
) -> axum::response::Response {
    let token = match get_svc_token(state).await {
        Some(t) => t,
        None    => return bad_gw(),
    };

    let mut req = state.http.request(method, &url)
        .header("X-Service-Token", &token)
        .header("Authorization", &auth)
        .header("Content-Type", "application/json");

    if let Some(b) = body {
        req = req.body(b);
    }

    match req.send().await {
        Ok(resp) => {
            let status = StatusCode::from_u16(resp.status().as_u16())
                .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
            match resp.json::<Value>().await {
                Ok(data) => (status, Json(data)).into_response(),
                Err(_)   => (status, Json(json!({}))).into_response(),
            }
        }
        Err(e) => { eprintln!("[gateway] proxy: {e}"); bad_gw() }
    }
}

// ── Admin guard ───────────────────────────────────────────────────────────────

fn admin_guard(headers: &HeaderMap, secret: &str) -> Option<axum::response::Response> {
    let auth  = auth_hdr(headers);
    let token = auth.strip_prefix("Bearer ").unwrap_or(&auth).trim();
    if token.is_empty() {
        return Some((StatusCode::UNAUTHORIZED, Json(json!({ "error": "No token provided." }))).into_response());
    }
    match decode_user_token(token, secret) {
        Err(_)                              => Some((StatusCode::UNAUTHORIZED, Json(json!({ "error": "Token invalid or expired." }))).into_response()),
        Ok(c) if c.role != "admin"          => Some((StatusCode::FORBIDDEN,   Json(json!({ "error": "Admin access required.", "code": "ADMIN_REQUIRED" }))).into_response()),
        Ok(_)                               => None,
    }
}

// ── Tier check ────────────────────────────────────────────────────────────────

async fn tier_guard(state: &AppState, headers: &HeaderMap, feature: &str) -> Option<axum::response::Response> {
    let auth  = auth_hdr(headers);
    let token = auth.strip_prefix("Bearer ").unwrap_or(&auth).trim().to_string();
    if token.is_empty() {
        return Some((StatusCode::UNAUTHORIZED, Json(json!({ "error": "No token provided." }))).into_response());
    }
    let claims = match decode_user_token(&token, &state.jwt_secret) {
        Ok(c)  => c,
        Err(_) => return Some((StatusCode::UNAUTHORIZED, Json(json!({ "error": "Token invalid or expired." }))).into_response()),
    };

    let tier = claims.tier.as_deref().unwrap_or("guest").to_string();
    let svc  = match get_svc_token(state).await { Some(t) => t, None => return Some(bad_gw()) };

    match state.http
        .post(format!("{}/tiers/check", state.tiers_url))
        .header("X-Service-Token", &svc)
        .json(&json!({ "tier": tier, "feature": feature }))
        .timeout(Duration::from_secs(3))
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => None,
        Ok(r) => {
            let status = StatusCode::from_u16(r.status().as_u16()).unwrap_or(StatusCode::FORBIDDEN);
            let data   = r.json::<Value>().await.unwrap_or(json!({}));
            Some((status, Json(data)).into_response())
        }
        Err(_) => Some(bad_gw()),
    }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async fn health_gateway() -> impl IntoResponse {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    Json(json!({ "ok": true, "ts": ts }))
}

async fn health_api(State(state): State<AppState>) -> impl IntoResponse {
    let now = Instant::now();
    {
        let cache = state.health_cache.lock().unwrap();
        if let Some(ref c) = *cache {
            if c.expires_at > now {
                let status = StatusCode::from_u16(c.status).unwrap_or(StatusCode::OK);
                return (status, Json(c.body.clone())).into_response();
            }
        }
    }

    let services = [
        ("auth",       format!("{}/health", state.auth_url)),
        ("users",      format!("{}/health", state.user_url)),
        ("location",   format!("{}/health", state.loc_url)),
        ("messages",   format!("{}/health", state.msg_url)),
        ("favourites", format!("{}/health", state.fav_url)),
        ("tiers",      format!("{}/health", state.tiers_url)),
        ("blocks",     format!("{}/health", state.blocks_url)),
    ];

    let mut statuses = HashMap::new();
    let futs: Vec<_> = services.iter().map(|(name, url)| {
        let http = state.http.clone();
        let url  = url.clone();
        let name = *name;
        async move {
            match http.get(&url).timeout(Duration::from_secs(3)).send().await {
                Ok(r) if r.status().is_success() => (name, "ok"),
                Ok(_)                             => (name, "degraded"),
                Err(_)                            => (name, "down"),
            }
        }
    }).collect();

    let results = futures_util::future::join_all(futs).await;
    for (name, s) in results { statuses.insert(name, s); }

    let all_ok = statuses.values().all(|s| *s == "ok");
    let ts     = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis();
    let body   = json!({ "ok": all_ok, "services": statuses, "ts": ts });
    let status = if all_ok { 200u16 } else { 503u16 };

    if all_ok {
        let mut cache = state.health_cache.lock().unwrap();
        *cache = Some(HealthCache { body: body.clone(), status, expires_at: now + HEALTH_CACHE_TTL });
    }

    (StatusCode::from_u16(status).unwrap(), Json(body)).into_response()
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async fn auth_guest(State(s): State<AppState>, headers: HeaderMap, body: Bytes) -> impl IntoResponse {
    if !s.lim_guest.check(real_ip(&headers)) { return rate_limited(); }
    proxy(&s, Method::POST, format!("{}/auth/guest", s.auth_url), auth_hdr(&headers), Some(body)).await
}
async fn auth_register(State(s): State<AppState>, headers: HeaderMap, body: Bytes) -> impl IntoResponse {
    if !s.lim_register.check(real_ip(&headers)) { return rate_limited(); }
    proxy(&s, Method::POST, format!("{}/auth/register", s.auth_url), auth_hdr(&headers), Some(body)).await
}
async fn auth_login(State(s): State<AppState>, headers: HeaderMap, body: Bytes) -> impl IntoResponse {
    if !s.lim_login.check(real_ip(&headers)) { return rate_limited(); }
    proxy(&s, Method::POST, format!("{}/auth/login", s.auth_url), auth_hdr(&headers), Some(body)).await
}

// ── Users ─────────────────────────────────────────────────────────────────────

async fn users_get_me(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !s.lim_api.check(real_ip(&headers)) { return rate_limited(); }
    proxy(&s, Method::GET, format!("{}/users/me", s.user_url), auth_hdr(&headers), None).await
}
async fn users_put_me(State(s): State<AppState>, headers: HeaderMap, body: Bytes) -> impl IntoResponse {
    if !s.lim_api.check(real_ip(&headers)) { return rate_limited(); }
    proxy(&s, Method::PUT, format!("{}/users/me", s.user_url), auth_hdr(&headers), Some(body)).await
}
async fn users_delete_me(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !s.lim_api.check(real_ip(&headers)) { return rate_limited(); }
    proxy(&s, Method::DELETE, format!("{}/users/me", s.user_url), auth_hdr(&headers), None).await
}
async fn users_get_keys(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !s.lim_api.check(real_ip(&headers)) { return rate_limited(); }
    proxy(&s, Method::GET, format!("{}/users/me/keys", s.user_url), auth_hdr(&headers), None).await
}
async fn users_put_keys(State(s): State<AppState>, headers: HeaderMap, body: Bytes) -> impl IntoResponse {
    if !s.lim_api.check(real_ip(&headers)) { return rate_limited(); }
    proxy(&s, Method::PUT, format!("{}/users/me/keys", s.user_url), auth_hdr(&headers), Some(body)).await
}
async fn users_search(State(s): State<AppState>, headers: HeaderMap, RawQuery(q): RawQuery) -> impl IntoResponse {
    if !s.lim_api.check(real_ip(&headers)) { return rate_limited(); }
    let qs = q.unwrap_or_default();
    proxy(&s, Method::GET, format!("{}/users/search?{}", s.user_url, qs), auth_hdr(&headers), None).await
}
async fn users_profile(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(uid): axum::extract::Path<String>) -> impl IntoResponse {
    if !s.lim_api.check(real_ip(&headers)) { return rate_limited(); }
    proxy(&s, Method::GET, format!("{}/users/{}/profile", s.user_url, uid), auth_hdr(&headers), None).await
}

// ── Location ──────────────────────────────────────────────────────────────────

async fn loc_put(State(s): State<AppState>, headers: HeaderMap, body: Bytes) -> impl IntoResponse {
    if !s.lim_api.check(real_ip(&headers)) { return rate_limited(); }
    proxy(&s, Method::PUT, format!("{}/location", s.loc_url), auth_hdr(&headers), Some(body)).await
}
async fn loc_delete(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !s.lim_api.check(real_ip(&headers)) { return rate_limited(); }
    proxy(&s, Method::DELETE, format!("{}/location", s.loc_url), auth_hdr(&headers), None).await
}
async fn loc_nearby(State(s): State<AppState>, headers: HeaderMap, RawQuery(q): RawQuery) -> impl IntoResponse {
    if !s.lim_api.check(real_ip(&headers)) { return rate_limited(); }
    let qs = q.unwrap_or_default();
    proxy(&s, Method::GET, format!("{}/location/nearby?{}", s.loc_url, qs), auth_hdr(&headers), None).await
}

// ── Messages ──────────────────────────────────────────────────────────────────

async fn msg_list(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !s.lim_api.check(real_ip(&headers)) { return rate_limited(); }
    if let Some(e) = tier_guard(&s, &headers, "message_online").await { return e; }
    proxy(&s, Method::GET, format!("{}/messages", s.msg_url), auth_hdr(&headers), None).await
}
async fn msg_thread(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(uid): axum::extract::Path<String>) -> impl IntoResponse {
    if !s.lim_api.check(real_ip(&headers)) { return rate_limited(); }
    if let Some(e) = tier_guard(&s, &headers, "message_online").await { return e; }
    proxy(&s, Method::GET, format!("{}/messages/{}", s.msg_url, uid), auth_hdr(&headers), None).await
}
async fn msg_send(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(uid): axum::extract::Path<String>, body: Bytes) -> impl IntoResponse {
    if !s.lim_api.check(real_ip(&headers)) { return rate_limited(); }
    if let Some(e) = tier_guard(&s, &headers, "message_online").await { return e; }
    proxy(&s, Method::POST, format!("{}/messages/{}", s.msg_url, uid), auth_hdr(&headers), Some(body)).await
}
async fn msg_delete(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(id): axum::extract::Path<String>) -> impl IntoResponse {
    if !s.lim_api.check(real_ip(&headers)) { return rate_limited(); }
    if let Some(e) = tier_guard(&s, &headers, "message_online").await { return e; }
    proxy(&s, Method::DELETE, format!("{}/messages/{}", s.msg_url, id), auth_hdr(&headers), None).await
}

// ── Tiers ─────────────────────────────────────────────────────────────────────

async fn tiers_nearby_radius(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(tier): axum::extract::Path<String>) -> impl IntoResponse {
    if !s.lim_api.check(real_ip(&headers)) { return rate_limited(); }
    proxy(&s, Method::GET, format!("{}/tiers/radius/nearby/{}", s.tiers_url, tier), auth_hdr(&headers), None).await
}
async fn tiers_msg_radius(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(tier): axum::extract::Path<String>) -> impl IntoResponse {
    if !s.lim_api.check(real_ip(&headers)) { return rate_limited(); }
    proxy(&s, Method::GET, format!("{}/tiers/radius/message/{}", s.tiers_url, tier), auth_hdr(&headers), None).await
}
async fn tiers_info(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(tier): axum::extract::Path<String>) -> impl IntoResponse {
    if !s.lim_api.check(real_ip(&headers)) { return rate_limited(); }
    proxy(&s, Method::GET, format!("{}/tiers/{}/info", s.tiers_url, tier), auth_hdr(&headers), None).await
}

// ── Favourites ────────────────────────────────────────────────────────────────

async fn fav_list(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !s.lim_api.check(real_ip(&headers)) { return rate_limited(); }
    if let Some(e) = tier_guard(&s, &headers, "manage_favourites").await { return e; }
    proxy(&s, Method::GET, format!("{}/favourites", s.fav_url), auth_hdr(&headers), None).await
}
async fn fav_is_mutual(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(uid): axum::extract::Path<String>) -> impl IntoResponse {
    if !s.lim_api.check(real_ip(&headers)) { return rate_limited(); }
    if let Some(e) = tier_guard(&s, &headers, "manage_favourites").await { return e; }
    proxy(&s, Method::GET, format!("{}/favourites/is-mutual/{}", s.fav_url, uid), auth_hdr(&headers), None).await
}
async fn fav_add(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(uid): axum::extract::Path<String>, body: Bytes) -> impl IntoResponse {
    if !s.lim_api.check(real_ip(&headers)) { return rate_limited(); }
    if let Some(e) = tier_guard(&s, &headers, "manage_favourites").await { return e; }
    proxy(&s, Method::POST, format!("{}/favourites/{}", s.fav_url, uid), auth_hdr(&headers), Some(body)).await
}
async fn fav_remove(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(uid): axum::extract::Path<String>) -> impl IntoResponse {
    if !s.lim_api.check(real_ip(&headers)) { return rate_limited(); }
    if let Some(e) = tier_guard(&s, &headers, "manage_favourites").await { return e; }
    proxy(&s, Method::DELETE, format!("{}/favourites/{}", s.fav_url, uid), auth_hdr(&headers), None).await
}

// ── Blocks ────────────────────────────────────────────────────────────────────

async fn blocks_list(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !s.lim_api.check(real_ip(&headers)) { return rate_limited(); }
    proxy(&s, Method::GET, format!("{}/blocks", s.blocks_url), auth_hdr(&headers), None).await
}
async fn blocks_add(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(uid): axum::extract::Path<String>, body: Bytes) -> impl IntoResponse {
    if !s.lim_api.check(real_ip(&headers)) { return rate_limited(); }
    proxy(&s, Method::POST, format!("{}/blocks/{}", s.blocks_url, uid), auth_hdr(&headers), Some(body)).await
}
async fn blocks_remove(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(uid): axum::extract::Path<String>) -> impl IntoResponse {
    if !s.lim_api.check(real_ip(&headers)) { return rate_limited(); }
    proxy(&s, Method::DELETE, format!("{}/blocks/{}", s.blocks_url, uid), auth_hdr(&headers), None).await
}

// ── Notifications ─────────────────────────────────────────────────────────────

async fn notif_list(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !s.lim_api.check(real_ip(&headers)) { return rate_limited(); }
    proxy(&s, Method::GET, format!("{}/notifications", s.fav_url), auth_hdr(&headers), None).await
}
async fn notif_delete(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(id): axum::extract::Path<String>) -> impl IntoResponse {
    if !s.lim_api.check(real_ip(&headers)) { return rate_limited(); }
    proxy(&s, Method::DELETE, format!("{}/notifications/{}", s.fav_url, id), auth_hdr(&headers), None).await
}

// ── Admin ─────────────────────────────────────────────────────────────────────

async fn admin_users(State(s): State<AppState>, headers: HeaderMap, RawQuery(q): RawQuery) -> impl IntoResponse {
    if !s.lim_api.check(real_ip(&headers)) { return rate_limited(); }
    if let Some(e) = admin_guard(&headers, &s.jwt_secret) { return e; }
    let qs = q.unwrap_or_default();
    proxy(&s, Method::GET, format!("{}/admin/users?{}", s.user_url, qs), auth_hdr(&headers), None).await
}
async fn admin_patch_tier(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(id): axum::extract::Path<String>, body: Bytes) -> impl IntoResponse {
    if !s.lim_api.check(real_ip(&headers)) { return rate_limited(); }
    if let Some(e) = admin_guard(&headers, &s.jwt_secret) { return e; }
    proxy(&s, Method::PATCH, format!("{}/admin/users/{}/tier", s.user_url, id), auth_hdr(&headers), Some(body)).await
}
async fn admin_patch_role(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(id): axum::extract::Path<String>, body: Bytes) -> impl IntoResponse {
    if !s.lim_api.check(real_ip(&headers)) { return rate_limited(); }
    if let Some(e) = admin_guard(&headers, &s.jwt_secret) { return e; }
    proxy(&s, Method::PATCH, format!("{}/admin/users/{}/role", s.user_url, id), auth_hdr(&headers), Some(body)).await
}
async fn admin_tiers_list(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !s.lim_api.check(real_ip(&headers)) { return rate_limited(); }
    if let Some(e) = admin_guard(&headers, &s.jwt_secret) { return e; }
    proxy(&s, Method::GET, format!("{}/admin/tiers", s.tiers_url), auth_hdr(&headers), None).await
}
async fn admin_tiers_post(State(s): State<AppState>, headers: HeaderMap, body: Bytes) -> impl IntoResponse {
    if !s.lim_api.check(real_ip(&headers)) { return rate_limited(); }
    if let Some(e) = admin_guard(&headers, &s.jwt_secret) { return e; }
    proxy(&s, Method::POST, format!("{}/admin/tiers", s.tiers_url), auth_hdr(&headers), Some(body)).await
}
async fn admin_tiers_put(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(name): axum::extract::Path<String>, body: Bytes) -> impl IntoResponse {
    if !s.lim_api.check(real_ip(&headers)) { return rate_limited(); }
    if let Some(e) = admin_guard(&headers, &s.jwt_secret) { return e; }
    proxy(&s, Method::PUT, format!("{}/admin/tiers/{}", s.tiers_url, name), auth_hdr(&headers), Some(body)).await
}
async fn admin_tiers_delete(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(name): axum::extract::Path<String>) -> impl IntoResponse {
    if !s.lim_api.check(real_ip(&headers)) { return rate_limited(); }
    if let Some(e) = admin_guard(&headers, &s.jwt_secret) { return e; }
    proxy(&s, Method::DELETE, format!("{}/admin/tiers/{}", s.tiers_url, name), auth_hdr(&headers), None).await
}

// ── WebSocket helpers ─────────────────────────────────────────────────────────

fn ws_close(code: u16, reason: &'static str) -> Message {
    Message::Close(Some(CloseFrame { code, reason: reason.into() }))
}

fn ws_text(v: Value) -> Message {
    Message::Text(serde_json::to_string(&v).unwrap_or_default().into())
}

fn origin_ok(headers: &HeaderMap) -> bool {
    headers.get("origin")
        .and_then(|v| v.to_str().ok())
        .map(|o| ALLOWED_ORIGINS.contains(&o))
        .unwrap_or(false)
}

// ── WebSocket — Location ──────────────────────────────────────────────────────

async fn ws_location(ws: WebSocketUpgrade, State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !origin_ok(&headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    ws.on_upgrade(move |socket| handle_loc_socket(socket, state))
}

async fn handle_loc_socket(socket: WebSocket, state: AppState) {
    let (ws_tx, mut ws_rx) = socket.split();
    let (tx, mut rx)       = mpsc::unbounded_channel::<Message>();

    // Sender task — owns ws_tx
    let sender_task = tokio::spawn(async move {
        let mut ws_tx = ws_tx;
        while let Some(msg) = rx.recv().await {
            if ws_tx.send(msg).await.is_err() { break; }
        }
    });

    // Auth phase
    let first = tokio::time::timeout(WS_AUTH_TIMEOUT, ws_rx.next()).await;
    let raw = match first {
        Ok(Some(Ok(Message::Text(s)))) => s,
        _ => { tx.send(ws_close(4001, "Auth timeout")).ok(); sender_task.abort(); return; }
    };
    let msg: Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => { tx.send(ws_close(4001, "Bad auth")).ok(); sender_task.abort(); return; }
    };
    if msg["type"].as_str() != Some("auth") {
        tx.send(ws_close(4001, "Auth required")).ok(); sender_task.abort(); return;
    }
    let token = match msg["token"].as_str() {
        Some(t) if !t.is_empty() => t.to_string(),
        _ => { tx.send(ws_close(4001, "Auth required")).ok(); sender_task.abort(); return; }
    };
    if decode_user_token(&token, &state.jwt_secret).is_err() {
        tx.send(ws_close(4001, "Invalid token")).ok(); sender_task.abort(); return;
    }

    println!("[WS:loc] + connected");

    // Shared position state
    let last_pos:  Arc<Mutex<Option<(f64, f64, String)>>> = Arc::new(Mutex::new(None));
    let last_sent: Arc<Mutex<Option<(f64, f64)>>>          = Arc::new(Mutex::new(None));

    // Nearby push timer (5 s)
    let lp  = last_pos.clone();
    let ls  = last_sent.clone();
    let st  = state.clone();
    let tok = token.clone();
    let ttx = tx.clone();

    let nearby_task = tokio::spawn(async move {
        let mut interval        = tokio::time::interval(Duration::from_secs(5));
        let mut last_nearby_hash = String::new();
        loop {
            interval.tick().await;

            let pos = lp.lock().unwrap().clone();
            let Some((lat, lon, ref acc)) = pos else { continue };

            // Retry a failed PUT if position has moved enough
            let sent       = ls.lock().unwrap().clone();
            let needs_push = sent.map(|(slat, slon)| haversine_distance(slat, slon, lat, lon) >= LOC_MIN_SEND_M).unwrap_or(true);

            if needs_push {
                if let Some(svc) = get_svc_token(&st).await {
                    if let Ok(r) = st.http
                        .put(format!("{}/location", st.loc_url))
                        .header("X-Service-Token", &svc)
                        .header("Authorization", format!("Bearer {tok}"))
                        .json(&json!({ "lat": lat, "lon": lon, "accuracy": acc }))
                        .send().await
                    {
                        if r.status().is_success() {
                            *ls.lock().unwrap() = Some((lat, lon));
                        }
                    }
                }
            }

            // GET /location/nearby
            if let Some(svc) = get_svc_token(&st).await {
                if let Ok(r) = st.http
                    .get(format!("{}/location/nearby?lat={}&lon={}", st.loc_url, lat, lon))
                    .header("X-Service-Token", &svc)
                    .header("Authorization", format!("Bearer {tok}"))
                    .send().await
                {
                    if let Ok(data) = r.json::<Value>().await {
                        if let Some(users) = data["users"].as_array() {
                            let hash = serde_json::to_string(users).unwrap_or_default();
                            if hash != last_nearby_hash {
                                last_nearby_hash = hash;
                                ttx.send(ws_text(json!({ "type": "nearby", "users": users }))).ok();
                            }
                        }
                    }
                }
            }
        }
    });

    // Message loop
    while let Some(Ok(msg)) = ws_rx.next().await {
        let raw = match &msg {
            Message::Text(s) if s.len() <= WS_MAX_BYTES => s.clone(),
            Message::Close(_) => break,
            _ => continue,
        };
        let Ok(m) = serde_json::from_str::<Value>(&raw) else { continue };

        if m["type"].as_str() == Some("position") {
            if let (Some(lat), Some(lon)) = (m["lat"].as_f64(), m["lon"].as_f64()) {
                let acc = m["accuracy"].as_str().unwrap_or("gps").to_string();
                *last_pos.lock().unwrap() = Some((lat, lon, acc.clone()));

                let sent  = last_sent.lock().unwrap().clone();
                let moved = sent.map(|(slat, slon)| haversine_distance(slat, slon, lat, lon) >= LOC_MIN_SEND_M).unwrap_or(true);

                if moved {
                    let st2  = state.clone();
                    let tok2 = token.clone();
                    let ls2  = last_sent.clone();
                    tokio::spawn(async move {
                        if let Some(svc) = get_svc_token(&st2).await {
                            if let Ok(r) = st2.http
                                .put(format!("{}/location", st2.loc_url))
                                .header("X-Service-Token", &svc)
                                .header("Authorization", format!("Bearer {tok2}"))
                                .json(&json!({ "lat": lat, "lon": lon, "accuracy": acc }))
                                .send().await
                            {
                                if r.status().is_success() {
                                    *ls2.lock().unwrap() = Some((lat, lon));
                                }
                            }
                        }
                    });
                }
            }
        }
    }

    // Cleanup
    nearby_task.abort();
    sender_task.abort();
    println!("[WS:loc] - disconnected");

    if let Some(svc) = get_svc_token(&state).await {
        let _ = state.http
            .delete(format!("{}/location", state.loc_url))
            .header("X-Service-Token", &svc)
            .header("Authorization", format!("Bearer {token}"))
            .send().await;
    }
}

// ── WebSocket — Messages ──────────────────────────────────────────────────────

async fn ws_messages(ws: WebSocketUpgrade, State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !origin_ok(&headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    ws.on_upgrade(move |socket| handle_msg_socket(socket, state))
}

async fn handle_msg_socket(socket: WebSocket, state: AppState) {
    let (ws_tx, mut ws_rx) = socket.split();
    let (tx, mut rx)       = mpsc::unbounded_channel::<Message>();

    let sender_task = tokio::spawn(async move {
        let mut ws_tx = ws_tx;
        while let Some(msg) = rx.recv().await {
            if ws_tx.send(msg).await.is_err() { break; }
        }
    });

    // Auth phase
    let first = tokio::time::timeout(WS_AUTH_TIMEOUT, ws_rx.next()).await;
    let raw = match first {
        Ok(Some(Ok(Message::Text(s)))) => s,
        _ => { tx.send(ws_close(4001, "Auth timeout")).ok(); sender_task.abort(); return; }
    };
    let msg: Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => { tx.send(ws_close(4001, "Bad auth")).ok(); sender_task.abort(); return; }
    };
    if msg["type"].as_str() != Some("auth") {
        tx.send(ws_close(4001, "Auth required")).ok(); sender_task.abort(); return;
    }
    let token = match msg["token"].as_str() {
        Some(t) if !t.is_empty() => t.to_string(),
        _ => { tx.send(ws_close(4001, "Auth required")).ok(); sender_task.abort(); return; }
    };
    let claims = match decode_user_token(&token, &state.jwt_secret) {
        Ok(c)  => c,
        Err(_) => { tx.send(ws_close(4001, "Invalid token")).ok(); sender_task.abort(); return; }
    };
    if !matches!(claims.role.as_str(), "user" | "admin") {
        tx.send(ws_close(4003, "Registered account required")).ok(); sender_task.abort(); return;
    }

    let user_id = claims.sub.clone();
    println!("[WS:msg] + {user_id}");

    // Shared viewing state
    let viewing: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));

    // List timer (3 s) — fetch all conversations
    let st  = state.clone();
    let tok = token.clone();
    let ttx = tx.clone();
    let list_task = tokio::spawn(async move {
        let mut interval      = tokio::time::interval(Duration::from_secs(3));
        let mut last_list_hash = String::new();

        // Immediate push
        push_list(&st, &tok, &ttx, &mut last_list_hash).await;

        loop {
            interval.tick().await;
            push_list(&st, &tok, &ttx, &mut last_list_hash).await;
        }
    });

    // Thread timer (2 s) — fetch active thread when viewing
    let st2      = state.clone();
    let tok2     = token.clone();
    let ttx2     = tx.clone();
    let viewing2 = viewing.clone();
    let thread_task = tokio::spawn(async move {
        let mut interval        = tokio::time::interval(Duration::from_secs(2));
        let mut last_thread_hash = String::new();
        let mut last_viewing_uid = None::<String>;
        loop {
            interval.tick().await;
            let cur = viewing2.lock().unwrap().clone();
            if cur != last_viewing_uid {
                last_thread_hash = String::new();
                last_viewing_uid = cur.clone();
            }
            let Some(ref uid) = cur else { continue };
            push_thread(&st2, &tok2, uid, &ttx2, &mut last_thread_hash).await;
        }
    });

    // Message loop
    while let Some(Ok(msg)) = ws_rx.next().await {
        let raw = match &msg {
            Message::Text(s) if s.len() <= WS_MAX_BYTES => s.clone(),
            Message::Close(_) => break,
            _ => continue,
        };
        let Ok(m) = serde_json::from_str::<Value>(&raw) else { continue };

        match m["type"].as_str() {
            Some("view") => {
                let new_uid = m["userId"].as_str().filter(|s| !s.is_empty()).map(String::from);
                *viewing.lock().unwrap() = new_uid.clone();
                // Immediate push on open
                if let Some(ref uid) = new_uid {
                    let st3  = state.clone();
                    let tok3 = token.clone();
                    let ttx3 = tx.clone();
                    let uid3 = uid.clone();
                    tokio::spawn(async move {
                        let mut h = String::new();
                        push_thread(&st3, &tok3, &uid3, &ttx3, &mut h).await;
                    });
                }
            }
            Some("send") => {
                if let (Some(to), Some(text)) = (m["toUserId"].as_str(), m["text"].as_str()) {
                    if !ws_check_send(&state.send_buckets, &user_id) {
                        tx.send(ws_text(json!({ "type": "send:error", "error": "Rate limit exceeded. Please wait a moment." }))).ok();
                        continue;
                    }
                    let st3  = state.clone();
                    let tok3 = token.clone();
                    let ttx3 = tx.clone();
                    let to3  = to.to_string();
                    let txt3 = text.to_string();
                    let uid3 = user_id.clone();
                    let cur_view = viewing.lock().unwrap().clone();
                    tokio::spawn(async move {
                        println!("[WS:send] {uid3} -> {to3}");
                        if let Some(svc) = get_svc_token(&st3).await {
                            match st3.http
                                .post(format!("{}/messages/{}", st3.msg_url, to3))
                                .header("X-Service-Token", &svc)
                                .header("Authorization", format!("Bearer {tok3}"))
                                .json(&json!({ "text": txt3 }))
                                .send().await
                            {
                                Ok(r) if r.status().is_success() => {
                                    // Immediate thread refresh if sender is viewing that conversation
                                    if cur_view.as_deref() == Some(&to3) {
                                        let mut h = String::new();
                                        push_thread(&st3, &tok3, &to3, &ttx3, &mut h).await;
                                    }
                                }
                                Ok(r) => {
                                    let err = r.json::<Value>().await.unwrap_or(json!({}));
                                    ttx3.send(ws_text(json!({ "type": "send:error", "error": err["error"].as_str().unwrap_or("Failed to send message.") }))).ok();
                                }
                                Err(e) => {
                                    eprintln!("[WS:send] fetch failed: {e}");
                                    ttx3.send(ws_text(json!({ "type": "send:error", "error": "Could not reach messaging service." }))).ok();
                                }
                            }
                        }
                    });
                }
            }
            _ => {}
        }
    }

    // Cleanup
    list_task.abort();
    thread_task.abort();
    sender_task.abort();
    println!("[WS:msg] - {user_id}");
}

async fn push_list(state: &AppState, token: &str, tx: &mpsc::UnboundedSender<Message>, last_hash: &mut String) {
    let Some(svc) = get_svc_token(state).await else { return };
    let Ok(resp)  = state.http
        .get(format!("{}/messages", state.msg_url))
        .header("X-Service-Token", &svc)
        .header("Authorization", format!("Bearer {token}"))
        .send().await
    else { return };

    let Ok(data) = resp.json::<Value>().await else { return };
    let hash = serde_json::to_string(&data["messages"]).unwrap_or_default();
    if hash == *last_hash { return }
    *last_hash = hash;
    tx.send(ws_text(json!({ "type": "conversations", "messages": data["messages"] }))).ok();
}

async fn push_thread(state: &AppState, token: &str, uid: &str, tx: &mpsc::UnboundedSender<Message>, last_hash: &mut String) {
    let Some(svc) = get_svc_token(state).await else { return };
    let Ok(resp)  = state.http
        .get(format!("{}/messages/{}", state.msg_url, uid))
        .header("X-Service-Token", &svc)
        .header("Authorization", format!("Bearer {token}"))
        .send().await
    else { return };

    let Ok(data) = resp.json::<Value>().await else { return };
    let hash = serde_json::to_string(&data["messages"]).unwrap_or_default();
    if hash == *last_hash { return }
    *last_hash = hash;
    tx.send(ws_text(json!({ "type": "thread", "userId": uid, "messages": data["messages"] }))).ok();
}

// ── Main ──────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let cfg = Config::from_env().unwrap_or_else(|e| { eprintln!("{e}"); std::process::exit(1); });

    // ── Migration on boot ──
    let svc_cache = Arc::new(ServiceTokenCache::new());
    let http      = reqwest::Client::builder()
        .tcp_keepalive(Duration::from_secs(30))
        .pool_max_idle_per_host(50)
        .build()
        .expect("HTTP client");

    println!("[gateway] Calling migration service…");
    match http
        .post(format!("{}/migrate/run", cfg.migration_url))
        .header("X-Service-Token", svc_cache.get("gateway", &cfg.service_secret).await.unwrap_or_default())
        .send().await
    {
        Ok(r) => match r.json::<Value>().await {
            Ok(data) if data["ok"].as_bool() == Some(true) =>
                println!("[gateway] Migrations done. Applied: {}", data["applied"]),
            Ok(data) =>
                eprintln!("[gateway] Migration service reported failure: {}", data["error"]),
            Err(e) =>
                eprintln!("[gateway] Could not parse migration response: {e}"),
        },
        Err(e) => eprintln!("[gateway] Could not reach migration service: {e}"),
    }

    let state = AppState {
        jwt_secret:      cfg.jwt_secret,
        service_secret:  cfg.service_secret,
        auth_url:        cfg.auth_url,
        user_url:        cfg.user_url,
        loc_url:         cfg.loc_url,
        msg_url:         cfg.msg_url,
        fav_url:         cfg.fav_url,
        tiers_url:       cfg.tiers_url,
        blocks_url:      cfg.blocks_url,
        migration_url:   cfg.migration_url,
        http,
        svc_token_cache: svc_cache,
        lim_login:       FixedWindow::new(10,  Duration::from_secs(15 * 60)),
        lim_register:    FixedWindow::new(5,   Duration::from_secs(60 * 60)),
        lim_guest:       FixedWindow::new(10,  Duration::from_secs(60 * 60)),
        lim_api:         FixedWindow::new(120, Duration::from_secs(60)),
        health_cache:    Arc::new(Mutex::new(None)),
        send_buckets:    Arc::new(Mutex::new(HashMap::new())),
    };

    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(
            ALLOWED_ORIGINS.iter().map(|o| o.parse().unwrap()).collect::<Vec<_>>()
        ))
        .allow_methods(AllowMethods::list([
            Method::GET, Method::POST, Method::PUT, Method::PATCH, Method::DELETE, Method::OPTIONS,
        ]))
        .allow_headers(AllowHeaders::list([header::CONTENT_TYPE, header::AUTHORIZATION]));

    let app = Router::new()
        // Health
        .route("/health",     get(health_gateway))
        .route("/api/health", get(health_api))
        // Auth
        .route("/api/auth/guest",    post(auth_guest))
        .route("/api/auth/register", post(auth_register))
        .route("/api/auth/login",    post(auth_login))
        // Users
        .route("/api/users/me",                get(users_get_me).put(users_put_me).delete(users_delete_me))
        .route("/api/users/me/keys",           get(users_get_keys).put(users_put_keys))
        .route("/api/users/search",            get(users_search))
        .route("/api/users/{userId}/profile",  get(users_profile))
        // Location
        .route("/api/location",        put(loc_put).delete(loc_delete))
        .route("/api/location/nearby", get(loc_nearby))
        // Messages
        .route("/api/messages",         get(msg_list))
        .route("/api/messages/{id}",    get(msg_thread).post(msg_send).delete(msg_delete))
        // Tiers
        .route("/api/tiers/radius/nearby/{tier}",  get(tiers_nearby_radius))
        .route("/api/tiers/radius/message/{tier}", get(tiers_msg_radius))
        .route("/api/tiers/{tier}/info",           get(tiers_info))
        // Favourites
        .route("/api/favourites",                  get(fav_list))
        .route("/api/favourites/is-mutual/{uid}",  get(fav_is_mutual))
        .route("/api/favourites/{uid}",            post(fav_add).delete(fav_remove))
        // Blocks
        .route("/api/blocks",       get(blocks_list))
        .route("/api/blocks/{uid}", post(blocks_add).delete(blocks_remove))
        // Notifications
        .route("/api/notifications",      get(notif_list))
        .route("/api/notifications/{id}", delete(notif_delete))
        // Admin
        .route("/api/admin/users",              get(admin_users))
        .route("/api/admin/users/{id}/tier",    patch(admin_patch_tier))
        .route("/api/admin/users/{id}/role",    patch(admin_patch_role))
        .route("/api/admin/tiers",              get(admin_tiers_list).post(admin_tiers_post))
        .route("/api/admin/tiers/{name}",       put(admin_tiers_put).delete(admin_tiers_delete))
        // WebSocket
        .route("/ws/location", get(ws_location))
        .route("/ws/messages", get(ws_messages))
        .fallback(|| async { (StatusCode::NOT_FOUND, Json(json!({ "error": "Not found." }))) })
        .layer(cors)
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", cfg.port))
        .await.unwrap();
    println!("[gateway] Running on :{}", cfg.port);
    axum::serve(listener, app).await.unwrap();
}
