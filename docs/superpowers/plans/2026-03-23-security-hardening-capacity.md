# Security Hardening & Capacity Tuning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the app against forgery, IP-spoof bypass, and rate-limit circumvention; configure all services for 69 % load on Railway hardware (5 replicas × 8 vCPU / 8 GB RAM); fix SEC-1.2; document every tunable setting in the READMEs.

**Architecture:** All changes stay within existing service boundaries — no new components, no new crates. The in-process `FixedWindow` / `HashMap`-bucket pattern already used in the gateway and gateway WS layer is reused for the per-userId message rate in messages-service. JWT TTL is surfaced as a `UserTokenParams` field so callers (auth-service, users-service) control it from an env var.

**Tech Stack:** Rust / Axum 0.8, tower-http (cors), jsonwebtoken, tokio, MongoDB. No new dependencies required.

---

## Hardware reference (Railway)

| Unit | Spec |
|---|---|
| Max per service | 48 vCPU / 48 GB RAM |
| Replica size | 8 vCPU / 8 GB RAM |
| Max replicas | 5 |
| Storage | 5 GB |
| **Target utilisation** | **≤ 69 %** CPU, RAM, and storage |

**Multi-replica caveat:** `location-service` uses an in-process memory store. Multiple replicas will each hold a disjoint subset of users, breaking nearby queries. Run **exactly one replica** of location-service until T-20 DB-mode is implemented. All other services are stateless and safe to scale to 5 replicas.

---

## Files to modify

| File | Change |
|---|---|
| `services/common/src/auth.rs` | Add `ttl_secs: u64` to `UserTokenParams`; `issue_user_token` uses it instead of the constant |
| `services/auth-service/src/main.rs` | Read `JWT_USER_TTL_SECS` from env; thread into `AppState`; pass to all `issue_user_token` calls |
| `services/users-service/src/main.rs` | Same JWT TTL pattern; add `ttl_secs` param to `make_token` helper |
| `services/gateway/src/main.rs` | `real_ip()` checks `CF-Connecting-IP` first; `DefaultBodyLimit`; env-var-controlled rate limits; separate `lim_msg` per-IP for msg_send |
| `services/messages-service/src/main.rs` | Per-userId `FixedWindow` (closes SEC-1.2) |
| `services/gateway/README.md` | Document all new env vars + production table |
| `services/auth-service/README.md` | Document `JWT_USER_TTL_SECS` |
| `services/users-service/README.md` | Document `JWT_USER_TTL_SECS` |
| `services/messages-service/README.md` | Document `MSG_SEND_RATE_MAX` / `MSG_SEND_RATE_WINDOW_SECS` |
| `services/location-service/README.md` | Add production-recommended env var values |
| `services/common/README.md` | Document `UserTokenParams.ttl_secs` |
| `services/favourites-service/README.md` | Minor: mark permanent cache as "runtime lifetime" for clarity |

---

## Task 1 — common: make JWT user TTL a caller-controlled parameter

**Files:**
- Modify: `services/common/src/auth.rs`

This change removes the last hardcoded security constant from shared code and lets each calling service configure it via env.

- [ ] **Step 1 — Edit `UserTokenParams` to add `ttl_secs`**

  In `services/common/src/auth.rs`, add one field to the struct:

  ```rust
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
      pub ttl_secs:     u64,           // ← new
  }
  ```

- [ ] **Step 2 — Use `p.ttl_secs` in `issue_user_token`**

  Replace the `exp` line in `issue_user_token`:
  ```rust
  // Before:
  exp: now + USER_TOKEN_EXPIRY_SECS,
  // After:
  exp: now + p.ttl_secs,
  ```

  The constant `USER_TOKEN_EXPIRY_SECS` is now unused. Keep it as a doc comment default or remove it. Prefer keeping as:
  ```rust
  /// Default when no specific TTL is required. Pass via `UserTokenParams::ttl_secs`.
  pub const USER_TOKEN_EXPIRY_SECS: u64 = 7 * 24 * 3600; // 7 days — legacy default
  ```

