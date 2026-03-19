# bOOmbOOm.NOW! — Usability Audit

**Last updated:** 2026-03-19
**Concern:** Usability — user-facing friction, UX issues, interaction flows that degrade the user experience.
**See also:** [AUDIT.md](AUDIT.md) (index · owner notes · global summary) · [AUDIT_INFRASTRUCTURE.md](AUDIT_INFRASTRUCTURE.md) · [AUDIT_MAINTAINABILITY.md](AUDIT_MAINTAINABILITY.md) · [AUDIT_SECURITY.md](AUDIT_SECURITY.md) · [AUDIT_PERFORMANCE.md](AUDIT_PERFORMANCE.md) · [AUDIT_DONE.md](AUDIT_DONE.md) (resolved items)

---

## Open Items

### 3.1 Users enter password twice in the cold login → messages flow

**File:** `ui/scripts/auth.js`, `ui/scripts/crypto-worker.js`

Login authenticates the user (issues JWT) but does **not** load the E2EE crypto keys into the worker. When the user navigates to `/messages/`, `requireUnlocked()` finds `BBMCrypto.isUnlocked() === false` and shows the lock screen — requiring the password a second time (PBKDF2 derivation, ~1 s, plus a network round-trip for the encrypted key blob).

**Net result: two password entries in the typical "log in → read messages" flow.**

**Mitigating factors:**
- SharedWorker on Chrome/Firefox/Edge: keys survive full-page navigations within the same browser session. Double-entry only happens on the first access after a cold login.
- Safari / iOS: regular Worker is destroyed on every page navigation — password required on every page load that touches messages.
- Inactivity lock: intentional (3 min idle / 30 s hidden tab).

**Possible improvement (no security downgrade):** After a successful login, automatically attempt to unlock the crypto keys using the password the user just typed — without requiring a second prompt. The password is available in-memory at that moment. The lock screen on inactivity/tab-hide would still protect keys at rest.

**Priority:** MEDIUM — real friction for returning users, especially on Safari.

---

## Summary Table

| Status | ID | Severity | Finding |
|---|---|---|---|
| 🔲 | 3.1 | MEDIUM | Users enter password twice in cold login → messages flow |

Resolved items → AUDIT_DONE.md
