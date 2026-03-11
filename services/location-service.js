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
  MONGO_URI:  process.env.MONGO_URI,
  DB_NAME:    process.env.DB_NAME    || 'boomboom',
  JWT_SECRET: process.env.JWT_SECRET,

  UPDATE_INTERVAL_MS:  15_000,
  UPDATE_DISTANCE_M:   100,
  LOCATION_TTL_SEC:    10 * 60,

  MAX_VISIBLE_GUESTS:      Infinity,
  MAX_VISIBLE_REGISTERED:  Infinity,
  VISIBLE_SELECTION_STRATEGY: 'random',  // 'random' | 'nearest' | 'newest'
};
const _missingCfg = ['JWT_SECRET', 'MONGO_URI'].filter(k => !CFG[k]);
if (_missingCfg.length) { console.error('FATAL: missing env vars:', _missingCfg.join(', ')); process.exit(1); }
// ============================================================

import express                        from 'express';
import { MongoClient, ObjectId }      from 'mongodb';
import jwt                            from 'jsonwebtoken';
const EARTH_RADIUS_M = 6_371_000;
function haversineDistance(lat1, lon1, lat2, lon2) {
  const toRad = deg => deg * Math.PI / 180;
  const dLat  = toRad(lat2 - lat1);
  const dLon  = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// --- DB -----------------------------------------------------
const db = (await new MongoClient(CFG.MONGO_URI).connect()).db(CFG.DB_NAME);
console.log('[location] DB connected.');

// Short-lived cache for the active-users list shared across all concurrent nearby polls.
// TTL is well under the minimum location update interval (15 s) so data stays fresh.
const NEARBY_CACHE_TTL_MS = 2_000;
let _activeUsersCache = null; // { users: Array, expiresAt: number }

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
    req.serviceAuth = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Service token invalid or expired.' });
  }
}
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  requireServiceToken(req, res, next);
});

async function verifyToken(req, res, next, requireRegistered = false) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token provided.', code: 'NO_TOKEN' });
  let payload;
  try {
    payload = jwt.verify(token, CFG.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Token invalid or expired.', code: 'TOKEN_INVALID' });
  }
  if (requireRegistered && payload.role !== 'user')
    return res.status(403).json({ error: 'Registered account required.', code: 'REGISTERED_REQUIRED' });

  // Verify tokenVersion so password changes invalidate old JWTs.
  if (payload.role === 'user') {
    try {
      const cached = _tvCache.get(payload.sub);
      let dbTv;
      if (cached && cached.exp > Date.now()) {
        dbTv = cached.tv;
      } else {
        let oid;
        try { oid = new ObjectId(payload.sub); } catch { oid = null; }
        const user = oid && await db.collection('users').findOne(
          { _id: oid },
          { projection: { tokenVersion: 1 } }
        );
        if (!user) return res.status(401).json({ error: 'Token revoked.', code: 'TOKEN_REVOKED' });
        dbTv = user.tokenVersion ?? 0;
        _tvCache.set(payload.sub, { tv: dbTv, exp: Date.now() + TV_CACHE_TTL_MS });
      }
      if (dbTv !== (payload.tv ?? 0))
        return res.status(401).json({ error: 'Token revoked.', code: 'TOKEN_REVOKED' });
    } catch {
      return res.status(500).json({ error: 'Internal error.' });
    }
  }

  req.auth = payload;
  next();
}

// tokenVersion cache — avoids a DB round-trip on every authenticated request.
// TTL trade-off: a revoked token may continue to work for up to TV_CACHE_TTL_MS
// after a password change (until the cache entry expires and the DB is re-read).
const _tvCache = new Map(); // userId -> { tv: number, exp: number }
const TV_CACHE_TTL_MS = 15_000;

const requireAny = (req, res, next) => verifyToken(req, res, next, false);

app.get('/health', async (_req, res) => {
  try {
    await db.command({ ping: 1 });
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false, error: 'DB unreachable' });
  }
});

