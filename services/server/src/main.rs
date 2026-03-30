// ============================================================
// bOOmbOOm.NOW! — server
//
// HTML server (Tera SSR) + reverse proxy facade to gateway.
// Replaces Jekyll / GitHub Pages. See T-28.
//
// Required env vars:
//   GATEWAY_URL            — full URL of the gateway service
//   GATEWAY_ALLOWED_HOST   — hostname validation for GATEWAY_URL
//
// Optional env vars:
//   PORT          — listen port (default 8080)
//   STATIC_DIR    — path to static assets (default ./static)
//   TEMPLATES_DIR — path to Tera templates dir (default ./templates)
//   ASSET_VERSION — cache-bust string injected into template asset hrefs
// ============================================================

mod proxy;

use std::{env, sync::Arc};

use axum::{
    extract::State,
    http::StatusCode,
    response::{Html, IntoResponse, Response},
    routing::{any, get},
    Router,
};
use tera::{Context, Tera};
use tower_http::services::{ServeDir, ServeFile};

pub struct AppState {
    pub gateway_url: String,
    pub http_client: reqwest::Client,
    pub tera: Tera,
    pub asset_version: String,
}

// ── Template helpers ─────────────────────────────────────────

fn base_context(state: &AppState) -> Context {
    let mut ctx = Context::new();
    ctx.insert("asset_version", &state.asset_version);
    ctx.insert("is_logged_in", &false);
    ctx.insert("nickname", &Option::<String>::None);
    ctx.insert("tier", &Option::<String>::None);
    ctx.insert("role", &Option::<String>::None);
    ctx
}

fn render(state: &AppState, template: &str, mut ctx: Context) -> Response {
    ctx.extend(base_context(state));
    match state.tera.render(template, &ctx) {
        Ok(html) => Html(html).into_response(),
        Err(e) => {
            tracing::error!("template render error for {template}: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "Template error").into_response()
        }
    }
}

// ── Page handlers ─────────────────────────────────────────────

async fn health() -> impl IntoResponse {
    "OK"
}

async fn page_index(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let mut ctx = Context::new();
    ctx.insert("page_title", "");
    render(&state, "pages/index.html", ctx)
}

async fn page_messages(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let mut ctx = Context::new();
    ctx.insert("page_title", "Conversations");
    render(&state, "pages/messages.html", ctx)
}

async fn page_messages_thread(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let mut ctx = Context::new();
    ctx.insert("page_title", "Message Thread");
    render(&state, "pages/messages-thread.html", ctx)
}

async fn page_profile(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let mut ctx = Context::new();
    ctx.insert("page_title", "My Profile");
    render(&state, "pages/profile.html", ctx)
}

async fn page_profile_view(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let mut ctx = Context::new();
    ctx.insert("page_title", "Profile");
    render(&state, "pages/profile-view.html", ctx)
}

async fn page_favourites(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let mut ctx = Context::new();
    ctx.insert("page_title", "Favourites");
    render(&state, "pages/favourites.html", ctx)
}

async fn page_settings(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let mut ctx = Context::new();
    ctx.insert("page_title", "Settings");
    render(&state, "pages/settings.html", ctx)
}

async fn page_admin(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let mut ctx = Context::new();
    ctx.insert("page_title", "Admin");
    render(&state, "pages/admin.html", ctx)
}

async fn page_donate(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let mut ctx = Context::new();
    ctx.insert("page_title", "Support bOOmbOOm.NOW!");
    render(&state, "pages/donate.html", ctx)
}

// ── Main ──────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    // ── Config ───────────────────────────────────────────
    let gateway_url = env::var("GATEWAY_URL").expect("GATEWAY_URL is required");
    let gateway_host =
        env::var("GATEWAY_ALLOWED_HOST").expect("GATEWAY_ALLOWED_HOST is required");
    let port: u16 = env::var("PORT")
        .unwrap_or_else(|_| "8080".into())
        .parse()
        .expect("PORT must be a number");
    let static_dir = env::var("STATIC_DIR").unwrap_or_else(|_| "./static".into());
    let templates_dir = env::var("TEMPLATES_DIR").unwrap_or_else(|_| "./templates".into());
    let asset_version = env::var("ASSET_VERSION").unwrap_or_else(|_| "0".into());

    validate_gateway_url(&gateway_url, &gateway_host);

    // ── Tera ─────────────────────────────────────────────
    let tera = Tera::new(&format!("{templates_dir}/**/*.html"))
        .unwrap_or_else(|e| panic!("failed to load templates from {templates_dir}: {e}"));

    let state = Arc::new(AppState {
        gateway_url: gateway_url.trim_end_matches('/').to_string(),
        http_client: reqwest::Client::new(),
        tera,
        asset_version,
    });

    // ── Routes ───────────────────────────────────────────
    let app = Router::new()
        // Health
        .route("/health", get(health))
        // API proxy — all methods
        .route("/api/{*rest}", any(proxy::proxy_api))
        // WebSocket proxy
        .route("/ws/{*rest}", get(proxy::proxy_ws))
        // Page routes
        .route("/", get(page_index))
        .route("/messages/", get(page_messages))
        .route("/messages/thread/", get(page_messages_thread))
        .route("/profile/", get(page_profile))
        .route("/profile/view/", get(page_profile_view))
        .route("/favourites/", get(page_favourites))
        .route("/settings/", get(page_settings))
        .route("/admin/", get(page_admin))
        .route("/donate/", get(page_donate))
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
