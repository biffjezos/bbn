// ============================================================
// bOOmbOOm.NOW! — server.js
// Public gateway. The only service exposed to the client.
// Forwards requests to internal services with Bearer token.
// Calls migration-service on boot before opening the gateway.
// ============================================================

// ============================================================
// CONFIG
// ============================================================
const CFG = {
  PORT:                  process.env.PORT                  || 3000,
  AUTH_SERVICE_URL:      process.env.AUTH_SERVICE_URL      || 'http://auth',
  USER_SERVICE_URL:      process.env.USER_SERVICE_URL      || 'http://usr',
  LOC_SERVICE_URL:       process.env.LOC_SERVICE_URL       || 'http://loc',
  MSG_SERVICE_URL:       process.env.MSG_SERVICE_URL       || 'http://msg',
  FAV_SERVICE_URL:       process.env.FAV_SERVICE_URL       || 'http://fav',
  MIGRATION_SERVICE_URL: process.env.MIGRATION_SERVICE_URL || 'http://migrations',
  JWT_SECRET:            process.env.JWT_SECRET            || 'change-me-in-production',
};
// ============================================================

import express from 'express';
import cors    from 'cors';
import jwt     from 'jsonwebtoken';

const app = express();

app.use(cors({
  origin: 'https://bbn-e86d0c.gitlab.io',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '16kb' }));

app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ============================================================
// SERVICE TOKEN — short-lived JWT identifying the gateway
// ============================================================
function serviceToken() {
  return jwt.sign(
    { sub: 'gateway', role: 'service' },
    CFG.JWT_SECRET,
    { expiresIn: '60s' }
  );
}

// ============================================================
// PROXY HELPER
// Passes the client's user token through as-is.
// Adds a service token in X-Service-Token so internal services
// can verify the request is coming from the gateway.
// ============================================================
async function proxy(req, res, targetUrl) {
  try {
    const response = await fetch(targetUrl, {
      method:  req.method,
      headers: {
        'Content-Type':    'application/json',
        'Authorization':   req.headers['authorization'] || '',
        'X-Service-Token': serviceToken(),
      },
      body: ['GET', 'DELETE'].includes(req.method) ? undefined : JSON.stringify(req.body),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (e) {
    console.error('[gateway]', e);
    res.status(502).json({ error: 'Service unavailable.' });
  }
}

// ============================================================
// ROUTES
// ============================================================

// --- Auth ---------------------------------------------------
app.post('/api/auth/guest',    (req, res) => proxy(req, res, `${CFG.AUTH_SERVICE_URL}/auth/guest`));
app.post('/api/auth/register', (req, res) => proxy(req, res, `${CFG.AUTH_SERVICE_URL}/auth/register`));
app.post('/api/auth/login',    (req, res) => proxy(req, res, `${CFG.AUTH_SERVICE_URL}/auth/login`));

// --- Users --------------------------------------------------
app.get   ('/api/users/me',                (req, res) => proxy(req, res, `${CFG.USER_SERVICE_URL}/users/me`));
app.put   ('/api/users/me',                (req, res) => proxy(req, res, `${CFG.USER_SERVICE_URL}/users/me`));
app.delete('/api/users/me',                (req, res) => proxy(req, res, `${CFG.USER_SERVICE_URL}/users/me`));
app.get   ('/api/users/:userId/profile', (req, res) => proxy(req, res, `${CFG.USER_SERVICE_URL}/users/${req.params.userId}/profile`));

// --- Location -----------------------------------------------
app.put   ('/api/location',        (req, res) => proxy(req, res, `${CFG.LOC_SERVICE_URL}/location`));
app.delete('/api/location',        (req, res) => proxy(req, res, `${CFG.LOC_SERVICE_URL}/location`));
app.get   ('/api/location/nearby', (req, res) => proxy(req, res, `${CFG.LOC_SERVICE_URL}/location/nearby?lat=${req.query.lat}&lon=${req.query.lon}`));

// --- Messages -----------------------------------------------
app.get   ('/api/messages',           (req, res) => proxy(req, res, `${CFG.MSG_SERVICE_URL}/messages`));
app.get   ('/api/messages/:userId',   (req, res) => proxy(req, res, `${CFG.MSG_SERVICE_URL}/messages/${req.params.userId}`));
app.post  ('/api/messages/:userId',   (req, res) => proxy(req, res, `${CFG.MSG_SERVICE_URL}/messages/${req.params.userId}`));
app.delete('/api/messages/:id',       (req, res) => proxy(req, res, `${CFG.MSG_SERVICE_URL}/messages/${req.params.id}`));

// --- Favourites ---------------------------------------------
app.get   ('/api/favourites',         (req, res) => proxy(req, res, `${CFG.FAV_SERVICE_URL}/favourites`));
app.post  ('/api/favourites/:userId', (req, res) => proxy(req, res, `${CFG.FAV_SERVICE_URL}/favourites/${req.params.userId}`));
app.delete('/api/favourites/:userId', (req, res) => proxy(req, res, `${CFG.FAV_SERVICE_URL}/favourites/${req.params.userId}`));

// --- 404 + error --------------------------------------------
app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, _req, res, _next) => res.status(500).json({ error: 'Internal server error.' }));

// ============================================================
// BOOT — run migrations first, then open the gateway
// ============================================================
try {
  console.log('[gateway] Calling migration service…');
  const result = await fetch(`${CFG.MIGRATION_SERVICE_URL}/migrate/run`, {
    method: 'POST',
    headers: { 'X-Service-Token': serviceToken() },
  });
  const data   = await result.json();
  if (data.ok) {
    console.log(`[gateway] Migrations done. Applied: ${data.applied}`);
  } else {
    console.warn('[gateway] Migration service reported failure:', data.error);
  }
} catch (e) {
  // Don't block the gateway if migrations are unreachable — log and continue
  console.warn('[gateway] Could not reach migration service:', e.message);
}

app.listen(CFG.PORT, () => console.log(`[gateway] Running on :${CFG.PORT}`));
