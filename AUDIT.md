# bOOmbOOm.NOW! — Code & Security Audit

**Date:** 2026-03-10
**Scope:** Full codebase (9 backend services, 9 frontend scripts, config)
**Auditor:** Claude (claude-sonnet-4-6)

---

## Executive Summary

bOOmbOOm.NOW! is a geo-location real-time messaging platform with end-to-end encryption. The architecture is generally well-designed — gateway pattern, service tokens, tokenVersion revocation, WebSocket-first delivery, MongoDB TTLs for ephemeral data, and strong crypto primitives. There are no critical vulnerabilities. However, two security bugs need prompt fixing: password changes are not protected against JWT theft, and guest location data leaks as a ghost marker after login. Several non-security bugs and a number of performance/maintainability concerns are documented below.

---

## 1. Security Bugs

### 1.1 Password change does not verify the current password (HIGH)

**Files:** `services/users-service.js:142–157`, `ui/scripts/profile.js:150–153`

The frontend sends `{ currentPassword, password }` to `PUT /api/users/me`. The server-side handler ignores `currentPassword` entirely:

```js
// users-service.js — currentPassword is never read
const changingPassword = req.body.password !== undefined && req.body.password.length >= 8;
if (changingPassword) {
  update.passwordHash = await bcrypt.hash(req.body.password, 12);
}
```

An attacker who steals a valid JWT (e.g. from an unlocked device, a browser extension, a shoulder-surfed DevTools session, or a compromised browser) can permanently change the victim's password and take over the account. The JWT is valid for 7 days, giving a wide attack window.

The frontend also calls `BBMCrypto.reencrypt(curr, nw, encBlob)` before the server call, which _does_ verify the old password before re-encrypting the private key blob. But if that step succeeds (because the attacker knows the user is logged in and their crypto keys are unlocked), nothing blocks the server from accepting the new password.

**Fix:** Add `currentPassword` verification to the server handler using `bcrypt.compare` before accepting `req.body.password`.

---

### 1.2 Ghost marker after login — guest location not cleaned up (MEDIUM)

**Files:** `ui/scripts/api.js:78`, `services/auth-service.js:58–64, 183–195`

When a user logs in, `auth.js` calls:

```js
const data = await window.Api.login({ email, password, guestId: _guestId });
```

But `api.js` destructures only `{ email, password }` and discards `guestId`:

```js
login({ email, password }) {            // guestId is silently dropped
  return apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),   // no guestId in body
  });
},
```

The auth service calls `cleanupGuest(guestId)` on login, which deletes the guest location doc and guest session. Without `guestId` the function returns immediately. The old guest location document (with the guest UUID as `userId`) therefore survives in MongoDB for up to 10 minutes (location TTL). During that window, other users see a phantom "guest" pin at the logging-in user's position — essentially a ghost marker revealing where the user was moments before they logged in.

For comparison, `register()` in `api.js` correctly passes `guestId` and the backend correctly calls `migrateGuestLocation` to transfer the doc.

**Fix:** Add `guestId` to the body in `api.js`'s `login()` function.

---

### 1.3 JWT token in WebSocket URL query string (LOW)

**File:** `ui/scripts/app.js:332–336`

```js
function locWsUrl() {
  var token = window.Auth?.getToken?.() || '';
  return base + '/ws/location?token=' + encodeURIComponent(token);
}
```

The token is appended to the URL, which means it appears in server access logs, browser history, and HTTP Referer headers on any subsequent navigation. The server correctly ignores the query string and requires the auth message (first WS frame) — but the token is still unnecessarily exposed.

The messages WS correctly omits the token from the URL entirely (`msgWsUrl()` has no token).

**Fix:** Remove the token from the URL in `locWsUrl()`. Authentication already happens via the first message frame.

---

### 1.4 Meeting mode pill persists across logout (LOW)

**Files:** `ui/scripts/map.js:248–300`, `ui/scripts/auth.js:40–45`

The "meeting mode" state is stored in `localStorage` under the key `bbm_meet`. On logout, `clearUserStorage()` removes the token, nickname, and sex — but not `bbm_meet`. Because the map stays active after logout (the user is re-authenticated as a guest and the location WS reconnects), `updateMeetingMode()` continues to run on each `geo:nearby` push. If a meeting partner is still online, the pill displays their nickname and distance after the user has logged out.

This is data leakage in the UX sense — another person using the same device (or the same user who considers themselves "logged out") sees a named partner's location on the map.