- [ ] **Step 3 — Build `common` to confirm no compilation errors**

  ```bash
  cd /home/user/bbn/services && cargo build -p common 2>&1 | tail -5
  ```
  Expected: `warning: ...` (unused constant if kept), no `error:` lines.
  The callers (auth-service, users-service) will fail to compile because `ttl_secs` is not yet set — that is expected and will be fixed in Tasks 2 and 3.

---

## Task 2 — auth-service: read `JWT_USER_TTL_SECS`, pass to token calls

**Files:**
- Modify: `services/auth-service/src/main.rs`

- [ ] **Step 1 — Add `jwt_user_ttl_secs` to `Config`**

  ```rust
  struct Config {
      port:                    u16,
      jwt_secret:              String,
      service_secret:          String,
      mongo_uri:               String,
      db_name:                 String,
      admin_bootstrap_user_id: Option<String>,
      jwt_user_ttl_secs:       u64,   // ← new
  }
  ```

  In `Config::from_env()`, add inside the `Ok(Self { … })`:
  ```rust
  jwt_user_ttl_secs: env::var("JWT_USER_TTL_SECS")
      .ok()
      .and_then(|v| v.parse::<u64>().ok())
      .unwrap_or(86400), // 24 hours
  ```

- [ ] **Step 2 — Add `jwt_user_ttl_secs` to `AppState`**

  ```rust
  #[derive(Clone)]
  struct AppState {
      db:                 Database,
      jwt_secret:         String,
      service_secret:     String,
      jwt_user_ttl_secs:  u64,   // ← new
  }
  ```

  In `main()`, update the `AppState { … }` initialisation:
  ```rust
  let state = AppState {
      db,
      jwt_secret:        cfg.jwt_secret,
      service_secret:    cfg.service_secret,
      jwt_user_ttl_secs: cfg.jwt_user_ttl_secs,   // ← new
  };
  ```

- [ ] **Step 3 — Add `ttl_secs` to all `issue_user_token` calls**

  There are two calls — in `auth_register` (line ~302) and `auth_login` (line ~407).
  Both need the extra field:
  ```rust
  issue_user_token(UserTokenParams {
      sub:          /* ... */,
      // … all existing fields …
      ttl_secs:     state.jwt_user_ttl_secs,   // ← new
  }, &state.jwt_secret)
  ```

- [ ] **Step 4 — Build auth-service**

  ```bash
  cd /home/user/bbn/services && cargo build -p auth-service 2>&1 | tail -5
  ```
  Expected: no `error:` lines.

- [ ] **Step 5 — Commit**

  ```bash
  git add services/common/src/auth.rs services/auth-service/src/main.rs
  git commit -m "security: make user JWT TTL configurable via JWT_USER_TTL_SECS (default 24 h)"
  ```

---

## Task 3 — users-service: same JWT TTL pattern

**Files:**
- Modify: `services/users-service/src/main.rs`

- [ ] **Step 1 — Add `jwt_user_ttl_secs` to `Config` (if `Config` struct exists) or read it in `main()`**

  Check the users-service Config struct. Add the same field and env var read as Task 2, Step 1.

- [ ] **Step 2 — Add `jwt_user_ttl_secs` to `AppState` and thread through `main()`**

  (Same pattern as auth-service.)

- [ ] **Step 3 — Update `make_token` helper to accept `ttl_secs`**

  ```rust
  // Before:
  fn make_token(user: &UserForToken, secret: &str) -> Result<String, String> {
      issue_user_token(UserTokenParams { /* … */ }, secret)
          .map_err(|e| e.to_string())
  }

  // After:
  fn make_token(user: &UserForToken, secret: &str, ttl_secs: u64) -> Result<String, String> {
      issue_user_token(UserTokenParams { /* … */, ttl_secs }, secret)
          .map_err(|e| e.to_string())
  }
  ```

