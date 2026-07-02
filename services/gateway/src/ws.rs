// ── WebSocket handlers ────────────────────────────────────────────────────────

use std::{sync::{Arc, Mutex}, time::Duration};

use axum::{
    extract::{ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade}, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
};
use common::{auth::decode_user_token, geo::haversine_distance};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::sync::mpsc;

use crate::{
    proxy::get_svc_token,
    rate::{ws_check_send, SendBuckets},
    AppState,
};

const WS_MAX_BYTES:    usize    = 4096;
const WS_AUTH_TIMEOUT: Duration = Duration::from_millis(3_000);
const LOC_MIN_SEND_M:  f64      = 5.0;

// ── Helpers ───────────────────────────────────────────────────────────────────

fn ws_close(code: u16, reason: &'static str) -> Message {
    Message::Close(Some(CloseFrame { code, reason: reason.into() }))
}

fn ws_text(v: Value) -> Message {
    Message::Text(serde_json::to_string(&v).unwrap_or_default().into())
}

fn origin_ok(headers: &HeaderMap, allowed: &[String]) -> bool {
    headers.get("origin")
        .and_then(|v| v.to_str().ok())
        .map(|o| allowed.iter().any(|a| a == o))
        .unwrap_or(false)
}

/// Verify a user JWT via authority-service and enforce a feature requirement.
/// Returns the verified subject (userId) on success. Fails closed on any error
/// (network, revoked token, insufficient tier), so the WS is rejected unless the
/// account genuinely holds the feature — this is the tier gate the HTTP path
/// applies via `verified_proxy`, which the raw-JWT WS path previously skipped.
async fn verify_ws_feature(state: &AppState, token: &str, feature: &str) -> Option<String> {
    let svc = get_svc_token(state).await?;
    let resp = state.http
        .post(format!("{}/authority/verify", state.authority_url))
        .header("X-Service-Token", &svc)
        .json(&json!({ "token": token, "feature": feature }))
        .timeout(Duration::from_secs(3))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let body = resp.json::<Value>().await.ok()?;
    body["sub"].as_str().map(String::from)
}

// ── WebSocket — Location ──────────────────────────────────────────────────────

pub async fn ws_location(ws: WebSocketUpgrade, State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !origin_ok(&headers, &state.cors_origins) { return StatusCode::FORBIDDEN.into_response(); }
    ws.on_upgrade(move |socket| handle_loc_socket(socket, state))
}

