// ── Proxy + common response helpers ──────────────────────────────────────────

use std::net::IpAddr;

use axum::{
    body::Bytes,
    http::{header, HeaderMap, Method, StatusCode},
    response::{IntoResponse, Json},
};
use serde_json::{json, Value};

use crate::{guards::VerifyResponse, AppState};

// ── Common responses ──────────────────────────────────────────────────────────

pub fn rate_limited() -> axum::response::Response {
    (StatusCode::TOO_MANY_REQUESTS, Json(json!({ "error": "Too many requests." }))).into_response()
}

pub fn bad_gw() -> axum::response::Response {
    (StatusCode::BAD_GATEWAY, Json(json!({ "error": "Service unavailable." }))).into_response()
}

// ── Header helpers ────────────────────────────────────────────────────────────

pub fn real_ip(headers: &HeaderMap) -> IpAddr {
    // Prefer CF-Connecting-IP (SEC-1.3): Cloudflare sets this to the true client IP.
    // X-Forwarded-For fallback: take the LAST entry — that is the hop appended by
    // our own edge proxy. The first entry is client-supplied and spoofable, which
    // would let one client rotate fake IPs to bypass the per-IP rate limits.
    headers.get("cf-connecting-ip")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.trim().parse().ok())
        .or_else(|| {
            headers.get("x-forwarded-for")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.split(',').next_back())
                .and_then(|s| s.trim().parse().ok())
        })
        .unwrap_or_else(|| IpAddr::from([127, 0, 0, 1]))
}

pub fn auth_hdr(headers: &HeaderMap) -> String {
    headers.get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string()
}

// ── Service token ─────────────────────────────────────────────────────────────

pub async fn get_svc_token(state: &AppState) -> Option<String> {
    state.svc_token_cache.get("gateway", &state.service_secret).await.ok()
}

// ── Core proxy ────────────────────────────────────────────────────────────────
//
// When `identity` is Some, X-Auth-* headers are injected so downstream
// services can read the pre-verified identity without decoding the JWT or
// hitting the DB themselves (AuthedByGateway extractor in common).

pub async fn proxy(
    state:    &AppState,
    method:   Method,
    url:      String,
    auth:     String,
    body:     Option<Bytes>,
    identity: Option<VerifyResponse>,
) -> axum::response::Response {
    // SSRF guard — reject any URL not rooted at a known internal service.
    let allowed = [
        &state.authority_url, &state.user_url, &state.loc_url,
        &state.msg_url, &state.fav_url, &state.blocks_url, &state.migration_url,
    ];
    if !allowed.iter().any(|base| url.starts_with(base.as_str())) {
        eprintln!("[gateway] proxy: rejected non-internal URL: {url}");
        return bad_gw();
    }

    let token = match get_svc_token(state).await {
        Some(t) => t,
        None    => return bad_gw(),
    };

    let mut req = state.http
        .request(method, &url)
        .header("X-Service-Token", &token)
        .header("Authorization",   &auth)
        .header("Content-Type",    "application/json");

    if let Some(ref id) = identity {
        req = req
            .header("X-Auth-Sub",          &id.sub)
            .header("X-Auth-Role",         &id.role)
            .header("X-Auth-Account-Type", &id.account_type)
            .header("X-Auth-Tier",         &id.tier)
            .header("X-Auth-TV",           id.tv.to_string())
            .header("X-Auth-Features",     serde_json::to_string(&id.features).unwrap_or_default())
            .header("X-Auth-Radii",        serde_json::to_string(&id.radii).unwrap_or_default());
    }

    if let Some(b) = body { req = req.body(b); }

    match req.send().await {
        Ok(resp) => {
            let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
            match resp.json::<Value>().await {
                Ok(data) => (status, Json(data)).into_response(),
                Err(_)   => (status, Json(json!({}))).into_response(),
            }
        }
        Err(e) => { eprintln!("[gateway] proxy: {e}"); bad_gw() }
    }
}

/// Convenience: verify identity via authority-service, then proxy with
/// X-Auth-* headers injected. Used by all authenticated routes.
pub async fn verified_proxy(
    state:   &AppState,
    headers: &HeaderMap,
    method:  Method,
    url:     String,
    body:    Option<Bytes>,
    feature: Option<&str>,
) -> axum::response::Response {
    use crate::guards::authority_guard;
    let identity = match authority_guard(state, headers, feature).await {
        Ok(id) => id,
        Err(e) => return e,
    };
    proxy(state, method, url, auth_hdr(headers), body, Some(identity)).await
}
