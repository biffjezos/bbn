// ============================================================
// bOOmbOOm.NOW! — gateway (Rust)
//
// Required env vars:
//   JWT_SECRET              — HS256 signing key (for WS token decode)
//   SERVICE_SECRET          — inter-service token key
//   AUTHORITY_SERVICE_URL   — authority-service (auth + tiers + /authority/verify)
//   USER_SERVICE_URL
//   LOC_SERVICE_URL
//   MSG_SERVICE_URL
//   FAV_SERVICE_URL
//   BLOCKS_SERVICE_URL
//   MIGRATION_SERVICE_URL
// ============================================================

mod guards;
mod handlers;
mod proxy;
mod rate;
mod ws;

use std::{
    collections::HashMap,
    env,
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    extract::DefaultBodyLimit,
    http::{header, Method},
    response::{IntoResponse, Json},
    routing::{delete, get, patch, post, put},
    Router,
};
use common::service_token::ServiceTokenCache;
use rate::{live_lim, HealthCache, LiveLimiter, SendBuckets};
use serde_json::json;
use tower_http::cors::{AllowHeaders, AllowMethods, AllowOrigin, CorsLayer};

pub const ALLOWED_ORIGINS: &[&str] = &["https://biffjezos.github.io"];

// ── Config ────────────────────────────────────────────────────────────────────

struct Config {
    port:           u16,
    jwt_secret:     String,
    service_secret: String,
    authority_url:  String,
    user_url:       String,
    loc_url:        String,
    msg_url:        String,
    fav_url:        String,
    blocks_url:     String,
    migration_url:  String,
}

impl Config {
    fn from_env() -> Result<Self, String> {
        let required = [
            "AUTHORITY_SERVICE_URL", "USER_SERVICE_URL", "LOC_SERVICE_URL",
            "MSG_SERVICE_URL", "FAV_SERVICE_URL", "BLOCKS_SERVICE_URL",
            "MIGRATION_SERVICE_URL", "JWT_SECRET", "SERVICE_SECRET",
        ];
        let missing: Vec<_> = required.iter().filter(|k| env::var(k).is_err()).collect();
        if !missing.is_empty() {
            return Err(format!("FATAL: missing env vars: {}", missing.iter().map(|k| **k).collect::<Vec<_>>().join(", ")));
        }
        Ok(Self {
            port:          env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(3000),
            jwt_secret:    env::var("JWT_SECRET").unwrap(),
            service_secret:env::var("SERVICE_SECRET").unwrap(),
            authority_url: env::var("AUTHORITY_SERVICE_URL").unwrap(),
            user_url:      env::var("USER_SERVICE_URL").unwrap(),
            loc_url:       env::var("LOC_SERVICE_URL").unwrap(),
            msg_url:       env::var("MSG_SERVICE_URL").unwrap(),
            fav_url:       env::var("FAV_SERVICE_URL").unwrap(),
            blocks_url:    env::var("BLOCKS_SERVICE_URL").unwrap(),
            migration_url: env::var("MIGRATION_SERVICE_URL").unwrap(),
        })
    }
}

// ── App state ─────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct AppState {
    pub jwt_secret:      String,
    pub service_secret:  String,
    pub authority_url:   String,
    pub user_url:        String,
    pub loc_url:         String,
    pub msg_url:         String,
    pub fav_url:         String,
    pub blocks_url:      String,
    #[allow(dead_code)]
    pub migration_url:   String,
    pub http:            reqwest::Client,
    pub svc_token_cache: Arc<ServiceTokenCache>,
    pub lim_login:       LiveLimiter,
    pub lim_register:    LiveLimiter,
    pub lim_guest:       LiveLimiter,
    pub lim_api:         LiveLimiter,
    pub lim_msg:         LiveLimiter,
    pub health_cache:    Arc<Mutex<Option<HealthCache>>>,
    pub send_buckets:    SendBuckets,
}

