// ── HTTP route handlers ───────────────────────────────────────────────────────
//
// All handlers follow one of three patterns:
//
//   1. Public proxy  — no auth, just rate-limit + proxy.
//   2. Auth proxy    — verified_proxy() handles authority check + header inject.
//   3. Role-gated    — authority_guard() + role_guard() + proxy() with identity.
//
// Tier-gated routes pass the required feature name to verified_proxy().

use std::{sync::Mutex, time::Instant};

use axum::{
    body::Bytes,
    extract::{RawQuery, State},
    http::{HeaderMap, Method, StatusCode},
    response::{IntoResponse, Json},
};
use serde_json::json;

use crate::{
    guards::{authority_guard, role_guard},
    proxy::{auth_hdr, bad_gw, proxy, rate_limited, real_ip, verified_proxy},
    rate::{check_lim, HealthCache, HEALTH_CACHE_TTL},
    AppState,
};

// ── Health ────────────────────────────────────────────────────────────────────

pub async fn health_gateway() -> impl IntoResponse {
    let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis();
    Json(json!({ "ok": true, "ts": ts }))
}

pub async fn health_api(State(state): State<AppState>) -> impl IntoResponse {
    let now = Instant::now();
    {
        let cache = state.health_cache.lock().unwrap();
        if let Some(ref c) = *cache {
            if c.expires_at > now {
                let status = StatusCode::from_u16(c.status).unwrap_or(StatusCode::OK);
                return (status, Json(c.body.clone())).into_response();
            }
        }
    }
    let services = [
        ("authority", format!("{}/health", state.authority_url)),
        ("users",     format!("{}/health", state.user_url)),
        ("location",  format!("{}/health", state.loc_url)),
        ("messages",  format!("{}/health", state.msg_url)),
        ("favourites",format!("{}/health", state.fav_url)),
        ("blocks",    format!("{}/health", state.blocks_url)),
    ];
    let futs: Vec<_> = services.iter().map(|(name, url)| {
        let http = state.http.clone();
        let url  = url.clone();
        let name = *name;
        async move {
            match http.get(&url).timeout(std::time::Duration::from_secs(3)).send().await {
                Ok(r) if r.status().is_success() => (name, "ok"),
                Ok(_)                             => (name, "degraded"),
                Err(_)                            => (name, "down"),
            }
        }
    }).collect();
    let results = futures_util::future::join_all(futs).await;
    let mut statuses = std::collections::HashMap::new();
    for (name, s) in results { statuses.insert(name, s); }
    let all_ok = statuses.values().all(|s| *s == "ok");
    let ts     = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis();
    let body   = json!({ "ok": all_ok, "services": statuses, "ts": ts });
    let status = if all_ok { 200u16 } else { 503u16 };
    if all_ok {
        let mut cache = state.health_cache.lock().unwrap();
        *cache = Some(HealthCache { body: body.clone(), status, expires_at: now + HEALTH_CACHE_TTL });
    }
    (StatusCode::from_u16(status).unwrap(), Json(body)).into_response()
}

// ── Auth (public — no authority check needed) ─────────────────────────────────

pub async fn auth_guest(State(s): State<AppState>, headers: HeaderMap, body: Bytes) -> impl IntoResponse {
    if !check_lim(&s.lim_guest, real_ip(&headers)) { return rate_limited(); }
    proxy(&s, Method::POST, format!("{}/auth/guest", s.authority_url), auth_hdr(&headers), Some(body), None).await
}
pub async fn auth_register_start(State(s): State<AppState>, headers: HeaderMap, body: Bytes) -> impl IntoResponse {
    if !check_lim(&s.lim_register, real_ip(&headers)) { return rate_limited(); }
    proxy(&s, Method::POST, format!("{}/auth/register/start", s.authority_url), auth_hdr(&headers), Some(body), None).await
}
pub async fn auth_register_finish(State(s): State<AppState>, headers: HeaderMap, body: Bytes) -> impl IntoResponse {
    if !check_lim(&s.lim_register, real_ip(&headers)) { return rate_limited(); }
    proxy(&s, Method::POST, format!("{}/auth/register/finish", s.authority_url), auth_hdr(&headers), Some(body), None).await
}
pub async fn auth_login_start(State(s): State<AppState>, headers: HeaderMap, body: Bytes) -> impl IntoResponse {
    if !check_lim(&s.lim_login, real_ip(&headers)) { return rate_limited(); }
    proxy(&s, Method::POST, format!("{}/auth/login/start", s.authority_url), auth_hdr(&headers), Some(body), None).await
}
pub async fn auth_login_finish(State(s): State<AppState>, headers: HeaderMap, body: Bytes) -> impl IntoResponse {
    if !check_lim(&s.lim_login, real_ip(&headers)) { return rate_limited(); }
    proxy(&s, Method::POST, format!("{}/auth/login/finish", s.authority_url), auth_hdr(&headers), Some(body), None).await
}

