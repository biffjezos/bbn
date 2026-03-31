# Session State

> **Read this file FIRST on every session resume** — before AUDIT.md, before TICKETS.md.
> Updated by Claude at session-start and before every commit.
> This file is the bridge across context compactions. Keep it honest and current.

---

**Branch:** `claude/fix-aria-hidden-focus-ZsyJo`
**Session date:** 2026-03-31
**Last updated:** 2026-03-31T15:00Z

---

## In Progress

Nothing — ready to commit and push.

---

## Completed This Session

### Fix batch 1 — deployed v3e46488 bugs

#### `DEBUG is not defined` — lock.js crash
- Added `const DEBUG = window.location.search.includes('dbg');` at top of lock.js.

#### aria-hidden / focus accessibility warning
- Added `document.activeElement?.blur()` before modal.show() and modal.hide() in lock.js.

#### /messages — blank instead of "No conversations yet."
- Early return with empty-state message when `Object.keys(threads).length === 0` in messages.js.

#### /settings — "Loading…" forever when API down
- JWT immediate fallback (tier, role) rendered synchronously; API enriches with email if available.

#### /profile — SSR content flash
- Removed `{% if ssr_me %}` block from profile.html server template entirely.

#### /settings — email + role in SSR account info
- Added email + role to settings.html SSR; added email field to MeData struct in main.rs.

### Fix batch 2 — regressions introduced in v900626b

#### Guest self marker completely gone
- Removed the `if (!isRegistered) { remove; return; }` guard added in session 1. Guests always get a yellow 👊 marker.

#### Guest shows wrong sex-colored icon after logged-in session
- Added `_sex = null; _nickname = null;` at the start of `initGuest()` in auth.js. Previously sex leaked from expired registered session.

#### Two icons stacked after login (self + nearby self)
- Added `getSelfId()` helper and `if(selfId && u.userId === selfId) return;` self-filter in `renderMarkers()` in map.js.

#### Stale admin radius after logout
- Removed `refreshRadius()` from `onLogout()` (reads stale admin token — cleared 3 lines AFTER onLogout fires).
- Wired `Auth.onGuestReady = () => { mapModule.refreshRadius(); }` in boomboom.js — fires after initGuest() sets guest token.
- `onLogout()` now removes selfMarker, selfCircle, resets viewRadius=0, lastSex=undefined immediately.

#### Female user icon shows yellow instead of pink
- Removed the registered-user guard that was blocking `placeSelfMarker()` from calling `makeLeafIcon(sex,...)`. The icon now always derives from `Auth.getSex()` which returns null for guests (→ yellow fist).

### Cleanup

#### `.claude/specs/` — deleted entirely
- Owner instruction: "REMOVE ALL SPECS. THEY ARE USELESS."
- `rm -rf .claude/specs/`

#### `.claude/CLAUDE.md` — removed all specs-related content
- Deleted "Spec Workflow" section entirely.
- Removed "Update specs." bullet from Before Each Commit.
- Removed "Update spec files" step from Session Wrap-Up Checklist (renumbered steps 3→7 to 3→6, shifting old 4→3, 5→4, 6→5, 7→6, 8→7).
- Removed `.claude/specs/` entry from Persistent Files.

---

## Key Decisions Made

- Guests get yellow 👊 self marker. Registered males get blue 👆. Registered females get pink 🤞.
- `placeSelfMarker()` is never guarded by isRegistered — the icon color derives from `Auth.getSex()` which returns null for guests.
- `_sex` and `_nickname` cleared at the START of `initGuest()` to prevent leaking from expired sessions.
- `refreshRadius()` must not be called from `onLogout()` — `_token` is still the registered user's token at that point. Use `Auth.onGuestReady` instead.
- Specs abolished by owner request.

---

## Blockers / Parked Items

- **503 / signal timeout on Railway** — `/api/health`, `/api/favourites`, `/api/location` all timing out. Cold-start or service down. Backend/infra issue.
- **`/api/admin/location-config` timeout** — admin settings location tab shows "Location config unavailable." Backend.
- **JWT_SECRET mismatch** — protected routes may redirect. Both server and gateway must use the same secret.
- **Fixed-location venues on map** — if not returned by `GET /location/nearby`, won't appear. Backend concern.
- **18 CodeQL alerts open** (fetched 2026-03-25).

---

## Handoff Notes

### Railway env vars
No new env vars required.

### Deploy impact
- Guest self marker restored (yellow fist emoji icon).
- Female icon now correctly pink after login.
- No stale radius or stacked icons after login/logout cycle.
- Settings page shows email + tier + role (not nickname).
- Profile page no longer flashes SSR nickname/age before form renders.
- Messages page shows "No conversations yet." when inbox is empty.

### Next session priorities
1. Verify all map fixes on deployed build.
2. Investigate 503/timeouts on Railway.
3. Check CodeQL alerts (18 open from 2026-03-25).
