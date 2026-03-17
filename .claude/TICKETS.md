# bOOmbOOm.NOW! — Feature Backlog & Roadmap

**This file is for Claude and the owner.** It contains planned features,
postponed items, architectural decisions, and scaling strategies.
Technical debt and security findings live in `AUDIT.md`.

---

## Recommended Implementation Order

Before any marketing or scaling push, the order of priority is:

1. ~~**T-05**~~ — ✅ Done (2026-03-16)
2. ~~**T-03**~~ — ✅ Done (2026-03-16)
3. ~~**T-04a**~~ — ✅ Done (2026-03-16): Rust tiers-service live on Railway. Static fallback active; migration 004 still blocked on disk space (AUDIT.md 2.0).
4. ~~**T-04b**~~ — ✅ Done (2026-03-16): Rust auth-service live. `role` in JWT, bootstrap mechanism. OPAQUE deferred (see T-04b note below).
5. ~~**T-01**~~ — ✅ Done (2026-03-16)
6. **T-05b** — Add encrypted note field to blocks (still waiting on OPAQUE; existing BBMCrypto is a candidate but original privacy decision stands — revisit after OPAQUE lands)
7. **T-02** — Analytics (low-risk, can slot in any time)
8. **T-06** — Venue accounts (needs T-01 and T-03)
9. **T-07** — Settings page + device notifications (UX polish)
10. ~~**T-04c**~~ — ✅ Done (2026-03-17): Rust port complete — blocks, favourites, messages, users, gateway all live. migration-service stays Node.js.
11. **T-08** — Authority service: merge auth + tiers → single authority, centralise RBAC in gateway, retire tiers-service (after T-01 + T-04c underway)

### Architectural Decision (2026-03-16)

**Access control model: Enhanced RBAC + access gates. No full ABAC policy engine.**

Roles are stored as DB documents (T-03 schema). Dual-control access (e.g. admin
requesting block note decryption, legal approving it) is handled via a shared
`access_requests` collection — not a policy engine. New gates are new
`resourceType` values in that collection. This pattern ports cleanly to Rust and
requires no new infrastructure.

### Owner's Comments

- Generally agreed on the implementation order. T-05, T-03 approved for implementation, but need clarification. See my comments in the tickets and clarify open questions in the upcoming meeting.
- I wonder if T-04 should have a higher priority. Probably less code to port, we could make use of common libraries earlier.
- **2026-03-16:** Agreed. Enhanced RBAC + access_requests. No encryption of the optional note for now. Tiers-service Rust port moves up after T-05 and T-03. Then the rest.
---

## T-01 — Admin UI (`/admin`)

**Status:** ✅ Complete (2026-03-16).

### Implemented (2026-03-16)

- `services/location-service.js` — replaced hardcoded inline radius table with cached fetch to tiers-service (5 min TTL, static fallback). New env var: `TIERS_SERVICE_URL`.
- `services/users-service.js` — fixed tokenVersion check to include `admin` role. Added `requireAdmin` middleware. Added `GET /admin/users`, `PATCH /admin/users/:id/tier`, `PATCH /admin/users/:id/role`.
- `services/tiers-service/src/main.rs` — admin tier CRUD: `GET/POST /admin/tiers`, `PUT/DELETE /admin/tiers/:name`. Each handler verifies adminUser JWT + tokenVersion from DB. Cache invalidated on every write.
- `services/common/src/auth.rs` — added `AdminUser` Axum extractor (signature + role check).
- `services/server.js` — added `requireAdmin` middleware, PATCH to CORS, admin proxy routes.
- `ui/_layouts/default.html` — extended layout guard: `/admin/*` requires `role === 'admin'`.
- `ui/_includes/offcanvas-menu.html` — admin nav link (hidden by default, shown by app.js for admin role).
- `ui/scripts/app.js` — `syncOffcanvas` and `buildDesktopNav` show admin link when `role === 'admin'`.
- `ui/scripts/api.js` — admin API methods: `adminSearchUsers`, `adminSetTier`, `adminSetRole`, `adminListTiers`, `adminCreateTier`, `adminUpdateTier`, `adminDeleteTier`.
- `ui/admin/admin-index.html` + `ui/scripts/admin.js` — admin UI: user search/expand/tier+role change; tier CRUD.

### Tiers CRUD polish (2026-03-16 — follow-up session)

- `tiers-service/src/main.rs` — `admin_list_tiers`: auto-seeds static tiers into the DB on first admin access (using `count_documents` guard, not deserialization result) so edit/delete immediately target real documents. Fetches the list as raw BSON `Document` to avoid silent `try_collect` failures causing spurious re-seeding.
- `tiers-service/src/main.rs` — `admin_create_tier`: shifts all existing tiers with `rank >= new rank` up by 1 before inserting, keeping ranks contiguous.
- `ui/scripts/admin.js` — edit form now expands inline below the clicked tier row instead of at the bottom of the list; heading removed; nearby/message radius fields on a dedicated second row; clicking a different row closes the previous form.
- `ui/scripts/admin.js` — "New Tier" rank field is a select (0 → maxRank+1) labelled with the occupant tier at each position; defaults to "append".

