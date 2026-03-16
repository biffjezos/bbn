# bOOmbOOm.NOW! — Code & Security Audit

**Date:** 2026-03-10
**Scope:** Full codebase (9 backend services, 9 frontend scripts, config)
**Auditor:** Claude (claude-sonnet-4-6)
**Note:** Carries forward postponed items from AUDIT-20260310-1425.md

---

## Executive Summary

---

## 1. Security Bugs

### 1.1 Plain password in a POST request

***Note:*** added by project owner (12 March 2026)

```json
[API] → POST https://boom.up.railway.app/api/auth/login
{
    email: ' {plain email address}',
    password: '{plain password}',
    guestId: '{guest id}'
}

//found /ui/scripts/api.js

login({ email, password, guestId }) {
    return apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, guestId }),
    });
  },
```

Why is that? Hash the email address and password right in the client. The app doesn't have any purpose for a plain text eMail address. Find the issue. Show me the concrete code snippet. If `/services` encrypt or hash data a second time, that's ok. I do not want any unencrypted/unhashed communication between server and clients (later also encrypt location data). Look into SRP or even better OPAQUE / PAKE to solve this. Include items 6.* before contemplating about this ticket. Could we implement OPAQUE if we would port the auth-service to rust as a test run?

On account creation the eMail should be hashed, just like the password, sent and stored in the db.

The eMail address and password should always be hashed right after it was added into the text field (of the account creation, login-modal).

---

### 1.2 Gateway send-rate limit bypassable at messages-service level

**File:** `services/server.js` (`_wsSendCounts`), `services/messages-service.js`

The per-user send rate (10 msg / 10 s) is enforced only at the WebSocket layer
in the gateway. The messages-service HTTP endpoint has no independent rate
limit. A client with a valid JWT hitting the HTTP endpoint directly (or via
multiple tabs) can exceed the per-user budget. messages-service needs its own
per-userId in-memory rate check.

**Priority:** Medium — actual spam risk before T-05 (blocking/reporting) is built.

---

### 1.3 JWT tier claim goes stale after admin tier change (future risk)

**Files:** `services/server.js` (`checkTier`)

The `tier` claim is baked into the JWT at login. `checkTier` reads it from the
token payload, not from the DB. When the admin tier-change feature (T-01) is
built, changing a tier in the DB has no effect until the old token expires.

**Resolution (when T-01 is built):** Bump `tokenVersion` on tier change —
same pattern already used for password changes. Cleanest fit with existing arch.

**Priority:** Low now, blocks T-01 implementation.

---

## 2. Non-Security Bugs

### 2.1 `haversineDistance` duplicated across three files

***Postponed by project owner (12 March 2026):*** Postponed until further notice.

**Files:** `services/server.js`, `services/messages-service.js`, `services/location-service.js`

Three independent copy-paste implementations of the same function. If a precision bug is found, all three need patching. `services/lib/geo.js` exists but is not imported by the services that need it.

**Context:** A shared internal library is not currently possible (no private package registry, no monorepo tooling). Each service is intentionally self-contained. Consolidation is deferred until the infrastructure to support a shared lib is in place. MongoDB geospatial indexes are also unavailable (free tier RAM limits + migration 002 failure), so haversine-in-JS is the correct approach for distance filtering regardless.

### 2.2 Tier badge in /profile has hard-coded values

I changed the see_nearby values and added a fourth tier `developer` but the information of the tier-badge seems to be hard coded. We have to improve the tier system, so it also stores standard information per tier. Maybe adding a `GET /tier/{regular}/info` which would return standard phrases or values, which the ui could render as:
See radius: x meters

---

## 3. Performance

### 3.1 Send-rate bucket is in-process — not safe for multi-instance gateway

***Postponed by project owner (12 March 2026):*** Postponed until further notice.

**File:** `services/server.js` (in-memory `_wsSendCounts`)

The per-user send-rate bucket is stored in-process:

```js
const _wsSendCounts = new Map(); // userId -> { count, connections, timer }
```

If the gateway scales to multiple instances, two connections from the same user on different instances will have separate buckets, doubling the effective send rate. As long as Railway runs a single gateway instance this is fine, but it's worth noting before horizontal scaling.

**Context:** Redis is not currently available. Adding Redis is planned when the app scales, at which point the bucket can be migrated to a shared store (e.g. Redis `INCR` with a TTL key).

---

### 3.2 Notification poll scales linearly with active users

**File:** `ui/scripts/app.js` (NotifModule), `services/favourites-service.js`

Each logged-in user polls `GET /api/notifications` every 30 s. Negligible at
current scale (< 1 000 concurrent). At larger scale, push delivery via the
existing message WebSocket would be more efficient. Acceptable for now.

---

## 4. Usability

---

## 5. Maintainability

### 5.1 Core utilities duplicated across all services

***Postponed by project owner (12 March 2026):*** Postponed until further notice.

**Files:** All services

The following utilities are copy-pasted across 3–4 files each:

**Note:** All duplication is intentional at this stage. A shared internal library is not currently possible (no private package registry, no monorepo tooling). Each service is intentionally self-contained. Consolidation is deferred until the infrastructure to support a shared lib is in place.

| Utility | Duplicated in |
|---|---|
| `verifyToken` | auth, users, messages, location, favourites — intentional copy per service |
| `requireServiceToken` | all 6 services — intentional copy per service |
| `serviceToken` (caching) | server.js, messages-service.js — intentional copy per service |
| `haversineDistance` | server.js, messages-service.js, location-service.js — intentional: MongoDB geospatial indexes unavailable (free tier RAM + migration 002 failure), distance filtering must run in JS per service; deferred with 2.1 |
| `safeObjectId` | users, messages, favourites — intentional copy per service |
| `issueUserToken` | auth-service.js, users-service.js — intentional copy per service |

If the JWT payload structure changes (e.g., adding a field), every `issueUserToken` and `verifyToken` in every service must be updated. This is a recurring maintenance risk.

### 5.2 `app.js` mixes four distinct module concerns

**File:** `ui/scripts/app.js`

The file contains the main app shell, `GeoModule`, `LockModule`, and `NotifModule` — four concerns with distinct lifecycles. Each wraps itself in an IIFE, which helps, but the file must be loaded on every page. As the app grows, splitting into separate files (which Jekyll already supports via `extra_js`) would improve navigation and testability.

---

## 6. Other Tickets (new features, evaluations, questions)

### 6.1 TTL for inactive users

***Note:*** added by project owner (12 March 2026)

Related to 1.1.

I want to follow a (lost password - lost access)-approach. If a user forgets the password, there should be no way to recover the account, set a new password, being able to login, (and) or delete the account or read existing messages.

Therefore, inactive users should be auto-deleted after 90 days. I prefer a TTL initially set on account creation and updated on each login.

### 6.2 Evaluate stricter data protection feasibility

***Note:*** added by project owner (12 March 2026)

In the best case, all information stored in the database is either hashed or encrypted. No user related data should be transmitted in any direction unencrypted or unhashed. Services should get their own private / public key pairs with which they can encrypt/decrypt data if necessary.

Evaluate in which way it's feasible to:

- encrypt geo location data on the client side
- being transmitted from a client (user) in an encrypted fashion
- stored only encrypted in the backend (mongodb)
- geo location sent out encrypted to all other `/location/nearby..`)
- decrypted by various clients (users) with different private keys.

### 6.3 Evaluate a port of all `/services` to Rust

***Note:*** added by project owner (12 March 2026)

In the medium-term I want to port the node.js `/services` to rust and have railway pull the project without manual work. Evaluate the prerequisites, milestones to guarantee an uninterrupted service of the app.

- Is it necessary to create a new project on github / railway?
- Can node.js and rust.rs services be included in the same repository?
- Which service is the easiest to port, which utility, and models modules should be ported first?
- What performance improvement can be expected?

### 6.4 Question: Is there a secure way to prove that the running service matches the public repo?

***Note:*** added by project owner (12 March 2026)

I want to give users a way to validate the code that runs the services, by matching a signature of the binary or in another way. Please elaborate on the feasible options.

### 6.5 Simple admin UI

***Note:*** added by project owner (14 March 2026)

I need an admin UI, in which I can as a developer change the current profile information (including current tier) of a specific user. It should look similar to the /profile page with the search bar. I would be able to search for a user using the same filters, then a click on a user entry expands the profile information. If I change the tier make sure that this change is effectively working (token generation etc) and not just changing the tier string in the db of the user.

### 6.6 Admin UI > Adding, changing, removing tiers

***Note:*** added by project owner (14 March 2026)

The admin UI should be able to add, edit, change, remove tiers. Therefore, I think it's also necessary to store the tier information in the db, rather than in a js. Please prepare a concrete plan for the implementation, estimate how difficult the implementation is.

---

## 7. Summary Table

| Status | # | Area | Severity | Finding |
|---|---|---|---|---|
| 🔲 | 1.1 | Security | HIGH | Plain password/email in POST request — needs OPAQUE/PAKE |
| 🔲 | 1.2 | Security | MEDIUM | Gateway send-rate bypassable at messages-service level |
| 🔲 | 1.3 | Security | LOW (future) | JWT tier claim stale after admin tier change |
| 🔲 | 2.1 | Bug | LOW | haversineDistance copy-pasted in 3 files (divergence risk) |
| 🔲 | 2.2 | Bug | LOW | Tier badge in /profile has hard-coded values |
| 🔲 | 3.1 | Performance | LOW | Send-rate bucket is in-process — not safe for multi-instance |
| 🔲 | 3.2 | Performance | LOW | Notification poll scales linearly with active users |
| 🔲 | 5.1 | Maintainability | MEDIUM | Core utilities (verifyToken, issueUserToken, haversine) duplicated |
| 🔲 | 5.2 | Maintainability | LOW | app.js mixes four module concerns |
