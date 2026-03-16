// ============================================================
// bOOmbOOm.NOW! — favourites-service.js
// Standalone service. Add, remove, list favourite contacts.
// ============================================================

// ============================================================
// CONFIG
// ============================================================
const CFG = {
  PORT:              process.env.PORT              || 3006,
  MONGO_URI:         process.env.MONGO_URI,
  DB_NAME:           process.env.DB_NAME           || 'boomboom',
  JWT_SECRET:        process.env.JWT_SECRET,
  LOC_SERVICE_URL:   process.env.LOC_SERVICE_URL,
  TIERS_SERVICE_URL: process.env.TIERS_SERVICE_URL,
};
const _missingCfg = ['JWT_SECRET', 'MONGO_URI', 'LOC_SERVICE_URL', 'TIERS_SERVICE_URL'].filter(k => !CFG[k]);
if (_missingCfg.length) { console.error('FATAL: missing env vars:', _missingCfg.join(', ')); process.exit(1); }
// ============================================================

import express                   from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import jwt                       from 'jsonwebtoken';

// --- DB -----------------------------------------------------
const db = (await new MongoClient(CFG.MONGO_URI).connect()).db(CFG.DB_NAME);
console.log('[favourites] DB connected.');

// TTL index — auto-expire notifications after 30 days
await db.collection('notifications').createIndex(
  { createdAt: 1 },
  { expireAfterSeconds: 30 * 24 * 3600 }
);
console.log('[favourites] Notifications TTL index ensured.');

// --- Service token ------------------------------------------
let _svcToken = null;
let _svcTokenExpiry = 0;
function serviceToken() {
  if (Date.now() < _svcTokenExpiry - 5_000) return _svcToken;
  _svcToken = jwt.sign({ sub: 'favourites', role: 'service' }, CFG.JWT_SECRET, { expiresIn: '60s' });
  _svcTokenExpiry = Date.now() + 60_000;
  return _svcToken;
}