- [ ] **Step 4 — Update every `make_token(…)` call site** (there is one call at ~line 425):

  ```rust
  let token = match make_token(&u, &state.jwt_secret, state.jwt_user_ttl_secs) {
  ```

- [ ] **Step 5 — Build users-service**

  ```bash
  cd /home/user/bbn/services && cargo build -p users-service 2>&1 | tail -5
  ```

- [ ] **Step 6 — Commit**

  ```bash
  git add services/users-service/src/main.rs
  git commit -m "security: thread JWT_USER_TTL_SECS through users-service token issuer"
  ```

---

## Task 4 — messages-service: per-userId rate limit (fixes SEC-1.2)

**Files:**
- Modify: `services/messages-service/src/main.rs`

SEC-1.2: the gateway WS send-rate (10 msg/10 s per userId) is not mirrored on the messages-service HTTP endpoint. A valid JWT holder calling POST /messages/:id directly can send without bound.

- [ ] **Step 1 — Add imports at the top of the file** (most likely already present via `std::sync`; confirm `Instant` is in scope)

  ```rust
  use std::{
      collections::HashMap,
      sync::{Arc, Mutex},
      time::Instant,
      // … rest of existing use std items …
  };
  ```

- [ ] **Step 2 — Add `msg_send_rate_max`, `msg_send_rate_window`, `user_send_buckets` to `Config` and `AppState`**

  In `Config`:
  ```rust
  msg_send_rate_max:    u32,
  msg_send_rate_window: std::time::Duration,
  ```

  In `Config::from_env()`:
  ```rust
  msg_send_rate_max:    env::var("MSG_SEND_RATE_MAX")
                            .ok().and_then(|v| v.parse().ok()).unwrap_or(10),
  msg_send_rate_window: Duration::from_secs(
                            env::var("MSG_SEND_RATE_WINDOW_SECS")
                                .ok().and_then(|v| v.parse().ok()).unwrap_or(10)),
  ```

  In `AppState`:
  ```rust
  user_send_buckets:    Arc<Mutex<HashMap<String, (u32, Instant)>>>,
  msg_send_rate_max:    u32,
  msg_send_rate_window: Duration,
  ```

  In `main()` initialisation:
  ```rust
  let state = AppState {
      // … existing fields …
      user_send_buckets:    Arc::new(Mutex::new(HashMap::new())),
      msg_send_rate_max:    cfg.msg_send_rate_max,
      msg_send_rate_window: cfg.msg_send_rate_window,
  };
  ```

- [ ] **Step 3 — Add the rate-check block to `send_message`**, immediately after extracting `from_id` and before the block-check (keep the check early to fail fast):

  ```rust
  // ── Per-userId send-rate limit (mirrors WS rate; closes SEC-1.2) ──
  {
      let mut b   = state.user_send_buckets.lock().unwrap();
      let now     = Instant::now();
      let entry   = b.entry(from_id.clone()).or_insert((0, now));
      if now.duration_since(entry.1) >= state.msg_send_rate_window {
          *entry = (0, now);
      }
      if entry.0 >= state.msg_send_rate_max {
          return (
              StatusCode::TOO_MANY_REQUESTS,
              Json(json!({ "error": "Message rate limit exceeded. Slow down." })),
          ).into_response();
      }
      entry.0 += 1;
  }
  ```

  Exact insertion point: after the `from_id` assignment (`let from_id = &claims.sub;`) and after the `safe_object_id(from_id)` guard, but before the block-check query.

- [ ] **Step 4 — Build messages-service**

  ```bash
  cd /home/user/bbn/services && cargo build -p messages-service 2>&1 | tail -5
  ```

- [ ] **Step 5 — Commit**

  ```bash
  git add services/messages-service/src/main.rs
  git commit -m "security: per-userId send-rate limit in messages-service (fixes SEC-1.2)"
  ```

