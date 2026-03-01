// ============================================================
// bOOmbOOm.NOW! — migration-service.js
// Standalone migration runner. Called by server.js on boot
// before the public gateway opens. Runs each migration exactly
// once and records it in the _migrations collection.
// Not exposed publicly — internal only.
// ============================================================

// ============================================================
// CONFIG
// ============================================================
const CFG = {
  PORT:      process.env.MIGRATION_PORT || 3099,
  MONGO_URI: process.env.MONGO_URI      || '',
  DB_NAME:   process.env.DB_NAME        || 'boomboom',
};
// ============================================================

import express           from 'express';
import { MongoClient }   from 'mongodb';

const MIGRATIONS_COLLECTION = '_migrations';

// ============================================================
// MIGRATIONS
// ============================================================
const migrations = [
  {
    id: '001_indexes',
    async up(db) {
      await db.collection('users').createIndex({ email: 1 },    { unique: true, background: true });
      await db.collection('users').createIndex({ nickname: 1 }, { unique: true, background: true });
      await db.collection('sessions').createIndex({ guestId: 1 }, { unique: true, background: true });
      await db.collection('favourites').createIndex(
        { ownerUserId: 1, favouriteUserId: 1 },
        { unique: true, background: true }
      );
      await db.collection('locations').createIndex(
        { updatedAt: 1 },
        { expireAfterSeconds: 600, background: true }
      );
      await db.collection('messages').createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0, background: true }
      );
    },
  },
  {
    id: '002_user_tiers_backfill',
    async up(db) {
      await db.collection('users').updateMany(
        { tier: { $exists: false } },
        { $set: { tier: 'regular' } }
      );
    },
  },
  {
    id: '003_user_tiers_index',
    async up(db) {
      await db.collection('users').createIndex({ tier: 1 }, { background: true });
    },
  },
  {
    id: '004_locations_2dsphere',
    async up(db) {
      // Add a 2dsphere index on locations.location (GeoJSON Point).
      // Location documents are TTL-ephemeral (10 min) so the collection
      // is empty or near-empty at deploy time — index build is instant.
      await db.collection('locations').createIndex(
        { location: '2dsphere' },
        { background: true }
      );
    },
  },
  {
    id: '005_drop_nickname_unique_index',
    async up(db) {
      // Nicknames are display names only — duplicates are allowed.
      // Only email is required to be unique for login.
      try {
        await db.collection('users').dropIndex('nickname_1');
      } catch (e) {
        // Index may not exist on fresh deployments — safe to ignore
        if (e.codeName !== 'IndexNotFound') throw e;
      }
    },
  },
];

// ============================================================
// EXPRESS
// ============================================================
const app = express();
app.use(express.json({ limit: '16kb' }));

app.get('/health', (_req, res) => res.json({ ok: true }));

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
    console.error('[migrations] Error:', e);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    await client?.close();
  }
});

app.listen(CFG.PORT, () => console.log(`[migrations] Running on :${CFG.PORT}`));
