/// JWT verification helpers shared across all services.
///
/// # Service token guard
/// Add `_: ServiceToken` as a handler parameter to require a valid
/// inter-service JWT on that route. The extractor reads `JwtSecret`
/// from app state via `FromRef`.
///
/// # User token decode
/// Call `decode_user_token(raw, secret)` to decode a user/guest JWT.
/// The token-version DB check is service-specific and NOT done here.
use axum::{
    extract::{FromRef, FromRequestParts},
    http::{request::Parts, StatusCode},
    response::Json,
};
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};

// ── Shared secret newtype ─────────────────────────────────────────────────────

/// Wraps the JWT secret so it can be extracted from app state via `FromRef`.
/// Each service's `AppState` must implement `FromRef<AppState> for JwtSecret`.
#[derive(Clone)]
pub struct JwtSecret(pub String);

// ── Service token extractor ───────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServiceClaims {
    pub sub:  String,
    pub role: String,
}

/// Axum extractor that validates the `X-Service-Token` header.
/// Rejects with 401/403 if the token is missing, invalid, or not a service token.
pub struct ServiceToken(pub ServiceClaims);

impl<S> FromRequestParts<S> for ServiceToken
where
    JwtSecret: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = (StatusCode, Json<serde_json::Value>);

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let JwtSecret(secret) = JwtSecret::from_ref(state);

        let raw = parts
            .headers
            .get("x-service-token")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");

        // Strip optional "Bearer " prefix (case-insensitive, like the JS)
        let token = raw
            .strip_prefix("Bearer ")
            .or_else(|| raw.strip_prefix("bearer "))
            .unwrap_or(raw)
            .trim();

        if token.is_empty() {
            return Err((
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": "No service token." })),
            ));
        }

        let claims = decode::<ServiceClaims>(
            token,
            &DecodingKey::from_secret(secret.as_bytes()),
            &Validation::new(Algorithm::HS256),
        )
        .map_err(|_| {
            (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": "Service token invalid or expired." })),
            )
        })?
        .claims;

        if claims.role != "service" {
            return Err((
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({ "error": "Not a service token." })),
            ));
        }

        Ok(ServiceToken(claims))
    }
}

// ── User / guest token decode ─────────────────────────────────────────────────

/// Claims embedded in a user or guest JWT.
/// All fields beyond `sub` and `role` are optional — guest tokens only set sub/role.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserClaims {
    pub sub:      String,
    pub role:     String, // "user" | "guest"
    pub tier:     Option<String>,
    pub tv:       Option<u32>,   // tokenVersion
    pub nickname: Option<String>,
    pub age:      Option<u32>,
    pub sex:      Option<String>,
}

/// Decode and validate (signature + expiry) a user/guest JWT.
/// Does NOT check tokenVersion — services must do that themselves.
pub fn decode_user_token(
    token: &str,
    secret: &str,
) -> Result<UserClaims, jsonwebtoken::errors::Error> {
    Ok(decode::<UserClaims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::new(Algorithm::HS256),
    )?
    .claims)
}
