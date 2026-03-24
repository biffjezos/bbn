// ── Identity guards ───────────────────────────────────────────────────────────
//
// `authority_guard` is the primary entry point: it calls authority-service,
// gets back a fully-verified identity (tokenVersion checked, features resolved),
// and returns it. Handlers can then check role or pass identity to proxy().
//
// `role_guard` is a thin helper for admin / manager routes.

use std::time::Duration;

use axum::{
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Json},
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    proxy::{auth_hdr, bad_gw, get_svc_token},
    AppState,
};

// ── Identity returned by /authority/verify ────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Radii {
    pub nearby_m:  u32,
    pub message_m: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct VerifyResponse {
    pub sub:          String,
    pub role:         String,
    pub account_type: String,
    pub tier:         String,
    pub tv:           u32,
    pub features:     Vec<String>,
    pub radii:        Radii,
}

// ── authority_guard ───────────────────────────────────────────────────────────

/// Call authority-service to verify the Bearer token and optionally enforce a
/// feature requirement. Returns the full verified identity on success.
pub async fn authority_guard(
    state:   &AppState,
    headers: &HeaderMap,
    feature: Option<&str>,
) -> Result<VerifyResponse, axum::response::Response> {
    let auth  = auth_hdr(headers);
    let token = auth.strip_prefix("Bearer ").unwrap_or(&auth).trim();
    if token.is_empty() {
        return Err((StatusCode::UNAUTHORIZED, Json(json!({ "error": "No token provided." }))).into_response());
    }

    let svc = match get_svc_token(state).await {
        Some(t) => t,
        None    => return Err(bad_gw()),
    };

    let mut body = json!({ "token": token });
    if let Some(f) = feature { body["feature"] = json!(f); }

    match state.http
        .post(format!("{}/authority/verify", state.authority_url))
        .header("X-Service-Token", &svc)
        .json(&body)
        .timeout(Duration::from_secs(3))
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => {
            r.json::<VerifyResponse>().await.map_err(|_| bad_gw())
        }
        Ok(r) => {
            let status = StatusCode::from_u16(r.status().as_u16()).unwrap_or(StatusCode::FORBIDDEN);
            let data   = r.json::<serde_json::Value>().await.unwrap_or(json!({}));
            Err((status, Json(data)).into_response())
        }
        Err(e) => { eprintln!("[gateway] authority_guard: {e}"); Err(bad_gw()) }
    }
}

// ── role_guard ────────────────────────────────────────────────────────────────

/// Returns an error response if the identity's role doesn't match `required`.
pub fn role_guard(identity: &VerifyResponse, required: &str) -> Option<axum::response::Response> {
    if identity.role != required {
        let (msg, code) = match required {
            "admin"         => ("Admin access required.",         "ADMIN_REQUIRED"),
            "venue_manager" => ("Venue manager role required.",   "MANAGER_REQUIRED"),
            _               => ("Insufficient role.",             "ROLE_REQUIRED"),
        };
        Some((StatusCode::FORBIDDEN, Json(json!({ "error": msg, "code": code }))).into_response())
    } else {
        None
    }
}
