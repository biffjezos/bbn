# bOOmbOOm.NOW! — Completed Tickets

Tickets and phases moved here once fully implemented and deployed.
Reference this file for historical context, decisions, and implementation details.
**Do not read this file on session start.**

---

## T-20 — Sharded Location Store: Phases 1–4 (2026-03-23)

Phase 5 (auto-adjustable shard size) remains deferred in TICKETS.md.

### What was implemented

| Phase | Status | What |
|---|---|---|
| 1 | ✅ | `common/src/shard.rs` — `ShardKey`, `shard_for_coords`, `intersecting_shards`, `min_dist_to_shard` + 16 unit tests |
| 2 | ✅ | `location-service/src/store.rs` — `MemoryStore` with full sharded upsert/remove/nearby/sweep; `location-service/src/db_store.rs` — `DbStore` backed by MongoDB `locations` collection; `location-service/src/location_store.rs` — `Store` enum dispatching to either backend; `LOCATION_STORE=memory\|db` env var |
| 3 | ✅ | `location-service/src/main.rs` — wired to `Arc<Store>`, reads all tuning env vars |
| 4 | ✅ | `migration-service/src/main.rs` — migration `007_shard_index` adds compound `{ shard_key: 1, updatedAt: -1 }` index on `locations` |

### Key design decisions

- **Shard key format:** `"{lat_idx}:{lon_idx}"` string stored as `shard_key` field — simple, unambiguous, works with `$in` queries.
- **Suppression in DbStore:** per-instance in-memory HashMap; avoids redundant DB writes without requiring shared state.
- **Multi-replica:** `memory` mode is single-process only (documented). `db` mode is replica-safe; all instances query the same `locations` collection.
- **early-exit traversal (memory only):** shards sorted by `min_dist_to_shard`; loop breaks when heap is full and next shard's nearest edge is farther than the Nth result.
- **Favourites reserved-slot model:** favourites fill their positions first, then remaining `limit - K` slots go to nearest non-favourites. Total never exceeds `limit`.

---

## T-17 — .unwrap() + email validation + logging in auth-service

**Status:** ✅ Complete (2026-03-19).

### What was implemented

