# bOOmbOOm.NOW! — Security Audit

**Last updated:** 2026-03-23
**Concern:** Security only.

---

## Open Items

### SEC-1.1 Plain password and email in POST request

***Note:*** added by project owner (12 March 2026)

```json
[API] → POST https://boom.up.railway.app/api/auth/login
{
    email: '{plain email address}',
    password: '{plain password}',
    guestId: '{guest id}'
}
```

Found in `/ui/scripts/api.js`:

```js
login({ email, password, guestId }) {
    return apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, guestId }),
    });
  },
```

The eMail address and password should be hashed right after they are entered in the text field (account creation, login modal). On account creation the eMail should be hashed like the password, sent and stored in the db. No unencrypted/unhashed communication between client and server.

Target solution: OPAQUE / PAKE. `opaque-ke` (Rust) is production-ready; no equivalent exists for JS. Implementing OPAQUE before the auth-service Rust port (T-04b) would require a full re-implementation once the port lands — T-04b is now complete but OPAQUE was explicitly deferred during the port.

**Sequencing decision (2026-03-16):** Implement OPAQUE in `auth-service` (Rust). Unblocks this ticket and T-05b (encrypted block note). Also resolve items in AUDIT.md 6.1/6.3 before contemplating this ticket.

**Implementation plan approved (2026-03-23):** See T-23 in TICKETS.md. WASM approach confirmed. No migration — users collection wiped. Two new required env vars: `EMAIL_PEPPER`, `OPAQUE_SERVER_SETUP`.

**Priority:** HIGH — T-23 ready to implement.

---

### SEC-1.2 Gateway send-rate limit bypassable at messages-service level

**File:** `services/gateway/src/main.rs` (`_wsSendCounts`), `services/messages-service/src/main.rs`

The per-user send rate (10 msg / 10 s) is enforced only at the WebSocket layer in the gateway. The messages-service HTTP endpoint has no independent rate limit. A client with a valid JWT hitting the HTTP endpoint directly (or via multiple tabs) can exceed the per-user budget. messages-service needs its own per-userId in-memory rate check.

**Priority:** MEDIUM — T-05 blocking is live which reduces abuse risk, but the HTTP bypass remains.

---

### SEC-1.3 `real_ip()` trusts a spoofable header

**File:** `services/gateway/src/main.rs:167`

`real_ip()` reads the first entry of `X-Forwarded-For`. Without Cloudflare in front any client can inject any value into this header, bypassing the per-IP rate limits entirely. Once Cloudflare is deployed the authoritative header is `CF-Connecting-IP`, which the client cannot forge.

**Fix (T-21):** Rewrite `real_ip()` to check `CF-Connecting-IP` first, fall back to `X-Forwarded-For` when that header is absent. No env flag needed — the header is simply absent when Cloudflare is not in front.

**Priority:** MEDIUM

---

### SEC-1.4 User JWT TTL is 7 days (hardcoded)

**File:** `services/common/src/auth.rs:189`

`USER_TOKEN_EXPIRY_SECS = 7 * 24 * 3600`. A stolen JWT is valid for up to 7 days. The `tokenVersion` mechanism can invalidate it early only if the owner changes their password — a silent theft is undetected. `tokenVersion` does NOT auto-increment on logout.

**Fix (T-21):** Add `ttl_secs: u64` to `UserTokenParams`; callers read `JWT_USER_TTL_SECS` from env (default 86 400 — 24 h). Does not require a refresh-token mechanism.

**Priority:** MEDIUM

---

### SEC-1.5 No request body size limit in gateway

**File:** `services/gateway/src/main.rs`

Axum's default body limit is 2 MB. There is no explicit cap. A client can send arbitrarily large payloads to any endpoint, potentially exhausting RAM or causing slow reads. Legitimate payloads are at most a few KB (E2EE message ~6 KB, auth bodies ~200 bytes).

**Fix (T-21):** Add `DefaultBodyLimit::max(HTTP_BODY_LIMIT_BYTES)` layer to the gateway router (default 32 KB).

