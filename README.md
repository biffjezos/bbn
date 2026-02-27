# bOOmbOOm.NOW! 💥

> Find who's nearby. Message in the moment.

A proximity-based ephemeral messaging web app. See registered users near you on a map, click their icon to view their profile, and exchange short messages — which auto-delete when you drift apart or after 4 hours.

---

## Architecture

```
GitLab Pages          Railway.com (middleware)    Railway.com (MongoDB)
┌──────────────┐      ┌──────────────────────┐    ┌────────────────┐
│ Jekyll SSG   │ ───► │ Express / Bun        │───►│ MongoDB        │
│ + Leaflet    │      │ REST API             │    │ (schemaless)   │
│ + Bootstrap  │      │ JWT Auth             │    │ TTL indexes    │
└──────────────┘      └──────────────────────┘    └────────────────┘
```

---

## Repository Structure

```
boomboom/
├── .gitlab-ci.yml          CI/CD pipeline
├── .gitignore
├── README.md
│
├── frontend/               Jekyll site
│   ├── _config.yml
│   ├── Gemfile
│   ├── index.html          Main page (map lives here)
│   ├── _layouts/
│   │   └── default.html    App shell: navbar, modals, offcanvas menu
│   ├── _thymeleaf/         Optional Thymeleaf templates (pre-processed in CI)
│   └── assets/
│       ├── css/app.css
│       └── js/
│           ├── api.js      All API calls (one place to change the base URL)
│           ├── auth.js     JWT management, guest tokens, countdown
│           ├── map.js      Leaflet, geolocation, Haversine, marker icons
│           └── app.js      App controller, wires everything together
│
└── middleware/             Express REST API
    ├── server.js           Entry point
    ├── config.js           ⭐ ALL tunable variables live here
    ├── routes.js           All API route handlers
    ├── auth.js             JWT issue / verify / middleware
    ├── geoLogic.js         ⭐ Haversine distance, no DB dependency
    ├── db.js               MongoDB connection + index setup
    ├── package.json
    └── railway.toml        Railway deployment config
```

---

## Quick Start (local development)

### Prerequisites
- Ruby 3.x + Bundler (`gem install bundler`)
- Node.js 18+ or Bun
- A MongoDB instance (local or MongoDB Atlas free tier)

### 1. Clone and install

```bash
git clone https://gitlab.com/yourname/boomboom.git
cd boomboom

# Frontend
cd frontend && bundle install

# Middleware
cd ../middleware && npm install   # or: bun install
```

### 2. Configure middleware

Create `middleware/.env` (never commit this):

```env
MONGO_URI=mongodb://username:password@localhost:27017/boomboom?authSource=admin
JWT_SECRET=replace-with-a-long-random-string-at-least-32-chars
ALLOWED_ORIGINS=http://localhost:4000
PORT=3000
DB_NAME=boomboom
```

### 3. Run locally

```bash
# Terminal 1 — middleware
cd middleware
node server.js       # or: bun server.js

# Terminal 2 — Jekyll
cd frontend
bundle exec jekyll serve --livereload
```

Open http://localhost:4000

---

## Deployment

### Middleware → Railway.com

1. Create a new Railway project
2. Add a MongoDB plugin (Railway managed) — copy the `MONGO_URI` from the plugin
3. Deploy the `middleware/` folder as a service
4. Set environment variables in Railway dashboard:
   - `MONGO_URI` — from the MongoDB plugin
   - `JWT_SECRET` — generate with: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
   - `ALLOWED_ORIGINS` — your GitLab Pages URL, e.g. `https://yourusername.gitlab.io`
5. Railway auto-detects `package.json` and deploys. Note your service URL.

### Frontend → GitLab Pages

1. In GitLab → Settings → CI/CD → Variables, add:
   - `API_URL` = `https://your-railway-service.up.railway.app/api`
2. Push to `main` branch — the pipeline runs automatically
3. Site is live at `https://yourusername.gitlab.io/boomboom` (or your custom domain)

---

## Configuration Reference

All server-side tunables are in `middleware/config.js`:

| Variable | Default | Description |
|---|---|---|
| `VICINITY_RADIUS_M` | 100 | Radius (m) to show other users |
| `MAX_VISIBLE_GUESTS` | 5 | Max pins shown to unregistered users |
| `MAX_VISIBLE_REGISTERED` | Infinity | Max pins for registered users |
| `VISIBLE_SELECTION_STRATEGY` | `'random'` | `random` / `nearest` / `newest` |
| `GUEST_REFRESH_WINDOW_MS` | 15 min | Guest token lifetime |
| `LOCATION_UPDATE_INTERVAL_MS` | 15s | Min time between location pushes |
| `LOCATION_UPDATE_DISTANCE_M` | 100 | Min movement to force location push |
| `MESSAGE_MAX_CHARS` | 144 | Max message length |
| `MESSAGE_TTL_MS` | 4h | Hard message expiry |
| `MESSAGE_PROXIMITY_REQUIRED_M` | 100 | Max distance to send a message |
| `LOCATION_TTL_MS` | 10 min | Stale location cleanup |

---

## API Reference

### Auth
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/guest` | — | Issue guest token |
| POST | `/api/auth/register` | — | Register new user |
| POST | `/api/auth/login` | — | Login (email or nickname) |

### Users
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/users/me` | User | Get own profile |
| PUT | `/api/users/me` | User | Update profile |
| DELETE | `/api/users/me` | User | Delete account + all data |
| GET | `/api/users/:nickname/profile` | Any | Public profile (for modal) |

### Location
| Method | Path | Auth | Description |
|---|---|---|---|
| PUT | `/api/location` | Any | Upsert own location |
| GET | `/api/location/nearby?lat=&lon=` | Any | Get nearby users |

### Messages
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/messages` | User | All conversations |
| GET | `/api/messages/:nickname` | User | Thread with user |
| POST | `/api/messages/:nickname` | User | Send message (proximity checked) |
| DELETE | `/api/messages/:id` | User | Delete own message |

---

## Map Icons

| Icon | Colour | Meaning |
|---|---|---|
| 👌 | yellow glow | You (self marker) |
| 👆 | light blue | Registered male user |
| 👆 | pink | Registered female user |
| 👆 | yellow | Registered other |
| ✊ | grey | Unregistered / guest |

---

## Security Notes

- Passwords are hashed with bcrypt (12 rounds)
- JWTs are signed with HS256; secret must be kept in Railway env vars
- MongoDB is only accessible from the middleware service via the `MONGO_URI` auth token
- CORS is restricted to configured `ALLOWED_ORIGINS`
- Guest tokens expire after 15 minutes and are not renewable without a new page load
- All inputs are validated server-side before DB writes

---

## Thymeleaf Templates (optional)

Place `.html` files in `frontend/_thymeleaf/`. The CI pipeline will pre-render them using the Thymeleaf CLI and output static fragments to `frontend/_includes/th/`, which you can then include in layouts with `{% include th/your-fragment.html %}`.

This is useful for complex server-side-rendered fragments you want to pre-compile at deploy time without adding a Java runtime to production.
