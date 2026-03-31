# Session State

> **Read this file FIRST on every session resume** — before AUDIT.md, before TICKETS.md.
> Updated by Claude at session-start and before every commit.
> This file is the bridge across context compactions. Keep it honest and current.

---

**Branch:** `claude/fix-aria-hidden-focus-ZsyJo`
**Session date:** 2026-03-31
**Last updated:** 2026-03-31T13:30Z

---

## In Progress

Client-side bug fixes (current session) — committing now.

---

## Completed This Session

### Fix batch 2 — client-side bugs from v3e46488 deploy

#### `DEBUG is not defined` — lock.js crash (breaks every page)
- **Root cause**: `lock.js` referenced `DEBUG` as a bare identifier but never declared it. `api.js` declares `const DEBUG` as a module-scoped constant; it does not leak to other modules.
- **Fix**: Added `const DEBUG = window.location.search.includes('dbg');` at the top of `lock.js`.

#### aria-hidden / focus accessibility warning
- **Root cause**: `lock()` and `unlock()` showed/hid the Bootstrap modal while a focused element remained in the page or modal. Browser blocks `aria-hidden` on elements with focused descendants.
- **Fix**: Call `document.activeElement?.blur()` before `modal.show()` (in `lock()`) and before `modal.hide()` (in `unlock()`).

#### Map — self marker and radius stale after logout
- **Root cause**: `onLogout()` did not remove `selfMarker`, `selfCircle`, or reset `viewRadius`/`lastSex`. After logout, the logged-in user's sex-aware icon and large admin radius remained on the map.
- **Fix**: `onLogout()` now removes `selfMarker`, `selfCircle`, resets `viewRadius=0`, `lastSex=undefined`, and calls `refreshRadius()` to fetch the guest tier radius. `placeSelfMarker()` now guards against non-registered users: guests do not get a personal sex-aware marker. The radius circle is shown for both guests and registered users (guest circle uses neutral yellow).

#### Map — fresh guest has no radius circle
- **Root cause**: `refreshRadius()` was only called from `Auth.onLogin`. Guests (never logged in) never triggered `onLogin`, so `viewRadius` stayed 0 and no circle was drawn.
- **Fix**: After `await window.__authReady` in `initApp()`, if `!Auth.isRegistered()`, call `mapModule.refreshRadius()` to fetch the guest tier radius.

#### /messages — "No conversations" message missing
- **Root cause**: `handleConversationsUpdate([])` with empty messages produced an empty thread map, and `Promise.all([]).then(arr => arr.join(''))` set `wrap.innerHTML = ''` (blank).
- **Fix**: Early return with empty-state message when `Object.keys(threads).length === 0`.

#### /settings — account info shows "Loading…" forever if API down
- **Root cause**: `initAccountInfo()` showed "Loading…" initially, then catch block did nothing on API failure, leaving "Loading…" forever.
- **Fix**: JWT data (nickname, tier, role) rendered synchronously as immediate fallback. API call runs after and enriches with email if available.

#### /profile — SSR content flicker (nickname/age h? element appears then disappears)
- **Root cause**: Server renders SSR content (nickname, age) into `#profileFormWrap`. JS only replaces it after `await window.__authReady` (up to several seconds later). Brief flash of SSR data before the proper profile form.
- **Fix**: Added immediate `#profileFormWrap` clear at the start of `initApp()` (at `DOMContentLoaded` time, before auth resolves).

---

## Key Decisions Made

- Self marker (sex-aware icon) is only for registered users. Guests are not personally identified on the map — only a radius circle shows their coverage area.
- `placeSelfMarker()` is the enforcement point for this rule, not just `onLogout()`. This prevents the stale-icon bug from reoccurring in any path that calls `placeSelfMarker`.
- `onLogout()` spec now matches `onGuestExpired()` for clearing — both clear ALL map state including selfMarker, selfCircle, viewRadius.
- `DEBUG` must be declared in every module that uses it. api.js's `const DEBUG` is module-private; other modules that need debug logging must declare their own.

---

## Blockers / Parked Items

- **503 / signal timeout on Railway** — `/api/health`, `/api/favourites`, `/api/location` all timing out. Cold-start or service down. Backend/infra issue.
- **`/api/admin/location-config` timeout** — admin settings location tab shows "Location config unavailable." Backend.
- **`/favourites` and other protected routes redirect** — JWT_SECRET mismatch. Both server and gateway must use the same secret.
- **`adminListVenueManagers`** uses `by=role&q=venue_manager` — confirm server's admin/users handler supports `by=role` filter.
- **Fixed-location venues on map** — if not returned by `GET /location/nearby`, won't appear. Backend concern.
- **`specs/ui/opaque-client.yaml` missing** — OPAQUE protocol client spec. Medium priority.
- 18 CodeQL alerts open (fetched 2026-03-25).

---

## Handoff Notes

### Railway env vars
No new env vars required. All fixes are client-side JS only.

### Deploy impact
- `window.Auth.isRegistered()` now gates the self marker in `placeSelfMarker()`. Any path that triggers `placeSelfMarker` for a guest will correctly show only the radius circle.
- Self marker is now explicitly removed on logout (not just cleaned up on next `geo:position` event).

### Next session priorities
1. Verify guest radius circle appears correctly after deploy.
2. Investigate 503/timeouts on Railway — may need to extend cold-start timeout or check service health.
3. Write `specs/ui/opaque-client.yaml`.
4. Check `adminListVenueManagers` backend support for `by=role` filter.
