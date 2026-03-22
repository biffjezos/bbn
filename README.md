# bOOmbOOm.NOW!

Privacy-by-design location-based instant messaging.

---

## Features

- **End-to-end encrypted messaging** — messages are encrypted client-side (ECDH P-256 + AES-GCM) before reaching the server. The server stores ciphertext only and cannot read any message content.
- **Zero-knowledge key storage** — the user's ECDH private key is encrypted with a key derived from their password (PBKDF2, 200 000 iterations, SHA-256) before being stored on the server. The server holds the encrypted blob; decryption requires the user's password and never happens server-side.
- **Hashed passwords** — bcrypt with per-user salt. Plain passwords are never stored or logged.
- **Session lock** — the private key lives only in browser memory. It is wiped after 3 minutes of inactivity or 30 seconds of the tab being hidden. Re-entering the password re-derives the key without a full re-login.
- **Short-lived data** — messages auto-delete after 4 hours; location data expires after 10 minutes of inactivity. Expiry is enforced in application queries as a primary safety net; MongoDB TTL indexes (applied by the migration service on boot) provide background cleanup at the database level once migrations have been fully applied.
- **Guest sessions** — any visitor gets an anonymous 15-minute JWT (UUID-identified, no account required) that allows seeing the map and nearby users.
- **Registered sessions** — 7-day JWT. Email and password required. Unlocks messaging, favourites, and blocking.
- **Tier-based access control** — `guest`, `regular`, `premium`, `developer`. Tiers define nearby and messaging radii. Tier definitions are stored in the database and manageable through the admin UI without redeployment.
- **Block and report** — any user can block any other user with a mandatory reason (`spam`, `harassment`, `inappropriate_content`, `fake_profile`, `other`). Blocked users are filtered from nearby results, cannot send messages, and cannot view the blocker's profile.
- **Favourites with range sync** — one-directional. The service tracks whether a favourited user is within messaging range and stores a `withinRange` flag on the favourite document; this flag is checked before messages can be sent. *(Planned: in-range notification when a favourite enters range — not yet implemented.)*
- **In-app notifications** — new-favourite events delivered via a `notifications` collection polled by the frontend every 2 minutes.
- **Admin UI** — user search, tier and role changes, tier CRUD. Accessible to `admin`-role accounts only.
- **Admin bootstrap** — first admin account is promoted via a one-time `ADMIN_BOOTSTRAP_USER_ID` environment variable set at boot. Subsequent promotions go through the admin UI. Raw database edits to role or tier fields have no effect without a `tokenVersion` bump.
- **Separate inter-service secret** — user JWTs and inter-service tokens are signed with independent secrets (`JWT_SECRET` and `SERVICE_SECRET`). A compromised user secret cannot be used to forge service requests.
- **Database migrations** — an idempotent migration runner applies schema changes on every boot before traffic is accepted.
- **IP geolocation fallback** — if the browser denies location access, the frontend tries a shuffled list of free IP geolocation services and shows an "approximate location" indicator on the map pin.

---

## Security & Encryption

### Passwords

Stored as bcrypt hashes. Salt is generated per-user. The plain password is used only to verify at login time and is never persisted or forwarded.

### Crypto Keys

On registration the client generates an ECDH P-256 keypair. The public key is stored in plain on the server (needed by anyone who wants to send a message). The private key is encrypted before it leaves the browser:

1. A 256-bit AES-GCM key is derived from the user's password using PBKDF2 (SHA-256, 200 000 iterations, random 16-byte salt).
2. The private key is encrypted with that AES key. Only the ciphertext, IV, and salt are sent to the server.
3. To unlock E2EE after a page load or session lock, the user re-enters their password. The browser re-runs PBKDF2, decrypts the blob, and loads the key into memory. Nothing happens server-side.

When a user changes their password, the frontend re-encrypts the private key blob under the new derived key before saving — existing messages remain readable.

### Messages

Every message is encrypted on the client using the ECDH-derived shared secret before being sent. The sender derives the shared AES-GCM key from their private key and the recipient's public key; the recipient derives the same key from their private key and the sender's public key — a symmetric property of Diffie-Hellman. Both parties can therefore decrypt the same single ciphertext independently without a second copy being stored.