// ── Users ─────────────────────────────────────────────────────────────────────

pub async fn users_get_me(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    verified_proxy(&s, &headers, Method::GET, format!("{}/users/me", s.user_url), None, None).await
}
pub async fn users_put_me(State(s): State<AppState>, headers: HeaderMap, body: Bytes) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    verified_proxy(&s, &headers, Method::PUT, format!("{}/users/me", s.user_url), Some(body), None).await
}
pub async fn users_delete_me(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    verified_proxy(&s, &headers, Method::DELETE, format!("{}/users/me", s.user_url), None, None).await
}
pub async fn users_get_keys(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    verified_proxy(&s, &headers, Method::GET, format!("{}/users/me/keys", s.user_url), None, None).await
}
pub async fn users_put_keys(State(s): State<AppState>, headers: HeaderMap, body: Bytes) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    verified_proxy(&s, &headers, Method::PUT, format!("{}/users/me/keys", s.user_url), Some(body), None).await
}
pub async fn users_get_preferences(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    verified_proxy(&s, &headers, Method::GET, format!("{}/users/me/preferences", s.user_url), None, None).await
}
pub async fn users_put_preferences(State(s): State<AppState>, headers: HeaderMap, body: Bytes) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    verified_proxy(&s, &headers, Method::PUT, format!("{}/users/me/preferences", s.user_url), Some(body), None).await
}
pub async fn users_pw_change_start(State(s): State<AppState>, headers: HeaderMap, body: Bytes) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    verified_proxy(&s, &headers, Method::POST, format!("{}/users/me/password/start", s.user_url), Some(body), None).await
}
pub async fn users_pw_change_finish(State(s): State<AppState>, headers: HeaderMap, body: Bytes) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    verified_proxy(&s, &headers, Method::POST, format!("{}/users/me/password/finish", s.user_url), Some(body), None).await
}
pub async fn users_search(State(s): State<AppState>, headers: HeaderMap, RawQuery(q): RawQuery) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    let qs = q.unwrap_or_default();
    verified_proxy(&s, &headers, Method::GET, format!("{}/users/search?{}", s.user_url, qs), None, None).await
}
pub async fn users_profile(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(uid): axum::extract::Path<String>) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    verified_proxy(&s, &headers, Method::GET, format!("{}/users/{}/profile", s.user_url, uid), None, None).await
}

// ── Location ──────────────────────────────────────────────────────────────────

pub async fn loc_put(State(s): State<AppState>, headers: HeaderMap, body: Bytes) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    verified_proxy(&s, &headers, Method::PUT, format!("{}/location", s.loc_url), Some(body), None).await
}
pub async fn loc_delete(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    verified_proxy(&s, &headers, Method::DELETE, format!("{}/location", s.loc_url), None, None).await
}
pub async fn loc_nearby(State(s): State<AppState>, headers: HeaderMap, RawQuery(q): RawQuery) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    let qs = q.unwrap_or_default();
    verified_proxy(&s, &headers, Method::GET, format!("{}/location/nearby?{}", s.loc_url, qs), None, None).await
}

// ── Messages (tier-gated: message_online) ────────────────────────────────────

pub async fn msg_list(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    verified_proxy(&s, &headers, Method::GET, format!("{}/messages", s.msg_url), None, Some("message_online")).await
}
pub async fn msg_thread(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(uid): axum::extract::Path<String>) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    verified_proxy(&s, &headers, Method::GET, format!("{}/messages/{}", s.msg_url, uid), None, Some("message_online")).await
}
pub async fn msg_send(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(uid): axum::extract::Path<String>, body: Bytes) -> impl IntoResponse {
    if !check_lim(&s.lim_api,  real_ip(&headers)) { return rate_limited(); }
    if !check_lim(&s.lim_msg,  real_ip(&headers)) { return rate_limited(); }  // SEC-1.6: dedicated msg limiter
    verified_proxy(&s, &headers, Method::POST, format!("{}/messages/{}", s.msg_url, uid), Some(body), Some("message_online")).await
}
pub async fn msg_delete(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(id): axum::extract::Path<String>) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    verified_proxy(&s, &headers, Method::DELETE, format!("{}/messages/{}", s.msg_url, id), None, Some("message_online")).await
}

