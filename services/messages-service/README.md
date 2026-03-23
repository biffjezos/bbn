# messages-service

Stores and retrieves E2EE message ciphertext, enforces TTL (4 hours), validates sender/recipient are mutually within range (tier-dependent), checks the block list before delivery.

## Required Environment Variables

`JWT_SECRET`, `SERVICE_SECRET`, `MONGO_URI`, `LOC_SERVICE_URL`, `LOC_SERVICE_ALLOWED_HOST`, `TIERS_SERVICE_URL`, `TIERS_SERVICE_ALLOWED_HOST`, `FAV_SERVICE_URL`, `FAV_SERVICE_ALLOWED_HOST`. Optional: `DB_NAME` (default `boomboom`), `PORT` (default 8080)

Each `*_ALLOWED_HOST` variable must equal the hostname of the corresponding `*_SERVICE_URL` (e.g. if `LOC_SERVICE_URL=http://location-service:8080` then `LOC_SERVICE_ALLOWED_HOST=location-service`). The service aborts at startup if they do not match, preventing SSRF from misconfigured URLs.

## Behaviour Settings (hardcoded)

| Setting | Value | Effect |
|---|---|---|
| Message TTL | 4 hours | `expiresAt` stamped on write; messages older than this are excluded from reads |
| Max message length | 4 096 chars | Applies to the E2EE ciphertext envelope |