async fn handle_loc_socket(socket: WebSocket, state: AppState) {
    let (ws_tx, mut ws_rx) = socket.split();
    let (tx, mut rx)       = mpsc::unbounded_channel::<Message>();

    let sender_task = tokio::spawn(async move {
        let mut ws_tx = ws_tx;
        while let Some(msg) = rx.recv().await {
            if ws_tx.send(msg).await.is_err() { break; }
        }
    });

    // Auth phase
    let raw = match tokio::time::timeout(WS_AUTH_TIMEOUT, ws_rx.next()).await {
        Ok(Some(Ok(Message::Text(s)))) => s,
        _ => { tx.send(ws_close(4001, "Auth timeout")).ok(); sender_task.abort(); return; }
    };
    let msg: Value = match serde_json::from_str(&raw) {
        Ok(v)  => v,
        Err(_) => { tx.send(ws_close(4001, "Bad auth")).ok(); sender_task.abort(); return; }
    };
    if msg["type"].as_str() != Some("auth") {
        tx.send(ws_close(4001, "Auth required")).ok(); sender_task.abort(); return;
    }
    let token = match msg["token"].as_str() {
        Some(t) if !t.is_empty() => t.to_string(),
        _ => { tx.send(ws_close(4001, "Auth required")).ok(); sender_task.abort(); return; }
    };
    if decode_user_token(&token, &state.jwt_secret).is_err() {
        tx.send(ws_close(4001, "Invalid token")).ok(); sender_task.abort(); return;
    }

    println!("[WS:loc] + connected");

    let last_pos:  Arc<Mutex<Option<(f64, f64, String)>>> = Arc::new(Mutex::new(None));
    let last_sent: Arc<Mutex<Option<(f64, f64)>>>          = Arc::new(Mutex::new(None));

    let lp  = last_pos.clone();
    let ls  = last_sent.clone();
    let st  = state.clone();
    let tok = token.clone();
    let ttx = tx.clone();

    let nearby_task = tokio::spawn(async move {
        let mut interval         = tokio::time::interval(Duration::from_secs(5));
        let mut last_nearby_hash = String::new();
        loop {
            interval.tick().await;
            let pos = lp.lock().unwrap().clone();
            let Some((lat, lon, ref acc)) = pos else { continue };
            let sent       = ls.lock().unwrap().clone();
            let needs_push = sent.map(|(slat, slon)| haversine_distance(slat, slon, lat, lon) >= LOC_MIN_SEND_M).unwrap_or(true);
            if needs_push {
                if let Some(svc) = get_svc_token(&st).await {
                    if let Ok(r) = st.http
                        .put(format!("{}/location", st.loc_url))
                        .header("X-Service-Token", &svc)
                        .header("Authorization", format!("Bearer {tok}"))
                        .json(&json!({ "lat": lat, "lon": lon, "accuracy": acc }))
                        .send().await
                    {
                        if r.status().is_success() { *ls.lock().unwrap() = Some((lat, lon)); }
                    }
                }
            }
            if let Some(svc) = get_svc_token(&st).await {
                if let Ok(r) = st.http
                    .get(format!("{}/location/nearby?lat={}&lon={}", st.loc_url, lat, lon))
                    .header("X-Service-Token", &svc)
                    .header("Authorization", format!("Bearer {tok}"))
                    .send().await
                {
                    if let Ok(data) = r.json::<Value>().await {
                        if let Some(users) = data["users"].as_array() {
                            let hash = serde_json::to_string(users).unwrap_or_default();
                            if hash != last_nearby_hash {
                                last_nearby_hash = hash;
                                ttx.send(ws_text(json!({ "type": "nearby", "users": users }))).ok();
                            }
                        }
                    }
                }
            }
        }
    });

    while let Some(Ok(msg)) = ws_rx.next().await {
        let raw = match &msg {
            Message::Text(s) if s.len() <= WS_MAX_BYTES => s.clone(),
            Message::Close(_) => break,
            _ => continue,
        };
        let Ok(m) = serde_json::from_str::<Value>(&raw) else { continue };
        if m["type"].as_str() == Some("position") {
            if let (Some(lat), Some(lon)) = (m["lat"].as_f64(), m["lon"].as_f64()) {
                let acc = m["accuracy"].as_str().unwrap_or("gps").to_string();
                *last_pos.lock().unwrap() = Some((lat, lon, acc.clone()));
                let sent  = last_sent.lock().unwrap().clone();
                let moved = sent.map(|(slat, slon)| haversine_distance(slat, slon, lat, lon) >= LOC_MIN_SEND_M).unwrap_or(true);
                if moved {
                    let st2  = state.clone();
                    let tok2 = token.clone();
                    let ls2  = last_sent.clone();
                    tokio::spawn(async move {
                        if let Some(svc) = get_svc_token(&st2).await {
                            if let Ok(r) = st2.http
                                .put(format!("{}/location", st2.loc_url))
                                .header("X-Service-Token", &svc)
                                .header("Authorization", format!("Bearer {tok2}"))
                                .json(&json!({ "lat": lat, "lon": lon, "accuracy": acc }))
                                .send().await
                            {
                                if r.status().is_success() { *ls2.lock().unwrap() = Some((lat, lon)); }
                            }
                        }
                    });
                }
            }
        }
    }

    nearby_task.abort();
    sender_task.abort();
    println!("[WS:loc] - disconnected");
    if let Some(svc) = get_svc_token(&state).await {
        let _ = state.http
            .delete(format!("{}/location", state.loc_url))
            .header("X-Service-Token", &svc)
            .header("Authorization", format!("Bearer {token}"))
            .send().await;
    }
}

