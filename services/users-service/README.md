# users-service

Profile CRUD, crypto key storage and retrieval, password changes (including re-keying the encrypted private key blob), account deletion, admin user management (tier and role changes with `tokenVersion` bump).

## Required Environment Variables

`JWT_SECRET`, `SERVICE_SECRET`, `MONGO_URI`. Optional: `DB_NAME` (default `boomboom`), `PORT` (default 3002), `SELF_PROMOTION_GUARD` (set to `1` to block admins from changing their own tier or role)

## Behaviour Settings

| Setting | Default | Effect |
|---|---|---|
| `SELF_PROMOTION_GUARD=1` | off | Prevents an admin from patching their own tier or role via the API |