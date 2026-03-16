// ============================================================
// bOOmbOOm.NOW! — messages-service.js
// Send, list, delete messages. All registered users have equal
// access. Messages require both parties to be online and within
// MESSAGE_PROXIMITY_M metres of each other.
// All addressing is by userId — nicknames are display-only.
// ============================================================

// ============================================================
// CONFIG
// ============================================================
const CFG = {
  PORT:             process.env.PORT             || 8080,
  MONGO_URI:         process.env.MONGO_URI,
  DB_NAME:           process.env.DB_NAME          || 'boomboom',
  JWT_SECRET:        process.env.JWT_SECRET,
  LOC_SERVICE_URL:   process.env.LOC_SERVICE_URL,
  TIERS_SERVICE_URL: process.env.TIERS_SERVICE_URL,
  FAV_SERVICE_URL:   process.env.FAV_SERVICE_URL,

  MESSAGE_MAX_CHARS: 4096,  // encrypted payload is larger than plaintext
  MESSAGE_TTL_MS:    4 * 60 * 60 * 1000,   // 4 hours
};
const _missingCfg = ['JWT_SECRET', 'MONGO_URI', 'LOC_SERVICE_URL', 'TIERS_SERVICE_URL', 'FAV_SERVICE_URL'].filter(k => !CFG[k]);
if (_missingCfg.length) { console.error('FATAL: missing env vars:', _missingCfg.join(', ')); process.exit(1); }
// ============================================================

