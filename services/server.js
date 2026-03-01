// ============================================================
// bOOmbOOm.NOW! — server.js
// Public gateway. The only service exposed to the client.
// Forwards /api/* requests to internal services.
// Calls migration-service on boot before accepting traffic.
// ============================================================

// ============================================================
// CONFIG
// ============================================================
const CFG = {
  PORT:              process.env.PORT              || 3000,
  AUTH_SERVICE_URL:  process.env.AUTH_SERVICE_URL  || 'http://localhost:3001',
  USER_SERVICE_URL:  process.env.USER_SERVICE_URL  || 'http://localhost:3002',
  LOC_SERVICE_URL:   process.env.LOC_SERVICE_URL   || 'http://localhost:3003',
  MSG_SERVICE_URL:   process.env.MSG_SERVICE_URL   || 'http://localhost:3004',
  TIERS_SERVICE_URL: process.env.TIERS_SERVICE_URL || 'http://localhost:3005',
  MIGRATE_URL:       process.env.MIGRATE_URL       || 'http://localhost:3099',
};
// ============================================================

import express from 'express';
import cors    from 'cors';

const app = express();

app.use(cors({
  origin:         'https://bbn-e86d0c.gitlab.io',
  methods:        ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '16kb' }));

app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// --- Proxy helper -------------------------------------------
async function proxy(req, res, targetUrl) {
  try {
    const response = await fetch(targetUrl, {
      method:  req.method,
      headers: {
        'Content-Type':  'application/json',
        'Authorization': req.headers['authorization'] || '',
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

// --- Auth ---------------------------------------------------
app.post('/api/auth/guest',    (req, res) => proxy(req, res, `${CFG.AUTH_SERVICE_URL}/auth/guest`));
app.post('/api/auth/register', (req, res) => proxy(req, res, `${CFG.AUTH_SERVICE_URL}/auth/register`));
app.post('/api/auth/login',    (req, res) => proxy(req, res, `${CFG.AUTH_SERVICE_URL}/auth/login`));

// --- Users --------------------------------------------------
app.get   ('/api/users/me',                (req, res) => proxy(req, res, `${CFG.USER_SERVICE_URL}/users/me`));
app.put   ('/api/users/me',                (req, res) => proxy(req, res, `${CFG.USER_SERVICE_URL}/users/me`));
app.delete('/api/users/me',                (req, res) => proxy(req, res, `${CFG.USER_SERVICE_URL}/users/me`));
app.get   ('/api/users/:nickname/profile', (req, res) => proxy(req, res, `${CFG.USER_SERVICE_URL}/users/${req.params.nickname}/profile`));

// --- Favourites ---------------------------------------------
app.get   ('/api/favourites',         (req, res) => proxy(req, res, `${CFG.USER_SERVICE_URL}/favourites`));
app.post  ('/api/favourites/:userId', (req, res) => proxy(req, res, `${CFG.USER_SERVICE_URL}/favourites/${req.params.userId}`));
app.delete('/api/favourites/:userId', (req, res) => proxy(req, res, `${CFG.USER_SERVICE_URL}/favourites/${req.params.userId}`));

// --- Location -----------------------------------------------
app.put('/api/location',        (req, res) => proxy(req, res, `${CFG.LOC_SERVICE_URL}/location`));
app.get('/api/location/nearby', (req, res) => proxy(req, res, `${CFG.LOC_SERVICE_URL}/location/nearby?lat=${req.query.lat}&lon=${req.query.lon}`));

// --- Messages -----------------------------------------------
app.get   ('/api/messages',           (req, res) => proxy(req, res, `${CFG.MSG_SERVICE_URL}/messages`));
app.get   ('/api/messages/:nickname', (req, res) => proxy(req, res, `${CFG.MSG_SERVICE_URL}/messages/${req.params.nickname}`));
app.post  ('/api/messages/:nickname', (req, res) => proxy(req, res, `${CFG.MSG_SERVICE_URL}/messages/${req.params.nickname}`));
app.delete('/api/messages/:id',       (req, res) => proxy(req, res, `${CFG.MSG_SERVICE_URL}/messages/${req.params.id}`));

// --- Tiers --------------------------------------------------
app.get ('/api/tiers/info',         (req, res) => proxy(req, res, `${CFG.TIERS_SERVICE_URL}/tiers/info`));
app.get ('/api/tiers/features',     (req, res) => proxy(req, res, `${CFG.TIERS_SERVICE_URL}/tiers/features`));
app.post('/api/tiers/can',          (req, res) => proxy(req, res, `${CFG.TIERS_SERVICE_URL}/tiers/can`));
app.get ('/api/tiers/radius/:tier', (req, res) => proxy(req, res, `${CFG.TIERS_SERVICE_URL}/tiers/radius/${req.params.tier}`));

// --- 404 + error --------------------------------------------
app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, _req, res, _next) => res.status(500).json({ error: 'Internal server error.' }));

// --- Boot: run migrations first, then open gateway ----------
(async () => {
  try {
    console.log('[gateway] Running migrations before opening…');
    const result = await fetch(`${CFG.MIGRATE_URL}/migrate/run`, { method: 'POST' })
      .then(r => r.json());
    console.log(`[gateway] Migrations complete. Applied: ${result.applied}. Opening gateway…`);
  } catch (e) {
    console.error('[gateway] Migration call failed — booting anyway.', e.message);
  }
  app.listen(CFG.PORT, () => console.log(`[gateway] Running on :${CFG.PORT}`));
})();
