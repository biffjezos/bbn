# Session State

> **Read this file FIRST on every session resume** — before AUDIT.md, before TICKETS.md.
> Updated by Claude at session-start and before every commit.
> This file is the bridge across context compactions. Keep it honest and current.

---

**Branch:** `claude/new-session-Sz0e6`
**Session date:** 2026-03-25
**Last updated:** 2026-03-25T09:50Z

---

## In Progress

Nothing — CodeQL alerts workflow not yet created (pending owner confirmation).

---

## Completed This Session

- Added `.claude/settings.local.json` to `.gitignore`.
- Stored `GITHUB_TOKEN` in `.claude/settings.local.json` (gitignored).
- Updated CLAUDE.md: pre-session step 4 reads `.claude/codeql-alerts.md` written by a scheduled agent; reports alerts only on first session after Wednesday scan; includes token-invalid reminder.
- Corrected step 4 to not fetch live on every session start.

---

## Key Decisions Made

- CodeQL alerts fetched weekly (Wednesday 11:15) by a scheduled agent, not on every session start.
- Pre-session step reads `.claude/codeql-alerts.md`; reports if newer than last Wednesday.
- `GITHUB_TOKEN` in `.claude/settings.local.json` only — never committed.
- Owner must rotate token shared in chat transcript.

---

## Blockers / Parked Items

- Scheduled agent (schedule skill) failed to connect — proposed GitHub Actions workflow as alternative, awaiting owner confirmation.

---

## Handoff Notes

### Current open CodeQL alerts (fetched 2026-03-25)
All 3 are HIGH (`js/clear-text-storage-of-sensitive-data`, CWE-312/315/359):

| # | File | Line |
|---|---|---|
| 41 | `ui/scripts/auth.js` | 204 |
| 40 | `ui/scripts/auth.js` | 37 |
| 3 | `ui/scripts/favourites.js` | 38 |

### What to do next
1. Confirm GitHub Actions workflow for weekly alert fetch (or retry schedule skill).
2. Fix 3 CodeQL alerts — priority over tickets.
3. Owner merges open branches → `dev`.
4. Next ticket: **T-09**.
