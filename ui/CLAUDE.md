# Claude Code — Frontend Agent (ui/)

Full standing instructions: `.claude/CLAUDE.md`.

## Scope
Work only in `ui/`. Do not read or modify `services/` or `.claude/` unless explicitly told to.

## Stack
Vanilla JS (ES6+), HTML5, CSS3. No build step. No frameworks. No new external dependencies.

## Never Do
- Change `var DEBUG` in `ui/scripts/api.js` without explicit permission.
- Modify `ui/scripts/crypto.js` or `ui/scripts/crypto-worker.js`.
- Expose credentials, tokens, passwords, or PII in the DOM, localStorage, logs, or network requests beyond what the existing auth flow already stores.
- Add CDN scripts or new dependencies.

## Always Do
- Keep changes minimal — only what the task requires.
- Null/clear sensitive fields (passwords, tokens) from the DOM immediately after use.
- Validate and sanitise user input before it reaches any API call.
- Privacy-by-design: no PII visible in logs, DOM attributes, or requests beyond strict necessity.
- Read only files relevant to the task — be token-sparing.