// ── WebSocket — Messages ──────────────────────────────────────────────────────

pub async fn ws_messages(ws: WebSocketUpgrade, State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    if !origin_ok(&headers, &state.cors_origins) { return StatusCode::FORBIDDEN.into_response(); }
    ws.on_upgrade(move |socket| handle_msg_socket(socket, state))
}

async fn handle_msg_socket(socket: WebSocket, state: AppState) {
    let (ws_tx, mut ws_rx) = socket.split();
    let (tx, mut rx)       = mpsc::unbounded_channel::<Message>();

    let sender_task = tokio::spawn(async move {
        let mut ws_tx = ws_tx;
        while let Some(msg) = rx.recv().await {
            if ws_tx.send(msg).await.is_err() { break; }
        }
    });

    // Auth phase
    let raw = match tokio::time::timeout(WS_AUTH_TIMEOUT, ws_rx.next()).await {
        Ok(Some(Ok(Message::Text(s)))) => s,
        _ => { tx.send(ws_close(4001, "Auth timeout")).ok(); sender_task.abort(); return; }
    };
    let msg: Value = match serde_json::from_str(&raw) {
        Ok(v)  => v,
        Err(_) => { tx.send(ws_close(4001, "Bad auth")).ok(); sender_task.abort(); return; }
    };
    if msg["type"].as_str() != Some("auth") {
        tx.send(ws_close(4001, "Auth required")).ok(); sender_task.abort(); return;
    }
    let token = match msg["token"].as_str() {
        Some(t) if !t.is_empty() => t.to_string(),
        _ => { tx.send(ws_close(4001, "Auth required")).ok(); sender_task.abort(); return; }
    };
    // Enforce the same tier gate the HTTP messaging routes use (`message_online`).
    // authority-service also re-checks tokenVersion, so a revoked or downgraded
    // token cannot open a messaging socket.
    let user_id = match verify_ws_feature(&state, &token, "message_online").await {
        Some(sub) => sub,
        None => { tx.send(ws_close(4003, "Messaging unavailable for your account.")).ok(); sender_task.abort(); return; }
    };
    println!("[WS:msg] + {user_id}");

    let viewing: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));

    // List timer (3 s)
    let st  = state.clone();
    let tok = token.clone();
    let ttx = tx.clone();
    let list_task = tokio::spawn(async move {
        let mut interval       = tokio::time::interval(Duration::from_secs(3));
        let mut last_list_hash = String::new();
        push_list(&st, &tok, &ttx, &mut last_list_hash).await;
        loop { interval.tick().await; push_list(&st, &tok, &ttx, &mut last_list_hash).await; }
    });

    // Thread timer (2 s)
    let st2      = state.clone();
    let tok2     = token.clone();
    let ttx2     = tx.clone();
    let viewing2 = viewing.clone();
    let thread_task = tokio::spawn(async move {
        let mut interval         = tokio::time::interval(Duration::from_secs(2));
        let mut last_thread_hash = String::new();
        let mut last_viewing_uid = None::<String>;
        loop {
            interval.tick().await;
            let cur = viewing2.lock().unwrap().clone();
            if cur != last_viewing_uid { last_thread_hash = String::new(); last_viewing_uid = cur.clone(); }
            let Some(ref uid) = cur else { continue };
            push_thread(&st2, &tok2, uid, &ttx2, &mut last_thread_hash).await;
        }
    });

    while let Some(Ok(msg)) = ws_rx.next().await {
        let raw = match &msg {
            Message::Text(s) if s.len() <= WS_MAX_BYTES => s.clone(),
            Message::Close(_) => break,
            _ => continue,
        };
        let Ok(m) = serde_json::from_str::<Value>(&raw) else { continue };
        match m["type"].as_str() {
            Some("view") => {
                let new_uid = m["userId"].as_str().filter(|s| !s.is_empty()).map(String::from);
                *viewing.lock().unwrap() = new_uid.clone();
                if let Some(ref uid) = new_uid {
                    let st3  = state.clone();
                    let tok3 = token.clone();
                    let ttx3 = tx.clone();
                    let uid3 = uid.clone();
                    tokio::spawn(async move {
                        let mut h = String::new();
                        push_thread(&st3, &tok3, &uid3, &ttx3, &mut h).await;
                    });
                }
            }
            Some("send") => {
                if let (Some(to), Some(text)) = (m["toUserId"].as_str(), m["text"].as_str()) {
                    if !ws_check_send(&state.send_buckets, &user_id) {
                        tx.send(ws_text(json!({ "type": "send:error", "error": "Rate limit exceeded. Please wait a moment." }))).ok();
                        continue;
                    }
                    let st3  = state.clone();
                    let tok3 = token.clone();
                    let ttx3 = tx.clone();
                    let to3  = to.to_string();
                    let txt3 = text.to_string();
                    let uid3 = user_id.clone();
                    let cur_view = viewing.lock().unwrap().clone();
                    tokio::spawn(async move {
                        println!("[WS:send] {uid3} -> {to3}");
                        if let Some(svc) = get_svc_token(&st3).await {
                            match st3.http
                                .post(format!("{}/messages/{}", st3.msg_url, to3))
                                .header("X-Service-Token", &svc)
                                .header("Authorization", format!("Bearer {tok3}"))
                                .json(&json!({ "text": txt3 }))
                                .send().await
                            {
                                Ok(r) if r.status().is_success() => {
                                    if cur_view.as_deref() == Some(&to3) {
                                        let mut h = String::new();
                                        push_thread(&st3, &tok3, &to3, &ttx3, &mut h).await;
                                    }
                                }
                                Ok(r) => {
                                    let err = r.json::<Value>().await.unwrap_or(json!({}));
                                    ttx3.send(ws_text(json!({ "type": "send:error", "error": err["error"].as_str().unwrap_or("Failed to send message.") }))).ok();
                                }
                                Err(e) => {
                                    eprintln!("[WS:send] fetch failed: {e}");
                                    ttx3.send(ws_text(json!({ "type": "send:error", "error": "Could not reach messaging service." }))).ok();
                                }
                            }
                        }
                    });
                }
            }
            _ => {}
        }
    }

    list_task.abort();
    thread_task.abort();
    sender_task.abort();
    println!("[WS:msg] - {user_id}");
}

