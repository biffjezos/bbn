// ============================================================
// bOOmbOOm.NOW! — messages-service.js
// Send, list, delete messages.
// - All addressing by userId only, never nickname
// - Tier-aware messaging rules:
//     regular : can message online users within 100m
//     premium : can message online or offline users, no distance limit
// ============================================================

const CFG = {
  PORT:            process.env.PORT            || 8080,
  MONGO_URI:       process.env.MONGO_URI       || '',
  DB_NAME:         process.env.DB_NAME         || 'boomboom',
  JWT_SECRET:      process.env.JWT_SECRET      || 'change-me-in-production',
  LOC_SERVICE_URL: process.env.LOC_SERVICE_URL || 'http://localhost:8080',

  MESSAGE_MAX_CHARS:        144,
  MESSAGE_TTL_MS:           4 * 60 * 60 * 1000,  // 4 hours
  MESSAGE_PROXIMITY_M:      100,                  // regular tier cap
};

import express                   from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import jwt                       from 'jsonwebtoken';

const db = (await new MongoClient(CFG.MONGO_URI).connect()).db(CFG.DB_NAME);
console.log('[messages] DB connected.');

await db.collection('messages').createIndex(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, background: true }
);

// --- Express ------------------------------------------------

const app = express();
app.use(express.json({ limit: '16kb' }));

function verifyToken(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token provided.' });
  try {
    const payload = jwt.verify(token, CFG.JWT_SECRET);
    if (payload.role !== 'user')
      return res.status(403).json({ error: 'Registered account required.' });
    req.auth  = payload;
    req.token = token;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Token invalid or expired.' });
  }
}

app.get('/health', (_req, res) => res.json({ ok: true }));

// --- Location helper ----------------------------------------

async function getLocation(userId, bearerToken) {
  try {
    const response = await fetch(`${CFG.LOC_SERVICE_URL}/location/user/${userId}`, {
      headers: { Authorization: `Bearer ${bearerToken}` },
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

    let otherOid;
    try { otherOid = new ObjectId(otherId); }
    catch { return res.status(400).json({ error: 'Invalid userId.' }); }

    const other = await db.collection('users').findOne({ _id: otherOid }, { projection: { _id: 1 } });
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

// POST /messages/:userId — send message to user by userId
app.post('/messages/:userId', verifyToken, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string' || !text.trim())
      return res.status(400).json({ error: 'text required.' });
    if (text.length > CFG.MESSAGE_MAX_CHARS)
      return res.status(400).json({ error: `Message exceeds ${CFG.MESSAGE_MAX_CHARS} characters.` });

    const fromId    = req.auth.sub;
    const toId      = req.params.userId;
    const tier      = req.auth.tier ?? 'regular';
    const isPremium = tier === 'premium';

    if (fromId === toId)
      return res.status(400).json({ error: 'Cannot message yourself.' });

    let toOid;
    try { toOid = new ObjectId(toId); }
    catch { return res.status(400).json({ error: 'Invalid userId.' }); }

    const toUser = await db.collection('users').findOne({ _id: toOid }, { projection: { _id: 1 } });
    if (!toUser) return res.status(404).json({ error: 'Recipient not found.' });

    // --- Tier-aware messaging rules -------------------------
    //
    // regular : recipient must be online + within 100m  (message_online + message_radius)
    // premium : recipient can be online or offline       (message_offline)
    //           no distance limit                        (message_radius = Infinity)

    const [fromLoc, toLoc] = await Promise.all([
      getLocation(fromId, req.token),
      getLocation(toId,   req.token),
    ]);

    // Sender must always have an active location
    if (!fromLoc)
      return res.status(403).json({ error: 'Your location is required to send messages.' });

    if (!toLoc) {
      // Recipient is offline
      if (!isPremium)
        return res.status(403).json({
          error:    'That user is offline. Upgrade to premium to message offline users.',
          yourTier: tier,
          required: 'premium',
        });
      // Premium — offline messaging allowed, skip distance check
    } else {
      // Recipient is online — check distance for regular tier
      if (!isPremium) {
        const dist = haversineDistance(fromLoc.lat, fromLoc.lon, toLoc.lat, toLoc.lon);
        if (dist > CFG.MESSAGE_PROXIMITY_M)
          return res.status(403).json({
            error:     `You must be within ${CFG.MESSAGE_PROXIMITY_M}m to message this user.`,
            distanceM: Math.round(dist),
            yourTier:  tier,
          });
      }
      // Premium — Infinity radius, no distance check
    }

    // --------------------------------------------------------

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
    let msgId;
    try   { msgId = new ObjectId(req.params.id); }
    catch { return res.status(400).json({ error: 'Invalid message id.' }); }

    const result = await db.collection('messages').deleteOne({
      _id:        msgId,
      fromUserId: req.auth.sub,
    });

    if (!result.deletedCount)
      return res.status(404).json({ error: 'Message not found or not yours.' });

    res.json({ ok: true });
  } catch (e) {
    console.error('[messages DELETE]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));

app.listen(CFG.PORT, () => console.log(`[messages] Running on :${CFG.PORT}`));
