// ── Rate limiting + health cache ──────────────────────────────────────────────

use std::{
    collections::HashMap,
    net::IpAddr,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use serde_json::Value;

// ── Per-IP fixed-window rate limiter ─────────────────────────────────────────

pub struct FixedWindow {
    pub max:     u32,
    pub window:  Duration,
    buckets: Mutex<HashMap<IpAddr, (u32, Instant)>>,
}

impl FixedWindow {
    pub fn new(max: u32, window: Duration) -> Arc<Self> {
        Arc::new(Self { max, window, buckets: Mutex::new(HashMap::new()) })
    }

    pub fn check(&self, ip: IpAddr) -> bool {
        let mut b   = self.buckets.lock().unwrap();
        let now     = Instant::now();
        let entry   = b.entry(ip).or_insert((0, now));
        if now.duration_since(entry.1) >= self.window { *entry = (0, now); }
        if entry.0 >= self.max { return false; }
        entry.0 += 1;
        true
    }
}

/// A rate limiter whose max/window can be swapped at runtime without losing
/// state continuity. Handlers read the inner `Arc<FixedWindow>` under a
/// short-lived read lock; the background-refresh task replaces it under a
/// write lock when admin_settings change.
pub type LiveLimiter = Arc<std::sync::RwLock<Arc<FixedWindow>>>;

pub fn live_lim(max: u32, window: Duration) -> LiveLimiter {
    Arc::new(std::sync::RwLock::new(FixedWindow::new(max, window)))
}

pub fn check_lim(lim: &LiveLimiter, ip: IpAddr) -> bool {
    lim.read().unwrap().check(ip)
}

// ── Per-userId WS send buckets ────────────────────────────────────────────────

pub type SendBuckets = Arc<Mutex<HashMap<String, (u32, Instant)>>>;

pub const WS_SEND_LIMIT:  u32      = 10;
pub const WS_SEND_WINDOW: Duration = Duration::from_millis(10_000);

pub fn ws_check_send(buckets: &SendBuckets, user_id: &str) -> bool {
    let mut b   = buckets.lock().unwrap();
    let now     = Instant::now();
    let entry   = b.entry(user_id.to_string()).or_insert((0, now));
    if now.duration_since(entry.1) >= WS_SEND_WINDOW { *entry = (0, now); }
    entry.0 += 1;
    entry.0 <= WS_SEND_LIMIT
}

// ── Health cache (30 s TTL) ───────────────────────────────────────────────────

pub struct HealthCache {
    pub body:       Value,
    pub status:     u16,
    pub expires_at: Instant,
}

pub const HEALTH_CACHE_TTL: Duration = Duration::from_secs(30);
