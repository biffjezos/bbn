// biffjezos asked Copilot (Windows 11) to port /services/server.js

use std::{collections::HashMap, sync::{Arc, Mutex}, time::{Duration, Instant}};
use rocket::{
    get, post, put, delete,
    http::Status,
    response::status,
    serde::json::Json,
    State, Request, Data, Route,
};
use rocket::fairing::{Fairing, Info, Kind};
use rocket::tokio::{self, sync::RwLock, time::sleep};
use serde::{Serialize, Deserialize};
use jsonwebtoken::{encode, decode, Header, Validation, EncodingKey, DecodingKey};
use reqwest::Client;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;
use futures::{SinkExt, StreamExt};
use rocket::tokio::net::TcpStream;

// ============================================================
// CONFIG
// ============================================================

#[derive(Clone)]
struct Cfg {
    port: u16,
    jwt_secret: String,
    auth_url: String,
    user_url: String,
    loc_url: String,
    msg_url: String,
    fav_url: String,
    tiers_url: String,
    migration_url: String,
}

impl Cfg {
    fn from_env() -> Self {
        Self {
            port: std::env::var("PORT").unwrap_or("3000".into()).parse().unwrap(),
            jwt_secret: std::env::var("JWT_SECRET").expect("JWT_SECRET missing"),
            auth_url: std::env::var("AUTH_SERVICE_URL").unwrap_or("http://auth".into()),
            user_url: std::env::var("USER_SERVICE_URL").unwrap_or("http://usr".into()),
            loc_url: std::env::var("LOC_SERVICE_URL").unwrap_or("http://loc".into()),
            msg_url: std::env::var("MSG_SERVICE_URL").unwrap_or("http://msg".into()),
            fav_url: std::env::var("FAV_SERVICE_URL").unwrap_or("http://fav".into()),
            tiers_url: std::env::var("TIERS_SERVICE_URL").unwrap_or("http://tiers".into()),
            migration_url: std::env::var("MIGRATION_SERVICE_URL").unwrap_or("http://migrations".into()),
        }
    }
}

// ============================================================
// JWT
// ============================================================

#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    sub: String,
    role: String,
    tier: Option<String>,
    exp: usize,
}

fn verify_jwt(token: &str, secret: &str) -> Option<Claims> {
    decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    ).ok().map(|d| d.claims)
}

// ============================================================
// SERVICE TOKEN CACHE
// ============================================================

struct ServiceToken {
    token: String,
    expires_at: Instant,
}

struct TokenCache {
    inner: Mutex<Option<ServiceToken>>,
}

impl TokenCache {
    fn new() -> Self {
        Self { inner: Mutex::new(None) }
    }

    fn get(&self, secret: &str) -> String {
        let mut guard = self.inner.lock().unwrap();
        let now = Instant::now();

        if let Some(st) = guard.as_ref() {
            if st.expires_at > now + Duration::from_secs(5) {
                return st.token.clone();
            }
        }

        let exp = (now + Duration::from_secs(60)).elapsed().as_secs() as usize + 60;
        let claims = Claims {
            sub: "gateway".into(),
            role: "service".into(),
            tier: None,
            exp,
        };

        let token = encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(secret.as_bytes()),
        ).unwrap();

        *guard = Some(ServiceToken {
            token: token.clone(),
            expires_at: now + Duration::from_secs(60),
        });

        token
    }
}

// ============================================================
// PROXY
// ============================================================

