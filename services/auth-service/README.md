# auth-service

Issues guest, user, and admin JWTs. Validates credentials via bcrypt. Handles admin bootstrap on first boot. All endpoints require a valid `X-Service-Token` from the gateway.

## Required Environment Variables

`JWT_SECRET`, `SERVICE_SECRET`, `MONGO_URI`. Optional: `DB_NAME` (default `boomboom`), `ADMIN_BOOTSTRAP_USER_ID` (one-time, remove after use), `PORT` (default 8080)