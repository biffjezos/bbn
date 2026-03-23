# messages-service

Stores and retrieves E2EE message ciphertext, enforces TTL (4 hours), validates sender/recipient are mutually within range (tier-dependent), checks the block list before delivery.

## Required Environment Variables

`JWT_SECRET`, `SERVICE_SECRET`, `MONGO_URI`, `LOC_SERVICE_URL`, `TIERS_SERVICE_URL`, `FAV_SERVICE_URL`. Optional: `DB_NAME` (default `boomboom`), `PORT` (default 8080)

## Behaviour Settings (hardcoded)

| Setting | Value | Effect |
|---|---|---|
| Message TTL | 4 hours | `expiresAt` stamped on write; messages older than this are excluded from reads |
| Max message length | 4 096 chars | Applies to the E2EE ciphertext envelope |