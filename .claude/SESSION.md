# Session State

> **Read this file FIRST on every session resume** — before AUDIT.md, before TICKETS.md.
> Updated by Claude at session-start and before every commit.
> This file is the bridge across context compactions. Keep it honest and current.

---

**Branch:** `claude/improve-collaboration-workflow-04TUN`
**Session date:** 2026-03-24
**Last updated:** session-start

---

## In Progress

Implementing collaboration workflow improvements (requested by owner this session):
- `.claude/hooks/precompact.sh` — PreCompact hook to warn before context compaction ✅
- `.claude/hooks/posttooluse-audit.sh` — PostToolUse audit log ✅
- `.claude/settings.json` — project-level hook wiring ✅
- `.claude/verify.sh` — post-commit artifact verification script ✅
- `.claude/SESSION.md` — this file ✅
- `.claude/settings.json` — adding SessionStart compact hook (pending commit)

---

## Completed This Session

- [5c5b30f] harness: SESSION.md, hooks (PreCompact, PostToolUse), verify.sh, settings.json, CLAUDE.md rules

---

## Key Decisions Made

- PreCompact hook blocks auto-compaction (exit 2) if SESSION.md is stale (>5 min); Claude must update SESSION.md first, then compaction proceeds automatically on next trigger
- PostToolUse hook logs Edit/Write/Bash to `session-audit.log` (TSV) — this is the ground truth for what actually changed
- verify.sh is a manual script Claude runs after each commit (before push); checks: files changed, ticket stubs, audit stubs, SESSION.md freshness
- Project-level `.claude/settings.json` used (not global) so hooks only apply to this repo
- Existing global stop hook (git check) is left untouched

---

## Blockers / Parked Items

_(none)_

---

## Handoff Notes

> For next Claude session: The collaboration harness is fully implemented. The three things to know:
> 1. Run `bash .claude/verify.sh` after every commit — it checks that claimed work is in artifacts
> 2. PreCompact hook fires automatically; update this file immediately if it blocks you
> 3. This file (SESSION.md) is the most important thing to keep current — it's your memory across compactions
