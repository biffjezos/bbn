# bOOmbOOm.NOW! — Security Audit

**Last updated:** 2026-03-19
**Concern:** Security only.
**See also:** AUDIT_PERFORMANCE.md · AUDIT.md (infrastructure / maintainability / usability) · AUDIT_DONE.md (resolved items)

---

## Open Items

### SEC-1.1 Plain password and email in POST request

***Note:*** added by project owner (12 March 2026)

```json
[API] → POST https://boom.up.railway.app/api/auth/login
{
    email: '{plain email address}',
    password: '{plain password}',
    guestId: '{guest id}'
}
```

Found in `/ui/scripts/api.js`:

```js
login({ email, password, guestId }) {
    return apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, guestId }),
    });
  },
```

The eMail address and password should be hashed right after they are entered in the text field (account creation, login modal). On account creation the eMail should be hashed like the password, sent and stored in the db. No unencrypted/unhashed communication between client and server.

Target solution: OPAQUE / PAKE. `opaque-ke` (Rust) is production-ready; no equivalent exists for JS. Implementing OPAQUE before the auth-service Rust port (T-04b) would require a full re-implementation once the port lands — T-04b is now complete but OPAQUE was explicitly deferred during the port.

**Sequencing decision (2026-03-16):** Implement OPAQUE in `auth-service` (Rust). Unblocks this ticket and T-05b (encrypted block note). Also resolve items in AUDIT.md 6.1/6.3 before contemplating this ticket.

**Priority:** HIGH — blocked on OPAQUE implementation decision.

---

### SEC-1.2 Gateway send-rate limit bypassable at messages-service level

**File:** `services/gateway/src/main.rs` (`_wsSendCounts`), `services/messages-service/src/main.rs`

The per-user send rate (10 msg / 10 s) is enforced only at the WebSocket layer in the gateway. The messages-service HTTP endpoint has no independent rate limit. A client with a valid JWT hitting the HTTP endpoint directly (or via multiple tabs) can exceed the per-user budget. messages-service needs its own per-userId in-memory rate check.

**Priority:** MEDIUM — T-05 blocking is live which reduces abuse risk, but the HTTP bypass remains.

---

## Summary Table

| Status | ID | Severity | Finding |
|---|---|---|---|
| 🔲 | SEC-1.1 | HIGH | Plain password/email in POST request — needs OPAQUE/PAKE |
| 🔲 | SEC-1.2 | MEDIUM | Gateway send-rate bypassable at messages-service HTTP endpoint |

Resolved items → AUDIT_DONE.md