---

## Task 5 — gateway: `real_ip()`, body limit, configurable rate limits, `lim_msg`

**Files:**
- Modify: `services/gateway/src/main.rs`

This is the largest set of changes; all are localised to constants / config / two functions / the router setup.

### 5a — `real_ip()`: prefer `CF-Connecting-IP`

- [ ] **Replace the `real_ip` function body** (signature unchanged, so no call-site changes needed):

  ```rust
  fn real_ip(headers: &HeaderMap) -> IpAddr {
      // CF-Connecting-IP is set by Cloudflare and cannot be forged by the client.
      // It is absent when Cloudflare is not in front, so the fallback is safe.
      headers.get("cf-connecting-ip")
          .and_then(|v| v.to_str().ok())
          .and_then(|s| s.trim().parse().ok())
          .or_else(|| {
              headers.get("x-forwarded-for")
                  .and_then(|v| v.to_str().ok())
                  .and_then(|s| s.split(',').next())
                  .and_then(|s| s.trim().parse().ok())
          })
          .unwrap_or_else(|| IpAddr::from([127, 0, 0, 1]))
  }
  ```

### 5b — Body limit layer

- [ ] **Add `http_body_limit: usize` to `Config`**

  In `Config::from_env()`:
  ```rust
  http_body_limit: env::var("HTTP_BODY_LIMIT_BYTES")
      .ok().and_then(|v| v.parse().ok()).unwrap_or(32 * 1024), // 32 KB
  ```

- [ ] **Pass limit to the router**

  In `main()`, store the value before building `AppState`:
  ```rust
  let body_limit = cfg.http_body_limit;
  ```

  In the router builder, add the layer **after** `cors`:
  ```rust
  use axum::extract::DefaultBodyLimit;
  // …
  let app = Router::new()
      /* … all routes … */
      .layer(DefaultBodyLimit::max(body_limit))
      .layer(cors)
      .with_state(state);
  ```

  Note: `DefaultBodyLimit` should be added as the outermost layer so it applies before `cors`.

### 5c — Env-var configurable rate limits + `lim_msg`

- [ ] **Add fields to `Config` for each rate limit**

  ```rust
  struct Config {
      // … existing …
      rate_login_max:         u32,
      rate_login_window:      Duration,
      rate_register_max:      u32,
      rate_register_window:   Duration,
      rate_guest_max:         u32,
      rate_guest_window:      Duration,
      rate_api_max:           u32,
      rate_api_window:        Duration,
      rate_msg_max:           u32,   // per-IP limit specifically for msg_send
      rate_msg_window:        Duration,
  }
  ```

  In `Config::from_env()`, add (all after the existing fields):
  ```rust
  rate_login_max:         env::var("RATE_LOGIN_MAX").ok().and_then(|v| v.parse().ok()).unwrap_or(10),
  rate_login_window:      Duration::from_secs(env::var("RATE_LOGIN_WINDOW_SECS").ok().and_then(|v| v.parse().ok()).unwrap_or(900)),
  rate_register_max:      env::var("RATE_REGISTER_MAX").ok().and_then(|v| v.parse().ok()).unwrap_or(3),
  rate_register_window:   Duration::from_secs(env::var("RATE_REGISTER_WINDOW_SECS").ok().and_then(|v| v.parse().ok()).unwrap_or(3600)),
  rate_guest_max:         env::var("RATE_GUEST_MAX").ok().and_then(|v| v.parse().ok()).unwrap_or(20),
  rate_guest_window:      Duration::from_secs(env::var("RATE_GUEST_WINDOW_SECS").ok().and_then(|v| v.parse().ok()).unwrap_or(3600)),
  rate_api_max:           env::var("RATE_API_MAX").ok().and_then(|v| v.parse().ok()).unwrap_or(60),
  rate_api_window:        Duration::from_secs(env::var("RATE_API_WINDOW_SECS").ok().and_then(|v| v.parse().ok()).unwrap_or(60)),
  rate_msg_max:           env::var("RATE_MSG_MAX").ok().and_then(|v| v.parse().ok()).unwrap_or(20),
  rate_msg_window:        Duration::from_secs(env::var("RATE_MSG_WINDOW_SECS").ok().and_then(|v| v.parse().ok()).unwrap_or(60)),
  ```

