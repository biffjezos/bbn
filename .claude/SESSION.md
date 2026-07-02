# Session State

> **Read this file FIRST on every session resume** — before AUDIT.md, before TICKETS.md.
> Updated by Claude at session-start and before every commit.
> This file is the bridge across context compactions. Keep it honest and current.

---

**Branch:** `claude/fable5-harness-strategy-940li4`
**Session date:** 2026-07-02
**Last updated:** 2026-07-02T14:15Z

---

## In Progress

Nothing — fixes implemented and verified, committing now.

---

## Completed This Session

### Codebase review + fixes (2026-07-02, later session)

Read-only review first, then fixed all findings the owner approved. `cargo check --locked
--workspace` PASS; messages.js / api.js pass `node --check`.

**Messaging repair (frontend — this is why messaging was broken):** rewrote `ui/scripts/lib/messages.js`
against the real template IDs and gateway WS protocol — render into `#threadMsgs` (was destroying
`#threadWrap`, the whole page), send `{type:'view'}` to subscribe the thread, handle `send:error`
into `#sendError`, make conversation items link to `/messages/thread/`, wire `#charCount`,
Ctrl/Cmd+Enter, `#threadDisplayName`, and the block button; added a profile cache (kills the N+1).

**Security (SEC-1.16..1.20):** WS messaging now enforces the `message_online` tier gate + tokenVersion
via `/authority/verify` (was raw-JWT, bypassable — gateway/ws.rs); gateway rate limiters only rebuild
when config changes (were resetting counts every 60 s — gateway/main.rs); no-plaintext-fallback on
send (messages.js blocks + prompts unlock instead of sending cleartext); `delete_me` now also purges
`blocks` + `notifications` (users-service); `DEBUG` in api.js gated on `?dbg`.

**Reliability (INFRA-1.5):** gateway + server reqwest clients got connect/read timeouts (15 s / 30 s)
+ a 120 s override on the boot migration call — kills the 502/hang class.

**Deploy reproducibility (INFRA-1.6):** all 9 Dockerfiles now `COPY services/Cargo.lock`, build
`--locked`, and pin `FROM rust:1` (was `rust:latest`). Cargo.lock confirmed tracked + in sync.

**NOT done (needs owner go-ahead):** `deploy.yml` still builds the dead Jekyll site to GitHub Pages —
it's a CI workflow file, blocked by the standing "no CI changes without explicit instruction" rule.
This is ticket T-30 (server deployment / CI migration, 0/3). README doc-rot (bcrypt→OPAQUE, 7d→24h)
and `admin_settings`→`meta_settings` comment drift left as-is (cosmetic).

### Harness restructure for the Fable 5 model tier (no code touched)

- **AUDIT consolidation:** the five concern files (AUDIT_INFRASTRUCTURE/MAINTAINABILITY/USABILITY/SECURITY/PERFORMANCE.md) were deleted and their open items merged into a single `AUDIT.md`, grouped by concern with prefixes kept. All summary tables (per-file + global) removed — the `<!-- ITEM -->` tags are the only status registry. Full texts of resolved SEC-1.10, SEC-1.11, SEC-1.12, SEC-1.15 and MAINT-2.4 archived to AUDIT_DONE.md; every other resolved item was already there.
- **TICKETS.md fixed:** converted from a markdown table to ITEM-tagged headings — the SessionStart open-tickets board had been silently broken since introduction because the hook parses ITEM tags and the table never had any. Five done tickets (T-28, T-29, T-31, T-32, T-33) removed from the index (stubs already in `tickets/done/`).
- **CLAUDE.md rewritten** at ~half length: trust hook-injected context instead of re-reading files at session start; Friction Awareness ritual replaced by a "Known Failure Modes" section; Persistent Files now a table. Owner rules (Never/Always Do) preserved unchanged.
- **Hooks/scripts aligned:** `sessionstart.sh` now parses AUDIT.md only; `verify.sh` audit-ref check simplified to AUDIT.md + AUDIT_DONE.md; legacy TICKETS_DONE.md fallback removed.

## Key Decisions Made

- Machine-parsed `<!-- ITEM -->` tags are the single source of truth for open-item status; no human-maintained summary tables anywhere.
- One audit file for open items (AUDIT.md) + one archive (AUDIT_DONE.md). Concern separation is by section, not by file — 8 open items did not justify 5 files.
- CHANGELOG.md keeps its taxonomy and compaction rules; the distilled failure modes now also live in CLAUDE.md where they are read every session.

---

## Blockers / Parked Items

Carried over from the 2026-04-04 session (fix-deployment-errors branch — check whether its PR was merged):

- **502/503 + signal timeouts on Railway** — `/api/auth/guest`, `/api/health`, `/api/favourites`. Backend/infra, not frontend-fixable.
- **`/api/admin/location-config` timeout** — admin settings location section shows "unavailable". Backend.
- **JWT_SECRET mismatch suspicion** (INFRA-1.4) and **CORS_ORIGINS env var** (INFRA-1.3) — owner actions in Railway still pending.
- **geo.js:172 browser violation** and **ipwho.org 503** — console noise only, handled with fallbacks.
- CodeQL: 0 open alerts as of 2026-07-01 snapshot.

---

## Handoff Notes

- This branch (`claude/fable5-harness-strategy-940li4`) touches only `.claude/` — no code, no CI workflows. Safe to merge into `dev` independently of any code branch.
- After merge, the next session start should show BOTH boards (tickets + audit items). If the tickets board is missing, check that TICKETS.md entries still carry `<!-- ITEM -->` tags.
- Next session priorities (unchanged from 2026-04-04): investigate the Railway 502/503 timeouts; INFRA-1.3 / INFRA-1.4 owner actions are still open.
