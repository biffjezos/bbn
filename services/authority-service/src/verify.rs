// ── POST /authority/verify ────────────────────────────────────────────────────
//
// The central identity-resolution endpoint consumed by the gateway.
// Verifies the JWT, checks tokenVersion, resolves tier features + radii,
// and optionally enforces a feature requirement.
//
// Request  (X-Service-Token required):
//   { "token": "<bearer JWT>", "feature": "<optional feature name>" }
//
// Response 200:
//   { sub, role, account_type, tier, tv, features: [...], radii: { nearby_m, message_m } }
//
// Response 401 / 403 on invalid token, revoked token, or insufficient tier.

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::post,
    Router,
};
use common::{auth::{decode_user_token, ServiceToken}, mongo::safe_object_id};
use mongodb::bson::doc;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    tiers::{can, features_for_tier, load_tiers, FEATURES},
    AppState,
};

#[derive(Deserialize)]
pub struct VerifyBody {
    pub token:   String,
    pub feature: Option<String>,
}

#[derive(Serialize)]
pub struct VerifyResponse {
    pub sub:          String,
    pub role:         String,
    pub account_type: String,
    pub tier:         String,
    pub tv:           u32,
    pub features:     Vec<String>,
    pub radii:        Radii,
}

#[derive(Serialize)]
pub struct Radii {
    pub nearby_m:  u32,
    pub message_m: Option<u32>,
}

pub async fn authority_verify(
    _: ServiceToken,
    State(state): State<AppState>,
    Json(body): Json<VerifyBody>,
) -> impl IntoResponse {
    // ── 1. Decode JWT ─────────────────────────────────────────────────────────
    let claims = match decode_user_token(&body.token, &state.jwt_secret) {
        Ok(c)  => c,
        Err(_) => return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Token invalid or expired.", "code": "TOKEN_INVALID" }))).into_response(),
    };

    // ── 2. tokenVersion check for registered users ───────────────────────────
    if matches!(claims.role.as_str(), "user" | "admin" | "venue_manager") {
        let Some(oid) = safe_object_id(&claims.sub) else {
            return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Token revoked.", "code": "TOKEN_REVOKED" }))).into_response();
        };
        let user = state.db
            .collection::<mongodb::bson::Document>("users")
            .find_one(doc! { "_id": oid })
            .projection(doc! { "tokenVersion": 1 })
            .await;
        let db_tv = match user {
            Ok(Some(u)) => u.get_i32("tokenVersion").unwrap_or(0) as u32,
            Ok(None)    => return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Token revoked.", "code": "TOKEN_REVOKED" }))).into_response(),
            Err(e)      => { eprintln!("[authority/verify] db: {e}"); return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Internal error." }))).into_response(); }
        };
        if db_tv != claims.tv.unwrap_or(0) {
            return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Token revoked.", "code": "TOKEN_REVOKED" }))).into_response();
        }
    }

    let tier = claims.tier.as_deref().unwrap_or("guest").to_string();
    let tv   = claims.tv.unwrap_or(0);

    // ── 3. Feature check (optional) ───────────────────────────────────────────
    if let Some(ref feature) = body.feature {
        if !can(&tier, feature) {
            let min_tier = FEATURES.get(feature.as_str()).map_or("unknown", |f| f.min_tier);
            return (StatusCode::FORBIDDEN, Json(json!({
                "error":    format!("This feature requires the '{min_tier}' tier or above."),
                "yourTier": tier,
                "required": min_tier,
                "code":     "TIER_REQUIRED",
            }))).into_response();
        }
    }

    // ── 4. Resolve tier data ──────────────────────────────────────────────────
    let tiers    = load_tiers(&state.tiers_cache, &state.db).await;
    let (nearby_m, message_m) = tiers.get(&tier)
        .map(|t| (t.nearby_radius_m, t.message_radius_m))
        .unwrap_or((500, None));

    Json(VerifyResponse {
        sub:          claims.sub,
        role:         claims.role,
        account_type: claims.account_type,
        tier,
        tv,
        features:     features_for_tier(claims.tier.as_deref().unwrap_or("guest")),
        radii:        Radii { nearby_m, message_m },
    }).into_response()
}

// ── Router ────────────────────────────────────────────────────────────────────

pub fn router() -> Router<AppState> {
    Router::new().route("/authority/verify", post(authority_verify))
}