import express                   from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import jwt                       from 'jsonwebtoken';
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
console.log('[messages] DB connected.');

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
  if (!['user','admin'].includes(payload.role))
    return res.status(403).json({ error: 'Registered account required.', code: 'REGISTERED_REQUIRED' });

  // Verify tokenVersion so password changes invalidate old JWTs.
  // Compare in JS (not as a Mongo filter) so legacy docs without the field
  // (which default to 0) are not incorrectly treated as revoked.
  // Admin tokens skip this check — consistent with users-service and location-service.
  if (payload.role === 'user') try {
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

// --- Service token (cached) ----------------------------------
let _svcToken = null;
let _svcTokenExpiry = 0;

function serviceToken() {
  if (Date.now() < _svcTokenExpiry - 5_000) return _svcToken;
  _svcToken = jwt.sign({ sub: 'messages', role: 'service' }, CFG.JWT_SECRET, { expiresIn: '60s' });
  _svcTokenExpiry = Date.now() + 60_000;
  return _svcToken;
}

// --- Location helper -----------------------------------------

async function getLocation(userId) {
  try {
    const response = await fetch(`${CFG.LOC_SERVICE_URL}/location/user/${userId}`, {
      headers: { 'X-Service-Token': serviceToken() },
    });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

// --- Helpers ------------------------------------------------
function safeObjectId(str) {
  try { return new ObjectId(str); } catch { return null; }
}

// Validate that text is an E2EE ciphertext envelope.
// Format (ECDH AES-GCM — sender and recipient derive the same shared key, so
// a single ciphertext is readable by both parties):
//   { cipher: { ivB64: '<base64>', cipherB64: '<base64>' }, recipientId: '<userId>' }
// Rejects plaintext and malformed payloads before they reach the DB.
const BASE64_RE = /^[A-Za-z0-9+/]+=*$/;
function isBase64(s) { return typeof s === 'string' && s.length > 0 && BASE64_RE.test(s); }
function isValidCipherHalf(h) { return h && isBase64(h.ivB64) && isBase64(h.cipherB64); }
function isValidCiphertext(text) {
  try {
    const p = JSON.parse(text);
    return isValidCipherHalf(p.cipher);
  } catch { return false; }
}

// --- Routes -------------------------------------------------

// GET /messages — all active conversations for current user
app.get('/messages', verifyToken, async (req, res) => {
  try {
    const messages = await db.collection('messages')
      .find({
        $or: [{ fromUserId: req.auth.sub }, { toUserId: req.auth.sub }],
        expiresAt: { $gt: new Date() },
      })
      .sort({ sentAt: -1 })
      .toArray();
    res.json({ messages });
  } catch (e) {
    console.error('[messages GET]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// GET /messages/:userId — thread with one user by userId
app.get('/messages/:userId', verifyToken, async (req, res) => {
  try {
    const me      = req.auth.sub;
    const otherId = req.params.userId;

    const otherOid = safeObjectId(otherId);
    if (!otherOid) return res.status(400).json({ error: 'Invalid userId.' });

    const other = await db.collection('users').findOne(
      { _id: otherOid },
      { projection: { _id: 1 } }
    );
    if (!other) return res.status(404).json({ error: 'User not found.' });

    const messages = await db.collection('messages')
      .find({
        $or: [
          { fromUserId: me,      toUserId: otherId },
          { fromUserId: otherId, toUserId: me },
        ],
        expiresAt: { $gt: new Date() },
      })
      .sort({ sentAt: 1 })
      .toArray();

    res.json({ messages });
  } catch (e) {
    console.error('[messages/:userId GET]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// POST /messages/:userId — send message, proximity enforced
app.post('/messages/:userId', verifyToken, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string' || !text.trim())
      return res.status(400).json({ error: 'text required.' });
    if (text.length > CFG.MESSAGE_MAX_CHARS)
      return res.status(400).json({ error: `Message exceeds ${CFG.MESSAGE_MAX_CHARS} characters.` });
    if (!isValidCiphertext(text))
      return res.status(400).json({ error: 'Message must be a valid E2EE ciphertext envelope.' });

    const fromId = req.auth.sub;
    const toId   = req.params.userId;

    if (fromId === toId)
      return res.status(400).json({ error: 'Cannot message yourself.' });

    const toOid = safeObjectId(toId);
    if (!toOid) return res.status(400).json({ error: 'Invalid userId.' });

    const toUser = await db.collection('users').findOne(
      { _id: toOid },
      { projection: { _id: 1, tier: 1 } }
    );
    if (!toUser) return res.status(404).json({ error: 'Recipient not found.' });

    // --- Block check (either direction) ---
    const blockDoc = await db.collection('blocks').findOne({
      $or: [
        { blockerUserId: fromId, blockedUserId: toId },
        { blockerUserId: toId,   blockedUserId: fromId },
      ],
    });
    if (blockDoc) return res.status(403).json({ error: 'You cannot message this user.' });

    const svcAuth = { Authorization: `Bearer ${serviceToken()}`, 'X-Service-Token': serviceToken() };

    // --- Step 1: mutual favourites check + stored withinRange flag ---
    // Fail closed: refuse if favourites-service is unreachable.
    let pairStatus;
    try {
      const pairRes = await fetch(
        `${CFG.FAV_SERVICE_URL}/favourites/pair-status?sender=${encodeURIComponent(fromId)}&recipient=${encodeURIComponent(toId)}`,
        { headers: svcAuth }
      );
      if (!pairRes.ok) throw new Error(`favourites-service responded ${pairRes.status}`);
      pairStatus = await pairRes.json();
    } catch (err) {
      console.error('[messages] favourites-service unreachable:', err.message);
      return res.status(503).json({ error: 'Service unavailable. Try again shortly.' });
    }

    if (!pairStatus.mutual)
      return res.status(403).json({ error: 'Both users must have each other as favourites to message.' });

    // --- Step 2: sender must be sharing location ---
    const fromLocRes = await fetch(
      `${CFG.LOC_SERVICE_URL}/location/user/${encodeURIComponent(fromId)}`,
      { headers: svcAuth }
    );
    if (fromLocRes.status !== 200)
      return res.status(403).json({ error: 'You must be sharing your location to send messages.' });

    // --- Step 3: proximity check (bidirectional) ---
    const toLocRes = await fetch(
      `${CFG.LOC_SERVICE_URL}/location/user/${encodeURIComponent(toId)}`,
      { headers: svcAuth }
    );

    if (toLocRes.status === 200) {
      // Recipient is online — enforce bidirectional range (both must be within each other's radius).
      const senderTier    = req.auth.tier    || 'regular';
      const recipientTier = toUser.tier      || 'regular';

      let senderRadiusM, recipientRadiusM;
      try {
        const [sRes, rRes] = await Promise.all([
          fetch(`${CFG.TIERS_SERVICE_URL}/tiers/radius/message/${encodeURIComponent(senderTier)}`,    { headers: svcAuth }),
          fetch(`${CFG.TIERS_SERVICE_URL}/tiers/radius/message/${encodeURIComponent(recipientTier)}`, { headers: svcAuth }),
        ]);
        if (!sRes.ok || !rRes.ok) throw new Error('tiers-service non-ok');
        ([senderRadiusM, recipientRadiusM] = await Promise.all([sRes.json(), rRes.json()])
          .then(([s, r]) => [s.radiusM, r.radiusM]));
      } catch (err) {
        console.error('[messages] tiers-service unreachable:', err.message);
        return res.status(503).json({ error: 'Tier service unavailable. Try again shortly.' });
      }

      const [fromLoc, toLoc] = await Promise.all([fromLocRes.json(), toLocRes.json()]);
      const dist = haversineDistance(fromLoc.lat, fromLoc.lon, toLoc.lat, toLoc.lon);
      const senderOk    = senderRadiusM    === -1 || dist <= senderRadiusM;
      const recipientOk = recipientRadiusM === -1 || dist <= recipientRadiusM;
      if (!senderOk || !recipientOk)
        return res.status(403).json({ error: 'You are too far away to message this user.' });
    } else {
      // Recipient is offline — fall back to the stored withinRange flag.
      if (pairStatus.withinRange !== true)
        return res.status(403).json({ error: 'Recipient is out of range.' });
    }

    const now       = new Date();
    const expiresAt = new Date(now.getTime() + CFG.MESSAGE_TTL_MS);

    const result = await db.collection('messages').insertOne({
      fromUserId: fromId,
      toUserId:   toId,
      text:       text.trim(),
      sentAt:     now,
      expiresAt,
    });

    res.status(201).json({ _id: result.insertedId, expiresAt });
  } catch (e) {
    console.error('[messages POST]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// DELETE /messages/:id — sender deletes their own message
app.delete('/messages/:id', verifyToken, async (req, res) => {
  try {
    const msgId = safeObjectId(req.params.id);
    if (!msgId) return res.status(400).json({ error: 'Invalid message id.' });

    const msg = await db.collection('messages').findOne({ _id: msgId });
    if (!msg) return res.status(404).json({ error: 'Message not found.' });
    if (msg.fromUserId !== req.auth.sub) return res.status(403).json({ error: 'Not your message.' });

    await db.collection('messages').deleteOne({ _id: msgId });
    res.json({ ok: true });
  } catch (e) {
    console.error('[messages DELETE]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));

app.listen(CFG.PORT, () => console.log(`[messages] Running on :${CFG.PORT}`));
