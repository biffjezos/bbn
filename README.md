# bOOmbOOm.NOW!

A real-time proximity messaging app. Find out who is physically nearby right now and send them a message. No followers, no feeds, no profiles to scroll. Just the people around you, in this moment.

---

## Concept

bOOmbOOm.NOW! is built around a single constraint: **you can only message someone if you are both in the same place at the same time.** Messages expire after 4 hours. Locations expire after 10 minutes. Nothing is permanent. Everything is now.

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
    ├── auth-service.js      (port 3001)  Guest tokens, register, login
    ├── users-service.js     (port 3002)  Profile, favourites
    ├── location-service.js  (port 3003)  Location push, nearby lookup
    └── messages-service.js  (port 3004)  Send, read, delete messages
```

### Frontend

- Static site built with Jekyll, hosted on GitLab Pages
- No framework — vanilla JS, Bootstrap 5, Leaflet
- Three scripts: `api.js` (HTTP client), `auth.js` (token + session state), `app.js` (UI controller), `map.js` (Leaflet map)

### Backend

- Node.js ES modules, Express
- MongoDB (single database `boomboom`, shared by all services)
- JWT authentication — stateless, verified locally in each service
- All services share `JWT_SECRET` and `MONGO_URI` via Railway environment variables

---

## Features

| Feature | Guest | Regular | Premium |
|---|---|---|---|
| See the map | ✅ | ✅ | ✅ |
| See nearby users | ✅ 50m | ✅ 500m | ✅ 2000m |
| Message nearby users | ❌ | ✅ | ✅ |
| Message anyone anytime | ❌ | ❌ | ✅ |
| Favourites list | ❌ | ❌ | ✅ |

---

## Repository Structure

```
/
├── ui/
│   ├── _layouts/
│   │   └── default.html        Main HTML shell, navbar, modals
│   ├── scripts/
│   │   ├── api.js              API client
│   │   ├── auth.js             Auth state manager
│   │   ├── app.js              UI controller
│   │   └── map.js              Leaflet map module
│   ├── styles/
│   │   └── app.css             App styles
│   ├── index.html              Entry point (Jekyll)
│   ├── _config.yml             Jekyll config
│   └── Gemfile                 Jekyll dependencies
│
├── services/
│   ├── server.js               Gateway + migration runner
│   ├── auth-service.js         Authentication
│   ├── users-service.js        Users + favourites
│   ├── location-service.js     Location
│   ├── messages-service.js     Messages
│   ├── migration-service.js    Standalone migration service reference
│   └── tiers.js                Tier system — single source of truth
│
└── .gitlab-ci.yml              CI/CD — builds and deploys GitLab Pages
```

---

## Documentation

| Document | Description |
|---|---|
| `README.md` | This file |
| `docs/auth.md` | Authentication — guest tokens, register, login, JWT |
| `docs/users.md` | User profiles — get, update, delete account |
| `docs/location.md` | Location system — push, nearby, TTL, proximity |
| `docs/messages.md` | Messaging — send, read, delete, proximity rules |
| `docs/favourites.md` | Favourites list — add, remove, online status |
| `docs/tiers.md` | Tier system — how it works, adding features and tiers |
| `docs/migrations.md` | Migration runner — how it works, adding migrations |

---

## Environment Variables

All services share the same set of Railway environment variables.

| Variable | Used by | Description |
|---|---|---|
| `MONGO_URI` | All services | MongoDB connection string |
| `DB_NAME` | All services | Database name (default: `boomboom`) |
| `JWT_SECRET` | All services | Secret for signing and verifying JWTs. **Must match across all services.** |
| `PORT` | Each service | Port the service listens on |
| `MIGRATE_PORT` | `server.js` | Port for the internal migration service (default: 3099) |
| `AUTH_SERVICE_URL` | `server.js` | Internal URL of auth-service |
| `USER_SERVICE_URL` | `server.js` | Internal URL of users-service |
| `LOC_SERVICE_URL` | `server.js` | Internal URL of location-service |
| `MSG_SERVICE_URL` | `server.js` | Internal URL of messages-service |

---

## Deployment

### Frontend (GitLab Pages)

Push to `main`. The CI pipeline runs Jekyll and publishes to GitLab Pages automatically. The API base URL is injected at build time via `site.api_url` in `_config.yml`.

### Backend (Railway)

Each service is a separate Railway deployment running `node services/<name>.js`. They share environment variables via Railway's shared variable groups.

On boot, `server.js` calls `POST /migrate/run` on the internal migration service before opening the gateway. This ensures the database is always in the correct state before any traffic is accepted.

---

## Local Development

```bash
# Frontend
cd ui
bundle install
bundle exec jekyll serve

# Backend (each service in a separate terminal)
node services/auth-service.js
node services/users-service.js
node services/location-service.js
node services/messages-service.js
node services/server.js
```

Set environment variables in a `.env` file or export them in your shell before running.