### Notes

- First use case: create a `unrestricted` tier with expanded nearby and messaging radii.
- Auth: a dedicated `admin` role added to JWT. **Not** created manually in DB — see bootstrap mechanism below.
- The `/admin` route must be excluded from the Jekyll public build or served from a separate path with server-side auth checks.

### On `admin` role vs tiers

`admin` is a **role**, not a tier. A tier controls feature access (see_map, message_online, etc.). A role controls what actions the user can perform on other users and system data. A user can be `tier: premium, role: admin`. They are orthogonal. The JWT must carry both.

Currently only `tier` is in the JWT. `role` needs to be added when T-01 is built. A plain DB edit to the `tier` field does not grant admin access — roles are separate and enforced separately.

### Bootstrap mechanism (prerequisite for T-01)

**Problem:** You need an admin to create an admin. Manual DB edits must not be the answer — they bypass auth and are not portable.

**Solution: `ADMIN_BOOTSTRAP_USER_ID` env var on auth-service (or gateway)**

1. Developer registers a normal account via the app.
2. Sets `ADMIN_BOOTSTRAP_USER_ID=<userId>` as an env var on Railway.
3. On next service boot: if no admin exists yet, the service promotes that userId to `role: admin`, bumps their `tokenVersion`.
4. Developer re-logs in → receives a JWT with `role: admin`.
5. Env var is removed from Railway (the service is a no-op if an admin already exists, but it should be removed as hygiene).

This is the only path to the first admin. All subsequent admin promotions go through the admin UI with an authenticated admin JWT. Raw DB edits to role/tier fields have no effect without a `tokenVersion` bump, which only the service can perform.

**Implementation note:** Must be part of T-04b (auth-service Rust port) or implemented in the current `auth-service.js` as a startup hook. Cannot be done before `role` is added to the JWT.

### Owner's Comments

- How do I create an elevated account? A change in the db ("regular" -> "admin") should not be permitted.
- Maybe T-03 answers open questions.
- Do not touch without explicit permission.
- **2026-03-16:** Confirmed: admin is a role, not a tier. Bootstrap via env var is the right approach. Raw DB edits must not grant access.

---

## T-02 — Analytics (`anal.js` / analytics-service)

**Status:** Not started.

### Requirements

- Logins per day (guest + registered, separate counts).
- New registrations per day.
- Active users (sent at least one message or location update) per day.
- Messages sent per day.
- Favourites added per day.

### Architecture notes

- **Option A — Event counters in MongoDB:** On each relevant action, `$inc` a counter document (e.g. `{ date: '2026-03-16', event: 'login', count: N }`). Near-zero overhead. No new infrastructure.
- **Option B — Log parsing:** Parse existing `console.log` output from Railway's log drain. Zero app changes, but requires a log aggregator.
- **Recommendation:** Option A. One `analytics` collection, one `$inc` per event. The `anal.js` frontend script reads from a new `analytics-service` endpoint and renders simple charts (Chart.js is already included or trivial to add).
- Do not add analytics writes to the hot path of high-frequency operations (location updates). Limit to: login, register, message sent, favourite added.

### Owner's Comments

- Option A it is.
- Not a high priority at the moment. May be postponed.

---

## T-03 — DB-stored Tiers + Configurable RBAC

**Status:** ✅ Complete (2026-03-16). Prerequisite for T-01 — now unblocked.

### Current state

Tiers are defined as static JSON in `services/tiers-service.js`. Adding or
editing a tier requires a code change and redeployment.

### Goal

Move tier definitions to a `tiers` MongoDB collection. The admin UI (T-01) can
then add, edit, and delete tiers without code changes.

### Tier document schema (proposed)

```json
{
  "name": "premium",
  "label": "Premium",
  "features": ["see_nearby", "message_online", "manage_favourites"],
  "radii": {
    "nearby_m": 5000,
    "message_m": 2000
  },
  "createdAt": "...",
  "updatedAt": "..."
}
```

### ABAC vs RBAC analysis

**The question:** Should we implement ABAC (Attribute-Based Access Control) or
stick with enhanced RBAC (Role-Based Access Control)?

**Current model:** RBAC — user has a tier, tier has feature flags and radii.
`checkTier` in `server.js` checks if the user's tier allows a feature.

**ABAC** would allow policies like: *"user may send message IF tier=premium AND
distance < 500m AND recipient has not blocked sender."* More expressive but
significantly more complex: requires a policy engine, policy storage, and
context evaluation at request time.

**Recommendation: Enhanced RBAC, not ABAC.**

