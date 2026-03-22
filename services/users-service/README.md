# users-service

Profile CRUD, crypto key storage and retrieval, password changes (including re-keying the encrypted private key blob), account deletion, admin user management (tier and role changes with `tokenVersion` bump).

## Required Environment Variables

`JWT_SECRET`, `SERVICE_SECRET`, `MONGO_URI`. Optional: `DB_NAME` (default `boomboom`), `PORT` (default 3002)