The server receives and stores the ciphertext envelope `{ cipher, recipientId }` as a JSON string. It cannot reconstruct the shared secret because it never holds any private key. Messages are deleted automatically by MongoDB TTL index 4 hours after they are sent.

### Authentication

Two token types, signed separately:

- **User/guest tokens** — HS256 JWTs signed with `JWT_SECRET`. Carry `sub`, `role`, `tier`, `tv` (tokenVersion). User tokens expire after 7 days; guest tokens after 15 minutes.
- **Inter-service tokens** — short-lived HS256 JWTs signed with `SERVICE_SECRET`. Injected by the gateway on every proxied request via `X-Service-Token`. Each downstream service validates this header and rejects requests without it, so services are unreachable without going through the gateway.

`tokenVersion` is a counter stored on the user document and baked into the JWT at issue time. On each login, registration, or admin role/tier change, `tokenVersion` is bumped. Services that handle registered users verify the `tv` claim against the database, which immediately invalidates all previously issued tokens for that user without a deny-list.

---

## Technology

### Frontend

- GitHub Pages (static hosting, auto-deployed from `dev` and `claude/**` branches)
- Jekyll SSG with Thymeleaf-style templating
- Bootstrap + custom CSS
- Web Crypto API for all client-side cryptography
- SharedWorker for private key isolation across tabs

### Backend

All services are written in Rust (Axum 0.8, Tokio, MongoDB driver 3). They are deployed as individual Railway services built from a shared Cargo workspace at `services/`.

#### gateway

Entry point for all client traffic. Routes HTTP requests to downstream services, injects `X-Service-Token` on every proxied request, enforces per-IP rate limits (login, register, guest, general API), handles WebSocket connections for live location and messaging, and runs database migrations on boot.

#### auth-service

Issues guest, user, and admin JWTs. Validates credentials via bcrypt. Handles admin bootstrap on first boot. All endpoints require a valid `X-Service-Token` from the gateway.

#### users-service

Profile CRUD, crypto key storage and retrieval, password changes (including re-keying the encrypted private key blob), account deletion, admin user management (tier and role changes with `tokenVersion` bump).

#### location-service

Stores and expires location documents, serves nearby-user queries filtered by tier radius and block list, exposes an internal per-user location endpoint used by messages-service and favourites-service.

#### messages-service

Stores and retrieves E2EE message ciphertext, enforces TTL (4 hours), validates sender/recipient are mutually within range (tier-dependent), checks the block list before delivery.

#### favourites-service

Manages one-directional favourite links, syncs range state (writes `withinRange` flag and fires a notification when a favourite comes into messaging range), delivers in-app notifications.

#### blocks-service

Block and unblock with mandatory reason enum. Blocked-user status is checked in location-service, messages-service, and users-service by reading the `blocks` collection directly.

#### tiers-service

DB-stored tier definitions with admin CRUD. Serves tier info and radius lookups to other services. In-memory cache (5-minute TTL) with static fallback if the collection is empty.

#### migration-service

Node.js. Applies idempotent database migrations in order on every gateway boot. Tracks applied migrations in a `_migrations` collection. Runs before the gateway opens to traffic.

### Persistence

MongoDB. Collections: `users`, `locations`, `messages`, `favourites`, `blocks`, `notifications`, `tiers`, `sessions`, `_migrations`.

---

## Live Demo

The `dev` branch and all `claude/**` branches auto-deploy to [https://biffjezos.github.io/bbn](https://biffjezos.github.io/bbn). The backend services may not be running at the time of your visit — Railway hosting costs money.

## Donate

Donate at [https://biffjezos.github.io/bbn/donate/](https://biffjezos.github.io/bbn/donate/) via Apple Pay, credit/debit card, or Revolut. Add a note if you want to be listed as a donor.

### Current monthly expenditure: **26.42 €**

- 21,42€ — Claude Code
- 5,00€ — Railway (microservices + MongoDB)

### Total amount spent (since February 2026)

- 21,42€
