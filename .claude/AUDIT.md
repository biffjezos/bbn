# bOOmbOOm.NOW! — Audit Index

**Last updated:** 2026-03-23
**Scope:** Full codebase (9 backend services, 9 frontend scripts, config)
**Auditor:** Claude (claude-sonnet-4-6)

---

## Concern Files

Each concern has its own file with full item descriptions and a per-concern summary table. Add new findings to the correct file; cross-concern items or items that don't fit any category go in this file.

- **[AUDIT_INFRASTRUCTURE.md](AUDIT_INFRASTRUCTURE.md)** — Railway/MongoDB environment, service dependencies, deployment constraints, one-time ops required on the backend.
- **[AUDIT_MAINTAINABILITY.md](AUDIT_MAINTAINABILITY.md)** — Code structure, duplication, architectural debt, patterns that complicate future changes.
- **[AUDIT_USABILITY.md](AUDIT_USABILITY.md)** — User-facing friction, UX issues, interaction flows that degrade the user experience.
- **[AUDIT_SECURITY.md](AUDIT_SECURITY.md)** — Security vulnerabilities, auth/privacy concerns, data exposure risks.
- **[AUDIT_PERFORMANCE.md](AUDIT_PERFORMANCE.md)** — Performance bottlenecks, slow queries, inefficient patterns, scaling concerns.

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
| 🔲 | INFRA-1.1 | [Infrastructure](AUDIT_INFRASTRUCTURE.md) | HIGH | migration-service not running — Railway volume too small (454 MB total, WiredTiger needs 524 MB free). Migrate to MongoDB Atlas. |
| ~~🔲~~ | ~~INFRA-1.0~~ | ~~[Infrastructure](AUDIT_INFRASTRUCTURE.md)~~ | ~~MEDIUM~~ | ~~MongoDB disk space~~ — superseded by INFRA-1.1 |
| 🔲 | INFRA-1.2 | [Infrastructure](AUDIT_INFRASTRUCTURE.md) | LOW | Sessions TTL index carries old 2 h value — drop `createdAt_1` index to apply 20 min TTL |
| ✅ | MAINT-2.1 | [Maintainability](AUDIT_MAINTAINABILITY.md) | LOW | haversineDistance — resolved, single impl in common/src/geo.rs |
| ✅ | MAINT-2.2 | [Maintainability](AUDIT_MAINTAINABILITY.md) | MEDIUM | Core utilities — resolved, all in common/src/auth.rs extractors |
| 🔲 | MAINT-2.3 | [Maintainability](AUDIT_MAINTAINABILITY.md) | LOW | Per-handler role guards still scattered; token verification now centralised |
| ✅ | MAINT-2.4 | [Maintainability](AUDIT_MAINTAINABILITY.md) | LOW | app.js split into 6 focused files — 2026-03-19 |
| 🔲 | MAINT-2.5 | [Maintainability](AUDIT_MAINTAINABILITY.md) | LOW | No explicit WS close on message-page navigation |
| 🔲 | MAINT-2.6 | [Maintainability](AUDIT_MAINTAINABILITY.md) | LOW | Per-service Config struct duplication — acceptable today, reassess at 15+ services |
| 🔲 | UX-3.1 | [Usability](AUDIT_USABILITY.md) | MEDIUM | Users enter password twice in cold login → messages flow |
| 🔲 | SEC-1.1 | [Security](AUDIT_SECURITY.md) | HIGH | Plain password/email in POST request — needs OPAQUE/PAKE |
| 🔲 | SEC-1.2 | [Security](AUDIT_SECURITY.md) | MEDIUM | Gateway send-rate bypassable at messages-service HTTP endpoint |
| 🔲 | SEC-1.3 | [Security](AUDIT_SECURITY.md) | MEDIUM | `real_ip()` trusts spoofable `X-Forwarded-For` — prefer `CF-Connecting-IP` |
| 🔲 | SEC-1.4 | [Security](AUDIT_SECURITY.md) | MEDIUM | User JWT TTL hardcoded at 7 days — should default to 24 h, be configurable |
| 🔲 | SEC-1.5 | [Security](AUDIT_SECURITY.md) | LOW | No request body size cap in gateway |
| 🔲 | SEC-1.6 | [Security](AUDIT_SECURITY.md) | LOW | `msg_send` shares the general API rate bucket instead of a tighter dedicated limiter |
| ✅ | SEC-1.7 | [Security](AUDIT_SECURITY.md) | MEDIUM | CWE-918 SSRF — JWT sub raw string interpolated into internal URLs — fixed 2026-03-23 |
| ✅ | SEC-1.8 | [Security](AUDIT_SECURITY.md) | MEDIUM | NaN panic in location sort (`partial_cmp().unwrap()`) — fixed 2026-03-23 |
| ✅ | SEC-1.9 | [Security](AUDIT_SECURITY.md) | LOW | Pre-epoch clock panic in `now_unix`/`now_ms` — fixed 2026-03-23 |
| ⏸️ | PERF-4.1 | [Performance](AUDIT_PERFORMANCE.md) | LOW | Send-rate bucket in-process — not safe for multi-instance gateway (deferred) |
| 🔲 | PERF-4.2 | [Performance](AUDIT_PERFORMANCE.md) | LOW | Notification poll scales linearly with active users |