- [ ] **Add `lim_msg` to `AppState`**

  ```rust
  struct AppState {
      // … existing …
      lim_msg: Arc<FixedWindow>,
  }
  ```

- [ ] **Replace hardcoded `FixedWindow::new(…)` calls in `main()`**

  ```rust
  lim_login:    FixedWindow::new(cfg.rate_login_max,    cfg.rate_login_window),
  lim_register: FixedWindow::new(cfg.rate_register_max, cfg.rate_register_window),
  lim_guest:    FixedWindow::new(cfg.rate_guest_max,    cfg.rate_guest_window),
  lim_api:      FixedWindow::new(cfg.rate_api_max,      cfg.rate_api_window),
  lim_msg:      FixedWindow::new(cfg.rate_msg_max,      cfg.rate_msg_window),
  ```

- [ ] **Update `msg_send` handler to use `lim_msg` instead of `lim_api`**

  ```rust
  async fn msg_send(State(s): State<AppState>, headers: HeaderMap, /* … */) -> impl IntoResponse {
      if !s.lim_msg.check(real_ip(&headers)) { return rate_limited(); }
      // … rest unchanged …
  }
  ```

- [ ] **Build gateway**

  ```bash
  cd /home/user/bbn/services && cargo build -p gateway 2>&1 | tail -5
  ```

- [ ] **Commit**

  ```bash
  git add services/gateway/src/main.rs
  git commit -m "security: CF-Connecting-IP, body limit, configurable rate limits, lim_msg for gateway"
  ```

---

## Task 6 — Update all READMEs

**Files:**
- `services/gateway/README.md`
- `services/auth-service/README.md`
- `services/users-service/README.md`
- `services/messages-service/README.md`
- `services/location-service/README.md`
- `services/common/README.md`
- `services/favourites-service/README.md` (minor)

### gateway/README.md

- [ ] **Rewrite fully.** New content:

  **Required env vars:** `JWT_SECRET`, `SERVICE_SECRET`, `AUTH_SERVICE_URL`, `USER_SERVICE_URL`, `LOC_SERVICE_URL`, `MSG_SERVICE_URL`, `FAV_SERVICE_URL`, `TIERS_SERVICE_URL`, `BLOCKS_SERVICE_URL`, `MIGRATION_SERVICE_URL`

  **Optional env vars:**

  | Variable | Default | Description |
  |---|---|---|
  | `PORT` | `3000` | Listening port |
  | `HTTP_BODY_LIMIT_BYTES` | `32768` | Max request body size (32 KB) |
  | `RATE_LOGIN_MAX` | `10` | Login attempts per IP per window |
  | `RATE_LOGIN_WINDOW_SECS` | `900` | Login rate window (15 min) |
  | `RATE_REGISTER_MAX` | `3` | Register attempts per IP per window |
  | `RATE_REGISTER_WINDOW_SECS` | `3600` | Register rate window (1 hr) |
  | `RATE_GUEST_MAX` | `20` | Guest auth per IP per window |
  | `RATE_GUEST_WINDOW_SECS` | `3600` | Guest rate window (1 hr) |
  | `RATE_API_MAX` | `60` | General API requests per IP per window |
  | `RATE_API_WINDOW_SECS` | `60` | API rate window (1 min) |
  | `RATE_MSG_MAX` | `20` | Message send (HTTP) per IP per window |
  | `RATE_MSG_WINDOW_SECS` | `60` | Message rate window (1 min) |

  **WebSocket (hardcoded):**

  | Setting | Value |
  |---|---|
  | Max message size | 4 096 bytes |
  | Send rate limit | 10 messages / 10 sec per userId |
  | Auth timeout | 3 sec |
  | Location min delta | 5 m |

  **IP detection:** `CF-Connecting-IP` is checked first (Cloudflare authoritative header); falls back to `X-Forwarded-For`. No env flag needed — when Cloudflare is not in front, `CF-Connecting-IP` is absent and the fallback is used automatically.

  **CORS:** Origin is hardcoded to `https://biffjezos.github.io`. Update the constant `ALLOWED_ORIGINS` in source for other domains.

  **Railway capacity note (5 replicas × 8 vCPU / 8 GB):** The gateway is stateless; all 5 replicas can run concurrently. Rate-limit buckets are in-process — each replica maintains its own. With Railway's load balancer distributing evenly, effective per-IP rate is `max × replicas` from a single client's perspective. Reduce the limit values accordingly if running multiple replicas (e.g. `RATE_LOGIN_MAX=2` with 5 replicas → effective 10/window).

