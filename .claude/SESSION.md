# Session State

> **Read this file FIRST on every session resume** — before AUDIT.md, before TICKETS.md.
> Updated by Claude at session-start and before every commit.
> This file is the bridge across context compactions. Keep it honest and current.

---

**Branch:** `claude/new-session-Sz0e6`
**Session date:** 2026-03-25
**Last updated:** 2026-03-25T10:20Z

---

## In Progress

Nothing.

---

## Completed This Session

- Added `.claude/settings.local.json` to `.gitignore`.
- Stored `GITHUB_TOKEN` in `.claude/settings.local.json` (gitignored).
- Created `.github/workflows/fetch-codeql-alerts.yml` — runs Wednesday 11:15, commits alert snapshot to `dev`.
- Added pre-session step 4 to CLAUDE.md: reads alert file from `origin/dev` via `git fetch + git show`; reports if written this Wednesday.
- Trimmed step 4 to two sentences.
- Filed CodeQL findings as SEC-1.13 and SEC-1.14 in AUDIT_SECURITY.md and AUDIT.md.

---

## Key Decisions Made

- CodeQL alerts fetched weekly by GitHub Actions (not live on session start).
- Pre-session step reads from `origin/dev` so sessions open before 11:15 still see fresh alerts.
- `GITHUB_TOKEN` in `.claude/settings.local.json` only — never committed. Owner must rotate the token shared in chat.

---

## Blockers / Parked Items

None.

---

## Handoff Notes

### Open CodeQL alerts (SEC-1.13 / SEC-1.14) — fix before tickets
All HIGH, `js/clear-text-storage-of-sensitive-data` (CWE-312):

| Alert | File | Line |
|---|---|---|
| #41 | `ui/scripts/auth.js` | 204 |
| #40 | `ui/scripts/auth.js` | 37 |
| #3  | `ui/scripts/favourites.js` | 38 |

Likely the `sex` profile field stored in localStorage/cookie. Fix is part of T-24 (Profile Data Encryption).

### What to do next
1. Fix SEC-1.13 / SEC-1.14 (CodeQL alerts) — priority over tickets.
2. Owner merges open session branches → `dev`.
3. Next ticket: **T-24** (Profile Data Encryption, high priority) or **T-09** (Role CRUD).