**Fix:** Clear `bbm_meet` from localStorage in `clearUserStorage()`.

---

### 1.5 What happens to user data and presence on logout — full trace

This section answers the direct question about data/memory state after logout.

**Location (server):** On logout, `Auth.onLogout` triggers `window.Api.deleteLocation()` — a `DELETE /api/location` that removes the document from the `locations` collection immediately. Additionally, the location WebSocket `onclose` handler independently fires the same `DELETE`. Both may succeed; the second is a no-op. **Result: location is removed promptly from the DB. Other users stop seeing the logged-out user within the next 5-second WS push cycle.**

**Location (client map):** The self marker remains on the map because `clearUserStorage` and `Auth.logout` do not remove it. After `Auth.initGuest()` completes and the next geo position fires, `placeSelfMarker` redraws the marker with the guest icon. There is no explicit removal step, but the marker transitions cleanly to guest styling. No stale personal data leaks via the self marker.

**Other users' markers:** The WS is closed on logout and a new guest WS opens. During the gap before the first `geo:nearby` push, the previous set of markers remains visible. This is a normal 0–5 second staleness window and not a security concern.

**Messages (memory):** On logout, `Auth.onLogout` redirects the user away from any protected route (`/messages/`, `/favourites/`, `/profile/`) via `window.location.href`. This reloads the page, clearing all in-memory decrypted messages, caches (`_profileCache`, `_pubKeyCache`), and DOM content. **Result: no decrypted messages persist in memory after logout.**

**Crypto keys:** `Auth.logout()` calls `window.BBMCrypto?.lock()` before clearing the token, which sends a `lock` command to the crypto worker, setting `_privateKey = null; _publicKey = null`. The SharedWorker's key state is cleared. **Result: private key is properly wiped from the worker on logout.**

**localStorage after logout:** Token, nickname, sex are removed. `bbm_guest_id`, `bbm_guest_exp`, and `bbm_meet` remain (the first two are needed to re-establish the guest session; the third is the meeting-mode bug described in §1.4).

---

## 2. Non-Security Bugs

### 2.1 `/api/tiers/*` routes are missing from the gateway (BROKEN FEATURE)

**Files:** `services/server.js` (routes section), `ui/scripts/api.js:136–138`, `ui/scripts/map.js:363–366`

`api.js` calls `apiFetch('/tiers/radius/nearby/:tier')` to fetch the view radius for the map circle. The gateway (`server.js`) has no `/api/tiers/*` routes, so every call returns a 404. `map.js` swallows the error silently (`.catch(function() {})`), and `viewRadius` stays at its default of 0 — so no view-radius circle is ever drawn.

This is not currently visible to users because all tier radii are `Infinity` (no circle anyway), but the feature is completely broken.

**Fix:** Add proxy routes for `/api/tiers/*` in `server.js`.

---

### 2.2 `currentPassword` sent to server but ignored — no client-side warning

**File:** `ui/scripts/profile.js:153`

The client sends `currentPassword` in the payload, which the server silently ignores (see §1.1). This is consistent in its brokenness but means the "Current Password" field in the UI has no effect whatsoever on whether the password change succeeds. This should be fixed server-side (§1.1).

---

### 2.3 Public key and profile caches are never invalidated

**File:** `ui/scripts/messages.js:40–47, 144–147`

```js
const _pubKeyCache  = {};
const _profileCache = {};
```

Both caches are keyed by `userId` and never invalidated. If a user re-generates their E2EE keys (e.g., via account recovery or key rotation in the future), the stale public key in `_pubKeyCache` causes decryption failures until the page is reloaded. Similarly, stale profile data (nickname changes) persist in `_profileCache` for the page's lifetime.

**Fix:** Add a TTL or a size-bounded LRU strategy; or at minimum, invalidate on `bbm:unlocked`.

---

### 2.4 `haversineDistance` duplicated across three files

**Files:** `services/server.js:225–231`, `services/messages-service.js:30–37`, `services/location-service.js:34–41`

Three independent copy-paste implementations of the same function. If a precision bug is found, all three need patching. `services/lib/geo.js` exists but is not imported by the services that need it.

---

### 2.5 `buf2b64` uses spread on potentially large ArrayBuffer

**File:** `ui/scripts/crypto-worker.js:20–21`

```js
function buf2b64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
```