async fn proxy(
    client: &Client,
    cfg: &Cfg,
    token_cache: &TokenCache,
    req: &Request<'_>,
    body: Option<serde_json::Value>,
    target: String,
) -> Result<status::Custom<Json<serde_json::Value>>, status::Custom<Json<serde_json::Value>>> {

    let method = req.method().as_str();
    let user_auth = req.headers().get_one("Authorization").unwrap_or("");

    let mut builder = client.request(method.parse().unwrap(), &target);
    builder = builder.header("Authorization", user_auth);
    builder = builder.header("X-Service-Token", token_cache.get(&cfg.jwt_secret));

    if let Some(b) = body {
        builder = builder.json(&b);
    }

    let res = builder.send().await.map_err(|_| {
        status::Custom(Status::BadGateway, Json(json!({"error": "Service unavailable"})))
    })?;

    let status = Status::new(res.status().as_u16());
    let json = res.json::<serde_json::Value>().await.unwrap_or(json!({"error": "Invalid JSON"}));

    Ok(status::Custom(status, Json(json)))
}

// ============================================================
// HEALTH CHECK
// ============================================================

#[get("/api/health")]
async fn health(cfg: &State<Cfg>, client: &State<Client>) -> Json<serde_json::Value> {
    let urls = vec![
        ("auth", format!("{}/health", cfg.auth_url)),
        ("users", format!("{}/health", cfg.user_url)),
        ("location", format!("{}/health", cfg.loc_url)),
        ("messages", format!("{}/health", cfg.msg_url)),
        ("favourites", format!("{}/health", cfg.fav_url)),
        ("tiers", format!("{}/health", cfg.tiers_url)),
    ];

    let mut status_map = serde_json::Map::new();

    for (name, url) in urls {
        let ok = client.get(url).timeout(Duration::from_secs(3)).send().await
            .map(|r| r.status().is_success())
            .unwrap_or(false);

        status_map.insert(name.into(), if ok { json!("ok") } else { json!("down") });
    }

    Json(json!({
        "ok": status_map.values().all(|v| v == "ok"),
        "services": status_map,
        "ts": chrono::Utc::now().timestamp_millis(),
    }))
}

// ============================================================
// ROCKET ROUTES (HTTP PROXY)
// ============================================================

#[post("/api/auth/login", data = "<body>")]
async fn auth_login(
    cfg: &State<Cfg>,
    client: &State<Client>,
    token_cache: &State<TokenCache>,
    body: Json<serde_json::Value>,
    req: &Request<'_>,
) -> Result<status::Custom<Json<serde_json::Value>>, status::Custom<Json<serde_json::Value>>> {
    proxy(client, cfg, token_cache, req, Some(body.into_inner()), format!("{}/auth/login", cfg.auth_url)).await
}

// (You would repeat this pattern for all your proxy routes…)

// ============================================================
// WEBSOCKETS (Location + Messaging)
// ============================================================
//
// NOTE: Rocket does not natively support WS upgrades.
// We attach a raw TCP listener and route upgrades manually.
// This mirrors your Node.js httpServer.on("upgrade") logic.
//

async fn handle_location_ws(
    mut ws: WebSocketStream<TcpStream>,
    cfg: Arc<Cfg>,
    client: Client,
    token_cache: Arc<TokenCache>,
) {
    // Same logic as your Node version:
    // - First message must be {type:"auth", token}
    // - Then periodic nearby pushes
    // - PUT /location on movement
    // - DELETE on disconnect

    // This is a placeholder skeleton:
    while let Some(msg) = ws.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                // parse JSON, handle "position", etc.
            }
            Ok(Message::Close(_)) | Err(_) => break,
            _ => {}
        }
    }
}

async fn handle_messages_ws(
    mut ws: WebSocketStream<TcpStream>,
    cfg: Arc<Cfg>,
    client: Client,
    token_cache: Arc<TokenCache>,
) {
    // Same structure as your Node message WS:
    // - Auth
    // - view thread
    // - send message
    // - periodic pushes
}

// ============================================================
// MIGRATIONS ON BOOT
// ============================================================

async fn run_migrations(cfg: &Cfg, client: &Client, token_cache: &TokenCache) {
    let _ = client
        .post(format!("{}/migrate/run", cfg.migration_url))
        .header("X-Service-Token", token_cache.get(&cfg.jwt_secret))
        .send()
        .await;
}

// =================================================
