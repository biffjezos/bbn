# Session State

> **Read this file FIRST on every session resume** — before AUDIT.md, before TICKETS.md.
> Updated by Claude at session-start and before every commit.
> This file is the bridge across context compactions. Keep it honest and current.

---

**Branch:** `claude/review-open-tasks-Vf3ZM`
**Session date:** 2026-03-24
**Last updated:** 2026-03-24

---

## In Progress

T-19 — Rate-limit notification banner (implementing).

---

## Completed This Session

- T-19 implemented: rate-limit banner wired into `#notifBanner` (below navbar) for login, register, and guest-session 429 errors.
  - `auth.js`: fires `Auth.onRateLimited?.()` when retried guest init still hits 429
  - `app.js`: `showRateLimitBanner()` helper + `Auth.onRateLimited` hook + 429 checks in login/register catch blocks

---

## Key Decisions Made

- Rate-limit banner uses `alert-warning` style with dismiss button. Shows once (deduplicated by class check). Links to `/donate/`.

---

## Blockers / Parked Items

None.

---

## Handoff Notes

### State of the codebase
- Branch `claude/review-open-tasks-Vf3ZM` — T-19 committed and pushed.
- Previous session branch (`claude/verify-t08-phase2-deployment-z6h0n`) still needs a PR opened → `dev` by the owner.

### What to do next

1. Open PR from `claude/verify-t08-phase2-deployment-z6h0n` → `dev` (previous session's work).
2. Open PR from `claude/review-open-tasks-Vf3ZM` → `dev` (T-19).
3. Pick next ticket: **T-16 Phase 2** or **T-09**.