// ── Main ──────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let cfg = Config::from_env().unwrap_or_else(|e| { eprintln!("{e}"); std::process::exit(1); });

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
        Ok(r) => match r.json::<serde_json::Value>().await {
            Ok(d) if d["ok"].as_bool() == Some(true) => println!("[gateway] Migrations done. Applied: {}", d["applied"]),
            Ok(d) => eprintln!("[gateway] Migration service reported failure: {}", d["error"]),
            Err(e) => eprintln!("[gateway] Could not parse migration response: {e}"),
        },
        Err(e) => eprintln!("[gateway] Could not reach migration service: {e}"),
    }

    // Load initial rate-limit config + body limit from admin_settings
    let mut body_limit_bytes: usize = 65536;
    if let Ok(svc_tok) = svc_cache.get("gateway", &cfg.service_secret).await {
        if let Ok(resp) = http.get(format!("{}/internal/settings", cfg.user_url))
            .header("X-Service-Token", &svc_tok)
            .timeout(Duration::from_secs(5))
            .send().await
        {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                body_limit_bytes = json["http_body_limit_bytes"].as_i64().unwrap_or(65536) as usize;
            }
        }
    }

    let state = AppState {
        jwt_secret:      cfg.jwt_secret,
        service_secret:  cfg.service_secret,
        authority_url:   cfg.authority_url,
        user_url:        cfg.user_url,
        loc_url:         cfg.loc_url,
        msg_url:         cfg.msg_url,
        fav_url:         cfg.fav_url,
        blocks_url:      cfg.blocks_url,
        migration_url:   cfg.migration_url,
        http,
        svc_token_cache: svc_cache,
        lim_login:    live_lim(10,  Duration::from_secs(900)),
        lim_register: live_lim(5,   Duration::from_secs(3600)),
        lim_guest:    live_lim(40,  Duration::from_secs(3600)),
        lim_api:      live_lim(120, Duration::from_secs(60)),
        lim_msg:      live_lim(30,  Duration::from_secs(60)),
        health_cache:    Arc::new(Mutex::new(None)),
        send_buckets:    Arc::new(Mutex::new(HashMap::new())),
    };

    // Background: refresh rate limiters from admin_settings every 60 s
    {
        let s2 = state.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(60));
            loop {
                interval.tick().await;
                let svc_tok = match s2.svc_token_cache.get("gateway", &s2.service_secret).await {
                    Ok(t) => t, Err(_) => continue,
                };
                let json = match s2.http
                    .get(format!("{}/internal/settings", s2.user_url))
                    .header("X-Service-Token", &svc_tok)
                    .timeout(Duration::from_secs(5))
                    .send().await
                {
                    Ok(r) if r.status().is_success() => match r.json::<serde_json::Value>().await {
                        Ok(j) => j, Err(_) => continue,
                    },
                    _ => continue,
                };
                let get_u32 = |k: &str, d: u32| json[k].as_i64().unwrap_or(d as i64) as u32;
                let get_u64 = |k: &str, d: u64| json[k].as_i64().unwrap_or(d as i64) as u64;
                macro_rules! refresh {
                    ($lim:expr, $max_k:expr, $win_k:expr, $dm:expr, $dw:expr) => {
                        *$lim.write().unwrap() = rate::FixedWindow::new(
                            get_u32($max_k, $dm),
                            Duration::from_secs(get_u64($win_k, $dw)),
                        );
                    };
                }
                refresh!(s2.lim_login,    "login_rate_max",    "login_rate_window_secs",    10,   900);
                refresh!(s2.lim_register, "register_rate_max", "register_rate_window_secs", 5,   3600);
                refresh!(s2.lim_guest,    "guest_rate_max",    "guest_rate_window_secs",    40,  3600);
                refresh!(s2.lim_api,      "api_rate_max",      "api_rate_window_secs",      120,   60);
                refresh!(s2.lim_msg,      "msg_ip_rate_max",   "msg_ip_rate_window_secs",   30,    60);
            }
        });
    }

    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(
            ALLOWED_ORIGINS.iter().map(|o| o.parse().unwrap()).collect::<Vec<_>>()
        ))
        .allow_methods(AllowMethods::list([
            Method::GET, Method::POST, Method::PUT, Method::PATCH, Method::DELETE, Method::OPTIONS,
        ]))
        .allow_headers(AllowHeaders::list([header::CONTENT_TYPE, header::AUTHORIZATION]));

    use handlers::*;
    let app = Router::new()
        // Health
        .route("/health",     get(health_gateway))
        .route("/api/health", get(health_api))
        // Auth (public — proxied to authority-service)
        .route("/api/auth/guest",            post(auth_guest))
        .route("/api/auth/register/start",   post(auth_register_start))
        .route("/api/auth/register/finish",  post(auth_register_finish))
        .route("/api/auth/login/start",      post(auth_login_start))
        .route("/api/auth/login/finish",     post(auth_login_finish))
        // Users
        .route("/api/users/me",                 get(users_get_me).put(users_put_me).delete(users_delete_me))
        .route("/api/users/me/preferences",     get(users_get_preferences).put(users_put_preferences))
        .route("/api/users/me/keys",            get(users_get_keys).put(users_put_keys))
        .route("/api/users/me/password/start",  post(users_pw_change_start))
        .route("/api/users/me/password/finish", post(users_pw_change_finish))
        .route("/api/users/search",             get(users_search))
        .route("/api/users/{userId}/profile",   get(users_profile))
        // Location
        .route("/api/location",        put(loc_put).delete(loc_delete))
        .route("/api/location/nearby", get(loc_nearby))
        // Messages (tier-gated)
        .route("/api/messages",       get(msg_list))
        .route("/api/messages/{id}",  get(msg_thread).post(msg_send).delete(msg_delete))
        // Tiers (public info)
        .route("/api/tiers/radius/nearby/{tier}",  get(tiers_nearby_radius))
        .route("/api/tiers/radius/message/{tier}", get(tiers_msg_radius))
        .route("/api/tiers/{tier}/info",           get(tiers_info))
        // Favourites (tier-gated)
        .route("/api/favourites",                 get(fav_list))
        .route("/api/favourites/is-mutual/{uid}", get(fav_is_mutual))
        .route("/api/favourites/{uid}",           post(fav_add).delete(fav_remove))
        // Blocks
        .route("/api/blocks",       get(blocks_list))
        .route("/api/blocks/{uid}", post(blocks_add).delete(blocks_remove))
        // Notifications
        .route("/api/notifications",      get(notif_list))
        .route("/api/notifications/{id}", delete(notif_delete))
        // Admin
        .route("/api/admin/config",                  get(admin_get_config))
        .route("/api/admin/settings",                get(admin_get_settings))
        .route("/api/admin/settings/{key}",          put(admin_put_setting))
        .route("/api/admin/users",                   get(admin_users))
        .route("/api/admin/users/{id}",              patch(admin_patch_user))
        .route("/api/admin/users/{id}/tier",         patch(admin_patch_tier))
        .route("/api/admin/users/{id}/role",         patch(admin_patch_role))
        .route("/api/admin/venues/{id}/manager",     patch(admin_patch_venue_manager))
        .route("/api/admin/tiers",                   get(admin_tiers_list).post(admin_tiers_post))
        .route("/api/admin/tiers/{name}",            put(admin_tiers_put).delete(admin_tiers_delete))
        .route("/api/admin/features",                get(admin_features_list).post(admin_features_post))
        .route("/api/admin/features/{name}",         put(admin_features_put).delete(admin_features_delete))
        // Manager
        .route("/api/manager/venues",      get(manager_venues_list).post(manager_venues_post))
        .route("/api/manager/venues/{id}", put(manager_venue_put).delete(manager_venue_delete))
        // WebSocket
        .route("/ws/location", get(ws::ws_location))
        .route("/ws/messages", get(ws::ws_messages))
        .fallback(|| async { (axum::http::StatusCode::NOT_FOUND, Json(json!({ "error": "Not found." }))) })
        .layer(DefaultBodyLimit::max(body_limit_bytes))
        .layer(cors)
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", cfg.port)).await.unwrap();
    println!("[gateway] Running on :{}", cfg.port);
    axum::serve(listener, app).await.unwrap();
}
