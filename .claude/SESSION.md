# Session State

> **Read this file FIRST on every session resume** — before AUDIT.md, before TICKETS.md.
> Updated by Claude at session-start and before every commit.
> This file is the bridge across context compactions. Keep it honest and current.

---

**Branch:** `claude/test-harness-structure-ejKZg`
**Session date:** 2026-03-24
**Last updated:** 2026-03-24 13:10 UTC (pre-commit: unified ITEM format changes)

---

## In Progress

Harness testing — unified `<!-- ITEM ... -->` format for tickets and audit items:
- All ticket tags in TICKETS.md migrated to `<!-- ITEM ... -->` with `concern:` field added ✅
- All audit tags in 5 concern files migrated to `<!-- ITEM ... -->`, `severity:` → `priority:` ✅
- `status:in-progress` → `status:active`, `status:not-started` → `status:open` ✅
- `sessionstart.sh` refactored: shared `parse_items()` function, one parser for both boards ✅

---

## Completed This Session

- [caaa058] harness: machine-readable TICKETS.md metadata + sessionstart board injection (PR #65, merged)
- [c5ccf82] harness: AUDIT concern files tagged + sessionstart audit board
- [this commit] harness: unified <!-- ITEM --> format for tickets and audit items

---

## Key Decisions Made

- Unified tag: `<!-- ITEM id:X status:Y priority:Z concern:W [phase:N/M] [prereqs:...] [relates:...] -->`
- `T` is a valid prefix — `T-08` follows the same `PREFIX-N` pattern as `INFRA-1.1`, `SEC-1.10`, etc.
- `severity` renamed to `priority` (same concept, unified vocabulary)
- `concern` added to ticket tags: `auth · services · db · infra · ui`
- Status vocabulary: `open · planned · active · blocked · deferred · done · closed · superseded`
- `sessionstart.sh` uses a shared `parse_items()` bash function — tickets skip `done:closed`, audit skips `resolved:superseded`

---

## Blockers / Parked Items

_(none)_

---

## Handoff Notes

> All items (tickets + audit) now use `<!-- ITEM ... -->` tags with identical field structure.
> To add any new item: write `## T-XX — Title` or `### PREFIX-N.N Title` heading, then add the `<!-- ITEM ... -->` tag on the next line.
> To close/resolve: change `status:` to `done`/`closed` (tickets) or `resolved`/`superseded` (audit) — disappears from boards automatically.
> sessionstart.sh `parse_items()` function accepts: file, skip-statuses (colon-separated), tmpfile, show_phase flag.
