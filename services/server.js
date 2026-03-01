// ============================================================
// bOOmbOOm.NOW! — server.js
// Public gateway. The only service exposed to the client.
// Forwards requests to internal services with Bearer token.
//
// Also hosts migration-service (standalone: migration-service.js)
// merged here because Railway does not allow spawning a new
// service instance. Duplicated constants are commented below.
// ============================================================

// ============================================================
// CONFIG — gateway
// ============================================================
const CFG = {
  PORT:             process.env.PORT             || 3000,
  AUTH_SERVICE_URL: process.env.AUTH_SERVICE_URL || 'http://localhost:3001',
  USER_SERVICE_URL: process.env.USER_SERVICE_URL || 'http://localhost:3002',
  LOC_SERVICE_URL:  process.env.LOC_SERVICE_URL  || 'http://localhost:3003',
  MSG_SERVICE_URL:  process.env.MSG_SERVICE_URL  || 'http://localhost:3004',
  MIGRATE_PORT:     process.env.MIGRATE_PORT     || 3099,
  MONGO_URI:        process.env.MONGO_URI        || '',
  DB_NAME:          process.env.DB_NAME          || 'boomboom',
};
// ============================================================

import express         from 'express';
import cors            from 'cors';
import { MongoClient } from 'mongodb';
import { TIER_BADGE }  from './tiers.js';

// ============================================================
// MIGRATION SERVICE (standalone: migration-service.js)
// ============================================================

// --- DB (migration service only) ----------------------------
const migrationDb = (await new MongoClient(CFG.MONGO_URI).connect()).db(CFG.DB_NAME);
console.log('[migrations] DB connected.');

// ============================================================
// MIGRATIONS
// Each migration has a unique id and an idempotent up() fn.
// Add new migrations at the bottom of the array only.
// Never edit or remove existing migrations.
// ============================================================
const migrations = [

  {
    id: '001_indexes',
    async up(db) {
      await db.collection('users').createIndex({ email: 1 },    { unique: true, background: true });
      await db.collection('users').createIndex({ nickname: 1 }, { unique: true, background: true });
      await db.collection('sessions').createIndex({ guestId: 1 }, { unique: true, background: true });
      await db.collection('locations').createIndex(
        { updatedAt: 1 },
        { expireAfterSeconds: 600, background: true }
      );
      await db.collection('messages').createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0, background: true }
      );
      await db.collection('favourites').createIndex(
        { ownerUserId: 1, favouriteUserId: 1 },
        { unique: true, background: true }
      );
    },
  },

  {
    id: '002_user_tiers_backfill',
    async up(db) {
      // Backfill all existing users that have no tier field with 'regular'.
      await db.collection('users').updateMany(
        { tier: { $exists: false } },
        { $set: { tier: 'regular' } }
      );
    },
  },

  {
    id: '003_user_tiers_index',
    async up(db) {
      // Index on tier for fast admin queries (e.g. list all premium users).
      await db.collection('users').createIndex(
        { tier: 1 },
        { background: true }
      );
    },
  },

  // ── ADD NEW MIGRATIONS HERE ─────────────────────────────────
  // {
  //   id: '004_your_migration',
  //   async up(db) { ... }
  // },

];

// --- Runner -------------------------------------------------
async function runMigrations() {
  const col     = migrationDb.collection('_migrations');
  const applied = new Set(
    (await col.find({}).toArray()).map(m => m.id)
  );

  let ran = 0;
  for (const migration of migrations) {
    if (applied.has(migration.id)) {
      console.log(`[migrations] skip  ${migration.id}`);
      continue;
    }
    console.log(`[migrations] run   ${migration.id} …`);
    await migration.up(migrationDb);
    await col.insertOne({ id: migration.id, appliedAt: new Date() });
    console.log(`[migrations] done  ${migration.id}`);
    ran++;
  }

  console.log(`[migrations] complete. ${ran} migration(s) applied.`);
  return { ok: true, applied: ran };
}

// --- Migration express app (internal, own port) -------------
// const app = express();       // <-- standalone: declared as 'app' in migration-service.js
// app.use(express.json(...))   // <-- standalone: declared on 'app' in migration-service.js
const migrationApp = express();
migrationApp.use(express.json({ limit: '16kb' }));

migrationApp.get('/health', (_req, res) => res.json({ ok: true }));

migrationApp.post('/migrate/run', async (_req, res) => {
  try {
    const result = await runMigrations();
    res.json(result);
  } catch (e) {
    console.error('[migrations] ERROR', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// const CFG = { PORT: ... }    // <-- standalone: migration-service.js uses CFG.PORT
//                                    here we use CFG.MIGRATE_PORT instead
migrationApp.use((_req, res) => res.status(404).json({ error: 'Not found.' }));
migrationApp.listen(CFG.MIGRATE_PORT, () =>
  console.log(`[migrations] Running on :${CFG.MIGRATE_PORT}`)
);

// ============================================================
// GATEWAY
// ============================================================

// const express = ...   // <-- already imported above
// const cors    = ...   // <-- already imported above

const app = express();

app.use(cors({
  origin: 'https://bbn-e86d0c.gitlab.io',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
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

// --- Tiers info — served directly from gateway --------------
// Returns badge labels and colours for each tier so the UI
// never needs to hardcode them. No auth required.
app.get('/api/tiers/info', (_req, res) => {
  res.json({ tiers: TIER_BADGE });
});

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

// --- 404 + error --------------------------------------------
app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, _req, res, _next) => res.status(500).json({ error: 'Internal server error.' }));

// --- Boot: run migrations first, then open gateway ----------
(async () => {
  try {
    console.log('[gateway] Running migrations before opening…');
    const result = await fetch(
      `http://localhost:${CFG.MIGRATE_PORT}/migrate/run`,
      { method: 'POST' }
    ).then(r => r.json());
    console.log(`[gateway] Migrations complete. Applied: ${result.applied}. Opening gateway…`);
  } catch (e) {
    console.error('[gateway] Migration call failed — booting anyway.', e.message);
  }
  app.listen(CFG.PORT, () => console.log(`[gateway] Running on :${CFG.PORT}`));
})();
