// ============================================================
// bOOmbOOm.NOW! — location.js
// Handles: push own location, get nearby users.
// Haversine distance logic lives here (no DB dependency).
// Opens its own MongoDB connection via MONGO_URI.
// ============================================================

// ============================================================
// CONFIG
// ============================================================
const CFG = {
  MONGO_URI: process.env.MONGO_URI || '',
  DB_NAME:   process.env.DB_NAME   || 'boomboom',

  // How often / how far a client must move before we write to DB
  UPDATE_INTERVAL_MS: 15_000,   // 15 seconds minimum between pushes
  UPDATE_DISTANCE_M:  100,      // OR moved at least 100 m

  // Stale location TTL (also set as a MongoDB index on auth.js startup)
  LOCATION_TTL_SEC:   10 * 60, // 10 min — MongoDB drops docs older than this

  // Vicinity rules
  VICINITY_RADIUS_M:          100,       // radius within which users are visible
  MAX_VISIBLE_GUESTS:         5,         // pin cap for unregistered viewers
  MAX_VISIBLE_REGISTERED:     Infinity,  // registered users see everyone
  VISIBLE_SELECTION_STRATEGY: 'random',  // 'random' | 'nearest' | 'newest'
};
// ============================================================

import { Router }      from 'express';
import { MongoClient } from 'mongodb';
import { requireAnyToken } from './auth.js';

// --- DB connection ------------------------------------------
const client = new MongoClient(CFG.MONGO_URI);
await client.connect();
const db = client.db(CFG.DB_NAME);
console.log('[location] DB connected.');

// TTL index: auto-remove location docs older than LOCATION_TTL_SEC
await db.collection('locations').createIndex(
  { updatedAt: 1 },
  { expireAfterSeconds: CFG.LOCATION_TTL_SEC, background: true }
);

// ============================================================
// HAVERSINE GEO LOGIC
// Pure functions — no DB, no side effects. Replace freely.
// ============================================================

const EARTH_RADIUS_M = 6_371_000;
const toRad = deg => deg * Math.PI / 180;

/** Great-circle distance in metres between two lat/lon points. */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Filter a users array to those within radiusM of origin. Adds .distanceM to each. */
function filterByRadius(origin, users, radiusM) {
  return users
    .map(u => ({ ...u, distanceM: haversineDistance(origin.lat, origin.lon, u.lat, u.lon) }))
    .filter(u => u.distanceM <= radiusM);
}

/** Apply the visibility cap using the configured strategy. */
function applyStrategy(users, maxCount, strategy) {
  if (maxCount === Infinity || users.length <= maxCount) return users;
  switch (strategy) {
    case 'nearest':
      return [...users].sort((a, b) => a.distanceM - b.distanceM).slice(0, maxCount);
    case 'newest':
      return [...users].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, maxCount);
    case 'random':
    default: {
      const s = [...users];
      for (let i = s.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [s[i], s[j]] = [s[j], s[i]];
      }
      return s.slice(0, maxCount);
    }
  }
}

/** True if the incoming location is worth writing to the DB. */
function shouldUpdate(prev, next) {
  if (!prev) return true;
  const timePassed = Date.now() - new Date(prev.updatedAt).getTime() >= CFG.UPDATE_INTERVAL_MS;
  const movedFar   = haversineDistance(prev.lat, prev.lon, next.lat, next.lon) >= CFG.UPDATE_DISTANCE_M;
  return timePassed || movedFar;
}

// Export for use in messages.js (proximity check before sending)
export { haversineDistance };

// --- Routes -------------------------------------------------
export const router = Router();

// PUT /api/location  — upsert caller's current position
router.put('/', requireAnyToken, async (req, res) => {
  try {
    const { lat, lon } = req.body;
    if (typeof lat !== 'number' || typeof lon !== 'number' ||
        lat < -90 || lat > 90 || lon < -180 || lon > 180)
      return res.status(400).json({ error: 'Valid lat and lon (numbers) required.' });

    const id     = req.auth.sub;
    const isUser = req.auth.role === 'user';

    const existing = await db.collection('locations').findOne({ userId: id });
    if (existing && !shouldUpdate(existing, { lat, lon }))
      return res.json({ ok: true, skipped: true });

    await db.collection('locations').updateOne(
      { userId: id },
      {
        $set: {
          userId:       id,
          lat,
          lon,
          isRegistered: isUser,
          sex:          req.auth.sex      || null,
          nickname:     req.auth.nickname || null,
          updatedAt:    new Date(),
        },
      },
      { upsert: true }
    );

    res.json({ ok: true });
  } catch (e) {
    console.error('[location PUT]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// GET /api/location/nearby?lat=&lon=
router.get('/nearby', requireAnyToken, async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);
    if (isNaN(lat) || isNaN(lon))
      return res.status(400).json({ error: 'lat and lon query params required.' });

    const callerId     = req.auth.sub;
    const isRegistered = req.auth.role === 'user';

    const all      = await db.collection('locations').find({ userId: { $ne: callerId } }).toArray();
    const inRadius = filterByRadius({ lat, lon }, all, CFG.VICINITY_RADIUS_M);
    const maxCount = isRegistered ? CFG.MAX_VISIBLE_REGISTERED : CFG.MAX_VISIBLE_GUESTS;
    const visible  = applyStrategy(inRadius, maxCount, CFG.VISIBLE_SELECTION_STRATEGY);

    res.json({
      users: visible.map(u => ({
        userId:       u.userId,
        lat:          u.lat,
        lon:          u.lon,
        isRegistered: u.isRegistered,
        sex:          u.sex,
        nickname:     u.nickname,
        distanceM:    Math.round(u.distanceM),
      })),
    });
  } catch (e) {
    console.error('[location/nearby]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});
