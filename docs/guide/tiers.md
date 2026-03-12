# Tiers

*[← Favourites](favourites.md) · [Migrations →](migrations.md)*

---

## Current Status

The `tier` field (`regular` | `premium`) is stored on the user document and included in the JWT at login. It is **not currently used to gate any features** — all registered users have equal access to all functionality.

---

## Tier Values

| Tier | Description |
|---|---|
| `guest` | Not logged in. UUID-identified. 15-minute session. |
| `regular` | Registered account. Default for all new users. |
| `premium` | Paid tier. Currently no extra access beyond `regular`. |

---

## Where Tier Appears

- Written to `users` as `tier: "regular"` on registration
- Read from the database at login and baked into the JWT
- Available on the frontend via `Auth.getTier()` for display purposes only
- Never used for access control decisions

---

## Upgrading a User's Tier

Update the `tier` field directly in the database. The user must log out and back in to receive a new JWT reflecting the change.

---

## Future: ABAC

The tiers system is a placeholder for a proper **Attribute-Based Access Control (ABAC)** layer that will evaluate policies against user attributes (role, tier, age, location, etc.) rather than a simple rank comparison. `tiers-service.js` is retained as a reference skeleton for this future work.

---

*[← Favourites](favourites.md) · [Migrations →](migrations.md)*
