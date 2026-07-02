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

Read-only codebase review delivered 2026-07-02 (no code changes, per owner instruction).
Key results in the review report (chat) — headline: messages thread page is broken by a
frontend contract mismatch (threadWrap vs threadMsgs, missing 'view' WS subscribe, ignored
send:error, plaintext fallback on encrypt failure); gateway HTTP client has no default
timeouts (502 source); gateway rate limiters reset every 60s; WS send path bypasses the
message_online tier gate; delete_me doesn't purge blocks/notifications; Dockerfiles don't
copy Cargo.lock; deploy.yml still deploys Jekyll (T-30 open). cargo check --workspace: PASS.
Next step: owner decides → file findings as audit items/tickets, then fix in priority order.

---

## Completed This Session

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
