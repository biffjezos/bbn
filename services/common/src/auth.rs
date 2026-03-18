/// JWT verification helpers shared across all services.
///
/// # Service token guard
/// Add `_: ServiceToken` as a handler parameter to require a valid
/// inter-service JWT on that route. The extractor reads `ServiceSecret`
/// from app state via `FromRef`. This is intentionally separate from
/// `JwtSecret` so the two secrets have independent rotation and blast radii.
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

// ── Shared secret newtypes ────────────────────────────────────────────────────

/// Wraps the user JWT secret so it can be extracted from app state via `FromRef`.
/// Each service's `AppState` must implement `FromRef<AppState> for JwtSecret`.
#[derive(Clone)]
pub struct JwtSecret(pub String);

/// Wraps the inter-service JWT secret so it can be extracted from app state via `FromRef`.
/// Kept separate from `JwtSecret` so the two secrets have independent blast radii.
/// Each service's `AppState` must implement `FromRef<AppState> for ServiceSecret`.
#[derive(Clone)]
pub struct ServiceSecret(pub String);

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
    ServiceSecret: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = (StatusCode, Json<serde_json::Value>);

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let ServiceSecret(secret) = ServiceSecret::from_ref(state);

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

// ── Admin user extractor ──────────────────────────────────────────────────────

/// Axum extractor for admin-only routes.
/// Reads `Authorization: Bearer <token>`, verifies signature, checks role == "admin".
/// Does NOT check tokenVersion — callers must do that themselves using the DB.
pub struct AdminUser(pub UserClaims);

impl<S> FromRequestParts<S> for AdminUser
where
    JwtSecret: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = (StatusCode, Json<serde_json::Value>);

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let JwtSecret(secret) = JwtSecret::from_ref(state);

        let raw = parts
            .headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");

        let token = raw
            .strip_prefix("Bearer ")
            .or_else(|| raw.strip_prefix("bearer "))
            .unwrap_or(raw)
            .trim();

        if token.is_empty() {
            return Err((
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": "No token provided." })),
            ));
        }

        let claims = decode_user_token(token, &secret).map_err(|_| (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "Token invalid or expired." })),
        ))?;

        if claims.role != "admin" {
            return Err((
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({ "error": "Admin access required.", "code": "ADMIN_REQUIRED" })),
            ));
        }

        Ok(AdminUser(claims))
    }
}

// ── User / guest token decode ─────────────────────────────────────────────────

/// Claims embedded in a user or guest JWT.
/// All fields beyond `sub` and `role` are optional — guest tokens only set sub/role.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserClaims {
    pub sub:          String,
    pub role:         String, // "user" | "admin" | "venue_manager" | "guest"
    pub tier:         Option<String>,
    pub tv:           Option<u32>,   // tokenVersion
    pub email:        Option<String>,
    pub nickname:     Option<String>,
    pub age:          Option<u32>,
    pub sex:          Option<String>,
    pub account_type: String,
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
    sub:          String,
    email:        String,
    nickname:     String,
    sex:          String,
    age:          Option<u32>,
    role:         String,
    tier:         String,
    tv:           u32,
    exp:          u64,
    iat:          u64,
    account_type: String,
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
    pub sub:          &'a str,
    pub email:        &'a str,
    pub nickname:     &'a str,
    pub sex:          &'a str,
    pub age:          Option<u32>,
    pub role:         &'a str,
    pub tier:         &'a str,
    pub tv:           u32,
    pub account_type: &'a str,
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
            sub:          p.sub.to_string(),
            email:        p.email.to_string(),
            nickname:     p.nickname.to_string(),
            sex:          p.sex.to_string(),
            age:          p.age,
            role:         p.role.to_string(),
            tier:         p.tier.to_string(),
            tv:           p.tv,
            exp:          now + USER_TOKEN_EXPIRY_SECS,
            iat:          now,
            account_type: p.account_type.to_string(),
        },
        &EncodingKey::from_secret(secret.as_bytes()),
    )
}

// ── RequireRegistered extractor ───────────────────────────────────────────────

/// Wraps [`AuthToken`] and additionally rejects guest tokens.
/// Use on routes that require a registered account (`role` == `"user"` or `"admin"`).
pub struct RequireRegistered(pub UserClaims);

impl<S> FromRequestParts<S> for RequireRegistered
where
    JwtSecret: FromRef<S>,
    mongodb::Database: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = (StatusCode, Json<serde_json::Value>);

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let AuthToken(claims) = AuthToken::from_request_parts(parts, state).await?;
        if !matches!(claims.role.as_str(), "user" | "admin" | "venue_manager") {
            return Err((
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({
                    "error": "Registered account required.",
                    "code":  "REGISTERED_REQUIRED"
                })),
            ));
        }
        Ok(RequireRegistered(claims))
    }
}

// ── AuthToken extractor (any role) ───────────────────────────────────────────

/// Axum extractor that accepts any valid JWT: guest, user, or admin.
///
/// For registered roles (`"user"`, `"admin"`) also verifies `tokenVersion` against
/// the DB, rejecting tokens that were invalidated by a password change or admin action.
///
/// Requires `JwtSecret` and `mongodb::Database` in app state (both via `FromRef`).
/// Each service's `AppState` must implement:
/// ```ignore
/// impl FromRef<AppState> for JwtSecret { ... }
/// impl FromRef<AppState> for mongodb::Database { ... }
/// ```
pub struct AuthToken(pub UserClaims);

impl<S> FromRequestParts<S> for AuthToken
where
    JwtSecret: FromRef<S>,
    mongodb::Database: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = (StatusCode, Json<serde_json::Value>);

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        use crate::models::UserTv;
        use crate::mongo::safe_object_id;
        use mongodb::bson::doc;

        let JwtSecret(secret) = JwtSecret::from_ref(state);
        let db = mongodb::Database::from_ref(state);

        let raw = parts
            .headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");

        let token = raw
            .strip_prefix("Bearer ")
            .or_else(|| raw.strip_prefix("bearer "))
            .unwrap_or(raw)
            .trim();

        if token.is_empty() {
            return Err((
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": "No token provided.", "code": "NO_TOKEN" })),
            ));
        }

        let claims = decode_user_token(token, &secret).map_err(|_| (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "Token invalid or expired.", "code": "TOKEN_INVALID" })),
        ))?;

        // Verify tokenVersion for registered users — rejects tokens invalidated by
        // password changes or admin role/tier changes.
        if matches!(claims.role.as_str(), "user" | "admin" | "venue_manager") {
            let oid = safe_object_id(&claims.sub).ok_or_else(|| (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": "Token revoked.", "code": "TOKEN_REVOKED" })),
            ))?;

            let user = db
                .collection::<UserTv>("users")
                .find_one(doc! { "_id": oid })
                .await
                .map_err(|_| (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": "Internal error." })),
                ))?
                .ok_or_else(|| (
                    StatusCode::UNAUTHORIZED,
                    Json(serde_json::json!({ "error": "Token revoked.", "code": "TOKEN_REVOKED" })),
                ))?;

            let db_tv = user.token_version.unwrap_or(0).max(0) as u32;
            if db_tv != claims.tv.unwrap_or(0) {
                return Err((
                    StatusCode::UNAUTHORIZED,
                    Json(serde_json::json!({ "error": "Token revoked.", "code": "TOKEN_REVOKED" })),
                ));
            }
        }

        Ok(AuthToken(claims))
    }
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