The spread operator pushes all bytes as individual arguments. JavaScript engines have a call-stack argument limit (~65,000–100,000). For a 4 KB ciphertext this is fine, but larger payloads (if limits are ever relaxed) could throw "Maximum call stack size exceeded". Low risk at current message sizes, but a latent bug.

---

### 2.6 `age` validation check is falsy-skipped in profile update

**File:** `services/users-service.js:150`

```js
if (update.age && (update.age < 18 || update.age > 120))
```

`update.age` is assigned as `parseInt(req.body.age, 10)`. If the client sends `age: 0`, the truthiness check skips validation and 0 is stored. Age 0 is nonsensical and violates the 18+ requirement. The check should use `update.age !== undefined`.

---

### 2.7 No explicit WebSocket disconnect on message-page navigation

**File:** `ui/scripts/messages.js:308`

```js
window.addEventListener('beforeunload', () => wsSend({ type: 'view', userId: null }), { once: true });
```

The `type: 'view', userId: null` message clears the thread subscription, but the WebSocket itself is not explicitly closed on navigation. The server's `onclose` handler clears timers and releases the send bucket. The browser will close the WS on unload, but there's no explicit `_msgWs.close()` call. This is unlikely to cause problems but is inconsistent with the location WS (`closeLocWS()` is called on logout).

---

## 3. Performance

The current setup (single MongoDB instance, self-contained services on Railway, no external cache) handles moderate traffic well. The following patterns become bottlenecks as user count grows.

### 3.1 Full collection scan for nearby query

**File:** `services/location-service.js:213–216`

When radius is `Infinity` (the current default for all tiers), the query falls back to:

```js
const nearby = await db.collection('locations').find({
  userId:    { $ne: callerId },
  updatedAt: { $gt: cutoff },
}).toArray();
```

This is a **full collection scan** — the 2dsphere index is unused. With 1,000 active users, the gateway polls this endpoint every 5 seconds per connected client. At 500 concurrent clients: 500 × 12/min = 6,000 reads/min, each loading the full collection. This is the single biggest scalability risk.

**Context:** Migration `002` failed in production, so the 2dsphere index does not exist. Additionally, MongoDB's free tier RAM limits make large geospatial indexes impractical anyway. The in-process `haversineDistance` function is therefore the correct approach for distance filtering for now. We do not currently have Redis, but adding one is planned when the app scales — at that point change-stream or pub/sub patterns become viable.

**Fix options:**
- ~~Use a bounded radius (e.g. 5 km) for all tiers and use the 2dsphere `$nearSphere` query~~ — not viable without the index.
- Keep the bounded radius (now enforced per-tier) and cap `MAX_VISIBLE_REGISTERED` to limit collection scan size as user count grows.
- Add Redis as a change-notification bus to eliminate polling entirely (deferred — see 3.5).

### 3.2 Poll-based WebSocket pushes hit MongoDB on every tick

**Files:** `services/server.js:288–301, 373–396`

Every connected location WebSocket polls the location service every 5 seconds. Every connected messages WebSocket polls conversations every 3 seconds and the active thread every 2 seconds. These are synchronous DB reads with no caching.

At 200 users on the messages page, that's 200 × 20/min = 4,000 reads/min on the messages collection alone, even when no messages have been sent.

**Fix:** MongoDB change streams would allow the server to push only when data actually changes, eliminating idle polling entirely. This requires a replica set (one node is sufficient on Railway). Alternatively, add a Redis layer as a change-notification bus.

### 3.3 TokenVersion DB lookup on every authenticated request

**Files:** All internal services, `verifyToken()` functions

Every authenticated API call hits MongoDB to check `tokenVersion`. A single API request (e.g. fetch conversations) results in:
- gateway verifies JWT (in-memory) ✓
- gateway → tiers-service: tiers service verifies JWT and does no DB lookup ✓
- gateway → messages-service: messages service does a DB lookup for `tokenVersion`

This adds one synchronous DB read to the hot path of every authenticated request.

**Fix:** Short-lived access tokens (e.g. 15-minute JWTs) eliminate the need for server-side tokenVersion checks for the vast majority of requests. Keep the tokenVersion mechanism only for immediate invalidation on password change, combined with a short expiry window.

### 3.4 Service token caching is per-service-instance, not shared

**Files:** `services/server.js:96–104`, `services/messages-service.js:98–106`

Each service instance caches its own service JWT independently. On Railway with multiple replicas, this is fine (each instance generates its own). But the 60-second signing is cheap; this is low priority.

### 3.5 No horizontal scaling for WebSocket state