The use cases described (different radii per tier, features on/off per tier,
block system) are fully covered by RBAC with these additions:
1. Tiers stored in DB (this ticket).
2. A separate `blocks` collection checked at the message/location layer (T-05).
3. Configurable named radii stored in the tier document.

ABAC adds "context-aware" policy evaluation (time of day, device type, session
state). None of the described features require this. The complexity cost
outweighs the benefit at this stage.

### On decoupling distances

The proposed named distances (`hyper_close: 50m`, `very_close: 500m`, etc.) are
a cosmetic improvement over direct values in the tier document. They add an
extra lookup (distance name → metres) with no functional gain for the described
use cases. **Recommendation:** Store radius values directly in the tier document
as integers in metres. If a future admin UI needs a human-friendly name, add an
optional `label` field to the radius value — no separate collection needed.

### Migration path

1. Write a migration that reads the current static tier definitions from
   `tiers-service.js` and inserts them as documents into the `tiers` collection.
2. `tiers-service.js` switches from static JSON to DB reads (with a short cache,
   e.g. 60 s TTL, to avoid a DB hit on every `checkTier` call).
3. Admin UI endpoints for CRUD on tier documents.

### Implemented (2026-03-16)

- `services/migration-service.js` — migration `004_tiers_seed`: seeds guest/regular/premium into `tiers` collection (`$setOnInsert`, idempotent). Pending disk space (AUDIT.md 2.0) — static fallback active until applied.
- `services/tiers-service.js` — full rewrite: MongoDB connection, 60s TTL cache (`loadTiers()`), `STATIC_TIERS` fallback if collection empty, new `GET /tiers/:name/info` endpoint, async radius lookups
- `services/server.js` — added `GET /api/tiers/:tier/info` proxy route
- `services/location-service.js` — fixed inline radius table (guest was 23,000 m → correct 500 m)
- `ui/scripts/api.js` — added `getTierInfo(tier)` method
- `ui/scripts/profile.js` — replaced hardcoded `TIER_DISPLAY` / `tierFeatureHtml` with API-driven version using `getTierInfo()` (fixes AUDIT.md 3.2)

**New env vars for tiers-service:** `MONGO_URI`, `DB_NAME` (same values as other services).

### Owner's Comments

- Agreed to be of high priority, but needs clarification. Please elaborate in the upcoming meeting.
- **2026-03-16:** Approved for implementation.

---

## T-04 — Port Services to Rust

**Status:** T-04a ✅ Complete (2026-03-16). T-04b ✅ Complete (2026-03-16). T-04c ✅ Complete (2026-03-17). All services + gateway now in Rust. migration-service remains Node.js (intentional). T-01 now unblocked. Sequenced as T-04a/b/c — see Implementation Order.

### T-04c — What was implemented (2026-03-17)

- `services/blocks-service/` — Rust port (axum 0.8, mongodb 3)
- `services/favourites-service/` — Rust port; fixed E0716 (tokio::join! temporaries), E0728 (await in non-async closure)
- `services/messages-service/` — Rust port; E2EE ciphertext validation, route conflict fix (`/messages/{id}` combined)
- `services/users-service/` — Rust port; bcrypt via spawn_blocking, regex_escape helper, find_one_and_update with ReturnDocument::After
- `services/gateway/` — Full Axum port of server.js: 28 HTTP proxy routes, fixed-window per-IP rate limiting, CORS via tower-http, WS location + WS messages handlers (mpsc channel pattern, auth timeout, push timers), 30s health cache, migration-on-boot call
- `services/Dockerfile.*` — per-service multi-stage Docker builds with workspace stubs
- `services/Cargo.toml` — workspace updated with all new members and tower-http dep
- **Deferred (see T-08):** signed internal auth context (X-Auth-* headers); requires updating all 7 downstream services + gateway simultaneously

**New env vars for gateway:** `JWT_SECRET`, `SERVICE_SECRET`, `AUTH_SERVICE_URL`, `USERS_SERVICE_URL`, `LOCATION_SERVICE_URL`, `MESSAGES_SERVICE_URL`, `FAVOURITES_SERVICE_URL`, `TIERS_SERVICE_URL`, `BLOCKS_SERVICE_URL`, `MIGRATION_SERVICE_URL`, `ALLOWED_ORIGINS` (optional, default: `https://biffjezos.github.io`), `PORT` (optional, default: 8080). **`JWT_SECRET` and `SERVICE_SECRET` are separate** — `JWT_SECRET` signs user/guest tokens; `SERVICE_SECRET` signs inter-service `X-Service-Token` JWTs. Separating them means a leaked user secret cannot be used to forge service requests, and vice versa. All eight Rust services require both.

### T-04b — What was implemented (2026-03-16)