async fn push_list(state: &AppState, token: &str, tx: &mpsc::UnboundedSender<Message>, last_hash: &mut String) {
    let Some(svc) = get_svc_token(state).await else { return };
    let Ok(resp)  = state.http
        .get(format!("{}/messages", state.msg_url))
        .header("X-Service-Token", &svc)
        .header("Authorization", format!("Bearer {token}"))
        .send().await else { return };
    let Ok(data) = resp.json::<Value>().await else { return };
    let hash = serde_json::to_string(&data["messages"]).unwrap_or_default();
    if hash == *last_hash { return }
    *last_hash = hash;
    tx.send(ws_text(json!({ "type": "conversations", "messages": data["messages"] }))).ok();
}

async fn push_thread(state: &AppState, token: &str, uid: &str, tx: &mpsc::UnboundedSender<Message>, last_hash: &mut String) {
    let Some(svc) = get_svc_token(state).await else { return };
    let Ok(resp)  = state.http
        .get(format!("{}/messages/{}", state.msg_url, uid))
        .header("X-Service-Token", &svc)
        .header("Authorization", format!("Bearer {token}"))
        .send().await else { return };
    let Ok(data) = resp.json::<Value>().await else { return };
    let hash = serde_json::to_string(&data["messages"]).unwrap_or_default();
    if hash == *last_hash { return }
    *last_hash = hash;
    tx.send(ws_text(json!({ "type": "thread", "userId": uid, "messages": data["messages"] }))).ok();
}