**Priority:** LOW

---

### SEC-1.6 `msg_send` shares the general API rate bucket

**File:** `services/gateway/src/main.rs`

`POST /api/messages/:id` uses `lim_api` (120 req/min per IP), identical to profile reads and other low-risk endpoints. This allows 120 message-send attempts per minute per IP while the WS path allows only 10 per 10 seconds.

**Fix (T-21):** Add a dedicated `lim_msg` limiter for `msg_send` (default 20/min per IP).

**Priority:** LOW

---

### SEC-1.7 CWE-918 SSRF — JWT sub interpolated raw into internal service URLs

**File:** `services/messages-service/src/main.rs` (previously lines 341, 372)

**Flagged by:** GitHub CodeQL (commit `037735f2`)

`claims.sub` (JWT token subject, set by the user) was validated with `safe_object_id()` but the original raw string — not the validated output — was then interpolated directly into internal HTTP URLs (`fav_service_url` and `loc_service_url` path segments). CodeQL's taint analysis correctly identified that the raw string still flowed into the URL despite the guard, as the sanitized ObjectId was discarded.

**Fix applied (2026-03-23):** Changed the validation block to capture the parsed `ObjectId`, then use `.to_hex()` at every URL interpolation point. The URL components now derive from a structured Rust type rather than the raw JWT string.

**Priority:** MEDIUM — internal services only, but defence-in-depth requires this to be clean.

---

### SEC-1.8 Panic on NaN in location sort (`partial_cmp().unwrap()`)

**File:** `services/location-service/src/store.rs` (previously lines 280, 293, 311, 328)

Four `sort_unstable_by` calls used `.partial_cmp().unwrap()` on `f64` distance values. `partial_cmp` returns `None` when either operand is `NaN`, causing an unwrap panic. A malformed location write with `NaN` coordinates would crash the location-service sort path.

**Fix applied (2026-03-23):** Replaced all four with `.total_cmp()`, which defines a total order on all `f64` values including `NaN` (NaN sorts last).

---

### SEC-1.9 Panic on pre-epoch system clock (`SystemTime::unwrap()`)

**Files:**
- `services/common/src/auth.rs` — `now_unix()`
- `services/messages-service/src/main.rs` — `now_ms()`
- `services/favourites-service/src/main.rs` — range-sync cutoff

`duration_since(UNIX_EPOCH)` returns `Err` if the system clock is set before 1970-01-01. All three call sites used `.unwrap()`, crashing the service in any containerised environment with a reset or misconfigured clock.

**Fix applied (2026-03-23):** Replaced `.unwrap()` with `.unwrap_or_default()` at all three sites. A clock-before-epoch condition now returns 0 s / 0 ms instead of panicking.

---

## Summary Table

| Status | ID | Severity | Finding |
|---|---|---|---|
| 🔲 | SEC-1.1 | HIGH | Plain password/email in POST request — needs OPAQUE/PAKE |
| 🔲 | SEC-1.2 | MEDIUM | Gateway send-rate bypassable at messages-service HTTP endpoint |
| 🔲 | SEC-1.3 | MEDIUM | `real_ip()` trusts spoofable `X-Forwarded-For` — prefer `CF-Connecting-IP` |
| 🔲 | SEC-1.4 | MEDIUM | User JWT TTL hardcoded at 7 days — should default to 24 h, be configurable |
| 🔲 | SEC-1.5 | LOW | No request body size cap in gateway |
| 🔲 | SEC-1.6 | LOW | `msg_send` shares the general API rate bucket instead of a tighter dedicated limiter |
| ✅ | SEC-1.7 | MEDIUM | CWE-918 SSRF — JWT sub raw string in internal URLs — fixed 2026-03-23 |
| ✅ | SEC-1.8 | MEDIUM | NaN panic in location sort — fixed 2026-03-23 |
| ✅ | SEC-1.9 | LOW | Pre-epoch clock panic in now_unix/now_ms — fixed 2026-03-23 |

Resolved items → AUDIT_DONE.md
