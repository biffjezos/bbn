// ============================================================
// bOOmbOOm.NOW! — migration-service.js
// ============================================================

const CFG = {
  PORT:      process.env.MIGRATION_PORT || 3099,
  MONGO_URI:  process.env.MONGO_URI,
  DB_NAME:    process.env.DB_NAME        || 'boomboom',
  JWT_SECRET: process.env.JWT_SECRET,
};
const _missingCfg = ['JWT_SECRET', 'MONGO_URI'].filter(k => !CFG[k]);
if (_missingCfg.length) { console.error('FATAL: missing env vars:', _missingCfg.join(', ')); process.exit(1); }

import express         from 'express';
import { MongoClient } from 'mongodb';
import jwt             from 'jsonwebtoken';

const MIGRATIONS_COLLECTION = '_migrations';

// ============================================================
// MIGRATIONS — each runs exactly once, in order
// ============================================================
const migrations = [
  {
    id: '001_indexes',
    async up(db) {
      await db.collection('users').createIndex({ email: 1 }, { unique: true });
      await db.collection('sessions').createIndex({ guestId: 1 }, { unique: true });
      await db.collection('sessions').createIndex(
        { createdAt: 1 },
        { expireAfterSeconds: 900 }  // sessions TTL: 15 min, matches guest JWT
      );
      await db.collection('favourites').createIndex(
        { ownerUserId: 1, favouriteUserId: 1 },
        { unique: true }
      );
      await db.collection('locations').createIndex(
        { updatedAt: 1 },
        { expireAfterSeconds: 600 }  // location TTL: 10 min
      );
      await db.collection('messages').createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0 }
      );
    },
  },
  {
    id: '002_locations_2dsphere',
    async up(db) {
      await db.collection('locations').createIndex({ location: '2dsphere' });
    },
  },
  {
    id: '003_blocks_indexes',
    async up(db) {
      // Unique: a user can only block another user once
      await db.collection('blocks').createIndex(
        { blockerUserId: 1, blockedUserId: 1 },
        { unique: true }
      );
      // For "who has blocked me" lookups in location/messages/users services
      await db.collection('blocks').createIndex({ blockedUserId: 1 });
    },
  },
];

// ============================================================
// EXPRESS
// ============================================================
const app = express();
app.use(express.json({ limit: '16kb' }));

// --- Service token guard ------------------------------------
function requireServiceToken(req, res, next) {
  const token = (req.headers['x-service-token'] || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'No service token.' });
  try {
    const payload = jwt.verify(token, CFG.JWT_SECRET);
    if (payload.role !== 'service') return res.status(403).json({ error: 'Not a service token.' });
    next();
  } catch {
    res.status(401).json({ error: 'Service token invalid or expired.' });
  }
}
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  requireServiceToken(req, res, next);
});

app.get('/health', async (_req, res) => {
  try {
    await db.command({ ping: 1 });
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false, error: 'DB unreachable' });
  }
});

// POST /migrate/run — called by gateway on boot
app.post('/migrate/run', async (req, res) => {
  let client;
  try {
    client = await new MongoClient(CFG.MONGO_URI).connect();
    const db  = client.db(CFG.DB_NAME);
    const col = db.collection(MIGRATIONS_COLLECTION);

    const applied    = await col.find({}).toArray();
    const appliedIds = new Set(applied.map(m => m.id));
    const pending    = migrations.filter(m => !appliedIds.has(m.id));

    for (const migration of pending) {
      await migration.up(db);
      await col.insertOne({ id: migration.id, appliedAt: new Date() });
      console.log(`[migrations] Applied: ${migration.id}`);
    }

    res.json({ ok: true, applied: pending.length });
  } catch (e) {
    console.error('[migrations] Error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    await client?.close();
  }
});

// POST /migrate/reset — clears bloated/empty collections, preserves users
// Call this ONCE manually after wiping the DB or to fix a broken state.
// Safe to call multiple times — collections are recreated fresh each time.
app.post('/migrate/reset', async (req, res) => {
  let client;
  try {
    client = await new MongoClient(CFG.MONGO_URI).connect();
    const db = client.db(CFG.DB_NAME);

    // Drop and recreate — preserves users collection entirely
    const toDrop = ['sessions', 'locations', 'messages', 'favourites', '_migrations'];
    for (const name of toDrop) {
      try { await db.collection(name).drop(); } catch (e) { /* ignore if not exists */ }
      console.log(`[migrations] Dropped: ${name}`);
    }

    // Re-run all migrations from scratch
    const col = db.collection(MIGRATIONS_COLLECTION);
    for (const migration of migrations) {
      await migration.up(db);
      await col.insertOne({ id: migration.id, appliedAt: new Date() });
      console.log(`[migrations] Applied: ${migration.id}`);
    }

    res.json({ ok: true, message: 'Reset complete. users collection untouched.' });
  } catch (e) {
    console.error('[migrations] Reset error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    await client?.close();
  }
});

app.listen(CFG.PORT, () => console.log(`[migrations] Running on :${CFG.PORT}`));