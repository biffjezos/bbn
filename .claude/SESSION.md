# Session State

> **Read this file FIRST on every session resume** — before AUDIT.md, before TICKETS.md.
> Updated by Claude at session-start and before every commit.
> This file is the bridge across context compactions. Keep it honest and current.

---

**Branch:** `claude/remove-rust-autobuild-sjOiS`
**Session date:** 2026-03-25
**Last updated:** 2026-03-25T13:00Z

---

## In Progress

Nothing.

---

## Completed This Session

- **Revert Rust CodeQL autobuild** — Previous session incorrectly changed `build-mode` for Rust from `none` to `autobuild`. Rust does not support autobuild mode in CodeQL — only `none` is valid. Reverted to `build-mode: none`.

---

## Key Decisions Made

- Rust CodeQL build-mode must remain `none`. This is a hard constraint from CodeQL itself, not a choice.

---

## Blockers / Parked Items

- `fetch-codeql-alerts.yml` still cannot push to `dev` (protected branch). Parked — owner must allow `github-actions[bot]` to bypass protection or redirect the push to an unprotected branch.

---

## Handoff Notes

### What to do next
1. Merge this branch (`claude/remove-rust-autobuild-sjOiS`) → `dev` immediately to unblock CodeQL.
2. Next ticket: **T-24** (Profile Data Encryption, high priority) or **T-09** (Role CRUD).

### Notes for next session
- Do NOT change Rust CodeQL build-mode from `none`. Rust only supports `none`.
- The `services/Cargo.toml` fix (removing nonexistent workspace members) from the previous session is still valid and should remain.
