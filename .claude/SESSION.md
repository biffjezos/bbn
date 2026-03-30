# Session State

> **Read this file FIRST on every session resume** — before AUDIT.md, before TICKETS.md.
> Updated by Claude at session-start and before every commit.
> This file is the bridge across context compactions. Keep it honest and current.

---

**Branch:** `claude/new-session-wfizk`
**Session date:** 2026-03-30
**Last updated:** 2026-03-30T00:00Z

---

## In Progress

T-29 — JS cleanup (next session)

---

## Completed This Session

- **T-28 Phase 4 — Minimal SSR data injection** ✅ (T-28 complete)
  - `guards.rs`: `AuthContext.raw_token` added — carries raw JWT string for gateway forwarding
  - `main.rs`: `MeData` struct (nickname, age, sex, bio, tier, account_type), `fetch_me` (3 s timeout, graceful None on error), `page_profile` and `page_settings` call `fetch_me` and insert `ssr_me` into Tera context
  - `templates/pages/profile.html`: renders nickname/age/sex/bio on first paint from `ssr_me`
  - `templates/pages/settings.html`: renders tier/account_type in `accountInfoWrap` from `ssr_me`
  - `cargo build -p server` — zero errors, zero warnings

- **T-31 — Modal scope fix** ✅
  - modal-block → index, messages-thread, profile-view via `{% include %}`
  - modal-delete → settings via `{% include %}`
  - Removed both from base.html

- **T-28 Phase 3 — Server-side route guards** ✅
  - guards.rs, JWT_SECRET, bbn_tok cookie in auth.js, client guard script removed

- **T-28 Phase 2 — Tera template migration** ✅
  - All templates ported, api.js API_BASE fixed

---

## Key Decisions Made

- **`fetch_me` URL**: calls `{gateway_url}/api/users/me` (proxy preserves `/api/` prefix)
- **SSR data strategy**: inject as Tera variables and render HTML on first paint; JS overwrites with interactive form on load (no `window.__bbnSSR` indirection needed at this stage)
- **Graceful degradation**: `fetch_me` returns `None` on any error → template falls back to "Loading…" / empty placeholders; page never 500s

---

## Blockers / Parked Items

- Site is offline (owner aware). JS module fixes are T-29.
- `JWT_SECRET` must be added to Railway env vars for the server service.
- `GATEWAY_URL`, `GATEWAY_ALLOWED_HOST`, `ASSET_VERSION` also needed in Railway for server.
- `fetch-codeql-alerts.yml` cannot push to `dev` (protected branch).
- 18 CodeQL alerts open (fetched 2026-03-25).
- `claude/fix-pwa-android-install-efOUW` branch pending merge → `dev`.

---

## Handoff Notes

### Start here next session
**T-29 — JS cleanup.** Read T-29 ticket before starting.

T-28 is fully done. T-30 (deployment) is next in sequence but requires owner action (Railway provisioning). T-29 JS cleanup can proceed in parallel.

T-29 scope:
1. Fix `window.Api.*` references in auth.js — `window.Api` is never set in ES6 module context; should import from `api.js`
2. Fix `window.BOOMBOOM_API_URL` references in geo.js, messages.js, notifications.js, warmup.js — already eliminated in api.js; these files may use the global directly
3. Fix `settings.js` — function bodies are stubs; this is a total loss, deferred
4. Review all scripts for `window.BOOMBOOM_BASE` references (eliminated — base is now `/`)
5. Ensure `boomboom.js` correctly imports Auth and Api modules

### Other notes
- T-28 done ticket stub should be created before next session's commit.
- T-30 deployment ticket is the next high-priority item after T-29, but requires Railway work by the owner.
