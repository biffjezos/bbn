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
  PORT:            process.env.PORT            || 8080,
  MONGO_URI:       process.env.MONGO_URI       || '',
  DB_NAME:         process.env.DB_NAME         || 'boomboom',
  JWT_SECRET:      process.env.JWT_SECRET,
  LOC_SERVICE_URL: process.env.LOC_SERVICE_URL || 'http://loc',

  MESSAGE_MAX_CHARS:   4096,  // encrypted payload is larger than plaintext
  MESSAGE_TTL_MS:      4 * 60 * 60 * 1000,   // 4 hours
  MESSAGE_PROXIMITY_M: 100,
};
if (!CFG.JWT_SECRET) { console.error('FATAL: JWT_SECRET not set'); process.exit(1); }
// ============================================================

import express                   from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import jwt                       from 'jsonwebtoken';

// --- DB -----------------------------------------------------
const db = (await new MongoClient(CFG.MONGO_URI).connect()).db(CFG.DB_NAME);
console.log('[messages] DB connected.');

await db.collection('messages').createIndex(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, background: true }
);

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

function verifyToken(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token provided.' });
  try {
    const payload = jwt.verify(token, CFG.JWT_SECRET);
    if (payload.role !== 'user')
      return res.status(403).json({ error: 'Registered account required.' });
    req.auth  = payload;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Token invalid or expired.' });
  }
}

app.get('/health', (_req, res) => res.json({ ok: true }));

// --- Location helper ----------------------------------------
// --- Service token ------------------------------------------
function serviceToken() {
  return jwt.sign(
    { sub: 'messages', role: 'service' },
    CFG.JWT_SECRET,
    { expiresIn: '60s' }
  );
}

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

// --- Haversine ----------------------------------------------
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

// --- Helpers ------------------------------------------------
function safeObjectId(str) {
  try { return new ObjectId(str); } catch { return null; }
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

    const fromId = req.auth.sub;
    const toId   = req.params.userId;

    if (fromId === toId)
      return res.status(400).json({ error: 'Cannot message yourself.' });

    const toOid = safeObjectId(toId);
    if (!toOid) return res.status(400).json({ error: 'Invalid userId.' });

    const toUser = await db.collection('users').findOne(
      { _id: toOid },
      { projection: { _id: 1 } }
    );
    if (!toUser) return res.status(404).json({ error: 'Recipient not found.' });

    // Proximity enforcement disabled — all users can message regardless of distance

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