// --- Geo ----------------------------------------------------
const EARTH_RADIUS_M = 6_371_000;
function haversineDistance(lat1, lon1, lat2, lon2) {
  const toRad = deg => deg * Math.PI / 180;
  const dLat  = toRad(lat2 - lat1);
  const dLon  = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// --- Radius cache (tiers are static at runtime) -------------
const _radiusCache = new Map();
async function getMessageRadius(tier) {
  if (_radiusCache.has(tier)) return _radiusCache.get(tier);
  const res = await fetch(
    `${CFG.TIERS_SERVICE_URL}/tiers/radius/message/${encodeURIComponent(tier)}`,
    { headers: { 'X-Service-Token': serviceToken() } }
  );
  if (!res.ok) throw new Error(`tiers-service ${res.status}`);
  const { radiusM } = await res.json();
  _radiusCache.set(tier, radiusM);
  return radiusM;
}

// --- Helpers ------------------------------------------------
function safeObjectId(str) {
  try { return new ObjectId(str); } catch { return null; }
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

const _tvCache = new Map(); // userId -> { tv: number, exp: number }
const TV_CACHE_TTL_MS = 15_000;

// Verify Bearer token — registered users only
async function verifyToken(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token provided.', code: 'NO_TOKEN' });
  let payload;
  try {
    payload = jwt.verify(token, CFG.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Token invalid or expired.', code: 'TOKEN_INVALID' });
  }
  if (payload.role !== 'user')
    return res.status(403).json({ error: 'Registered account required.', code: 'REGISTERED_REQUIRED' });

  // Verify tokenVersion so password changes invalidate old JWTs.
  // Compare in JS (not as a Mongo filter) so legacy docs without the field
  // (which default to 0) are not incorrectly treated as revoked.
  try {
    const cached = _tvCache.get(payload.sub);
    let dbTv;
    if (cached && cached.exp > Date.now()) {
      dbTv = cached.tv;
    } else {
      const oid  = safeObjectId(payload.sub);
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

  req.auth = payload;
  next();
}


app.get('/health', async (_req, res) => {
  try {
    await db.command({ ping: 1 });
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false, error: 'DB unreachable' });
  }
});

// GET /favourites — list all favourites with live nickname + online status
app.get('/favourites', verifyToken, async (req, res) => {
  try {
    const entries = await db.collection('favourites')
      .find({ ownerUserId: req.auth.sub })
      .sort({ addedAt: -1 })
      .toArray();

    if (entries.length === 0) return res.json({ favourites: [] });

    const ids = entries.map(e => safeObjectId(e.favouriteUserId)).filter(Boolean);

    const users = await db.collection('users')
      .find({ _id: { $in: ids } })
      .project({ _id: 1, nickname: 1, sex: 1 })
      .toArray();

    const userMap = Object.fromEntries(users.map(u => [u._id.toString(), u]));

    const onlineBatch = await fetch(`${CFG.LOC_SERVICE_URL}/location/online-batch`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-Service-Token': serviceToken() },
      body:    JSON.stringify({ userIds: entries.map(e => e.favouriteUserId) }),
    });
    const { online = [] } = await onlineBatch.json();
    const onlineSet = new Set(online);

    const favourites = entries
      .filter(e => userMap[e.favouriteUserId])
      .map(e => {
        const u = userMap[e.favouriteUserId];
        return {
          userId:        e.favouriteUserId,
          nickname:      u.nickname,
          sex:           u.sex,
          online:        onlineSet.has(e.favouriteUserId),
          addedAt:       e.addedAt,
          withinRange:   e.withinRange    ?? null,
          withinRangeAt: e.withinRangeAt  ?? null,
        };
      });

    res.json({ favourites });
  } catch (e) {
    console.error('[favourites GET]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// POST /favourites/:userId — add a favourite
app.post('/favourites/:userId', verifyToken, async (req, res) => {
  try {
    const ownerUserId     = req.auth.sub;
    const favouriteUserId = req.params.userId;

    if (ownerUserId === favouriteUserId)
      return res.status(400).json({ error: 'Cannot favourite yourself.' });

    const oid = safeObjectId(favouriteUserId);
    if (!oid) return res.status(400).json({ error: 'Invalid user id.' });

    const target = await db.collection('users').findOne({ _id: oid }, { projection: { _id: 1 } });
    if (!target) return res.status(404).json({ error: 'User not found.' });

    await db.collection('favourites').insertOne({
      ownerUserId,
      favouriteUserId,
      addedAt: new Date(),
    });

    // Notify the favourited user (non-fatal — upsert so remove+re-add doesn't stack)
    try {
      const ownerDoc = await db.collection('users').findOne(
        { _id: safeObjectId(ownerUserId) },
        { projection: { nickname: 1, sex: 1 } }
      );
      if (ownerDoc) {
        await db.collection('notifications').replaceOne(
          { recipientUserId: favouriteUserId, fromUserId: ownerUserId, type: 'new_favourite' },
          {
            recipientUserId: favouriteUserId,
            fromUserId:      ownerUserId,
            fromNickname:    ownerDoc.nickname,
            fromSex:         ownerDoc.sex,
            type:            'new_favourite',
            createdAt:       new Date(),
          },
          { upsert: true }
        );
      }
    } catch (notifErr) {
      console.error('[notifications] insert failed:', notifErr.message);
    }

    res.status(201).json({ ok: true });
  } catch (e) {
    if (e.code === 11000)
      return res.status(409).json({ error: 'Already in favourites.' });
    console.error('[favourites POST]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// GET /favourites/is-mutual/:userId — user-facing: is this a mutual favourite?
// Used by the frontend map modal to decide whether to show the Message button.
app.get('/favourites/is-mutual/:userId', verifyToken, async (req, res) => {
  try {
    const me     = req.auth.sub;
    const userId = req.params.userId;

    if (me === userId)
      return res.json({ mutual: false });

    const [myDoc, theirDoc] = await Promise.all([
      db.collection('favourites').findOne({ ownerUserId: me,     favouriteUserId: userId }),
      db.collection('favourites').findOne({ ownerUserId: userId, favouriteUserId: me }),
    ]);

    res.json({ mutual: !!(myDoc && theirDoc) });
  } catch (e) {
    console.error('[favourites/is-mutual]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// GET /favourites/pair-status — internal (service-token only): mutual flag + withinRange flag.
// Called by messages-service before allowing a message to be sent.
app.get('/favourites/pair-status', async (req, res) => {
  try {
    const { sender, recipient } = req.query;
    if (!sender || !recipient)
      return res.status(400).json({ error: 'sender and recipient query params required.' });

    const [senderDoc, recipDoc] = await Promise.all([
      db.collection('favourites').findOne({ ownerUserId: sender,    favouriteUserId: recipient }),
      db.collection('favourites').findOne({ ownerUserId: recipient, favouriteUserId: sender }),
    ]);

    res.json({
      mutual:      !!(senderDoc && recipDoc),
      withinRange: senderDoc?.withinRange ?? null,
    });
  } catch (e) {
    console.error('[favourites/pair-status]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// POST /favourites/internal/range-sync — internal (service-token only).
// Called by location-service on every location write to keep withinRange flags fresh.
// Body: { userId, lat, lon }
app.post('/favourites/internal/range-sync', async (req, res) => {
  try {
    const { userId, lat, lon } = req.body;
    if (!userId || typeof lat !== 'number' || typeof lon !== 'number')
      return res.status(400).json({ error: 'userId, lat, lon required.' });

    // Only registered users have favourites
    const userOid = safeObjectId(userId);
    if (!userOid) return res.json({ ok: true, updated: 0 });

    const docs = await db.collection('favourites')
      .find({ $or: [{ ownerUserId: userId }, { favouriteUserId: userId }] })
      .toArray();

    if (docs.length === 0) return res.json({ ok: true, updated: 0 });

    // Unique other-party user IDs
    const otherIds = [...new Set(
      docs.map(d => d.ownerUserId === userId ? d.favouriteUserId : d.ownerUserId)
    )];

    // Fetch active locations for the other users (direct DB — same instance)
    const LOCATION_TTL_SEC = 10 * 60;
    const cutoff = new Date(Date.now() - LOCATION_TTL_SEC * 1000);
    const otherLocs = await db.collection('locations')
      .find({ userId: { $in: otherIds }, updatedAt: { $gt: cutoff } })
      .project({ userId: 1, lat: 1, lon: 1 })
      .toArray();

    if (otherLocs.length === 0) return res.json({ ok: true, updated: 0 });

    // Fetch userId's tier
    const userDoc = await db.collection('users').findOne(
      { _id: userOid }, { projection: { tier: 1 } }
    );
    const userTier = userDoc?.tier || 'regular';

    // Fetch other users' tiers in one query
    const otherOids = otherLocs.map(l => safeObjectId(l.userId)).filter(Boolean);
    const otherUsers = await db.collection('users')
      .find({ _id: { $in: otherOids } })
      .project({ _id: 1, tier: 1 })
      .toArray();
    const tierMap = Object.fromEntries(otherUsers.map(u => [u._id.toString(), u.tier || 'regular']));

    let updated = 0;
    for (const otherLoc of otherLocs) {
      const otherId   = otherLoc.userId;
      const otherTier = tierMap[otherId] || 'regular';

      let radiusA, radiusB;
      try {
        [radiusA, radiusB] = await Promise.all([
          getMessageRadius(userTier),
          getMessageRadius(otherTier),
        ]);
      } catch {
        continue; // skip pair if tiers-service is unreachable
      }

      const dist = haversineDistance(lat, lon, otherLoc.lat, otherLoc.lon);
      const withinRange = (radiusA === -1 || dist <= radiusA) &&
                          (radiusB === -1 || dist <= radiusB);
      const rangeFields = { withinRange, ...(withinRange ? { withinRangeAt: new Date() } : {}) };

      await Promise.all([
        db.collection('favourites').updateOne(
          { ownerUserId: userId,   favouriteUserId: otherId },
          { $set: rangeFields }
        ),
        db.collection('favourites').updateOne(
          { ownerUserId: otherId, favouriteUserId: userId },
          { $set: rangeFields }
        ),
      ]);
      updated++;
    }

    res.json({ ok: true, updated });
  } catch (e) {
    console.error('[favourites/range-sync]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// DELETE /favourites/:userId — remove a favourite
app.delete('/favourites/:userId', verifyToken, async (req, res) => {
  try {
    const result = await db.collection('favourites').deleteOne({
      ownerUserId:     req.auth.sub,
      favouriteUserId: req.params.userId,
    });

    if (!result.deletedCount)
      return res.status(404).json({ error: 'Favourite not found.' });

    res.json({ ok: true });
  } catch (e) {
    console.error('[favourites DELETE]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// GET /notifications — unseen notifications for the authenticated user
app.get('/notifications', verifyToken, async (req, res) => {
  try {
    const items = await db.collection('notifications')
      .find({ recipientUserId: req.auth.sub })
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray();
    res.json({
      notifications: items.map(n => ({
        id:           n._id.toString(),
        fromUserId:   n.fromUserId,
        fromNickname: n.fromNickname,
        fromSex:      n.fromSex,
        type:         n.type,
        createdAt:    n.createdAt,
      })),
    });
  } catch (e) {
    console.error('[notifications GET]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// DELETE /notifications/:id — dismiss a notification
app.delete('/notifications/:id', verifyToken, async (req, res) => {
  try {
    const oid = safeObjectId(req.params.id);
    if (!oid) return res.status(400).json({ error: 'Invalid notification id.' });
    const result = await db.collection('notifications').deleteOne({
      _id:             oid,
      recipientUserId: req.auth.sub,
    });
    if (!result.deletedCount) return res.status(404).json({ error: 'Notification not found.' });
    res.json({ ok: true });
  } catch (e) {
    console.error('[notifications DELETE]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));

app.listen(CFG.PORT, () => console.log(`[favourites] Running on :${CFG.PORT}`));