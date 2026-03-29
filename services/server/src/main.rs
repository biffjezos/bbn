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
//   PORT        — listen port (default 8080)
//   STATIC_DIR  — path to static assets (default ./static)
// ============================================================

mod proxy;

use std::{env, sync::Arc};

use axum::{
    response::IntoResponse,
    routing::{any, get},
    Router,
};
use tower_http::services::{ServeDir, ServeFile};

pub struct AppState {
    pub gateway_url: String,
    pub http_client: reqwest::Client,
}

async fn health() -> impl IntoResponse {
    "OK"
}

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

    validate_gateway_url(&gateway_url, &gateway_host);

    let state = Arc::new(AppState {
        gateway_url: gateway_url.trim_end_matches('/').to_string(),
        http_client: reqwest::Client::new(),
    });

    // ── Routes ───────────────────────────────────────────
    let app = Router::new()
        // Health
        .route("/health", get(health))
        // API proxy — all methods
        .route("/api/{*rest}", any(proxy::proxy_api))
        // WebSocket proxy
        .route("/ws/{*rest}", get(proxy::proxy_ws))
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
