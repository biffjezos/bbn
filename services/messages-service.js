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
import { haversineDistance }     from './lib/geo.js';

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

async function verifyToken(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token provided.' });
  let payload;
  try {
    payload = jwt.verify(token, CFG.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Token invalid or expired.' });
  }
  if (payload.role !== 'user')
    return res.status(403).json({ error: 'Registered account required.' });

  // Verify tokenVersion so password changes invalidate old JWTs.
  try {
    const oid  = safeObjectId(payload.sub);
    const user = oid && await db.collection('users').findOne(
      { _id: oid, tokenVersion: payload.tv ?? 0 },
      { projection: { _id: 1 } }
    );
    if (!user) return res.status(401).json({ error: 'Token revoked.' });
  } catch {
    return res.status(500).json({ error: 'Internal error.' });
  }

  req.auth = payload;
  next();
}

app.get('/health', (_req, res) => res.json({ ok: true }));

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
// Format (matching the client's WebCrypto AES-GCM dual-encryption output):
//   {
//     forRecipient: { ivB64: '<base64>', cipherB64: '<base64>' },
//     forSender:    { ivB64: '<base64>', cipherB64: '<base64>' }
//   }
// Rejects plaintext and malformed payloads before they reach the DB.
const BASE64_RE = /^[A-Za-z0-9+/]+=*$/;
function isBase64(s) { return typeof s === 'string' && s.length > 0 && BASE64_RE.test(s); }
function isValidCipherHalf(h) { return h && isBase64(h.ivB64) && isBase64(h.cipherB64); }
function isValidCiphertext(text) {
  try {
    const p = JSON.parse(text);
    return isValidCipherHalf(p.forRecipient) && isValidCipherHalf(p.forSender);
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
      { projection: { _id: 1 } }
    );
    if (!toUser) return res.status(404).json({ error: 'Recipient not found.' });

    // Proximity enforcement — both users must be online and within MESSAGE_PROXIMITY_M metres.
    const svcAuth = { Authorization: `Bearer ${serviceToken()}`, 'X-Service-Token': serviceToken() };
    const [fromLocRes, toLocRes] = await Promise.all([
      fetch(`${CFG.LOC_SERVICE_URL}/location/user/${encodeURIComponent(fromId)}`,  { headers: svcAuth }),
      fetch(`${CFG.LOC_SERVICE_URL}/location/user/${encodeURIComponent(toId)}`,    { headers: svcAuth }),
    ]);
    if (fromLocRes.status !== 200 || toLocRes.status !== 200)
      return res.status(403).json({ error: 'Both users must be sharing location to message.' });
    const [fromLoc, toLoc] = await Promise.all([fromLocRes.json(), toLocRes.json()]);
    if (haversineDistance(fromLoc.lat, fromLoc.lon, toLoc.lat, toLoc.lon) > CFG.MESSAGE_PROXIMITY_M)
      return res.status(403).json({ error: 'You are too far away to message this user.' });

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
