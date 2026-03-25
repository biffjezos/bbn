# bOOmbOOm.NOW! — Audit Index

**Last updated:** 2026-03-24
**Scope:** Full codebase (9 backend services, 9 frontend scripts, config)
**Auditor:** Claude (claude-sonnet-4-6)

---

## Concern Files

Each concern has its own file. Add new findings to the correct file; cross-concern items go here.

- **[AUDIT_INFRASTRUCTURE.md](AUDIT_INFRASTRUCTURE.md)** (`INFRA-`) — Railway/MongoDB environment, deployment constraints, one-time backend ops.
- **[AUDIT_MAINTAINABILITY.md](AUDIT_MAINTAINABILITY.md)** (`MAINT-`) — Code structure, duplication, architectural debt.
- **[AUDIT_USABILITY.md](AUDIT_USABILITY.md)** (`UX-`) — User-facing friction and broken interaction flows.
- **[AUDIT_SECURITY.md](AUDIT_SECURITY.md)** (`SEC-`) — Security bugs, auth/privacy vulnerabilities.
- **[AUDIT_PERFORMANCE.md](AUDIT_PERFORMANCE.md)** (`PERF-`) — Bottlenecks, slow queries, scaling concerns.

Resolved items from any file → **[AUDIT_DONE.md](AUDIT_DONE.md)**

---

## Owner Notes / Open Questions

### 4.1 TTL for inactive users

***Note:*** added by project owner (12 March 2026)

Related to SEC-1.1.

I want to follow a (lost password - lost access)-approach. If a user forgets the password, there should be no way to recover the account, set a new password, being able to login, (and) or delete the account or read existing messages.

Therefore, inactive users should be auto-deleted after 90 days. I prefer a TTL initially set on account creation and updated on each login.

---

### 4.2 Evaluate stricter data protection feasibility

***Note:*** added by project owner (12 March 2026)

In the best case, all information stored in the database is either hashed or encrypted. No user related data should be transmitted in any direction unencrypted or unhashed. Services should get their own private / public key pairs with which they can encrypt/decrypt data if necessary.

Evaluate in which way it's feasible to:

- encrypt geo location data on the client side
- being transmitted from a client (user) in an encrypted fashion
- stored only encrypted in the backend (mongodb)
- geo location sent out encrypted to all other `/location/nearby..`
- decrypted by various clients (users) with different private keys.

---

### 4.3 Question: Is there a secure way to prove the running service matches the public repo?

***Note:*** added by project owner (12 March 2026)

I want to give users a way to validate the code that runs the services, by matching a signature of the binary or in another way. Please elaborate on the feasible options.

---

### 4.4 Simple admin UI

***Note:*** added by project owner (14 March 2026)

I need an admin UI, in which I can as a developer change the current profile information (including current tier) of a specific user. It should look similar to the /profile page with the search bar. I would be able to search for a user using the same filters, then a click on a user entry expands the profile information. If I change the tier make sure that this change is effectively working (token generation etc) and not just changing the tier string in the db of the user.

---

### 4.5 Admin UI > Adding, changing, removing tiers

***Note:*** added by project owner (14 March 2026)

The admin UI should be able to add, edit, change, remove tiers. Therefore, I think it's also necessary to store the tier information in the db, rather than in a js. Please prepare a concrete plan for the implementation, estimate how difficult the implementation is.

---

## Global Summary Table

When a finding is resolved: update the relevant concern file's summary, move the item to AUDIT_DONE.md, and update the row below to ✅.

