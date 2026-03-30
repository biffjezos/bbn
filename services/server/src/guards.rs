// ============================================================
// bOOmbOOm.NOW! — server route guards
//
// Reads the `bbn_tok` cookie, validates the JWT (HS256), and
// returns an AuthContext for template injection.
//
// Guard functions return Err(redirect) on auth failure so
// page handlers can early-return without boilerplate.
// ============================================================

use axum::{
    http::HeaderMap,
    response::{IntoResponse, Redirect, Response},
};
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};

// ── JWT claims ────────────────────────────────────────────────

/// Subset of user JWT claims the server needs for guards and SSR context.
/// Must match the claims issued by the gateway (common::auth::UserClaims).
#[derive(Debug, Serialize, Deserialize)]
pub struct UserClaims {
    pub sub:      String,
    pub role:     String, // "user" | "admin" | "venue_manager" | "guest"
    pub tier:     Option<String>,
    pub nickname: Option<String>,
    pub sex:      Option<String>,
    pub exp:      u64,
}

// ── Template-facing auth context ──────────────────────────────

/// Auth fields injected into every Tera template context.
/// Use `AuthContext::guest()` for unauthenticated / public pages.
#[derive(Debug)]
pub struct AuthContext {
    pub is_logged_in: bool,
    pub nickname:     Option<String>,
    pub tier:         Option<String>,
    pub role:         Option<String>,
    pub sex:          Option<String>,
}

impl AuthContext {
    pub fn guest() -> Self {
        Self {
            is_logged_in: false,
            nickname:     None,
            tier:         None,
            role:         None,
            sex:          None,
        }
    }
}

// ── Cookie helpers ────────────────────────────────────────────

/// Extract the value of a named cookie from the `Cookie` request header.
fn extract_cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    let raw = headers.get("cookie")?.to_str().ok()?;
    raw.split(';').find_map(|part| {
        let part = part.trim();
        let (k, v) = part.split_once('=')?;
        if k.trim() == name {
            Some(v.trim().to_owned())
        } else {
            None
        }
    })
}

/// Decode and validate the `bbn_tok` cookie JWT.
/// Returns None if the cookie is absent, the signature is invalid, or the token is expired.
fn decode_bbn_tok(headers: &HeaderMap, jwt_secret: &str) -> Option<UserClaims> {
    let token = extract_cookie(headers, "bbn_tok")?;
    let mut validation = Validation::new(Algorithm::HS256);
    validation.validate_exp = true;
    decode::<UserClaims>(
        &token,
        &DecodingKey::from_secret(jwt_secret.as_bytes()),
        &validation,
    )
    .ok()
    .map(|td| td.claims)
}

// ── Public API ────────────────────────────────────────────────

/// Read the bbn_tok cookie and return an AuthContext.
/// Always succeeds — falls back to `AuthContext::guest()` if the cookie is
/// absent, invalid, or expired.
pub fn check_auth(headers: &HeaderMap, jwt_secret: &str) -> AuthContext {
    match decode_bbn_tok(headers, jwt_secret) {
        Some(c) => AuthContext {
            is_logged_in: true,
            nickname:     c.nickname,
            tier:         c.tier,
            role:         Some(c.role),
            sex:          c.sex,
        },
        None => AuthContext::guest(),
    }
}

/// Guard: require a valid JWT with role in [user, admin, venue_manager].
/// Returns `Err(302 → /)` if the cookie is missing, expired, or role is wrong.
pub fn require_user(headers: &HeaderMap, jwt_secret: &str) -> Result<AuthContext, Response> {
    let ctx = check_auth(headers, jwt_secret);
    if ctx.is_logged_in
        && matches!(
            ctx.role.as_deref(),
            Some("user") | Some("admin") | Some("venue_manager")
        )
    {
        Ok(ctx)
    } else {
        Err(Redirect::to("/").into_response())
    }
}

/// Guard: require a valid JWT with role == admin.
/// Returns `Err(302 → /)` otherwise.
pub fn require_admin(headers: &HeaderMap, jwt_secret: &str) -> Result<AuthContext, Response> {
    let ctx = check_auth(headers, jwt_secret);
    if ctx.is_logged_in && ctx.role.as_deref() == Some("admin") {
        Ok(ctx)
    } else {
        Err(Redirect::to("/").into_response())
    }
}
