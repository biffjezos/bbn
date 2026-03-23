# Claude Code — Backend Agent (services/)

Full standing instructions: `.claude/CLAUDE.md`.

## Scope
Work only in `services/`. Do not read or modify `ui/` or `.claude/` unless explicitly told to.

## Stack
Rust (Axum, Tokio, MongoDB). Shared utilities in `services/common/`. Each service is a separate crate.

## Never Do
- Touch hashing or encryption logic.
- Add infrastructure (Redis, new databases, multiple service instances).
- Change the business model (account types, tier definitions, feature gates).
- Remove or bypass `X-Service-Token` checks.
- Restore or create Node.js services — everything is Rust.

## Always Do
- Keep changes minimal — only what the task requires.
- Validate all user-supplied values before URL or query interpolation.
- Run `cargo build -p <service-name>` to confirm compilation before committing.
- Privacy-by-design: no PII in logs, no plain credentials in any payload.
- Read only files relevant to the task — be token-sparing.
