// ============================================================
// bOOmbOOm.NOW! — users-service.js
// Standalone service. Profile get, update, delete account.
// Public profile endpoint uses userId, not nickname.
// ============================================================

// ============================================================
// CONFIG
// ============================================================
const CFG = {
  PORT:       process.env.PORT       || 3002,
  MONGO_URI:  process.env.MONGO_URI  || '',
  DB_NAME:    process.env.DB_NAME    || 'boomboom',
  JWT_SECRET: process.env.JWT_SECRET,
};
if (!CFG.JWT_SECRET) { console.error('FATAL: JWT_SECRET not set'); process.exit(1); }
// ============================================================

import express                   from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import jwt                       from 'jsonwebtoken';

// --- DB -----------------------------------------------------
const db = (await new MongoClient(CFG.MONGO_URI).connect()).db(CFG.DB_NAME);
console.log('[users] DB connected.');

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

const requireUser = (req, res, next) => verifyToken(req, res, next, true);
const requireAny  = (req, res, next) => verifyToken(req, res, next, false);

app.get('/health', (_req, res) => res.json({ ok: true }));

// GET /users/me
app.get('/users/me', requireUser, async (req, res) => {
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

// PUT /users/me
app.put('/users/me', requireUser, async (req, res) => {
  try {
    if (req.body.tier !== undefined)
      return res.status(400).json({ error: 'tier cannot be modified.' });

    const update = {};

    if (req.body.nickname !== undefined) update.nickname = req.body.nickname.trim();
    if (req.body.age      !== undefined) update.age      = parseInt(req.body.age, 10);
    if (req.body.sex      !== undefined) update.sex      = req.body.sex;
    if (req.body.email    !== undefined) update.email    = req.body.email.toLowerCase().trim();
    if (req.body.password !== undefined && req.body.password.length >= 8) {
      const bcrypt = await import('bcryptjs');
      update.passwordHash = await bcrypt.default.hash(req.body.password, 12);
    }

    if (!Object.keys(update).length)
      return res.status(400).json({ error: 'Nothing to update.' });

    if (update.age && (update.age < 18 || update.age > 120))
      return res.status(400).json({ error: 'Age must be 18-120.' });
    if (update.sex && !['m', 'f'].includes(update.sex))
      return res.status(400).json({ error: "sex must be 'm' or 'f'." });

    await db.collection('users').updateOne(
      { _id: new ObjectId(req.auth.sub) },
      { $set: update }
    );

    // Keep location doc in sync so map icon updates without re-login
    const locUpdate = {};
    if (update.sex)      locUpdate.sex      = update.sex;
    if (update.nickname) locUpdate.nickname = update.nickname;
    if (Object.keys(locUpdate).length) {
      await db.collection('locations').updateOne(
        { userId: req.auth.sub },
        { $set: locUpdate }
      );
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('[users/me PUT]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// DELETE /users/me — removes account, location, all messages, all favourites
app.delete('/users/me', requireUser, async (req, res) => {
  try {
    const id = req.auth.sub;
    await Promise.all([
      db.collection('users').deleteOne({ _id: new ObjectId(id) }),
      db.collection('locations').deleteOne({ userId: id }),
      db.collection('messages').deleteMany({ $or: [{ fromUserId: id }, { toUserId: id }] }),
      db.collection('favourites').deleteMany({ $or: [{ ownerUserId: id }, { favouriteUserId: id }] }),
    ]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[users/me DELETE]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// GET /users/:userId/profile — public profile for map modal
// Uses userId (not nickname) — nickname is display-only
app.get('/users/:userId/profile', requireAny, async (req, res) => {
  try {
    let oid;
    try { oid = new ObjectId(req.params.userId); } catch {
      return res.status(400).json({ error: 'Invalid userId.' });
    }
    const user = await db.collection('users').findOne(
      { _id: oid },
      { projection: { nickname: 1, age: 1, sex: 1, publicKey: 1, _id: 0 } }
    );
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json(user);
  } catch (e) {
    console.error('[users/:userId/profile]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// PUT /users/me/keys — store public key + encrypted private key blob
app.put('/users/me/keys', requireUser, async (req, res) => {
  try {
    const { publicKey, encryptedPrivateKey } = req.body;
    if (!publicKey || !encryptedPrivateKey)
      return res.status(400).json({ error: 'publicKey and encryptedPrivateKey required.' });

    await db.collection('users').updateOne(
      { _id: new ObjectId(req.auth.sub) },
      { $set: { publicKey, encryptedPrivateKey } }
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('[users/me/keys PUT]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// GET /users/me/keys — fetch encrypted private key blob for login
app.get('/users/me/keys', requireUser, async (req, res) => {
  try {
    const user = await db.collection('users').findOne(
      { _id: new ObjectId(req.auth.sub) },
      { projection: { publicKey: 1, encryptedPrivateKey: 1, _id: 0 } }
    );
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json(user);
  } catch (e) {
    console.error('[users/me/keys GET]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));

app.listen(CFG.PORT, () => console.log(`[users] Running on :${CFG.PORT}`));
