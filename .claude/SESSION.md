# Session State

> **Read this file FIRST on every session resume** — before AUDIT.md, before TICKETS.md.
> Updated by Claude at session-start and before every commit.
> This file is the bridge across context compactions. Keep it honest and current.

---

**Branch:** `claude/remove-rust-autobuild-sjOiS`
**Session date:** 2026-03-25
**Last updated:** 2026-03-25T13:10Z

---

## In Progress

Nothing.

---

## Completed This Session

- **Revert Rust CodeQL autobuild** — Previous session incorrectly changed `build-mode` for Rust from `none` to `autobuild` without being asked to. Rust does not support autobuild in CodeQL — only `none` is valid. Reverted to `build-mode: none`. Committed and pushed on `claude/remove-rust-autobuild-sjOiS`.
- **Reflection + rule** — Added rule to CLAUDE.md: never change CI/CD workflow files beyond what was explicitly requested. Logged in CHANGELOG.md.

---

## Key Decisions Made

- Rust CodeQL `build-mode` must remain `none`. This is a hard constraint from CodeQL, not a choice.
- CI/CD workflow files are now explicitly off-limits for unsolicited changes.

---

## Blockers / Parked Items

- `fetch-codeql-alerts.yml` still cannot push to `dev` (protected branch). Owner must allow `github-actions[bot]` to bypass protection or redirect the push to an unprotected branch.

---

## Handoff Notes

### What to do next
1. Merge `claude/remove-rust-autobuild-sjOiS` → `dev` immediately to unblock CodeQL.
2. Next ticket: **T-24** (Profile Data Encryption, high priority) or **T-09** (Role CRUD).

### Notes for next session
- Do NOT change Rust CodeQL `build-mode` from `none`. Rust only supports `none`.
- The `services/Cargo.toml` fix (removing nonexistent workspace members `tiers-service` and `auth-service`) from the previous session is still valid and in `dev`.
- No open audit items or tickets were created or changed this session.