### auth-service/README.md

- [ ] **Add** `JWT_USER_TTL_SECS` to the Optional section:

  | Variable | Default | Description |
  |---|---|---|
  | `JWT_USER_TTL_SECS` | `86400` | User JWT lifetime in seconds (24 h). Set higher for longer sessions, lower for tighter security |

  Keep existing rows unchanged.

### users-service/README.md

- [ ] **Add** `JWT_USER_TTL_SECS` (same description as auth-service above).

### messages-service/README.md

- [ ] **Add** to the Behaviour Settings table:

  | Setting | Default | Effect |
  |---|---|---|
  | `MSG_SEND_RATE_MAX` | `10` | Max HTTP sends per userId per window before 429 |
  | `MSG_SEND_RATE_WINDOW_SECS` | `10` | Rate window in seconds (matches WS send rate) |

### location-service/README.md

- [ ] **Add a "Production / Railway" section** with recommended values:

  ```
  ## Production — Railway (5 replicas × 8 vCPU / 8 GB, 69 % target)

  ⚠️  Run exactly ONE replica of location-service. The in-memory store is
  not shared across replicas. Multiple replicas will each see a different
  subset of users, breaking nearby queries. Scale out only after T-20
  DB-mode is implemented.

  Recommended env vars for a dense city deployment:

  | Variable | Recommended | Reason |
  |---|---|---|
  | LOCATION_SHARD_SIZE_M | 500 | Tighter shards for dense urban areas |
  | LOCATION_NEARBY_LIMIT | 200 | Keep responses lean; increase if UX demands |
  | LOCATION_TTL_SECS | 600 | 10 min — OK; reduce to 300 for fresher results |
  | LOCATION_UPDATE_INTERVAL_SECS | 20 | Reduce write pressure slightly |
  | LOCATION_UPDATE_DISTANCE_M | 50 | More responsive to small movements |
  | LOCATION_SWEEP_INTERVAL_SECS | 60 | More frequent stale-entry cleanup |
  ```

### common/README.md

- [ ] **Replace the empty file** with minimal content:

  ```markdown
  # common

  Shared Rust library used by all services.

  ## Contents

  - `auth.rs` — JWT issuing (`issue_user_token`, `issue_guest_token`), extractors (`AuthToken`, `RequireRegistered`, `ServiceToken`, `AdminUser`)
  - `geo.rs` — Haversine distance
  - `mongo.rs` — `safe_object_id` helper
  - `models.rs` — Shared DB document types (`BlockDoc`, `UserTv`)
  - `service_token.rs` — `ServiceTokenCache` (caches signed inter-service JWTs)
  - `shard.rs` — Shard-grid primitives for the location store

  ## `UserTokenParams`

  Used by `issue_user_token`. All callers must provide `ttl_secs`.
  Recommended default: `86400` (24 h). Old default was `604800` (7 days).

  | Field | Type | Notes |
  |---|---|---|
  | `ttl_secs` | `u64` | JWT lifetime in seconds. Read from `JWT_USER_TTL_SECS` in callers |
  ```