**File:** `services/server.js` (in-memory `_wsSendCounts`)

The per-user send-rate bucket is stored in-process:

```js
const _wsSendCounts = new Map(); // userId -> { count, connections, timer }
```

If the gateway scales to multiple instances, two connections from the same user on different instances will have separate buckets, doubling the effective send rate. As long as Railway runs a single gateway instance this is fine, but it's worth noting before horizontal scaling.

**Context:** Redis is not currently available. Adding Redis is planned when the app scales, at which point the bucket can be migrated to a shared store (e.g. Redis `INCR` with a TTL key).

---

## 4. Usability — Password Entry Frequency

The current design requires users to enter their password in two distinct situations:

**Situation 1 — Login:** The user enters email + password. This authenticates them (JWT is issued) but does **not** load the crypto keys into the worker. The login flow has no unlock step.

**Situation 2 — First message access after login:** When navigating to `/messages/`, `requireUnlocked()` checks `window.BBMCrypto.isUnlocked()`. After a fresh login this is always `false`. The lock screen appears and the user must enter their password again to unlock the E2EE keys (which triggers a PBKDF2 derivation with 200,000 iterations, taking ~1 second, plus a network round-trip to fetch the encrypted key blob).

**Net result: two password entries in the typical "log in → read messages" flow.**

### Mitigating factors

- **SharedWorker on Chrome/Firefox/Edge:** Keys loaded into the SharedWorker survive full-page navigations within the same browser session. If the user navigated to the map, then clicked to messages, and the tab never timed out, the keys are still live — no second unlock needed. The double-entry only happens on the first access after a cold login.
- **Safari / iOS:** The regular Worker is destroyed on every page navigation, so the password is required on every page load that touches messages.
- **Inactivity lock:** After 3 minutes of inactivity, or 30 seconds with the tab hidden, the lock screen reappears. This is intentional and reasonable for a sensitive E2EE app.
- **Registration is seamless:** During registration, `BBMCrypto.setup(password)` loads the keys immediately, so a newly registered user doesn't see the second password prompt.

### Assessment

The double-entry is a real friction point for logged-out returning users on Chrome/Firefox, and a recurring friction point on Safari. It is a direct consequence of correctly separating authentication (who you are) from key decryption (unlocking your private key with your password). The design is defensible but the UX cost is high.

**Possible improvement (no security downgrade):** After a successful login, automatically attempt to unlock the crypto keys using the password the user just typed — without requiring a second prompt. The password is available in-memory at that moment (it was just used for the login form). This would eliminate the second entry for the cold-login case entirely. The lock screen on inactivity/tab-hide would still protect keys at rest.

---

## 5. Maintainability

### 5.1 Strengths

- **Tiers service as single source of truth.** Adding a new gated feature requires two steps: add an entry to `FEATURES` in `tiers-service.js`, add a route in `server.js`. Nothing else needs to change. This is excellent design.
- **Migration service.** Schema changes are versioned and idempotent. Boot-time invocation ensures the gateway never starts against a stale schema.
- **Consistent security middleware pattern.** Every service uses the same `requireServiceToken` + `verifyToken` chain, making the pattern easy to audit and reason about.
- **WebSocket architecture.** The fire-and-forget for location and the polling-for-messages pattern is a pragmatic balance between complexity and reliability.
- **TTL indexes.** Ephemeral data (locations, messages, sessions) are cleaned up automatically without application-level cron jobs.
- **Frontend XSS discipline.** `escHtml()` is applied consistently before inserting user-controlled strings into the DOM.

### 5.2 Concerns

**Code duplication across services.** The following utilities are copy-pasted across 3–4 files each:

| Utility | Duplicated in |
|---|---|
| `verifyToken` | auth, users, messages, location, favourites |
| `requireServiceToken` | all 6 services |
| `serviceToken` (caching) | server.js, messages-service.js |
| `haversineDistance` | server.js, messages-service.js, location-service.js — **copies are intentional**: MongoDB geospatial indexes are unavailable (free tier RAM limits + migration 002 failure), so distance filtering must happen in JS in each service. Consolidating into a shared lib is deferred with 2.4. |
| `safeObjectId` | users, messages, favourites |
| `issueUserToken` | auth-service.js, users-service.js |

`services/lib/geo.js` exists but only geo.js is in it; the other utilities live inline. If the JWT payload structure changes (e.g., adding a field), every `issueUserToken` and `verifyToken` in every service must be updated. This is a recurring maintenance risk.

