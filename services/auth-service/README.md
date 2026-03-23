# auth-service

Issues guest, user, and admin JWTs. Validates credentials via bcrypt. Handles admin bootstrap on first boot. All endpoints require a valid `X-Service-Token` from the gateway.

## Required Environment Variables

`JWT_SECRET`, `SERVICE_SECRET`, `MONGO_URI`. Optional: `DB_NAME` (default `boomboom`), `ADMIN_BOOTSTRAP_USER_ID` (one-time, remove after use), `PORT` (default 8080)

## Behaviour Settings (hardcoded)

| Setting | Value |
|---|---|
| Guest token TTL | 15 min |
| Sessions TTL index | 20 min (MongoDB index on `sessions.createdAt`) |
| Valid tiers | `regular`, `premium`, `unrestricted` |
| Valid roles | `user`, `admin`, `venue_manager` |

`ADMIN_BOOTSTRAP_USER_ID` — if set and no admin exists yet, promotes that user to admin on boot. Remove the variable after first use.