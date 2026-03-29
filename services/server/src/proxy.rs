// ============================================================
// server — reverse proxy for /api/* and /ws/*
//
// Pure pass-through: no auth logic, no request transformation,
// no response modification. See specs/services/server/proxy.yaml.
// ============================================================

use axum::{
    body::Body,
    extract::{ws::WebSocketUpgrade, OriginalUri, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;

use crate::AppState;

/// Hop-by-hop headers that must not be forwarded.
const HOP_HEADERS: &[&str] = &[
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "host",
];

// ── HTTP proxy ───────────────────────────────────────────

pub async fn proxy_api(
    State(state): State<Arc<AppState>>,
    original_uri: OriginalUri,
    req: axum::extract::Request,
) -> Response {
    let path_and_query = original_uri
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or(original_uri.path());

    let url = format!("{}{}", state.gateway_url, path_and_query);
    let method = req.method().clone();
    let headers = req.headers().clone();

    let body = match axum::body::to_bytes(req.into_body(), 10 * 1024 * 1024).await {
        Ok(b) => b,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };

    let Ok(rq_method) = reqwest::Method::from_bytes(method.as_str().as_bytes()) else {
        return StatusCode::BAD_REQUEST.into_response();
    };

    let mut proxy_req = state.http_client.request(rq_method, &url);

    for (name, value) in headers.iter() {
        if HOP_HEADERS.contains(&name.as_str()) {
            continue;
        }
        proxy_req = proxy_req.header(name.as_str(), value.as_bytes());
    }

    if !body.is_empty() {
        proxy_req = proxy_req.body(body);
    }

    match proxy_req.send().await {
        Ok(resp) => {
            let status =
                StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
            let resp_headers = resp.headers().clone();
            let body = resp.bytes().await.unwrap_or_default();

            let mut builder = Response::builder().status(status);
            for (name, value) in resp_headers.iter() {
                if HOP_HEADERS.contains(&name.as_str()) {
                    continue;
                }
                builder = builder.header(name, value);
            }
            builder
                .body(Body::from(body))
                .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
        }
        Err(e) => {
            tracing::error!("proxy error: {e}");
            StatusCode::BAD_GATEWAY.into_response()
        }
    }
}

// ── WebSocket proxy ──────────────────────────────────────

pub async fn proxy_ws(
    State(state): State<Arc<AppState>>,
    original_uri: OriginalUri,
    ws: WebSocketUpgrade,
) -> Response {
    let path_and_query = original_uri
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or(original_uri.path());

    let upstream_url = format!(
        "{}{}",
        state
            .gateway_url
            .replace("http://", "ws://")
            .replace("https://", "wss://"),
        path_and_query,
    );

    ws.on_upgrade(|socket| tunnel_ws(socket, upstream_url))
}

async fn tunnel_ws(client: axum::extract::ws::WebSocket, upstream_url: String) {
    use axum::extract::ws::Message as AMsg;
    use tokio_tungstenite::tungstenite::Message as TMsg;

    let upstream = match tokio_tungstenite::connect_async(&upstream_url).await {
        Ok((ws, _)) => ws,
        Err(e) => {
            tracing::error!("WS upstream connect failed: {e}");
            return;
        }
    };

    let (mut client_tx, mut client_rx) = client.split();
    let (mut up_tx, mut up_rx) = upstream.split();

    let client_to_upstream = async {
        while let Some(Ok(msg)) = client_rx.next().await {
            let t = match msg {
                AMsg::Text(s) => TMsg::Text(s.to_string().into()),
                AMsg::Binary(b) => TMsg::Binary(b.to_vec().into()),
                AMsg::Ping(p) => TMsg::Ping(p.to_vec().into()),
                AMsg::Pong(p) => TMsg::Pong(p.to_vec().into()),
                AMsg::Close(_) => return,
            };
            if up_tx.send(t).await.is_err() {
                return;
            }
        }
    };

    let upstream_to_client = async {
        while let Some(Ok(msg)) = up_rx.next().await {
            let a = match msg {
                TMsg::Text(s) => AMsg::Text(s.to_string().into()),
                TMsg::Binary(b) => AMsg::Binary(b.to_vec().into()),
                TMsg::Ping(p) => AMsg::Ping(p.to_vec().into()),
                TMsg::Pong(p) => AMsg::Pong(p.to_vec().into()),
                TMsg::Close(_) => return,
                _ => continue,
            };
            if client_tx.send(a).await.is_err() {
                return;
            }
        }
    };

    tokio::select! {
        _ = client_to_upstream => {}
        _ = upstream_to_client => {}
    }
}
