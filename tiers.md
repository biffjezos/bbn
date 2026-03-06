# Tiers

## Current Status

The `tier` field (`regular` | `premium`) is stored on the user document and included in the JWT at login. It is **not currently used to gate any features** — all registered users have equal access to all functionality.

A proper **Attribute-Based Access Control (ABAC)** system will replace the current tier field in a future iteration. The `tiers-service.js` file is retained as a reference but is not called by any other service.

---

## Tier Values

| Tier      | Description                          |
|-----------|--------------------------------------|
| `guest`   | Not logged in. UUID-identified.      |
| `regular` | Registered account. Default for all new users. |
| `premium` | Paid tier. Currently no extra access. |

---

## Where Tier Appears

- Written to the `users` collection as `tier: "regular"` on registration
- Read from the database at login and baked into the JWT
- Available on the frontend via `Auth.getTier()` for display purposes only
- Never used for access control decisions until ABAC is implemented

---

## Upgrading a User's Tier

Update the `tier` field directly in the database. The user must log out and back in to receive a new token reflecting the change.

---

## Future: ABAC

The tiers system will be replaced by an attribute-based access control layer that evaluates policies against user attributes (role, tier, age, location, etc.) rather than a simple rank comparison.
