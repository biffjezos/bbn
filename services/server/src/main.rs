// ============================================================
// bOOmbOOm.NOW! — server
//
// HTML server (Tera SSR) + reverse proxy facade to gateway.
// Replaces Jekyll / GitHub Pages. See T-28.
//
// Required env vars:
//   GATEWAY_URL            — full URL of the gateway service
//   GATEWAY_ALLOWED_HOST   — hostname validation for GATEWAY_URL
//   JWT_SECRET             — HS256 key (same key used by gateway)
//
// Optional env vars:
//   PORT          — listen port (default 8080)
//   STATIC_DIR    — path to static assets (default ./static)
//   TEMPLATES_DIR — path to Tera templates dir (default ./templates)
//   ASSET_VERSION — cache-bust string injected into template asset hrefs
// ============================================================

mod guards;
mod proxy;

use std::{env, sync::Arc, time::Duration};

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::{any, get},
    Router,
};
use guards::AuthContext;
use serde::{Deserialize, Serialize};
use tera::{Context, Tera};
use tower_http::services::{ServeDir, ServeFile};

// ── SSR data ──────────────────────────────────────────────────

/// Fields from GET /api/users/me used for SSR pre-population.
/// All optional so graceful degradation is automatic.
#[derive(Debug, Serialize, Deserialize, Default)]
struct MeData {
    nickname:     Option<String>,
    age:          Option<u32>,
    sex:          Option<String>,
    bio:          Option<String>,
    tier:         Option<String>,
    account_type: Option<String>,
    email:        Option<String>,
}

/// Call GET {gateway_url}/api/users/me on behalf of the logged-in user.
/// Returns None on any error (network, timeout, 4xx/5xx, parse failure).
/// Timeout is 3 s — page still renders if the gateway is slow or down.
async fn fetch_me(
    client: &reqwest::Client,
    gateway_url: &str,
    token: &str,
) -> Option<MeData> {
    let res = client
        .get(format!("{gateway_url}/api/users/me"))
        .header("Authorization", format!("Bearer {token}"))
        .timeout(Duration::from_secs(3))
        .send()
        .await
        .ok()?;
    if !res.status().is_success() {
        return None;
    }
    res.json::<MeData>().await.ok()
}

pub struct AppState {
    pub gateway_url:   String,
    pub http_client:   reqwest::Client,
    pub tera:          Tera,
    pub asset_version: String,
    pub jwt_secret:    String,
}

// ── Template rendering ────────────────────────────────────────

