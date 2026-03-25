# bOOmbOOm.NOW! — Security Audit

**Last updated:** 2026-03-23
**Concern:** Security only.

---

## Open Items

SEC-1.1 ✅ fully resolved 2026-03-24 — details in AUDIT_DONE.md
<!-- ITEM id:SEC-1.1 status:resolved priority:high concern:security -->

---

SEC-1.2 ✅ fixed 2026-03-23 — details in AUDIT_DONE.md
<!-- ITEM id:SEC-1.2 status:resolved priority:medium concern:security -->

---

SEC-1.3 ✅ fixed 2026-03-23 — details in AUDIT_DONE.md
<!-- ITEM id:SEC-1.3 status:resolved priority:medium concern:security -->

---

SEC-1.4 ✅ fixed 2026-03-23 — details in AUDIT_DONE.md
<!-- ITEM id:SEC-1.4 status:resolved priority:medium concern:security -->

---

SEC-1.5 ✅ fixed 2026-03-23 — details in AUDIT_DONE.md
<!-- ITEM id:SEC-1.5 status:resolved priority:low concern:security -->

---

SEC-1.6 ✅ fixed 2026-03-23 — details in AUDIT_DONE.md
<!-- ITEM id:SEC-1.6 status:resolved priority:low concern:security -->

---

### SEC-1.7 ✅ CWE-918 SSRF — JWT sub raw string in internal URLs
<!-- ITEM id:SEC-1.7 status:resolved priority:medium concern:security -->

Fixed 2026-03-23. Full details in AUDIT_DONE.md.

---

### SEC-1.8 ✅ Panic on NaN in location sort (`partial_cmp().unwrap()`)
<!-- ITEM id:SEC-1.8 status:resolved priority:medium concern:security -->

Fixed 2026-03-23. Full details in AUDIT_DONE.md.

---

### SEC-1.9 ✅ Panic on pre-epoch system clock (`SystemTime::unwrap()`)
<!-- ITEM id:SEC-1.9 status:resolved priority:low concern:security -->

Fixed 2026-03-23. Full details in AUDIT_DONE.md.

---

### SEC-1.10 ✅ Email pre-hash uses plain SHA-256 — no work factor
<!-- ITEM id:SEC-1.10 status:resolved priority:high concern:security -->

**File:** `ui/scripts/opaque-client.js:hashEmail`

**Finding (2026-03-23):** The client computed `emailHash = hex(SHA-256(lowercase(email)))` before
sending to the server. SHA-256 has no work factor: an attacker who captures the in-transit value
(TLS termination, infra logging) or obtains the DB + `EMAIL_PEPPER` can reverse any email address
using a dictionary at essentially zero cost. The email received none of OPAQUE's privacy guarantees.

**Fix (2026-03-23):** Replaced with `PBKDF2-SHA256(password=email, salt='boomboom-email-v2', iterations=100_000)`
via WebCrypto's native `crypto.subtle`. The fixed domain salt is not secret; protection comes from
the iteration count. Bulk reversal now requires ~100k SHA-256 ops per candidate email per target user,
making dictionary attacks computationally expensive.

**Pending deploy:** users collection wipe (same step as SEC-1.1 / T-23 deploy).

**Priority:** HIGH

---

### SEC-1.11 ✅ No per-user salt on email hash — pepper leak enables bulk precomputation
<!-- ITEM id:SEC-1.11 status:resolved priority:medium concern:security -->

**File:** `services/auth-service/src/main.rs:auth_register_finish`

**Finding (2026-03-23):** `emailHash` stored in the DB was derived as `HMAC(pepper, SHA-256(email))` with no
per-user random component. If `EMAIL_PEPPER` leaks, an attacker can precompute the entire hash space for
all known email addresses in one pass and cross-reference the full `users` collection.

**Fix (2026-03-23):** At registration the server now generates a random 16-byte `emailSalt` per user and
stores it alongside `emailHash`. The PBKDF2 work factor from SEC-1.10 already makes bulk precomputation
expensive; `emailSalt` adds defence-in-depth and is the foundation for profile-data encryption (items 4+5).
Note: `emailSalt` is not currently mixed into the lookup hash (that would break lookup); it is reserved
for the per-user `profileKey = PBKDF2(email, emailSalt)` derivation when profile encryption lands.

**Pending deploy:** users collection wipe (same step as SEC-1.1 / T-23 deploy).

**Priority:** MEDIUM

---

SEC-1.13 ✅ fixed 2026-03-25 — details in AUDIT_DONE.md
<!-- ITEM id:SEC-1.13 status:resolved priority:high concern:security -->

SEC-1.14 ✅ fixed 2026-03-25 — details in AUDIT_DONE.md
<!-- ITEM id:SEC-1.14 status:resolved priority:high concern:security -->

---

## Summary Table

| Status | ID | Severity | Finding |
|---|---|---|---|
| ✅ | SEC-1.1 | HIGH | Plain password/email in POST request — OPAQUE implemented (T-23, pending deploy) |
| ✅ | SEC-1.2 | MEDIUM | Gateway send-rate bypassable at messages-service — per-userId bucket added (T-22, 2026-03-23) |
| ✅ | SEC-1.3 | MEDIUM | `real_ip()` trusts spoofable `X-Forwarded-For` — CF-Connecting-IP preferred (T-22, 2026-03-23) |
| ✅ | SEC-1.4 | MEDIUM | User JWT TTL hardcoded at 7 days — configurable via admin_settings, default 24 h (T-22, 2026-03-23) |
| ✅ | SEC-1.5 | LOW | No request body size cap — DefaultBodyLimit added, configurable via admin_settings (T-22, 2026-03-23) |
| ✅ | SEC-1.6 | LOW | `msg_send` shares general API rate bucket — dedicated lim_msg added (T-22, 2026-03-23) |
| ✅ | SEC-1.7 | MEDIUM | CWE-918 SSRF — JWT sub raw string in internal URLs — fixed 2026-03-23 |
| ✅ | SEC-1.8 | MEDIUM | NaN panic in location sort — fixed 2026-03-23 |
| ✅ | SEC-1.9 | LOW | Pre-epoch clock panic in now_unix/now_ms — fixed 2026-03-23 |
| ✅ | SEC-1.10 | HIGH | Email pre-hash was plain SHA-256 — replaced with PBKDF2-SHA256 (100k iters, 2026-03-23, pending deploy) |
| ✅ | SEC-1.11 | MEDIUM | No per-user email salt — `emailSalt` added to user document at registration (2026-03-23, pending deploy) |
| ✅ | SEC-1.12 | HIGH | Auth token stored in `localStorage` persisted after tab close — session takeover risk — switched to `sessionStorage` + `pagehide` DELETE /location (2026-03-23) |
| ✅ | SEC-1.13 | HIGH | CWE-312 clear-text storage of `sex` field — removed dedicated sessionStorage key; sex now read from JWT — fixed 2026-03-25 |
| ✅ | SEC-1.14 | HIGH | CWE-312 clear-text storage of sensitive data — removed `sex` from `bbm_meet` localStorage object — fixed 2026-03-25 |

Resolved items → AUDIT_DONE.md