**auth-service:**
- Added `is_valid_email()` helper; register and login now reject malformed addresses with 400 `"Invalid email address."`.
- Replaced `r.inserted_id.as_object_id().unwrap()` with an explicit error branch — no panic on unexpected DB `_id` type.
- Fixed pre-existing compile error: `account_type: Some("user")` → `"user"` in register handler (field type changed to `&str` in an earlier common refactor but auth-service wasn't updated).
- `tracing_subscriber::fmt::init()` → `tracing_subscriber::fmt().with_env_filter(EnvFilter::from_default_env()).init()` — honours `RUST_LOG`.

**users-service:**
- Added `is_valid_email()` helper; `PUT /users/me` email-update path now validates format before writing to DB.
- Same tracing fix as above.

**All other Rust services (blocks, favourites, gateway, location, messages, migration, tiers):**
- Same tracing fix — all 9 services now respect `RUST_LOG`.

### Backend note

Set `RUST_LOG=warn` (or `info`, `error`, `debug`) on each Railway service to control log verbosity. No other backend action required.

---

## T-07a — Settings Page

**Status:** ✅ Complete (2026-03-18).

### What was implemented

- Route: `/settings/` — full settings page loaded via the app layout
- **Blocked users** — list of blocked accounts with unblock button (T-05 integration)
- **Account info** — displays email, accountType, tier, role (read-only)
- **App limits** — shows session duration, message TTL, other tier-derived limits
- **Profile editing** — nickname, age, sex (same fields as registration)
- **Password change** — current + new password form
- **Preferences** — map default zoom and show-favourite-pins toggle; stored server-side in `users` document via `GET/PUT /users/me/preferences`; `prefs.js` added as global module (loads between `blocks.js` and `map.js`); localStorage used as synchronous read-through cache for `map.js`
- **Danger zone** — account deletion and other destructive actions

### Backend additions (users-service)

- `GET /users/me/preferences` — returns `{ mapZoom, showFavPins }` with defaults (17, true) when sub-document absent
- `PUT /users/me/preferences` — updates `preferences.mapZoom` and/or `preferences.showFavPins` via dot-notation `$set`

### New files

- `ui/settings/index.html`
- `ui/scripts/settings.js`
- `ui/scripts/prefs.js` (global preferences module)

### Notes

- T-16 `meta` entries for `map_default_zoom` and `show_favourite_pins_on_map` are now server-side per-user prefs (not admin-controlled `meta`). T-16 entry updated accordingly.

---

## T-08 Phase 1 — Normalise accountType / tier / role (ex-T-13)

**Status:** ✅ Complete (2026-03-18).

**Canonical axis definitions:**

| Axis | Values | Meaning | Who sets it | In JWT? |
|---|---|---|---|---|
| `accountType` | `"user"` (never `null`), `"venue"` | What kind of entity the account represents. | Admin only. New registrations always `"user"`. | Yes — `account_type` claim |
| `tier` | `guest`, `regular`, `premium`, `unrestricted` | Feature gates and radius limits. | Admin only. New registrations default to `regular`. | Yes — `tier` claim |
| `role` | `"user"`, `"admin"`, `"venue_manager"` | System actions the account may perform. | Bootstrap env var / admin UI. | Yes — `role` claim |

**What was done:**
- Legacy accounts without `accountType` deleted from DB directly (dev environment, two test accounts).
- `account_type: Option<String>` → `String` across all services and `common/src/auth.rs`.
- All `.as_deref() == Some("venue")` patterns replaced with direct `== "venue"` comparisons.
- `skip_serializing_if` on `account_type` in JWT claims removed — field always present.
- `migration_007` (`007_default_account_type`) removed from migration-service (no longer needed; DB has no null accountType rows).
- `UserTokenParams.account_type: Option<&str>` → `&str`.

**Note (owner, 2026-03-18):** `unrestricted` stays a tier. No `developer` role or accountType.

---

## T-11 — Enforce 144-character plaintext limit on message send

**Status:** ✅ Complete (2026-03-18).

Added a guard in `ui/scripts/messages.js` (send handler, line 266) that checks
`text.length > 144` before calling `encryptFor()`. Shows an inline error and
returns early — encryption and send are never reached for oversized input.
No backend change required.

---

## T-12 — Remove leftover `bbm_meet` localStorage key

**Status:** ✅ Closed as invalid (2026-03-18).

Investigated during session 2026-03-18. `bbm_meet` is **not** a leftover — it is the active storage key for the compass/meeting feature (`localStorage.setItem('bbm_meet', JSON.stringify({ uid, nickname, sex }))` in `ui/scripts/favourites.js`). The `localStorage.removeItem('bbm_meet')` in `clearUserStorage()` is intentional: cancelling an active compass target on logout is correct behaviour. No action required.

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

### Bootstrap mechanism

**Problem:** You need an admin to create an admin. Manual DB edits must not be the answer — they bypass auth and are not portable.

**Solution: `ADMIN_BOOTSTRAP_USER_ID` env var on auth-service (or gateway)**

1. Developer registers a normal account via the app.
2. Sets `ADMIN_BOOTSTRAP_USER_ID=<userId>` as an env var on Railway.
3. On next service boot: if no admin exists yet, the service promotes that userId to `role: admin`, bumps their `tokenVersion`.
4. Developer re-logs in → receives a JWT with `role: admin`.
5. Env var is removed from Railway (the service is a no-op if an admin already exists, but it should be removed as hygiene).

This is the only path to the first admin. All subsequent admin promotions go through the admin UI with an authenticated admin JWT. Raw DB edits to role/tier fields have no effect without a `tokenVersion` bump, which only the service can perform.

### Owner's Comments

- **2026-03-16:** Confirmed: admin is a role, not a tier. Bootstrap via env var is the right approach. Raw DB edits must not grant access.

---

## T-03 — DB-stored Tiers + Configurable RBAC

**Status:** ✅ Complete (2026-03-16).

### Implemented (2026-03-16)

- `services/migration-service.js` — migration `004_tiers_seed`: seeds guest/regular/premium into `tiers` collection (`$setOnInsert`, idempotent). Pending disk space (AUDIT.md 2.0) — static fallback active until applied.
- `services/tiers-service.js` — full rewrite: MongoDB connection, 60s TTL cache (`loadTiers()`), `STATIC_TIERS` fallback if collection empty, new `GET /tiers/:name/info` endpoint, async radius lookups
- `services/server.js` — added `GET /api/tiers/:tier/info` proxy route
- `services/location-service.js` — fixed inline radius table (guest was 23,000 m → correct 500 m)
- `ui/scripts/api.js` — added `getTierInfo(tier)` method
- `ui/scripts/profile.js` — replaced hardcoded `TIER_DISPLAY` / `tierFeatureHtml` with API-driven version using `getTierInfo()` (fixes AUDIT.md 3.2)

**New env vars for tiers-service:** `MONGO_URI`, `DB_NAME` (same values as other services).

### Architectural Decision

**Access control model: Enhanced RBAC + access gates. No full ABAC policy engine.**

Roles are stored as DB documents. Dual-control access (e.g. admin requesting block note decryption, legal approving it) is handled via a shared `access_requests` collection — not a policy engine. New gates are new `resourceType` values in that collection. This pattern ports cleanly to Rust and requires no new infrastructure.

### Owner's Comments

- **2026-03-16:** Approved for implementation.

---

## T-04 — Port Services to Rust

**Status:** T-04a ✅ Complete (2026-03-16). T-04b ✅ Complete (2026-03-16). T-04c ✅ Complete (2026-03-17). All services + gateway now in Rust. migration-service remains Node.js (intentional).

### T-04a — tiers-service Rust port (2026-03-16)

Rust tiers-service live on Railway. Static fallback active; migration 004 still blocked on disk space (AUDIT.md 2.0).

### T-04b — auth-service Rust port (2026-03-16)

- `services/auth-service/` — full Rust port (axum 0.8, bcrypt, mongodb 3)
- `common/src/auth.rs` — added `email` to `UserClaims`, added `issue_user_token` / `issue_guest_token` (reusable for future service ports)
- `role` field added to JWT (`user` | `admin`). Read from DB on login; new users get `role: user` on register.
- Bootstrap mechanism: `ADMIN_BOOTSTRAP_USER_ID` env var. On boot, if set and no admin exists, promotes that user and bumps `tokenVersion`. Safe to leave set (no-op after first run, but should be removed).
- `services/Dockerfile.auth` for Railway deployment.
- Identical HTTP contract to `auth-service.js` — gateway unchanged.

**New env vars for auth-service:** `MONGO_URI`, `DB_NAME`, `JWT_SECRET` (same values as other services), `ADMIN_BOOTSTRAP_USER_ID` (one-time, remove after use).

**OPAQUE/PAKE deferred** until further work — see AUDIT.md 1.1 and T-05b.

### T-04c — remaining services + gateway Rust port (2026-03-17)

- `services/blocks-service/` — Rust port (axum 0.8, mongodb 3)
- `services/favourites-service/` — Rust port; fixed E0716 (tokio::join! temporaries), E0728 (await in non-async closure)
- `services/messages-service/` — Rust port; E2EE ciphertext validation, route conflict fix (`/messages/{id}` combined)
- `services/users-service/` — Rust port; bcrypt via spawn_blocking, regex_escape helper, find_one_and_update with ReturnDocument::After
- `services/gateway/` — Full Axum port of server.js: 28 HTTP proxy routes, fixed-window per-IP rate limiting, CORS via tower-http, WS location + WS messages handlers (mpsc channel pattern, auth timeout, push timers), 30s health cache, migration-on-boot call
- `services/Dockerfile.*` — per-service multi-stage Docker builds with workspace stubs
- `services/Cargo.toml` — workspace updated with all new members and tower-http dep
- **Deferred (see T-08):** signed internal auth context (X-Auth-* headers); requires updating all 7 downstream services + gateway simultaneously

**New env vars for gateway:** `JWT_SECRET`, `SERVICE_SECRET`, `AUTH_SERVICE_URL`, `USERS_SERVICE_URL`, `LOCATION_SERVICE_URL`, `MESSAGES_SERVICE_URL`, `FAVOURITES_SERVICE_URL`, `TIERS_SERVICE_URL`, `BLOCKS_SERVICE_URL`, `MIGRATION_SERVICE_URL`, `ALLOWED_ORIGINS` (optional, default: `https://biffjezos.github.io`), `PORT` (optional, default: 8080).

**Note:** `JWT_SECRET` and `SERVICE_SECRET` are separate — `JWT_SECRET` signs user/guest tokens; `SERVICE_SECRET` signs inter-service `X-Service-Token` JWTs.

### Owner's Comments

- **2026-03-16:** Priority elevated. Tiers-service first (T-04a), then auth-service + OPAQUE (T-04b) which unblocks T-05 block-note encryption. Remaining services (T-04c) follow incrementally.

> **Reminder (2026-03-16):** Once T-04 (full Rust port) is complete, upgrade the Railway MongoDB plan to free up disk space. This will unblock migration `003_blocks_indexes` (see AUDIT.md 2.0) and should be done before any growth push. Dev-alpha state is acceptable until then.

---

## T-05 — Blocking & Reporting (Phase 1)

**Status:** ✅ Phase 1 complete (2026-03-16). Deployed.
**Note:** T-05b (encrypted note field) is still pending in TICKETS.md — blocked on OPAQUE (T-04b followup).

### Implemented (2026-03-16)

- `services/blocks-service.js` — new service, deployed on Railway
- `services/server.js` — proxy routes + health aggregator entry
- `services/location-service.js` — block filter on nearby results (30 s cache)
- `services/messages-service.js` — block check before message delivery
- `services/users-service.js` — directional block check on `/profile`: blockee gets 404; blocker sees profile with `blockedByViewer: true`
- `services/migration-service.js` — migration `003_blocks_indexes` (pending disk space — see AUDIT.md 2.0)
- `ui/scripts/blocks.js` — `BlockModule` global, reason select modal
- `ui/scripts/api.js` — `blockUser`, `unblockUser`, `getBlocks`
- `ui/_layouts/default.html` — loads `blocks.js` on every page
- `ui/_includes/modal-pin.html` — Report/Block in map pin modal
- `ui/scripts/app.js` — wired pin block button
- `ui/scripts/profile.js` — Block/Unblock button, Blocked badge, re-renders in-place
- `ui/scripts/favourites.js` — blocked badge + disabled message btn in list/search

### Architecture

`blocks` collection (phase 1 — no note field yet):
```json
{
  "blockerUserId": "...",
  "blockedUserId": "...",
  "reason": "spam",
  "createdAt": "..."
}
```

`access_requests` collection (dual-control gate for future admin access):
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

---

## T-06 — Venue Accounts + Manager Role (Phase 1)

**Status:** ✅ Phase 1 complete (2026-03-18).
**Note:** T-06b (venue messaging) and T-06c (multiple venues) are still pending in TICKETS.md.

### What Phase 1 covers

- `role: "venue_manager"` added to role enum in auth/users-service
- Admin UI: grant/revoke manager role
- `POST /manager/venues` — create a venue (manager only, enforces one-venue limit)
- `PUT /manager/venues/:id` — edit mutable fields (manager only, ownership check)
- `DELETE /manager/venues/:id` — delete venue (manager only, ownership check)
- `GET /manager/venues` — list manager's venues
- `/profile` manager section: create/edit/delete venue UI
- Map: venue pins rendered from `GET /location/venues`
- Pin modal: venue-specific display
- `/profile/:id` reused — renders venue variant based on `accountType`

### Key design decisions (agreed 2026-03-18)

- Venues are `users` collection documents with `accountType: "venue"` — no credentials, no login
- Managers are regular users with `role: "venue_manager"` granted by admin
- One venue per manager (hard limit, server-enforced) — lifted in T-06c (see below)
- `venueName`, `address`, `fixedLat`, `fixedLon` — immutable after creation
- Deletion cascade: venue deleted → wipe messages, favourites, blocks; manager deleted → cascade-delete their venue first
- Message radius = min(user tier `messageRadiusM`, venue tier `messageRadiusM`)
- Map: venue always visible to users whose `nearbyRadiusM` includes the venue's coordinates
- Favouriting enabled in Phase 1 (read-only card); messaging channel deferred to T-06b

### Owner's Comments

- 2026-03-18: Design agreed. Venue has no credentials, no login. Manager is a regular user with an added role. One venue per manager for now. Venue name/address/location immutable after creation. Tier is fixed (admin-only), no subscription yet.
- 2026-03-18: Deletion cascade, message radius, map visibility, favouriting, and profile page decisions recorded.
- 2026-03-18: Phase 1 complete.
- 2026-03-18: Phase 3 (T-06c) complete — multiple venues per manager enabled.

---

## T-06c — Multiple Venues per Manager

**Status:** ✅ Complete (2026-03-18). Part of T-06.

One-venue limit lifted. A `venue_manager` can now create, manage, and delete multiple venues. The effective per-manager limit is set to 9999 in `POST /manager/venues` (functionally unlimited). Tiered per-manager quotas are tracked separately as T-14 (deferred until T-08 authority service exists).
