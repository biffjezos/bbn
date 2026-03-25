# Session State

> **Read this file FIRST on every session resume** — before AUDIT.md, before TICKETS.md.
> Updated by Claude at session-start and before every commit.
> This file is the bridge across context compactions. Keep it honest and current.

---

**Branch:** `claude/fix-venue-messaging-MKdDl`
**Session date:** 2026-03-25
**Last updated:** 2026-03-25T20:00Z

---

## In Progress

(nothing)

---

## Completed This Session

- **Fix: cannot send message to venue — "User has no public key"**
  - Root cause: `getPublicKey(venueId)` in `messages.js` calls `getProfile(venueId)` → `/users/${venueId}/profile`. Venues have no account and no public key. The profile endpoint also didn't include `managerId` in its projection or response, so the frontend had no way to find the manager.
  - Fix (backend): added `managerId` to `ProfileDoc`, added it to both DB projections and both JSON response blocks in `get_profile` (`users-service/src/main.rs`).
  - Fix (frontend): `getPublicKey` in `messages.js` now checks `profile.accountType === 'venue'` + `profile.managerId` and recursively resolves the manager's public key instead of erroring.

- **Fix: venues not appearing in nearby WS for premium users**
  - Root cause: `tiers.rs` `nearby_radius` and `message_radius` endpoints used `load_tiers()` then `tiers.get(&tier).map_or(500, ...)`. If `meta_tiers` collection is partially seeded (has some docs but not "premium"), `tiers.get("premium")` returns None → fallback 500m. Location-service caches this 500m for premium, so nearby radius = 500m instead of 23km. Venue is outside 500m → excluded from nearby.
  - Fix: added `.or_else(|| static_tiers().get(&tier))` to both `nearby_radius` and `message_radius` — mirrors the fix applied to `verify.rs` in the previous session.
  - **Note**: after deploy, the location-service tier_radius_cache must expire (5-minute TTL) before premium users see the correct 23km radius. Or restart location-service.

- **Fix: all services fail to build — tiers-service removed from workspace but still referenced in Dockerfiles**
  - Root cause: `tiers-service` was removed from `services/Cargo.toml` workspace members but all 8 Dockerfiles (`Dockerfile.authority`, `.users`, `.favourites`, `.gateway`, `.location`, `.messages`, `.blocks`, `.migration`) still had `COPY services/tiers-service/Cargo.toml` + `RUN mkdir -p ./tiers-service/src` lines.
  - Fix: removed those two lines from all 8 Dockerfiles. Not a cache issue — the file simply no longer exists in the repo.

- **Fix: premium users see zero nearby users / venues not on map / compass "out of range"**
  - Root cause 1: `common/src/auth.rs` — `AuthedByGateway` fallback (used when X-Auth-Radii headers are absent, i.e. the WS nearby path) was hardcoded to `nearby_m: 500`. Premium users were capped at 500 m instead of 23 km.
  - Root cause 2: `authority-service/src/verify.rs` — if `meta_tiers` collection is partially seeded (missing "premium"), `tiers.get("premium")` returned None and fell through to `(500, None)`. Now falls back to static tier definitions.
  - Fix: changed fallback to `nearby_m: 0` (signals "unknown") — location-service already handles 0 by looking up the tier's actual radius.

- **Fix: tier change → withinRange goes stale**
  - Root cause: admin tier change updates DB but range-sync is only triggered by location pushes. If no one pushes after the change, withinRange stays stale from the previous tier's radius.
  - Fix: `users-service/src/main.rs` `admin_patch_tier` and `admin_patch_user` now `$unset withinRange` for all favourite pairs involving the changed user. Range-sync recalculates on next location push.

- **Fix: message icon shown for venues with canReceiveMessages:false**
  - `favourites-service/src/main.rs`: Added `canReceiveMessages` to `UserProfile`, DB projection, and GET /favourites JSON response (venues only).
  - `ui/scripts/favourites.js`: `canMsg` now checks `f.canReceiveMessages !== false`. Icon hidden completely (not greyed out) when can't message.

---

## Key Decisions Made

- `nearby_m: 0` is the canonical "unknown / use tier lookup" sentinel in `GatewayRadii`.
- `canReceiveMessages` is returned from GET /favourites only for venue entries (null for regular users).
- Tier change resets withinRange to null; it recalculates on next location push (acceptable UX).

---

## Blockers / Parked Items

- `fetch-codeql-alerts.yml` still cannot push to `dev` (protected branch). Owner must allow `github-actions[bot]` to bypass protection.
- 18 CodeQL alerts open (fetched 2026-03-25). SSRF alerts in messages-service, location-service, favourites-service, gateway need review. See codeql-alerts.md on origin/dev.

---

## Handoff Notes

### What to do next
1. Merge `claude/fix-venue-messaging-MKdDl` → `dev`.
2. Redeploy **users-service** on Railway (backend change to `get_profile`).
3. CodeQL SSRF alerts (18 open) — take priority at next session.

### Notes for next session
- The `nearby_m: 0` sentinel is the correct fallback in `GatewayRadii`. Do NOT restore it to 500.
- The WS nearby path in `gateway/src/ws.rs` still does not inject X-Auth headers — it relies on the 0-fallback in common/auth.rs + tier lookup in location-service. This works but is architecturally imperfect.
- `withinRange` reset on tier change is done in users-service via `$unset`. Range-sync recalculates on next location push.
- The partial-seeding bug pattern (load_tiers() returns DB docs when collection is non-empty, so missing tiers get the default instead of static fallback) is now fixed in all three places: `verify.rs`, `tiers.rs::nearby_radius`, `tiers.rs::message_radius`. No further instances known.
- Venue messaging E2EE now works: `getPublicKey` resolves venue → manager transparently. The venue's `managerId` is now returned by `GET /users/:id/profile` for venue accounts.