// ── Tiers (public info — no auth needed) ──────────────────────────────────────

pub async fn tiers_nearby_radius(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(tier): axum::extract::Path<String>) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    proxy(&s, Method::GET, format!("{}/tiers/radius/nearby/{}", s.authority_url, tier), auth_hdr(&headers), None, None).await
}
pub async fn tiers_msg_radius(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(tier): axum::extract::Path<String>) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    proxy(&s, Method::GET, format!("{}/tiers/radius/message/{}", s.authority_url, tier), auth_hdr(&headers), None, None).await
}
pub async fn tiers_info(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(tier): axum::extract::Path<String>) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    proxy(&s, Method::GET, format!("{}/tiers/{}/info", s.authority_url, tier), auth_hdr(&headers), None, None).await
}

// ── Favourites (tier-gated: manage_favourites) ────────────────────────────────

pub async fn fav_list(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    verified_proxy(&s, &headers, Method::GET, format!("{}/favourites", s.fav_url), None, Some("manage_favourites")).await
}
pub async fn fav_is_mutual(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(uid): axum::extract::Path<String>) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    verified_proxy(&s, &headers, Method::GET, format!("{}/favourites/is-mutual/{}", s.fav_url, uid), None, Some("manage_favourites")).await
}
pub async fn fav_add(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(uid): axum::extract::Path<String>, body: Bytes) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    verified_proxy(&s, &headers, Method::POST, format!("{}/favourites/{}", s.fav_url, uid), Some(body), Some("manage_favourites")).await
}
pub async fn fav_remove(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(uid): axum::extract::Path<String>) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    verified_proxy(&s, &headers, Method::DELETE, format!("{}/favourites/{}", s.fav_url, uid), None, Some("manage_favourites")).await
}

// ── Blocks ────────────────────────────────────────────────────────────────────

pub async fn blocks_list(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    verified_proxy(&s, &headers, Method::GET, format!("{}/blocks", s.blocks_url), None, None).await
}
pub async fn blocks_add(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(uid): axum::extract::Path<String>, body: Bytes) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    verified_proxy(&s, &headers, Method::POST, format!("{}/blocks/{}", s.blocks_url, uid), Some(body), None).await
}
pub async fn blocks_remove(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(uid): axum::extract::Path<String>) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    verified_proxy(&s, &headers, Method::DELETE, format!("{}/blocks/{}", s.blocks_url, uid), None, None).await
}

// ── Notifications ─────────────────────────────────────────────────────────────

pub async fn notif_list(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    verified_proxy(&s, &headers, Method::GET, format!("{}/notifications", s.fav_url), None, None).await
}
pub async fn notif_delete(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(id): axum::extract::Path<String>) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    verified_proxy(&s, &headers, Method::DELETE, format!("{}/notifications/{}", s.fav_url, id), None, None).await
}

// ── Admin (role-gated: admin) ─────────────────────────────────────────────────

async fn admin_guard_then<F, Fut>(s: &AppState, headers: &HeaderMap, f: F) -> axum::response::Response
where
    F: FnOnce(crate::guards::VerifyResponse) -> Fut,
    Fut: std::future::Future<Output = axum::response::Response>,
{
    let id = match authority_guard(s, headers, None).await { Ok(id) => id, Err(e) => return e };
    if let Some(e) = role_guard(&id, "admin") { return e; }
    f(id).await
}

