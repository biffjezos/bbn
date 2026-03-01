// ============================================================
// bOOmbOOm.NOW! — migration-service.js
// Standalone service. Runs DB migrations on demand.
// Called by server.js on boot before accepting traffic.
// ============================================================

// ============================================================
// CONFIG
// ============================================================
const CFG = {
  PORT:       process.env.MIGRATE_PORT  || 3099,
  MONGO_URI:  process.env.MONGO_URI     || '',
  DB_NAME:    process.env.DB_NAME       || 'boomboom',
};
// ============================================================

import express         from 'express';
import { MongoClient } from 'mongodb';

// --- DB -----------------------------------------------------
const db = (await new MongoClient(CFG.MONGO_URI).connect()).db(CFG.DB_NAME);
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
      // users — unique email + nickname
      await db.collection('users').createIndex({ email: 1 },    { unique: true, background: true });
      await db.collection('users').createIndex({ nickname: 1 }, { unique: true, background: true });

      // sessions — guest session lookup
      await db.collection('sessions').createIndex({ guestId: 1 }, { unique: true, background: true });

      // locations — TTL index (10 min expiry)
      await db.collection('locations').createIndex(
        { updatedAt: 1 },
        { expireAfterSeconds: 600, background: true }
      );

      // messages — TTL index (expires at field)
      await db.collection('messages').createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0, background: true }
      );

      // favourites — unique owner+target pair
      await db.collection('favourites').createIndex(
        { ownerUserId: 1, favouriteUserId: 1 },
        { unique: true, background: true }
      );
    },
  },

  {
    id: '002_user_tiers',
    async up(db) {
      // Backfill all existing users that have no tier field with 'regular'
      await db.collection('users').updateMany(
        { tier: { $exists: false } },
        { $set: { tier: 'regular' } }
      );
    },
  },

  // ── ADD NEW MIGRATIONS HERE ─────────────────────────────────
  // {
  //   id: '003_your_migration',
  //   async up(db) { ... }
  // },

];

// ============================================================
// RUNNER
// ============================================================
async function runMigrations() {
  const col = db.collection('_migrations');
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
    await migration.up(db);
    await col.insertOne({ id: migration.id, appliedAt: new Date() });
    console.log(`[migrations] done  ${migration.id}`);
    ran++;
  }

  console.log(`[migrations] complete. ${ran} migration(s) applied.`);
  return { ok: true, applied: ran };
}

// ============================================================
// EXPRESS
// ============================================================
const app = express();
app.use(express.json({ limit: '16kb' }));

app.get('/health', (_req, res) => res.json({ ok: true }));

// POST /migrate/run — called by server.js on boot
app.post('/migrate/run', async (_req, res) => {
  try {
    const result = await runMigrations();
    res.json(result);
  } catch (e) {
    console.error('[migrations] ERROR', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));

app.listen(CFG.PORT, () => console.log(`[migrations] Running on :${CFG.PORT}`));