// PUT /location — upsert caller's position
app.put('/location', requireAny, async (req, res) => {
  try {
    const { lat, lon, accuracy } = req.body;
    if (typeof lat !== 'number' || typeof lon !== 'number' ||
        lat < -90 || lat > 90 || lon < -180 || lon > 180)
      return res.status(400).json({ error: 'Valid lat and lon required.' });

    const id     = req.auth.sub;
    const isUser = req.auth.role === 'user';

    const locationDoc = {
      userId:       id,
      lat,
      lon,
      location:     { type: 'Point', coordinates: [lon, lat] }, // GeoJSON is [longitude, latitude]
      isRegistered: isUser,
      sex:          req.auth.sex      || null,
      nickname:     req.auth.nickname || null,
      age:          req.auth.age      ?? null,
      accuracy:     accuracy === 'ip' ? 'ip' : 'gps',
      updatedAt:    new Date(),
    };

    // Best-effort distance check (non-atomic, but low risk — worst case is one extra write).
    // The time gate below is enforced atomically in the query filter.
    const existing = await db.collection('locations').findOne(
      { userId: id },
      { projection: { lat: 1, lon: 1, updatedAt: 1 } }
    );

    if (existing) {
      const movedFar = haversineDistance(existing.lat, existing.lon, lat, lon) >= CFG.UPDATE_DISTANCE_M;
      if (!movedFar) {
        // Atomic time-gated update: only writes if the record is old enough.
        // If another concurrent request already refreshed updatedAt, matchedCount === 0.
        const cutoff = new Date(Date.now() - CFG.UPDATE_INTERVAL_MS);
        const result = await db.collection('locations').updateOne(
          { userId: id, updatedAt: { $lt: cutoff } },
          { $set: locationDoc }
        );
        return res.json({ ok: true, skipped: result.matchedCount === 0 });
      }
    }

    // New user (existing === null) or user moved far enough — unconditional upsert.
    await db.collection('locations').updateOne(
      { userId: id },
      { $set: locationDoc },
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

    const callerId = req.auth.sub;
    const now      = Date.now();

    if (!_activeUsersCache || _activeUsersCache.expiresAt <= now) {
      const cutoff = new Date(now - CFG.LOCATION_TTL_SEC * 1000);
      const all    = await db.collection('locations').find({ updatedAt: { $gt: cutoff } }).toArray();
      _activeUsersCache = { users: all, expiresAt: now + NEARBY_CACHE_TTL_MS };
    }
    const nearby = _activeUsersCache.users.filter(u => u.userId !== callerId);

    // Inline radius table — avoids a cross-service call on every nearby query.
    // guest=23 km, all registered tiers=unlimited (null).
    const tier    = req.auth.tier || 'guest';
    const radiusM = tier === 'guest' ? 23_000 : null;

    const withDist = nearby
      .map(u => ({ ...u, _dist: haversineDistance(lat, lon, u.lat, u.lon) }))
      .filter(u => radiusM === null || u._dist <= radiusM);

    const visible = applyStrategy(withDist, Infinity, CFG.VISIBLE_SELECTION_STRATEGY);

    res.json({
      users: visible.map(u => ({
        userId:       u.userId,
        lat:          u.lat,
        lon:          u.lon,
        isRegistered: u.isRegistered,
        sex:          u.sex,
        nickname:     u.nickname,
        age:          u.age ?? null,
        accuracy:     u.accuracy || 'gps',
        distanceM:    Math.round(u._dist),
      })),
    });
  } catch (e) {
    console.error('[location/nearby]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// POST /location/online-batch — called internally by favourites-service
// Body: { userIds: string[] }
// Returns: { online: string[] }  — subset that have an active location within TTL
app.post('/location/online-batch', (req, res, next) => {
  if (req.serviceAuth?.sub !== 'favourites')
    return res.status(403).json({ error: 'Not authorised.' });
  next();
}, async (req, res) => {
  try {
    const { userIds } = req.body;
    if (!Array.isArray(userIds)) return res.status(400).json({ error: 'userIds must be an array.' });
    const cutoff = new Date(Date.now() - CFG.LOCATION_TTL_SEC * 1000);
    const docs = await db.collection('locations')
      .find({ userId: { $in: userIds }, updatedAt: { $gt: cutoff } })
      .project({ userId: 1 })
      .toArray();
    res.json({ online: docs.map(d => d.userId) });
  } catch (e) {
    console.error('[location/online-batch]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// GET /location/user/:userId — called internally by messages-service only
app.get('/location/user/:userId', (req, res, next) => {
  if (req.serviceAuth?.sub !== 'messages')
    return res.status(403).json({ error: 'Not authorised.' });
  next();
}, requireAny, async (req, res) => {
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