- `services/auth-service/` — full Rust port (axum 0.8, bcrypt, mongodb 3)
- `common/src/auth.rs` — added `email` to `UserClaims`, added `issue_user_token` / `issue_guest_token` (reusable for future service ports)
- `role` field added to JWT (`user` | `admin`). Read from DB on login; new users get `role: user` on register.
- Bootstrap mechanism: `ADMIN_BOOTSTRAP_USER_ID` env var. On boot, if set and no admin exists, promotes that user and bumps `tokenVersion`. Safe to leave set (no-op after first run, but should be removed).
- `services/Dockerfile.auth` for Railway deployment.
- Identical HTTP contract to `auth-service.js` — gateway unchanged.

**New env vars for auth-service:** `MONGO_URI`, `DB_NAME`, `JWT_SECRET` (same values as other services), `ADMIN_BOOTSTRAP_USER_ID` (one-time, remove after use).

### T-04b — OPAQUE/PAKE (deferred)

OPAQUE requires client-side protocol participation (JS changes to login/register forms). The Rust infrastructure is now in place. This is a separate workstream — see AUDIT.md 1.1.

### Rationale

The microservice architecture allows porting one service at a time.
Each service is isolated behind the gateway (`server.js`). As long as the
HTTP API contract (routes, request/response JSON shape) is preserved, the
gateway does not change when a service is ported.

### Recommended porting order (least risky first)

1. **tiers-service** — read-only at runtime, smallest codebase, stateless.
2. **location-service** — straightforward read/write, haversine already
   implemented in Rust's geo crates.
3. **favourites-service** — slightly more complex (range-sync, notifications),
   but self-contained.