fn render(state: &AppState, template: &str, mut ctx: Context, auth: AuthContext) -> Response {
    ctx.insert("asset_version",  &state.asset_version);
    ctx.insert("is_logged_in",   &auth.is_logged_in);
    ctx.insert("nickname",       &auth.nickname);
    ctx.insert("tier",           &auth.tier);
    ctx.insert("role",           &auth.role);
    ctx.insert("sex",            &auth.sex);
    match state.tera.render(template, &ctx) {
        Ok(html) => Html(html).into_response(),
        Err(e) => {
            tracing::error!("template render error for {template}: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "Template error").into_response()
        }
    }
}

// ── Handlers ──────────────────────────────────────────────────

async fn health() -> impl IntoResponse {
    "OK"
}

// Public pages — guard optional (serves everyone, injects auth context if present)

async fn page_index(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let auth = guards::check_auth(&headers, &state.jwt_secret);
    let mut ctx = Context::new();
    ctx.insert("page_title", "");
    render(&state, "pages/index.html", ctx, auth)
}

async fn page_donate(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let auth = guards::check_auth(&headers, &state.jwt_secret);
    let mut ctx = Context::new();
    ctx.insert("page_title", "Support bOOmbOOm.NOW!");
    render(&state, "pages/donate.html", ctx, auth)
}

async fn page_profile_view(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let auth = guards::check_auth(&headers, &state.jwt_secret);
    let mut ctx = Context::new();
    ctx.insert("page_title", "Profile");
    render(&state, "pages/profile-view.html", ctx, auth)
}

// Protected pages — require valid user JWT

async fn page_messages(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    match guards::require_user(&headers, &state.jwt_secret) {
        Ok(auth) => {
            let mut ctx = Context::new();
            ctx.insert("page_title", "Conversations");
            render(&state, "pages/messages.html", ctx, auth)
        }
        Err(redirect) => redirect,
    }
}

async fn page_messages_thread(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    match guards::require_user(&headers, &state.jwt_secret) {
        Ok(auth) => {
            let mut ctx = Context::new();
            ctx.insert("page_title", "Message Thread");
            render(&state, "pages/messages-thread.html", ctx, auth)
        }
        Err(redirect) => redirect,
    }
}

async fn page_profile(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    match guards::require_user(&headers, &state.jwt_secret) {
        Ok(auth) => {
            let me = match &auth.raw_token {
                Some(t) => fetch_me(&state.http_client, &state.gateway_url, t).await,
                None    => None,
            };
            let mut ctx = Context::new();
            ctx.insert("page_title", "My Profile");
            ctx.insert("ssr_me", &me);
            render(&state, "pages/profile.html", ctx, auth)
        }
        Err(redirect) => redirect,
    }
}

async fn page_favourites(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    match guards::require_user(&headers, &state.jwt_secret) {
        Ok(auth) => {
            let mut ctx = Context::new();
            ctx.insert("page_title", "Favourites");
            render(&state, "pages/favourites.html", ctx, auth)
        }
        Err(redirect) => redirect,
    }
}

async fn page_settings(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    match guards::require_user(&headers, &state.jwt_secret) {
        Ok(auth) => {
            let me = match &auth.raw_token {
                Some(t) => fetch_me(&state.http_client, &state.gateway_url, t).await,
                None    => None,
            };
            let mut ctx = Context::new();
            ctx.insert("page_title", "Settings");
            ctx.insert("ssr_me", &me);
            render(&state, "pages/settings.html", ctx, auth)
        }
        Err(redirect) => redirect,
    }
}

// Admin-only page

async fn page_admin(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    match guards::require_admin(&headers, &state.jwt_secret) {
        Ok(auth) => {
            let mut ctx = Context::new();
            ctx.insert("page_title", "Admin");
            render(&state, "pages/admin.html", ctx, auth)
        }
        Err(redirect) => redirect,
    }
}

// ── Main ──────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    // ── Config ───────────────────────────────────────────
    let gateway_url = env::var("GATEWAY_URL").expect("GATEWAY_URL is required");
    let gateway_host =
        env::var("GATEWAY_ALLOWED_HOST").expect("GATEWAY_ALLOWED_HOST is required");
    let jwt_secret = env::var("JWT_SECRET").expect("JWT_SECRET is required");
    let port: u16 = env::var("PORT")
        .unwrap_or_else(|_| "8080".into())
        .parse()
        .expect("PORT must be a number");
    let static_dir    = env::var("STATIC_DIR").unwrap_or_else(|_| "./static".into());
    let templates_dir = env::var("TEMPLATES_DIR").unwrap_or_else(|_| "./templates".into());
    let asset_version = env::var("ASSET_VERSION")
        .or_else(|_| env::var("RAILWAY_GIT_COMMIT_SHA").map(|s| s[..s.len().min(7)].to_string()))
        .unwrap_or_else(|_| "dev".into());

    validate_gateway_url(&gateway_url, &gateway_host);

    // ── Tera ─────────────────────────────────────────────
    let tera = Tera::new(&format!("{templates_dir}/**/*.html"))
        .unwrap_or_else(|e| panic!("failed to load templates from {templates_dir}: {e}"));

    let state = Arc::new(AppState {
        gateway_url: gateway_url.trim_end_matches('/').to_string(),
        http_client: reqwest::Client::new(),
        tera,
        asset_version,
        jwt_secret,
    });

    // ── Routes ───────────────────────────────────────────
    let app = Router::new()
        // Health
        .route("/health", get(health))
        // API proxy — all methods
        .route("/api/{*rest}", any(proxy::proxy_api))
        // WebSocket proxy
        .route("/ws/{*rest}", get(proxy::proxy_ws))
        // Public page routes
        .route("/", get(page_index))
        .route("/donate/", get(page_donate))
        .route("/profile/view/", get(page_profile_view))
        // Protected page routes (user)
        .route("/messages/", get(page_messages))
        .route("/messages/thread/", get(page_messages_thread))
        .route("/profile/", get(page_profile))
        .route("/favourites/", get(page_favourites))
        .route("/settings/", get(page_settings))
        // Admin-only page route
        .route("/admin/", get(page_admin))
        // Static assets
        .nest_service("/assets", ServeDir::new(format!("{static_dir}/assets")))
        .nest_service("/scripts", ServeDir::new(format!("{static_dir}/scripts")))
        .nest_service("/styles", ServeDir::new(format!("{static_dir}/styles")))
        // Root-level static files
        .route_service(
            "/service-worker.js",
            ServeFile::new(format!("{static_dir}/service-worker.js")),
        )
        .route_service(
            "/manifest.json",
            ServeFile::new(format!("{static_dir}/manifest.json")),
        )
        .with_state(state);

    // ── Start ────────────────────────────────────────────
    tracing::info!("server listening on 0.0.0.0:{port}");
    tracing::info!("static dir: {static_dir}");
    tracing::info!("templates dir: {templates_dir}");
    tracing::info!("gateway: {gateway_url}");

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port))
        .await
        .expect("failed to bind");

    axum::serve(listener, app).await.expect("server failed");
}

fn validate_gateway_url(raw: &str, expected_host: &str) {
    let parsed =
        url::Url::parse(raw).unwrap_or_else(|e| panic!("GATEWAY_URL is not a valid URL: {e}"));
    match parsed.scheme() {
        "http" | "https" => {}
        s => panic!("GATEWAY_URL scheme must be http or https, got '{s}'"),
    }
    let host = parsed.host_str().unwrap_or("");
    assert!(
        host == expected_host,
        "GATEWAY_URL host '{host}' does not match GATEWAY_ALLOWED_HOST '{expected_host}'"
    );
}