pub async fn admin_get_settings(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    admin_guard_then(&s, &headers, |id| proxy(&s, Method::GET, format!("{}/admin/settings", s.user_url), auth_hdr(&headers), None, Some(id))).await
}
pub async fn admin_put_setting(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(key): axum::extract::Path<String>, body: Bytes) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    admin_guard_then(&s, &headers, |id| proxy(&s, Method::PUT, format!("{}/admin/settings/{}", s.user_url, key), auth_hdr(&headers), Some(body), Some(id))).await
}
pub async fn admin_users(State(s): State<AppState>, headers: HeaderMap, RawQuery(q): RawQuery) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    let qs = q.unwrap_or_default();
    admin_guard_then(&s, &headers, |id| proxy(&s, Method::GET, format!("{}/admin/users?{}", s.user_url, qs), auth_hdr(&headers), None, Some(id))).await
}
pub async fn admin_get_config(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    admin_guard_then(&s, &headers, |id| proxy(&s, Method::GET, format!("{}/admin/config", s.user_url), auth_hdr(&headers), None, Some(id))).await
}
pub async fn admin_patch_user(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(uid): axum::extract::Path<String>, body: Bytes) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    admin_guard_then(&s, &headers, |id| proxy(&s, Method::PATCH, format!("{}/admin/users/{}", s.user_url, uid), auth_hdr(&headers), Some(body), Some(id))).await
}
pub async fn admin_patch_tier(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(uid): axum::extract::Path<String>, body: Bytes) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    admin_guard_then(&s, &headers, |id| proxy(&s, Method::PATCH, format!("{}/admin/users/{}/tier", s.user_url, uid), auth_hdr(&headers), Some(body), Some(id))).await
}
pub async fn admin_patch_role(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(uid): axum::extract::Path<String>, body: Bytes) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    admin_guard_then(&s, &headers, |id| proxy(&s, Method::PATCH, format!("{}/admin/users/{}/role", s.user_url, uid), auth_hdr(&headers), Some(body), Some(id))).await
}
pub async fn admin_patch_venue_manager(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(uid): axum::extract::Path<String>, body: Bytes) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    admin_guard_then(&s, &headers, |id| proxy(&s, Method::PATCH, format!("{}/admin/venues/{}/manager", s.user_url, uid), auth_hdr(&headers), Some(body), Some(id))).await
}
pub async fn admin_tiers_list(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    admin_guard_then(&s, &headers, |id| proxy(&s, Method::GET, format!("{}/admin/tiers", s.authority_url), auth_hdr(&headers), None, Some(id))).await
}
pub async fn admin_tiers_post(State(s): State<AppState>, headers: HeaderMap, body: Bytes) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    admin_guard_then(&s, &headers, |id| proxy(&s, Method::POST, format!("{}/admin/tiers", s.authority_url), auth_hdr(&headers), Some(body), Some(id))).await
}
pub async fn admin_tiers_put(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(name): axum::extract::Path<String>, body: Bytes) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    admin_guard_then(&s, &headers, |id| proxy(&s, Method::PUT, format!("{}/admin/tiers/{}", s.authority_url, name), auth_hdr(&headers), Some(body), Some(id))).await
}
pub async fn admin_tiers_delete(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(name): axum::extract::Path<String>) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    admin_guard_then(&s, &headers, |id| proxy(&s, Method::DELETE, format!("{}/admin/tiers/{}", s.authority_url, name), auth_hdr(&headers), None, Some(id))).await
}

// ── Manager (role-gated: venue_manager) ───────────────────────────────────────

async fn manager_guard_then<F, Fut>(s: &AppState, headers: &HeaderMap, f: F) -> axum::response::Response
where
    F: FnOnce(crate::guards::VerifyResponse) -> Fut,
    Fut: std::future::Future<Output = axum::response::Response>,
{
    let id = match authority_guard(s, headers, None).await { Ok(id) => id, Err(e) => return e };
    if let Some(e) = role_guard(&id, "venue_manager") { return e; }
    f(id).await
}

pub async fn manager_venues_list(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    manager_guard_then(&s, &headers, |id| proxy(&s, Method::GET, format!("{}/manager/venues", s.user_url), auth_hdr(&headers), None, Some(id))).await
}
pub async fn manager_venues_post(State(s): State<AppState>, headers: HeaderMap, body: Bytes) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    manager_guard_then(&s, &headers, |id| proxy(&s, Method::POST, format!("{}/manager/venues", s.user_url), auth_hdr(&headers), Some(body), Some(id))).await
}
pub async fn manager_venue_put(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(uid): axum::extract::Path<String>, body: Bytes) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    manager_guard_then(&s, &headers, |id| proxy(&s, Method::PUT, format!("{}/manager/venues/{}", s.user_url, uid), auth_hdr(&headers), Some(body), Some(id))).await
}
pub async fn manager_venue_delete(State(s): State<AppState>, headers: HeaderMap, axum::extract::Path(uid): axum::extract::Path<String>) -> impl IntoResponse {
    if !check_lim(&s.lim_api, real_ip(&headers)) { return rate_limited(); }
    manager_guard_then(&s, &headers, |id| proxy(&s, Method::DELETE, format!("{}/manager/venues/{}", s.user_url, uid), auth_hdr(&headers), None, Some(id))).await
}