**`app.js` mixes three distinct modules.** The file contains the main app shell, `GeoModule`, and `LockModule` — three concerns with distinct lifecycles. Each wraps itself in an IIFE, which helps, but a 718-line file that must be loaded on every page adds cognitive overhead. As the app grows, splitting into separate files (which Jekyll already supports via `extra_js`) would improve navigation and testability.

**No TypeScript.** Without types, the implicit shape of objects passed between functions (e.g., the `nearby` user object, the ciphertext envelope) is not enforced. Adding a type definition for the ciphertext envelope in one file doesn't prevent a typo from shipping in another. TypeScript is not required, but JSDoc type annotations on the critical shapes (token payload, ciphertext, nearby user) would catch bugs earlier.

**Frontend globals.** `window.Auth`, `window.Api`, `window.BBMCrypto`, `window.MapModule`, `window.GeoState` are used as an implicit dependency injection system. This works fine at current scale, but there's no protection against load-order bugs (if a script that assumes `window.BBMCrypto` is defined loads before `crypto.js`). Since Jekyll concatenates scripts via `extra_js`, the order is predictable but implicit.

**Silent `catch` blocks.** Seventeen `catch { /* silent */ }` or `catch(function() {})` blocks across `server.js` and `app.js` suppress errors that are useful for debugging in production. WebSocket push failures, location delete failures, and WS reconnection errors all vanish silently. Adding structured logging (even a simple `console.warn`) with a unique tag makes future debugging dramatically faster.

**`LOCATION_TTL_SEC` constant duplicated.** `favourites-service.js:14` hard-codes 10 minutes with a comment "must match location-service". There is no enforcement. A change to one is invisible to the other.

**Password-change flow couples three operations without rollback.** In `profile.js:148–153`, the password change:
1. Fetches the encrypted private key
2. Re-encrypts it (client-side)
3. Saves the new key blob to the server
4. Updates the password hash on the server

Steps 3 and 4 can fail independently. If step 3 succeeds but step 4 fails, the private key blob is encrypted with the new password, but the account still uses the old password hash — making the keys permanently unreadable on next login. There is no rollback. The server returning a new JWT after the password change (which the frontend does not currently use) could serve as an atomic confirmation.

---

## 6. Summary Table

| Status | # | Area | Severity | Finding |
|---|---|---|---|---|
| ✅ | 1.1 | Security | HIGH | Password change accepts new password without verifying current password on server |
| ✅ | 1.2 | Security | MEDIUM | Ghost marker after login — guest location not cleaned up (guestId dropped by api.js) |
| ✅ | 1.3 | Security | LOW | Location WS URL includes JWT in query string |
| ✅ | 1.4 | Security | LOW | Meeting mode pill (`bbm_meet`) persists in localStorage after logout |
| ✅ | 2.1 | Bug | HIGH | `/api/tiers/*` routes missing from gateway — getNearbyRadius always 404s |
| 🔲 | 2.3 | Bug | LOW | Public key and profile caches never invalidated |
| ⏸️ | 2.4 | Bug | LOW | haversineDistance copy-pasted in 3 files (divergence risk) |
| 🔲 | 2.5 | Bug | LOW | `buf2b64` spread can overflow call stack on large payloads |
| 🔲 | 2.6 | Bug | LOW | Age validation uses truthiness check — age 0 skips validation |
| ✅ | 3.1 | Performance | HIGH | Nearby query is full collection scan when radius is Infinity |
| ✅ | 3.2 | Performance | MEDIUM | Poll-based WebSocket pushes hit MongoDB every tick with no caching |
| ✅ | 3.3 | Performance | MEDIUM | TokenVersion DB lookup on every authenticated request |
| ⏸️ | 3.5 | Performance | LOW | Send-rate bucket is in-process — not safe for multi-instance gateway |
| 🔲 | 4 | Usability | MEDIUM | Users enter password twice in cold login → messages flow |
| 🔲 | 5.2a | Maintainability | MEDIUM | Core utilities (verifyToken, issueUserToken, haversine) duplicated across all services |
| 🔲 | 5.2b | Maintainability | LOW | app.js mixes three distinct module concerns (718 lines) |
| 🔲 | 5.2c | Maintainability | LOW | LOCATION_TTL_SEC duplicated in favourites-service with no enforcement |
| 🔲 | 5.2d | Maintainability | LOW | Password-change flow lacks rollback if step 3 or 4 fails independently |