4. **messages-service** — E2EE envelope pass-through; complex validation logic.
5. **users-service** — touches many fields; port last of the "regular" services.
6. **auth-service** — highest risk; port only after all others are stable.
7. **server.js (gateway)** — can be replaced with Axum or Actix as the final
   step, or left as Node (it's not CPU-bound).

### Directory strategy

- Keep `/services` as the current Node.js codebase.
- Create `/services-rs` for Rust services as they are developed.
- Each Rust service lives in its own subdirectory: `/services-rs/tiers/`.
- **Railway deployment:** Each Railway service has a "Root Directory" setting
  in the service dashboard (Settings → Source → Root Directory). When a Rust
  service is ready, change that one service's root directory from
  `/services/tiers-service` to `/services-rs/tiers`. No other services are
  affected. This is the correct way to do this — no folder renaming needed.
- Build command for Rust on Railway: `cargo build --release`
  Start command: `./target/release/tiers-service`

### Note on shared code

The utilities duplicated across Node services (AUDIT.md 6.1) become a Rust
shared crate. In a Cargo workspace at `/services-rs/Cargo.toml`, a `common`
crate can hold JWT verification, ObjectId helpers, etc. This is the monorepo
tooling situation Node currently lacks.

### Owner's Comments

- I wonder, if the port to rust should get a higher priority. If we port sooner, we could use common libs earlier and have less code to port.
- Tell me what you think in the upcoming meeting.
- **2026-03-16:** Priority elevated. Tiers-service first (T-04a), then auth-service + OPAQUE (T-04b) which unblocks T-05 block-note encryption. Remaining services (T-04c) follow incrementally.

> **Reminder (2026-03-16):** Once T-04 (full Rust port) is complete, upgrade the
> Railway MongoDB plan to free up disk space. This will unblock migration
> `003_blocks_indexes` (see AUDIT.md 2.0) and should be done before any growth
> push. Dev-alpha state is acceptable until then.

---

## T-05 — Blocking & Reporting

**Status:** ✅ Phase 1 complete (2026-03-16). Deployed. Blocked on T-04b for phase 2.

### Phase split

- **T-05 (done):** Block mechanism + reason enum. Deployed 2026-03-16.
- **T-05b (after T-04b):** Add optional encrypted note field once OPAQUE-based key derivation is in place.

### Requirements

- Any user can block any other user.
- When A blocks B:
  - B no longer sees A in nearby results (location-service must check the block list).
  - B cannot send messages to A (messages-service must check).
  - B cannot see A's profile (users-service must check `/profile` endpoint).
  - Any existing favourite entry between them remains (for audit), but the mutual
    requirement fails, so messaging is already prevented.
- Block requires a reason. Options: `spam`, `harassment`, `inappropriate_content`,
  `fake_profile`, `other` + optional free-text (max 500 chars).
- The block + reason is stored as a report for future moderation review.
- Blocks are visible in the user's settings page (T-07) and can be removed.
- Blocked user receives no notification that they have been blocked.

### Architecture

New `blocks` collection (T-05, phase 1 — no note field yet):
```json
{
  "blockerUserId": "...",
  "blockedUserId": "...",
  "reason": "spam",
  "createdAt": "..."
}
```

Note field (`note: "..."`) is deferred to T-05b. Storing free-text without
proper client-side encryption (pending T-04b + OPAQUE) would be a privacy
regression. Reason enum is not sensitive.

New `access_requests` collection (dual-control gate for future admin access to block data):
```json
{
  "requestedBy": "admin_userId",
  "resourceType": "block_note",
  "resourceId": "block_id",
  "approvedBy": "legal_userId",
  "expiresAt": "...",
  "usedAt": null
}
```

Admin can request access to a block record. A `legal`-role account approves
the request (time-limited). The decryption endpoint checks: `role === admin AND
active approval EXISTS for (admin_id, block_id)`. This is the access gate
pattern — no ABAC policy engine required. New resource types follow the same
pattern.

New endpoints on a new `blocks-service`:
- `POST /blocks/:userId` — block a user with reason
- `DELETE /blocks/:userId` — unblock
- `GET /blocks` — list my blocked users (for settings page)

The `location-service`, `messages-service`, and `users-service` check the
`blocks` collection directly (same MongoDB instance).

### Implemented (2026-03-16)

- `services/blocks-service.js` — new service, deployed on Railway
- `services/server.js` — proxy routes + health aggregator entry
- `services/location-service.js` — block filter on nearby results (30 s cache)
- `services/messages-service.js` — block check before message delivery
- `services/users-service.js` — directional block check on `/profile`:
  blockee gets 404; blocker sees profile with `blockedByViewer: true`
- `services/migration-service.js` — migration `003_blocks_indexes`
  (pending disk space — see AUDIT.md 2.0)
- `ui/scripts/blocks.js` — `BlockModule` global, reason select modal
- `ui/scripts/api.js` — `blockUser`, `unblockUser`, `getBlocks`
- `ui/_layouts/default.html` — loads `blocks.js` on every page
- `ui/_includes/modal-pin.html` — Report/Block in map pin modal
- `ui/scripts/app.js` — wired pin block button
- `ui/scripts/profile.js` — Block/Unblock button, Blocked badge, re-renders in-place
- `ui/scripts/favourites.js` — blocked badge + disabled message btn in list/search

### Rate limiting improvement (related — AUDIT.md 1.2)

While building the blocking feature: add per-userId rate limiting at the
messages-service level (not just the gateway WebSocket). A simple in-process
`Map<userId, { count, resetAt }>` in messages-service is sufficient for
single-instance deployment.

### Owner's Comments

- Relates to T-05. 
- Since the blocking information may contain personal information about the blocked user, I think the db entry or parts of it should be encrypted. 
- Only the blocking user (through the UI) and an elevated account (admin / dev) should be able to  decrypt and read the blocking information. 
- I could also think of a two-dimensional access system, in which a higher tier user (legal) must permit acccess (decryption in the admin ui) before the content can be decrypted. I want to avoid unrestricted access to the information. So, just because a user is an admin, access should not be granted, admins may access the information, but only if necessary and that is determined by a second account (ie a "legal"-role).
- Short: Protected content can only be accessed by certain account types, but only if really necessary. Necessity must be approved by another account (or account type)

---

## T-06 — Venue Accounts

**Status:** Not started. Requires T-01 (admin UI) and T-03 (DB tiers).

### Requirements

- Account type `venue`. Cannot be self-registered — admin converts a regular
  account to `venue` type via the admin UI (T-01).
- Venue profile fields replace `sex` and `age` with:
  - `venueName` (string)
  - `description` (text)
  - `address` (string, display only)
  - `fixedLat`, `fixedLon` (stored location — does not move with GPS)
- On map: venue appears as a house icon (`bi-house-fill` or similar), always
  visible to users within range (uses the venue's `fixedLat/fixedLon`).
- Map pin modal for venues shows name + description + link to venue profile page.
- Messaging: standard two-sided favourites required. Venues can send messages to
  users; users can message venues. Future: Either auto-add-to-favourites if a user has added venue as favourite, or implicit-favourite: venue can send messages to all users that have added venue as favourites, without adding them as favourites
- Venues can be blocked by regular users (T-05). Blocked venues see nothing
  about that user.
- Admin flow: user registers normally → admin changes `accountType` to `venue`
  in admin UI → admin fills venue-specific fields → token is re-issued (see T-01
  + AUDIT.md 1.2).
- Venue login: same email/password, same JWT flow. Frontend detects
  `accountType: 'venue'` from the token and renders the venue profile view.

### Venue profile editable fields — clarification (2026-03-17)

**Admin-only fields (set via admin UI, not editable by venue itself):**
- `venueName` — display name, set by admin on conversion. Currently editable
  by the venue in `/profile` — **this must be removed**. Venue should not be
  able to rename itself.
- `address` — already read-only in the UI. Correct.
- `fixedLat` / `fixedLon` — already read-only. Correct.

**Venue-editable fields (venue manages via `/profile`):**
- `openingHours` (string or structured, TBD) — e.g. "Mon–Fri 18:00–02:00".
- `locationType` (string enum, TBD) — e.g. "bar", "club", "café", "restaurant",
  "gallery", "other".

**Implementation scope:**
- `users-service`: accept `openingHours` and `locationType` in `PUT /users/me`
  for venue accounts; reject `venueName` changes from venue self (admin-only).
- `users-service GET /users/:id/profile`: include `openingHours` and
  `locationType` in the public profile response for venue accounts.
- `profile.js renderMyProfile`: remove `venueName` input; add `openingHours`
  textarea and `locationType` select.
- `profile.js renderPublicProfile`: show `openingHours` and `locationType`
  when present on a venue profile.
- `app.js openPinModal`: show `locationType` badge and `openingHours` line
  in the map pin popup for venues.
- **No admin UI changes required** — admin already sets `venueName` /
  `address` / `fixedLat` / `fixedLon` on conversion.

### Owner's Comments

- Not a high priority. Postponed until the rest is done. Remind me.

---

## T-07 — Settings Page + Device Notifications

**Status:** Not started.

### Settings page requirements

- Route: `/settings/`
- Managed options:
  - View and remove blocked users (T-05).
  - (future) Notification preferences (opt in/out per event type).
  - (future) Privacy settings.

### Device notification requirements

Notification events (priority order):

| Event | Notes |
|---|---|
| Received a new message | Already partially handled by message WS polling |
| Added to someone's favourites | Implemented (NotifModule, 2026-03-16) |
| A favourite came online | Requires presence tracking improvement |
| A favourite is now in range | Derived from range-sync events |
| Admin changed your account type | Triggered by T-01 admin action |
| Compass activated by a favourite | Future feature |

**Delivery mechanism options:**

- **Web Push (Service Worker + Push API):** True device notifications, works
  when app is closed. Requires VAPID keys, a push subscription stored per user,
  and a push-sending step in the relevant service. Most powerful but most
  complex. Requires HTTPS (already satisfied).
- **In-app notifications (current NotifModule approach):** Banner + badge while
  app is open. Already built for new-favourite events. Extend the polling to
  cover other event types.
- **Recommendation:** Extend the existing NotifModule + `notifications`
  collection to cover all in-app events first. Add Web Push in a second pass
  when the event types are stable.

The existing `notifications` collection (added 2026-03-16) already supports
arbitrary `type` values. New event types are additive — no schema change needed.


### Owner's Comments

- Not a priority at the moment. May be postponed until after the rust port. Remind me.

---

## T-08 — Authority Service (auth + tiers consolidation + gateway-centralised RBAC)

**Status:** Not started. Addresses AUDIT.md 6.3 definitively.

### Problem

There is no single authority for user rights and limits.
Today's distribution:

| What | Where |
|---|---|
| JWT issue & tokenVersion | `auth-service` (Rust) |
| Tier definitions & feature flags | `tiers-service` (Rust) |
| Radius lookups | `tiers-service` (Rust) + hardcoded table in `location-service.js` |
| Token verification | Copy-pasted `verifyToken` in every JS service (×5) |
| Role enforcement | Copy-pasted role check in every JS service (×5) |

Any role model change (new role, new field) currently requires edits in 6+ places. This was the root cause of the admin-role cascade bug documented in AUDIT.md 6.3.

### Proposed architecture

**Step 1 — Merge auth-service and tiers-service into a single `authority-service` Rust binary:**

- All JWT issuing and verification
- tokenVersion DB check (single place, with short cache)
- Tier definitions, feature flag checks, radius lookups
- Admin role management (promote/demote, tokenVersion bumps)

Exposes a single internal endpoint:

```
POST /authority/verify
Body: { token: "...", feature?: "message_online" }
→ 200 { sub, role, tier, tv, features[], radii{} }
→ 401/403 on invalid/expired/insufficient
```

**Step 2 — Gateway becomes the single enforcer (implements AUDIT.md 6.3):**

Gateway calls `/authority/verify` once per incoming request.
On success, injects trusted headers into the proxied request:
- `X-Auth-Sub`, `X-Auth-Role`, `X-Auth-Tier`, `X-Auth-TV`
- `X-Auth-Features` (JSON array), `X-Auth-Radii` (JSON object)

Gateway's `checkTier()` becomes a header read — no separate tiers-service call.

**Step 3 — Services drop `verifyToken` copy-paste:**

Each service reads `X-Auth-*` headers instead of re-verifying the JWT.
`X-Service-Token` still protects services from external callers.
tokenVersion DB check moves entirely to the gateway step.

**Step 4 — Retire tiers-service:**

Remove from Railway once authority-service is live and all services have been migrated to header-based auth.

### Security properties

- Role and tier changes take effect immediately — gateway re-verifies on every request, not just at login.
- Stale JWT carrying a downgraded role is rejected at the gateway as soon as `tokenVersion` is bumped.
- New roles or features require changes in exactly **one place** (authority-service).
- `X-Auth-*` headers are only trusted because they are injected by the gateway; services are unreachable from the outside without `X-Service-Token`.

### Prerequisites

- T-01 complete (admin CRUD for tiers is established and tested before the service is merged)
- T-04c in progress (JS services being ported to Rust; authority header pattern is adopted as services are ported)
- No new infrastructure required

### What this is NOT

- Not a policy engine (no ABAC). The `authority/verify` response is a flat permission set, not a policy tree.
- Not a reverse proxy. The gateway remains the routing layer. Authority is a verification call only.
- Does not replace `X-Service-Token` inter-service authentication.

### Implementation order (within this ticket)

1. Extend auth-service to absorb tiers-service routes (internally, same binary, same DB).
2. Add `POST /authority/verify` endpoint.
3. Update gateway to call authority and inject headers (replaces `checkTier` + `verifyToken`).
4. Update each JS service to read headers (one service at a time, backwards-compatible).
5. When all services are updated, retire tiers-service on Railway.

### Owner's Comments

- 2026-03-16: Proposed by Claude based on the admin-role cascade bug post-mortem (AUDIT.md 6.3). Makes auth-service the true single authority for all rights and limits. Feasible once T-01 is done and T-04c is underway. tiers-service to be retired after merge.

---

## T-09 — Role CRUD with Permissions UI

**Status:** Not started. Requires backend changes.

### Problem

Roles are currently hardcoded strings (`user`, `admin`) validated inline in each service. The admin Roles tab (added T-01 follow-up, 2026-03-16) is read-only. Adding custom roles or per-role permission sets requires:

1. A `roles` MongoDB collection: `{ name, label, permissions[], rank, createdAt }`
2. Role validation in `users-service` updated from hardcoded list to DB lookup
3. Gateway or authority service reads role permissions at request time (see T-08)
4. Admin UI: form to define role name, label, and permission toggles

### Standalone guard (can be done without T-09)

**Admin self-modification block** (AUDIT.md 1.4): prevent admins from changing their own tier or role via the API. One-line fix per handler in `users-service.js`:

```
if (targetId === req.auth.sub)
  return res.status(403).json({ error: 'Cannot modify your own tier or role.', code: 'SELF_MODIFICATION_FORBIDDEN' })
```

This does not require a `roles` collection and can be implemented at any time.

### Prerequisites

- T-08 (Authority service) is the natural home for role-to-permissions resolution. Without T-08, the change touches 5+ services (same anti-pattern as AUDIT.md 6.3).
- T-09 full implementation should follow T-08.

### Owner's Comments

- 2026-03-16: Raised by owner — need ability to add/edit/remove roles with permissions. Custom roles and permissions require backend work; tracked here. Standalone self-modification guard (AUDIT 1.4) can be patched sooner.

---

## T-10 — Restore migration-service

**Status:** 🔲 Railway deployment unverified. A Rust port exists at `services/migration-service/src/main.rs`. Project owner reports service not working (2026-03-17).

### Problem

`services/migration-service.js` was accidentally deleted in commit `4a8f547`
("chore: retire Node.js services") along with the other Node.js services.
TICKETS.md T-04c explicitly states "migration-service stays Node.js (intentional)".

The gateway (`services/gateway/src/main.rs`) still calls
`POST {MIGRATION_SERVICE_URL}/migrate/run` on every boot and logs an error if
the service is unreachable. Without a running migration-service:

- MongoDB TTL indexes for `messages` and `locations` are not applied on new
  deployments (data is filtered in-query as a fallback, but not auto-purged at
  the DB level — privacy regression for data at rest).
- Migration `003_blocks_indexes` (unique index on `blocks`, index on
  `blockedUserId`) is not applied — duplicate block documents can be inserted
  (see also AUDIT.md 2.0 and 3.1-related context).
- Migration `004_tiers_seed` is not applied — tiers-service falls back to
  static tiers.

### Fix

Restore `services/migration-service.js` from git history (last known good:
commit `09f266b` or earlier) and redeploy to Railway. The file is ~179 lines of
Node.js. The Railway service for migration-service was not removed, so
redeployment should be straightforward once the file is back in the repo.

### Prerequisites

None — this is a pure restoration. The gateway already expects it.

### Priority

**HIGH** — data at rest is not being auto-purged from MongoDB; this is a
privacy regression in a privacy-by-design app.

---

## T-13 — Define and stabilise accountType / tier / role as a coherent system

**Status:** Not started.

### Problem

The three orthogonal axes that govern user identity and access are currently
ad-hoc, inconsistently applied, and underdocumented:

- **`accountType`** — `null` for regular users, `"venue"` for venue accounts.
  `null` is used as the implicit default, which means missing-field and
  "normal user" are indistinguishable. No enum or validation exists.
- **`tier`** — DB-backed (`guest`, `regular`, `premium`, `unrestricted`, …).
  Controls feature access flags and radius limits. Added to JWT. Stored in
  `users` collection. Managed via admin UI. Broadly correct but the `unrestricted`
  tier was added manually and is not in the seed migrations yet. The interaction
  between tier and accountType is undefined (e.g. does a venue get a tier?
  what does `nearbyRadiusM` mean for a venue with a fixed location?).
- **`role`** — `"user"` | `"admin"`. Controls admin actions. Added to JWT.
  Currently only two values; hardcoded in every service's `verifyToken` copy.

### Goal

Produce a written spec (in this ticket) agreed by the owner, then implement
it so every service, every JWT claim, and every UI check is consistent.

### Proposed definitions

| Axis | Values | Meaning | Who sets it | In JWT? |
|---|---|---|---|---|
| `accountType` | `"user"` (not `null`), `"venue"` | **What kind of entity** the account represents. Determines which profile fields exist, how location is handled, and which UI view renders. | Admin only (admin UI convert-to-venue / revert). New registrations always `"user"`. | Yes — `account_type` claim |
| `tier` | `guest`, `regular`, `premium`, `unrestricted`, … | **What features and radii** the account is allowed. Fully DB-backed; admin-configurable. Venue accounts can have a tier (controls their message radius). | Admin only. New registrations default to `regular`. Guests always `guest`. | Yes — `tier` claim |
| `role` | `"user"`, `"admin"` | **What system actions** the account may perform (read/write other users' data, call admin endpoints). Orthogonal to tier and accountType. | Bootstrap env var for first admin; admin UI for subsequent promotions. | Yes — `role` claim |

### Concrete changes required

1. **Rename `accountType: null` → `accountType: "user"`** everywhere:
   - `auth-service`: set `account_type: "user"` on every new registration.
   - `users-service`: migration that sets `accountType: "user"` on all
     existing documents where the field is absent or null.
   - All services that read `account_type` from JWT or DB: treat absent/null
     as `"user"` as a backwards-compat fallback (belt-and-suspenders only).
   - Frontend `isVenueAccount()` check: remains `=== "venue"`, no change needed.

2. **Add migration `006_default_account_type`** in migration-service:
   ```
   db.users.updateMany({ accountType: { $in: [null, undefined] } },
                       { $set: { accountType: "user" } })
   ```

3. **JWT `issue_user_token`** in `common/src/auth.rs`: always emit
   `account_type` (never omit it). For non-venue accounts emit `"user"`.

4. **Tiers and venues**: document and enforce that a venue account MUST have
   a tier assigned. The tier's `messageRadiusM` is the distance within which
   a user must be to message the venue (and vice versa). The tier's
   `nearbyRadiusM` is irrelevant for venues (venues don't broadcast GPS;
   they are always visible to users within the *user's* own nearby radius).
   Document this in the tiers-service and in the admin UI tooltip.

5. **Role enum validation**: `users-service` `PATCH /admin/users/:id/role`
   currently accepts any string. Restrict to `["user", "admin"]` (or the
   DB-backed roles list if T-09 is implemented first).

6. **Admin UI**: show `accountType` field as a read-only badge on every user
   row in the search results (alongside tier and role). Make it clear which
   axis is being changed when the admin clicks "Convert to Venue" vs
   "Change Tier" vs "Change Role".

7. **TICKETS.md / AUDIT.md**: once implemented, record the final definitions
   here so they can be referenced in future sessions without re-deriving them.

### Prerequisites

- T-08 (authority service) would centralise these checks, but this ticket can
  be implemented independently service-by-service.
- Migration-service must be running to apply migration 006.

### Owner's note to self

Before implementing: agree on whether `unrestricted` stays a tier or becomes
a role (or a special accountType for internal/developer accounts). Currently
it is a tier with unlimited radii, which leaks into the tier UI. A cleaner
split might be: `role: "developer"` with a bypass in the radius check, leaving
tiers exclusively for user-facing feature control.

---

## T-11 — Enforce 144-character plaintext limit on message send

**Status:** Not started.

### Problem

The UI input counter in `ui/scripts/messages.js` (line 254) correctly counts
down from 144 characters, but there is no enforcement on send. A user can type
more than 144 characters and the message will be submitted without error. The
messages-service validates only the *encrypted* text length (`MESSAGE_MAX_CHARS
= 4096`), which is the ciphertext length, not the plaintext.

The 144-character limit is intentional product behaviour. It must be enforced
before encryption, on the client side.

### Fix

In `messages.js`, before calling `encryptFor()`, check `text.length > 144` and
show an inline error instead of proceeding. No backend change required.

### Prerequisites

None.

---

## T-12 — Remove leftover `bbm_meet` localStorage key

**Status:** Not started.

### Problem

`ui/scripts/auth.js` `clearUserStorage()` (line 44) removes a localStorage key
`bbm_meet` that is not defined as a constant anywhere in the codebase. It
appears to be a leftover from a removed feature. The key name is undocumented
and may silently conflict with future features.

### Fix

Identify what `bbm_meet` was used for (git history), confirm it is fully
retired, then remove the `localStorage.removeItem('bbm_meet')` line from
`clearUserStorage()`.

### Prerequisites

None.
