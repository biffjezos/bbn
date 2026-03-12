# bOOmbOOm.NOW!

A real-time proximity messaging app. Find out who is physically nearby right now and send them a message. No followers, no feeds, no profiles to scroll. Just the people around you, in this moment.

---

## Table of Contents

- [Part 1 — User Guide](#part-1--user-guide)
  - [What is bOOmbOOm.NOW!](#what-is-boomboomnow)
  - [Getting Started](#getting-started)
  - [The Map](#the-map)
  - [Sending Messages](#sending-messages)
  - [Favourites](#favourites)
  - [Your Profile](#your-profile)
  - [Privacy & Session Lock](#privacy--session-lock)
  - [What Happens to Your Data](#what-happens-to-your-data)
- [Part 2 — Technical Reference](#part-2--technical-reference)
  - [Architecture](#architecture)
  - [Security & Encryption](#security--encryption)
  - [Repository Structure](#repository-structure)
  - [Environment Variables](#environment-variables)
  - [Deployment](#deployment)
  - [Local Development](#local-development)
  - [API Documentation](#api-documentation)

---

# Part 1 — User Guide

> Full step-by-step usage details: [User Guide →](user-guide.md)

## What is bOOmbOOm.NOW!

bOOmbOOm.NOW! is built around a single constraint: **you can only message someone if you are both in the same place at the same time.** Messages expire after 4 hours. Locations expire after 10 minutes. Nothing is permanent. Everything is now.

There are no followers, no feeds, no algorithmic recommendations. Proximity is the only filter. Privacy is not a feature — it is the foundation.

---

## Getting Started

You do not need an account to use the map. Open the app and you will appear as a guest pin. You can see who else is nearby immediately.

To send and receive messages, you need a registered account. Registration takes under a minute — just an email, nickname, password, age, and sex.

| | Guest | Registered |
|---|---|---|
| See the map | ✅ | ✅ |
| See nearby users | ✅ | ✅ |
| Send & receive messages | ❌ | ✅ |
| End-to-end encrypted messages | ❌ | ✅ |
| Favourites list | ❌ | ✅ |
| View public profiles | ✅ | ✅ |
| Session inactivity lock | ❌ | ✅ |

---

## The Map

The map shows everyone who has pushed their location in the last 10 minutes. Guest pins and registered user pins are visually distinct. Tapping a pin opens a brief profile and, if you are registered, a button to send that person a message.

Your location is pushed automatically every 30 seconds. If the browser blocks location access, the app falls back to IP-based geolocation — those pins are marked as approximate.

---

## Sending Messages

Only registered users can message. You can only message someone who is currently nearby (their pin must be on the map). Messages are end-to-end encrypted — the server never sees your text, only ciphertext. Messages expire 4 hours after they are sent.

Navigate to **Messages** to see all your active conversations and threads.

---

## Favourites

Add anyone you want to keep track of to your Favourites list. You can see in real time whether each favourited person is currently online (has pushed a location in the last 10 minutes). The other person is not notified when you add them.

---

## Your Profile

Your public profile shows your nickname, age, and sex — nothing else. Your email is never visible to other users. You can update your nickname, email, password, age, and sex at any time from the Profile page. Deleting your account permanently removes all your data including messages and location history.

---

## Privacy & Session Lock

Your messages are end-to-end encrypted using keys that exist only in your browser. The server stores an encrypted copy of your private key, but cannot read it — only your password can unlock it.

To protect your keys when you step away, the app automatically locks after:
- **30 minutes** of no interaction
- **3 minutes** of the tab being hidden

When locked, a prompt asks for your password to restore your keys. This is not a full re-login — your session stays active.

---

## What Happens to Your Data

| Data | Lifetime |
|---|---|
| Your location pin | Disappears 10 minutes after your last push, or immediately on logout |
| Messages | Expire 4 hours after being sent |
| Your account | Persists until you delete it |
| Guest session | 15 minutes, then a new token is issued |

---

# Part 2 — Technical Reference

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

## Security & Encryption

bOOmbOOm.NOW! implements **end-to-end encrypted (E2EE) messaging** using the Web Crypto API. Messages are encrypted in the browser before being sent to the server. The server stores only ciphertext and can never read message content.

- Each user has an ECDH P-256 keypair generated in the browser on first login
- The private key is encrypted with the user's password (PBKDF2 + AES-GCM) and stored on the server as a blob
- The private key never leaves the browser in plaintext
- On login, the encrypted blob is fetched and decrypted client-side using the entered password
- Each message is encrypted twice — once with the recipient's public key, once with the sender's own public key — so both parties can read their copy
- On logout or inactivity, keys are wiped from memory

See [Messages](messages.md) for the full E2EE protocol details.

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
├── user-guide.md                 → User Guide (Part 1 detail)
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

## API Documentation

| Document | Description |
|---|---|
| [Authentication](auth.md) | Guest tokens, register, login, JWT structure |
| [User Profiles & Keys](users.md) | Profile management, E2EE key storage |
| [Location](location.md) | Location push, nearby lookup, IP fallback |
| [Messages](messages.md) | Send, read, E2EE encryption format, expiry |
| [Favourites](favourites.md) | Add, remove, online status |
| [Tiers](tiers.md) | Tier system, future ABAC plans |
| [Migrations](migrations.md) | Migration runner, adding migrations |

---

*You are here: README · [User Guide →](user-guide.md) · [Authentication →](auth.md)*
