# bOOmbOOm.NOW!

A real-time proximity messaging app. Find out who is physically nearby right now and send them a message. No followers, no feeds, no profiles to scroll. Just the people around you, in this moment.

---

## Table of Contents

1. [Concept](#concept)
2. [Architecture](#architecture)
3. [Features](#features)
4. [Security & Encryption](#security--encryption)
5. [Repository Structure](#repository-structure)
6. [Environment Variables](#environment-variables)
7. [Deployment](#deployment)
8. [Local Development](#local-development)
9. [Documentation](#documentation)

---

## Concept

bOOmbOOm.NOW! is built around a single constraint: **you can only message someone if you are both in the same place at the same time.** Messages expire after 4 hours. Locations expire after 10 minutes. Nothing is permanent. Everything is now.

There are no followers, no feeds, no algorithmic recommendations. Proximity is the only filter. Privacy is not a feature — it is the foundation.

---

## Architecture

The app is split into a static frontend and a set of backend microservices hosted on Railway.

```
Browser (GitLab Pages)
    │
    ▼
server.js — public gateway (port 3000)
    │  Proxies all /api/* requests to internal services
    │  Runs migration-service on boot
    │
    ├── auth-service.js       (port 3001)  Guest tokens, register, login
    ├── users-service.js      (port 3002)  Profiles, crypto key storage
    ├── location-service.js   (port 3003)  Location push, nearby lookup
    ├── messages-service.js   (port 3004)  Send, read, delete messages
    ├── favourites-service.js (port 3005)  Favourites list
    └── tiers-service.js      (port 3006)  Tier definitions (reference)
```

### Frontend

- Static site built with Jekyll, hosted on GitLab Pages
- No framework — vanilla JS, Bootstrap 5, Leaflet
- Scripts: `crypto.js` (E2EE), `api.js` (HTTP client), `auth.js` (token + session state), `app.js` (UI + geolocation + inactivity lock), `map.js` (Leaflet map)

### Backend

- Node.js ES modules, Express
- MongoDB (single database `boomboom`, shared by all services)
- JWT authentication — stateless, verified locally in each service
- Inter-service requests authenticated via short-lived `X-Service-Token` JWTs
- All services share `JWT_SECRET` and `MONGO_URI` via Railway environment variables

---

## Features

| Feature | Guest | Registered |
|---|---|---|
| See the map | ✅ | ✅ |
| See nearby users | ✅ | ✅ |
| Send & receive messages | ❌ | ✅ |
| End-to-end encrypted messages | ❌ | ✅ |
| Favourites list | ❌ | ✅ |
| View public profiles | ✅ | ✅ |
| Push location | ✅ | ✅ |
| Session inactivity lock | ❌ | ✅ |

---

## Security & Encryption

bOOmbOOm.NOW! implements **end-to-end encrypted (E2EE) messaging** using the Web Crypto API. Messages are encrypted in the browser before being sent to the server. The server stores only ciphertext and can never read message content.

### How it works

- Each user has an ECDH P-256 keypair generated in the browser on first login
- The private key is encrypted with the user's password (PBKDF2 + AES-GCM) and stored on the server as a blob
- The private key never leaves the browser in plaintext
- On login, the encrypted blob is fetched and decrypted client-side using the entered password
- Each message is encrypted twice — once with the recipient's public key, once with the sender's own public key — so both parties can read their copy
- On logout or inactivity, keys are wiped from memory

### Session lock

Registered users are protected by an inactivity lock:

- **30 minutes** of no interaction → keys wiped, lock screen shown
- **3 minutes** of tab hidden → keys wiped, lock screen shown
- Re-entering password re-derives the private key from the server blob — no full re-login needed

---

## Repository Structure

```
/
├── ui/
│   ├── _layouts/
│   │   └── default.html          Main HTML shell, navbar, modals
│   ├── _includes/
│   │   ├── navbar.html           Top navigation bar with donation badge
│   │   ├── modal-login.html      Login modal
│   │   ├── modal-register.html   Registration modal
│   │   ├── modal-pin.html        Map pin detail modal
│   │   └── modal-lock.html       Session lock modal (E2EE re-auth)
│   ├── scripts/
│   │   ├── crypto.js             E2EE — ECDH, AES-GCM, PBKDF2
│   │   ├── api.js                API HTTP client
│   │   ├── auth.js               Auth state manager
│   │   ├── app.js                UI controller, geolocation, lock module
│   │   ├── map.js                Leaflet map module
│   │   ├── messages.js           Messages page module
│   │   ├── profile.js            Profile page module
│   │   └── favourites.js         Favourites page module
│   ├── styles/
│   │   └── app.css               App styles
│   ├── donate/
│   │   └── index.html            Donation page
│   ├── messages/                 Messages pages
│   ├── profile/                  Profile pages
│   ├── favourites/               Favourites pages
│   ├── index.html                Entry point (map)
│   ├── _config.yml               Jekyll config
│   └── Gemfile                   Jekyll dependencies
│
├── services/
│   ├── server.js                 Gateway + migration runner
│   ├── auth-service.js           Authentication
│   ├── users-service.js          Users + crypto key storage
│   ├── location-service.js       Location
│   ├── messages-service.js       Messages
│   ├── favourites-service.js     Favourites
│   ├── migration-service.js      Standalone migration reference
│   └── tiers-service.js          Tier definitions
│
├── README.md                     This file
├── auth.md                       → Authentication
├── users.md                      → User profiles & crypto keys
├── location.md                   → Location system
├── messages.md                   → Messaging & E2EE
├── favourites.md                 → Favourites
├── tiers.md                      → Tier system
└── migrations.md                 → Migration runner
```

---

## Environment Variables

| Variable | Used by | Description |
|---|---|---|
| `MONGO_URI` | All services | MongoDB connection string |
| `DB_NAME` | All services | Database name (default: `boomboom`) |
| `JWT_SECRET` | All services | Shared secret for JWTs. **Must be identical across all services.** |
| `PORT` | Each service | Port the service listens on |
| `MIGRATE_PORT` | `server.js` | Internal migration service port (default: 3099) |
| `AUTH_SERVICE_URL` | `server.js` | Internal URL of auth-service |
| `USER_SERVICE_URL` | `server.js` | Internal URL of users-service |
| `LOC_SERVICE_URL` | `server.js` | Internal URL of location-service |
| `MSG_SERVICE_URL` | `server.js` | Internal URL of messages-service |
| `FAV_SERVICE_URL` | `server.js` | Internal URL of favourites-service |

---

## Deployment

### Frontend (GitLab Pages)

Push to `main`. The CI pipeline runs Jekyll and publishes automatically. The API base URL is injected at build time via `site.api_url` in `_config.yml`.

### Backend (Railway)

Each service is a separate Railway deployment. On boot, `server.js` calls `POST /migrate/run` before opening the gateway.

| Changed file | Redeploy |
|---|---|
| `server.js` | Gateway |
| `auth-service.js` | auth-service |
| `users-service.js` | users-service |
| `location-service.js` | location-service |
| `messages-service.js` | messages-service |
| `favourites-service.js` | favourites-service |

---

## Local Development

```bash
# Frontend
cd ui && bundle install && bundle exec jekyll serve

# Backend (each in a separate terminal)
node services/auth-service.js
node services/users-service.js
node services/location-service.js
node services/messages-service.js
node services/favourites-service.js
node services/server.js
```

---

## Documentation

| Chapter | Description |
|---|---|
| [Authentication](auth.md) | Guest tokens, register, login, JWT structure |
| [User Profiles & Keys](users.md) | Profile management, E2EE key storage |
| [Location](location.md) | Location push, nearby lookup, IP fallback |
| [Messages](messages.md) | Send, read, E2EE encryption format, expiry |
| [Favourites](favourites.md) | Add, remove, online status |
| [Tiers](tiers.md) | Tier system, future ABAC plans |
| [Migrations](migrations.md) | Migration runner, adding migrations |

---

*You are here: README · Next: [Authentication →](auth.md)*
