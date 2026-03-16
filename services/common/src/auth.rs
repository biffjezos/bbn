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
///
/// # Token issuing
/// `issue_user_token` and `issue_guest_token` are used by auth-service
/// (and users-service when ported) to sign JWTs.
use axum::{
    extract::{FromRef, FromRequestParts},
    http::{request::Parts, StatusCode},
    response::Json,
};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

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
    pub role:     String, // "user" | "admin" | "guest"
    pub tier:     Option<String>,
    pub tv:       Option<u32>,   // tokenVersion
    pub email:    Option<String>,
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

// ── Token issuing ─────────────────────────────────────────────────────────────

const USER_TOKEN_EXPIRY_SECS:  u64 = 7 * 24 * 3600; // 7 days
const GUEST_TOKEN_EXPIRY_SECS: u64 = 15 * 60;        // 15 minutes

#[derive(Serialize)]
struct IssuedUserClaims {
    sub:      String,
    email:    String,
    nickname: String,
    sex:      String,
    age:      Option<u32>,
    role:     String,
    tier:     String,
    tv:       u32,
    exp:      u64,
    iat:      u64,
}

#[derive(Serialize)]
struct IssuedGuestClaims {
    sub:  String,
    role: String,
    tier: String,
    exp:  u64,
    iat:  u64,
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

pub struct UserTokenParams<'a> {
    pub sub:      &'a str,
    pub email:    &'a str,
    pub nickname: &'a str,
    pub sex:      &'a str,
    pub age:      Option<u32>,
    pub role:     &'a str,
    pub tier:     &'a str,
    pub tv:       u32,
}

/// Sign a user JWT. `role` is typically `"user"` or `"admin"`.
pub fn issue_user_token(
    p: UserTokenParams<'_>,
    secret: &str,
) -> Result<String, jsonwebtoken::errors::Error> {
    let now = now_unix();
    encode(
        &Header::new(Algorithm::HS256),
        &IssuedUserClaims {
            sub:      p.sub.to_string(),
            email:    p.email.to_string(),
            nickname: p.nickname.to_string(),
            sex:      p.sex.to_string(),
            age:      p.age,
            role:     p.role.to_string(),
            tier:     p.tier.to_string(),
            tv:       p.tv,
            exp:      now + USER_TOKEN_EXPIRY_SECS,
            iat:      now,
        },
        &EncodingKey::from_secret(secret.as_bytes()),
    )
}

/// Sign a guest JWT.
pub fn issue_guest_token(
    guest_id: &str,
    secret: &str,
) -> Result<String, jsonwebtoken::errors::Error> {
    let now = now_unix();
    encode(
        &Header::new(Algorithm::HS256),
        &IssuedGuestClaims {
            sub:  guest_id.to_string(),
            role: "guest".to_string(),
            tier: "guest".to_string(),
            exp:  now + GUEST_TOKEN_EXPIRY_SECS,
            iat:  now,
        },
        &EncodingKey::from_secret(secret.as_bytes()),
    )
}
