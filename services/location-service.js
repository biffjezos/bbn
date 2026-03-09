// ============================================================
// bOOmbOOm.NOW! — location-service.js
// Standalone service. Location push, nearby lookup.
// Uses MongoDB $nearSphere with 2dsphere index for radius queries.
// ============================================================

// ============================================================
// CONFIG
// ============================================================
const CFG = {
  PORT:      process.env.PORT       || 8080,
  MONGO_URI: process.env.MONGO_URI  || '',
  DB_NAME:   process.env.DB_NAME    || 'boomboom',
  JWT_SECRET: process.env.JWT_SECRET,

  UPDATE_INTERVAL_MS:  15_000,
  UPDATE_DISTANCE_M:   100,
  LOCATION_TTL_SEC:    10 * 60,

  RADIUS_GUEST_M:      Infinity,
  RADIUS_REGISTERED_M: Infinity,

  MAX_VISIBLE_GUESTS:      Infinity,
  MAX_VISIBLE_REGISTERED:  Infinity,
  VISIBLE_SELECTION_STRATEGY: 'random',  // 'random' | 'nearest' | 'newest'
};
if (!CFG.JWT_SECRET) { console.error('FATAL: JWT_SECRET not set'); process.exit(1); }
// ============================================================

import express         from 'express';
import { MongoClient } from 'mongodb';
import jwt             from 'jsonwebtoken';

// --- DB -----------------------------------------------------
const db = (await new MongoClient(CFG.MONGO_URI).connect()).db(CFG.DB_NAME);
console.log('[location] DB connected.');

// --- Haversine (used for shouldUpdate and distanceM output) -
const EARTH_RADIUS_M = 6_371_000;
const toRad = deg => deg * Math.PI / 180;

function haversineDistance(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function shouldUpdate(prev, next) {
  if (!prev) return true;
  const timePassed = Date.now() - new Date(prev.updatedAt).getTime() >= CFG.UPDATE_INTERVAL_MS;
  const movedFar   = haversineDistance(prev.lat, prev.lon, next.lat, next.lon) >= CFG.UPDATE_DISTANCE_M;
  return timePassed || movedFar;
}

// --- Selection strategy -------------------------------------
function applyStrategy(users, maxCount, strategy) {
  if (maxCount === Infinity || users.length <= maxCount) return users;
  switch (strategy) {
    case 'nearest':
      return [...users].sort((a, b) => a._dist - b._dist).slice(0, maxCount);
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

// --- Express ------------------------------------------------
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

function verifyToken(req, res, next, requireRegistered = false) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token provided.' });
  try {
    const payload = jwt.verify(token, CFG.JWT_SECRET);
    if (requireRegistered && payload.role !== 'user')
      return res.status(403).json({ error: 'Registered account required.' });
    req.auth = payload;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Token invalid or expired.' });
  }
}

const requireAny = (req, res, next) => verifyToken(req, res, next, false);

app.get('/health', (_req, res) => res.json({ ok: true }));

// PUT /location — upsert caller's position
app.put('/location', requireAny, async (req, res) => {
  try {
    const { lat, lon, accuracy } = req.body;
    if (typeof lat !== 'number' || typeof lon !== 'number' ||
        lat < -90 || lat > 90 || lon < -180 || lon > 180)
      return res.status(400).json({ error: 'Valid lat and lon required.' });

    const id     = req.auth.sub;
    const isUser = req.auth.role === 'user';

    const existing = await db.collection('locations').findOne({ userId: id });
    if (existing && !shouldUpdate(existing, { lat, lon }))
      return res.json({ ok: true, skipped: true });

    await db.collection('locations').updateOne(
      { userId: id },
      {
        $set: {
          userId:   id,
          lat,
          lon,
          location: {
            type:        'Point',
            coordinates: [lon, lat],   // GeoJSON is [longitude, latitude]
          },
          isRegistered: isUser,
          sex:          req.auth.sex      || null,
          nickname:     req.auth.nickname || null,
          accuracy:     accuracy === 'ip' ? 'ip' : 'gps',
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

// DELETE /location — remove caller's own location doc immediately
app.delete('/location', requireAny, async (req, res) => {
  try {
    await db.collection('locations').deleteOne({ userId: req.auth.sub });
    res.json({ ok: true });
  } catch (e) {
    console.error('[location DELETE]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// GET /location/nearby?lat=&lon=
app.get('/location/nearby', requireAny, async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);
    if (isNaN(lat) || isNaN(lon))
      return res.status(400).json({ error: 'lat and lon query params required.' });

    const callerId     = req.auth.sub;
    const cutoff       = new Date(Date.now() - CFG.LOCATION_TTL_SEC * 1000);

    // Infinite radius — plain query, no geo filter needed
    const nearby = await db.collection('locations').find({
      userId:    { $ne: callerId },
      updatedAt: { $gt: cutoff },
    }).toArray();

    const withDist = nearby.map(u => ({
      ...u,
      _dist: haversineDistance(lat, lon, u.lat, u.lon),
    }));

    const visible = applyStrategy(withDist, Infinity, CFG.VISIBLE_SELECTION_STRATEGY);

    res.json({
      users: visible.map(u => ({
        userId:       u.userId,
        lat:          u.lat,
        lon:          u.lon,
        isRegistered: u.isRegistered,
        sex:          u.sex,
        nickname:     u.nickname,
        accuracy:     u.accuracy || 'gps',
        distanceM:    Math.round(u._dist),
      })),
    });
  } catch (e) {
    console.error('[location/nearby]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// GET /location/user/:userId — called internally by messages-service
app.get('/location/user/:userId', requireAny, async (req, res) => {
  try {
    const loc = await db.collection('locations').findOne({ userId: req.params.userId });
    if (!loc) return res.status(404).json({ error: 'Location not found.' });
    res.json({ lat: loc.lat, lon: loc.lon, updatedAt: loc.updatedAt });
  } catch (e) {
    console.error('[location/user/:userId]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));

app.listen(CFG.PORT, () => console.log(`[location] Running on :${CFG.PORT}`));