### favourites-service/README.md

- [ ] **Fix** the "permanent (runtime)" cache note to read:

  "Message radius cache: runtime lifetime — values fetched from tiers-service on first use and held until process restart. Restart the service to pick up tier-radius changes."

- [ ] **Commit all READMEs**

  ```bash
  git add services/*/README.md services/common/README.md
  git commit -m "docs: document all env vars, production capacity settings, and security changes"
  ```

---

## Task 7 — Build entire workspace to verify

- [ ] **Full build**

  ```bash
  cd /home/user/bbn/services && cargo build 2>&1 | grep -E "^error" | head -20
  ```

  Expected: no `error:` lines. Warnings are OK.

- [ ] **If any errors** — fix them before pushing. Common causes:
  - Missing `ttl_secs` in a `UserTokenParams` struct literal → add the field
  - `Instant` not imported in messages-service → add to the `use std::time::…` line
  - `DefaultBodyLimit` not in scope → add `use axum::extract::DefaultBodyLimit;`

- [ ] **Final commit and push**

  ```bash
  git add -A
  git status  # review — should only be docs/superpowers/plans/
  git push -u origin claude/add-tests-docs-NO8Oy
  ```

---

## Security findings resolved by this plan

| Finding | How fixed |
|---|---|
| SEC-1.2 — messages-service HTTP bypass | Per-userId `FixedWindow` in `send_message` |
| IP spoof via `X-Forwarded-For` (no ticket, found this session) | `real_ip()` prefers `CF-Connecting-IP` |
| Fixed-window burst opportunity (login, no ticket) | Defaults reduced; sliding-window upgrade deferred (no burst at the login rate of 10/15 min) |
| 7-day JWT exposure window (no ticket) | `JWT_USER_TTL_SECS` defaults to 24 h |
| 120 req/min homogeneous API limit too permissive for msg_send | Separate `lim_msg` limiter (20/min default) |
| Unbounded request bodies (no ticket) | `DefaultBodyLimit` (32 KB) |

## Still open (existing tickets)

| ID | Status |
|---|---|
| SEC-1.1 | Plain email + password in POST — blocked on OPAQUE. Not touched here. |

---

## New env vars summary (all services)

| Service | Variable | Default | Notes |
|---|---|---|---|
| auth-service | `JWT_USER_TTL_SECS` | `86400` | 24 h user JWT lifetime |
| users-service | `JWT_USER_TTL_SECS` | `86400` | Must match auth-service |
| messages-service | `MSG_SEND_RATE_MAX` | `10` | Per-userId per window |
| messages-service | `MSG_SEND_RATE_WINDOW_SECS` | `10` | Window in seconds |
| gateway | `HTTP_BODY_LIMIT_BYTES` | `32768` | Global body cap |
| gateway | `RATE_LOGIN_MAX` | `10` | ↓ from 20 |
| gateway | `RATE_LOGIN_WINDOW_SECS` | `900` | (15 min — same) |
| gateway | `RATE_REGISTER_MAX` | `3` | ↓ from 5 |
| gateway | `RATE_REGISTER_WINDOW_SECS` | `3600` | (same) |
| gateway | `RATE_GUEST_MAX` | `20` | ↓ from 40 |
| gateway | `RATE_GUEST_WINDOW_SECS` | `3600` | (same) |
| gateway | `RATE_API_MAX` | `60` | ↓ from 120 |
| gateway | `RATE_API_WINDOW_SECS` | `60` | (same) |
| gateway | `RATE_MSG_MAX` | `20` | New per-IP msg limiter |
| gateway | `RATE_MSG_WINDOW_SECS` | `60` | Window in seconds |
