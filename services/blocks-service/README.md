# blocks-service

Block and unblock users with mandatory reason enum. Blocked-user status is checked in location-service, messages-service, and users-service by reading the `blocks` collection directly.

## Required Environment Variables

Requires: `JWT_SECRET`, `SERVICE_SECRET`, `MONGO_URI`. Optional: `DB_NAME` (default `boomboom`), `PORT` (default 8080)