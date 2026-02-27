// ============================================================
// bOOmbOOm.NOW! — users.js
// Handles: get profile, update profile, delete account.
// Opens its own MongoDB connection via MONGO_URI.
// ============================================================

// ============================================================
// CONFIG
// ============================================================
const CFG = {
  MONGO_URI: process.env.MONGO_URI || '',
  DB_NAME:   process.env.DB_NAME   || 'boomboom',
};
// ============================================================

import { Router }      from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import { requireUser, requireAnyToken } from './auth.js';

// --- DB connection ------------------------------------------
const client = new MongoClient(CFG.MONGO_URI);
await client.connect();
const db = client.db(CFG.DB_NAME);
console.log('[users] DB connected.');

// --- Routes -------------------------------------------------
export const router = Router();

// GET /api/users/me
router.get('/me', requireUser, async (req, res) => {
  try {
    const user = await db.collection('users').findOne(
      { _id: new ObjectId(req.auth.sub) },
      { projection: { passwordHash: 0 } }
    );
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json(user);
  } catch (e) {
    console.error('[users/me GET]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// PUT /api/users/me
router.put('/me', requireUser, async (req, res) => {
  try {
    const allowed = ['nickname', 'age', 'sex'];
    const update  = Object.fromEntries(
      allowed.filter(k => req.body[k] !== undefined).map(k => [k, req.body[k]])
    );
    if (!Object.keys(update).length)
      return res.status(400).json({ error: 'Nothing to update.' });

    await db.collection('users').updateOne(
      { _id: new ObjectId(req.auth.sub) },
      { $set: update }
    );
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: 'Nickname already in use.' });
    console.error('[users/me PUT]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// DELETE /api/users/me — removes account, location, all messages
router.delete('/me', requireUser, async (req, res) => {
  try {
    const id = req.auth.sub;
    await db.collection('users').deleteOne({ _id: new ObjectId(id) });
    await db.collection('locations').deleteOne({ userId: id });
    await db.collection('messages').deleteMany({
      $or: [{ fromUserId: id }, { toUserId: id }],
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('[users/me DELETE]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// GET /api/users/:nickname/profile  — public profile for map modal
router.get('/:nickname/profile', requireAnyToken, async (req, res) => {
  try {
    const user = await db.collection('users').findOne(
      { nickname: req.params.nickname },
      { projection: { nickname: 1, age: 1, sex: 1, _id: 0 } }
    );
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json(user);
  } catch (e) {
    console.error('[users/:nickname/profile]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});