| Status | ID | Concern | Severity | Finding |
|---|---|---|---|---|
| ✅ | INFRA-1.1 | [Infrastructure](AUDIT_INFRASTRUCTURE.md) | HIGH | migration-service not running — resolved 2026-03-24 by Railway plan upgrade (1 TB storage). |
| ✅ | INFRA-1.0 | [Infrastructure](AUDIT_INFRASTRUCTURE.md) | MEDIUM | MongoDB disk space — superseded by INFRA-1.1, resolved same. |
| ✅ | INFRA-1.2 | [Infrastructure](AUDIT_INFRASTRUCTURE.md) | LOW | Sessions TTL index carried old 2 h value — resolved via migration 010, confirmed deployed 2026-03-24. |
| ✅ | MAINT-2.1 | [Maintainability](AUDIT_MAINTAINABILITY.md) | LOW | haversineDistance — resolved, single impl in common/src/geo.rs |
| ✅ | MAINT-2.2 | [Maintainability](AUDIT_MAINTAINABILITY.md) | MEDIUM | Core utilities — resolved, all in common/src/auth.rs extractors |
| 🔲 | MAINT-2.3 | [Maintainability](AUDIT_MAINTAINABILITY.md) | LOW | Per-handler role guards still scattered; token verification now centralised |
| ✅ | MAINT-2.4 | [Maintainability](AUDIT_MAINTAINABILITY.md) | LOW | app.js split into 6 focused files — 2026-03-19 |
| 🔲 | MAINT-2.5 | [Maintainability](AUDIT_MAINTAINABILITY.md) | LOW | No explicit WS close on message-page navigation |
| 🔲 | MAINT-2.6 | [Maintainability](AUDIT_MAINTAINABILITY.md) | LOW | Per-service Config struct duplication — acceptable today, reassess at 15+ services |
| 🔲 | UX-3.1 | [Usability](AUDIT_USABILITY.md) | MEDIUM | Users enter password twice in cold login → messages flow |
| ✅ | SEC-1.1 | [Security](AUDIT_SECURITY.md) | HIGH | Plain password/email in POST request — OPAQUE fully deployed 2026-03-24; UI password-change also fixed |
| ✅ | SEC-1.2 | [Security](AUDIT_SECURITY.md) | MEDIUM | Gateway send-rate bypassable at messages-service — per-userId bucket added (T-22, 2026-03-23) |
| ✅ | SEC-1.3 | [Security](AUDIT_SECURITY.md) | MEDIUM | `real_ip()` trusts spoofable `X-Forwarded-For` — CF-Connecting-IP preferred (T-22, 2026-03-23) |
| ✅ | SEC-1.4 | [Security](AUDIT_SECURITY.md) | MEDIUM | User JWT TTL hardcoded at 7 days — configurable via admin_settings, default 24 h (T-22, 2026-03-23) |
| ✅ | SEC-1.5 | [Security](AUDIT_SECURITY.md) | LOW | No request body size cap — DefaultBodyLimit added, configurable via admin_settings (T-22, 2026-03-23) |
| ✅ | SEC-1.6 | [Security](AUDIT_SECURITY.md) | LOW | `msg_send` shares general API rate bucket — dedicated lim_msg added (T-22, 2026-03-23) |
| ✅ | SEC-1.7 | [Security](AUDIT_SECURITY.md) | MEDIUM | CWE-918 SSRF — JWT sub raw string interpolated into internal URLs — fixed 2026-03-23 |
| ✅ | SEC-1.8 | [Security](AUDIT_SECURITY.md) | MEDIUM | NaN panic in location sort (`partial_cmp().unwrap()`) — fixed 2026-03-23 |
| ✅ | SEC-1.9 | [Security](AUDIT_SECURITY.md) | LOW | Pre-epoch clock panic in `now_unix`/`now_ms` — fixed 2026-03-23 |
| ✅ | SEC-1.10 | [Security](AUDIT_SECURITY.md) | HIGH | Email pre-hash was plain SHA-256 — replaced with PBKDF2-SHA256 (100k iters), deployed 2026-03-24 |
| ✅ | SEC-1.11 | [Security](AUDIT_SECURITY.md) | MEDIUM | No per-user email salt — `emailSalt` added to user doc at registration, deployed 2026-03-24 |
| ✅ | SEC-1.12 | [Security](AUDIT_SECURITY.md) | HIGH | Auth token in `localStorage` — switched to `sessionStorage` + `pagehide` DELETE /location (2026-03-23) |
| 🔲 | SEC-1.13 | [Security](AUDIT_SECURITY.md) | HIGH | CWE-312 clear-text storage of `sex` field — `auth.js:37`, `auth.js:204` — fix via T-24 |
| 🔲 | SEC-1.14 | [Security](AUDIT_SECURITY.md) | HIGH | CWE-312 clear-text storage of sensitive data — `favourites.js:38` — fix via T-24 |
| ⏸️ | PERF-4.1 | [Performance](AUDIT_PERFORMANCE.md) | LOW | Send-rate bucket in-process — not safe for multi-instance gateway (deferred) |
| 🔲 | PERF-4.2 | [Performance](AUDIT_PERFORMANCE.md) | LOW | Notification poll scales linearly with active users |
