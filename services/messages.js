// ============================================================
// bOOmbOOm.NOW! — messages.js
// Handles: list conversations, get thread, send, delete message.
// Proximity is enforced at send time via Haversine (from location.js).
// Opens its own MongoDB connection via MONGO_URI.
// ============================================================

// ============================================================
// CONFIG
// ============================================================
const CFG = {
  MONGO_URI: process.env.MONGO_URI || '',
  DB_NAME:   process.env.DB_NAME   || 'boomboom',

  MESSAGE_MAX_CHARS:   144,
  MESSAGE_TTL_MS:      4 * 60 * 60 * 1000,   // 4 h hard expiry per message
  MESSAGE_PROXIMITY_M: 100,                   // both users must be within this range to send
};
// ============================================================

import { Router }      from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import { requireUser } from './auth.js';
import { haversineDistance } from './location.js';

// --- DB connection ------------------------------------------
const client = new MongoClient(CFG.MONGO_URI);
await client.connect();
const db = client.db(CFG.DB_NAME);
console.log('[messages] DB connected.');

// TTL index: MongoDB deletes each message doc when now >= doc.expiresAt
await db.collection('messages').createIndex(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, background: true }
);

// --- Routes -------------------------------------------------
export const router = Router();

// GET /api/messages  — all active messages for the logged-in user
router.get('/', requireUser, async (req, res) => {
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

// GET /api/messages/:nickname  — thread with one specific user
router.get('/:nickname', requireUser, async (req, res) => {
  try {
    const other = await db.collection('users').findOne({ nickname: req.params.nickname });
    if (!other) return res.status(404).json({ error: 'User not found.' });

    const me      = req.auth.sub;
    const otherId = other._id.toString();

    const messages = await db.collection('messages')
      .find({
        $or: [
          { fromUserId: me,      toUserId: otherId },
          { fromUserId: otherId, toUserId: me      },
        ],
        expiresAt: { $gt: new Date() },
      })
      .sort({ sentAt: 1 })
      .toArray();

    res.json({ messages });
  } catch (e) {
    console.error('[messages/:nickname GET]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// POST /api/messages/:nickname  — send a message (proximity enforced)
router.post('/:nickname', requireUser, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string' || !text.trim())
      return res.status(400).json({ error: 'text required.' });
    if (text.length > CFG.MESSAGE_MAX_CHARS)
      return res.status(400).json({ error: `Message exceeds ${CFG.MESSAGE_MAX_CHARS} characters.` });

    const fromId = req.auth.sub;
    const toUser = await db.collection('users').findOne({ nickname: req.params.nickname });
    if (!toUser) return res.status(404).json({ error: 'Recipient not found.' });

    const toId = toUser._id.toString();
    if (fromId === toId)
      return res.status(400).json({ error: 'Cannot message yourself.' });

    // Both parties must have a fresh location within MESSAGE_PROXIMITY_M
    const [fromLoc, toLoc] = await Promise.all([
      db.collection('locations').findOne({ userId: fromId }),
      db.collection('locations').findOne({ userId: toId }),
    ]);

    if (!fromLoc || !toLoc)
      return res.status(403).json({ error: 'Location required for both parties to message.' });

    const dist = haversineDistance(fromLoc.lat, fromLoc.lon, toLoc.lat, toLoc.lon);
    if (dist > CFG.MESSAGE_PROXIMITY_M)
      return res.status(403).json({
        error: `Both users must be within ${CFG.MESSAGE_PROXIMITY_M}m to message.`,
        distanceM: Math.round(dist),
      });

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

// DELETE /api/messages/:id  — sender can delete their own message
router.delete('/:id', requireUser, async (req, res) => {
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
