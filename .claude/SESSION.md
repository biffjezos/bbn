# Session State

> **Read this file FIRST on every session resume** — before AUDIT.md, before TICKETS.md.
> Updated by Claude at session-start and before every commit.
> This file is the bridge across context compactions. Keep it honest and current.

---

**Branch:** `claude/project-orchestrator-setup-sd7v52`
**Session date:** 2026-07-22
**Last updated:** 2026-07-22T00:00Z

---

## In Progress

Nothing — committing the orchestrator-mode CLAUDE.md rewrite now.

---

## Completed This Session

### CLAUDE.md rewritten for orchestrator mode (no code touched)

Owner decided the session model (Fable 5) acts as project orchestrator and
delegates work to cheaper models via the Agent tool:

- New **Orchestration** section at the top of CLAUDE.md: routing table
  (coding → `sonnet` subagents, retrieval/search → `haiku` subagents,
  planning/review/commits/state files/trivial edits/crypto-and-privacy-critical
  work → orchestrator inline), briefing requirements (subagents start with zero
  context — briefs must carry paths, module contracts, and the relevant Known
  Failure Modes / Never Do rules verbatim), subagent boundaries (no commits, no
  pushes, no `.claude/` edits, no workflow files, no `docs/`), and a mandatory
  review-before-staging rule for all subagent diffs.
- Everything hook-dependent preserved unchanged: session-start protocol,
  pre-commit checklist, wrap-up, Persistent Files table, compaction rules.
- Owner rules (Never/Always Do) preserved verbatim, now explicitly binding on
  subagents too; Known Failure Modes list kept as the source to copy into briefs.
- Ticket Workflow gained a routing decision step; CHANGELOG friction logging now
  explicitly covers delegation friction (bad briefs, subagent scope creep).

## Key Decisions Made

- Delegation is the default for coding (sonnet) and retrieval (haiku); the
  orchestrator never delegates encryption/hashing/auth-timing/privacy-critical
  work and never commits unreviewed subagent output.
- Hook contract and owner rules were deliberately kept despite the "full
  override" permission — the SessionStart/PreCompact/PostToolUse hooks and
  verify.sh still parse these files, and the Never/Always rules are owner
  policy, not harness mechanics.

---

## Blockers / Parked Items

Carried over (unchanged since 2026-07-02):

- **502/503 + signal timeouts on Railway** — `/api/auth/guest`, `/api/health`, `/api/favourites`. Backend/infra, not frontend-fixable.
- **`/api/admin/location-config` timeout** — admin settings location section shows "unavailable". Backend.
- **JWT_SECRET mismatch suspicion** (INFRA-1.4) and **CORS_ORIGINS env var** (INFRA-1.3) — owner actions in Railway still pending.
- **geo.js:172 browser violation** and **ipwho.org 503** — console noise only, handled with fallbacks.

---

## Handoff Notes

- This branch touches only `.claude/CLAUDE.md`, `SESSION.md`, and
  `CHANGELOG.md` — no code, no CI workflows. Safe to merge into `dev`
  independently.
- From the next session on, operate in orchestrator mode per the new
  Orchestration section: route per the table, write self-contained briefs,
  review every subagent diff before staging.
- Next session priorities (unchanged): investigate the Railway 502/503
  timeouts; INFRA-1.3 / INFRA-1.4 owner actions are still open.
