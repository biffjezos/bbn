// ============================================================
// bOOmbOOm.NOW! — users-service.js
// Handles: profile get/update/delete + favourites.
// Tier enforcement via HTTP call to tiers-service.
// ============================================================

// ============================================================
// CONFIG
// ============================================================
const CFG = {
  PORT:              process.env.PORT              || 3002,
  MONGO_URI:         process.env.MONGO_URI         || '',
  DB_NAME:           process.env.DB_NAME           || 'boomboom',
  JWT_SECRET:        process.env.JWT_SECRET        || 'change-me-in-production',
  LOCATION_TTL_SEC:  10 * 60,
  TIERS_SERVICE_URL: process.env.TIERS_SERVICE_URL || 'http://localhost:3005',
};
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

// --- Token verification -------------------------------------
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

// --- Tier enforcement via tiers-service ---------------------
function requireTier(feature) {
  return async (req, res, next) => {
    try {
      const response = await fetch(`${CFG.TIERS_SERVICE_URL}/tiers/check`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ tier: req.auth?.tier ?? 'guest', feature }),
      });
      const data = await response.json();
      if (!response.ok) return res.status(response.status).json(data);
      next();
    } catch (e) {
      console.error('[users] tiers-service unreachable', e.message);
      res.status(502).json({ error: 'Tier service unavailable.' });
    }
  };
}

app.get('/health', (_req, res) => res.json({ ok: true }));

// ============================================================
// USER PROFILE ROUTES
// ============================================================

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
    if (e.code === 11000) return res.status(409).json({ error: 'Nickname already in use.' });
    console.error('[users/me PUT]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// DELETE /users/me
app.delete('/users/me', requireUser, async (req, res) => {
  try {
    const id = req.auth.sub;
    await db.collection('users').deleteOne({ _id: new ObjectId(id) });
    await db.collection('locations').deleteOne({ userId: id });
    await db.collection('messages').deleteMany({
      $or: [{ fromUserId: id }, { toUserId: id }],
    });
    await db.collection('favourites').deleteMany({
      $or: [{ ownerUserId: id }, { favouriteUserId: id }],
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('[users/me DELETE]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// GET /users/:nickname/profile
app.get('/users/:nickname/profile', requireAny, async (req, res) => {
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

// ============================================================
// FAVOURITES ROUTES — premium tier required
// ============================================================

// GET /favourites
app.get('/favourites', requireUser, requireTier('favourites'), async (req, res) => {
  try {
    const entries = await db.collection('favourites')
      .find({ ownerUserId: req.auth.sub })
      .sort({ addedAt: -1 })
      .toArray();

    if (entries.length === 0) return res.json({ favourites: [] });

    const ids   = entries.map(e => new ObjectId(e.favouriteUserId));
    const users = await db.collection('users')
      .find({ _id: { $in: ids } })
      .project({ _id: 1, nickname: 1, sex: 1 })
      .toArray();

    const userMap = Object.fromEntries(users.map(u => [u._id.toString(), u]));

    const cutoff    = new Date(Date.now() - CFG.LOCATION_TTL_SEC * 1000);
    const locations = await db.collection('locations')
      .find({ userId: { $in: entries.map(e => e.favouriteUserId) }, updatedAt: { $gt: cutoff } })
      .project({ userId: 1 })
      .toArray();

    const onlineSet  = new Set(locations.map(l => l.userId));
    const favourites = entries
      .filter(e => userMap[e.favouriteUserId])
      .map(e => {
        const u = userMap[e.favouriteUserId];
        return {
          userId:   e.favouriteUserId,
          nickname: u.nickname,
          sex:      u.sex,
          online:   onlineSet.has(e.favouriteUserId),
          addedAt:  e.addedAt,
        };
      });

    res.json({ favourites });
  } catch (e) {
    console.error('[favourites GET]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// POST /favourites/:userId
app.post('/favourites/:userId', requireUser, requireTier('favourites'), async (req, res) => {
  try {
    const ownerUserId     = req.auth.sub;
    const favouriteUserId = req.params.userId;

    if (ownerUserId === favouriteUserId)
      return res.status(400).json({ error: 'Cannot favourite yourself.' });

    let target;
    try {
      target = await db.collection('users').findOne(
        { _id: new ObjectId(favouriteUserId) },
        { projection: { _id: 1 } }
      );
    } catch {
      return res.status(400).json({ error: 'Invalid user id.' });
    }
    if (!target) return res.status(404).json({ error: 'User not found.' });

    await db.collection('favourites').insertOne({
      ownerUserId,
      favouriteUserId,
      addedAt: new Date(),
    });

    res.status(201).json({ ok: true });
  } catch (e) {
    if (e.code === 11000)
      return res.status(409).json({ error: 'Already in favourites.' });
    console.error('[favourites POST]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// DELETE /favourites/:userId
app.delete('/favourites/:userId', requireUser, requireTier('favourites'), async (req, res) => {
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

app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));

app.listen(CFG.PORT, () => console.log(`[users] Running on :${CFG.PORT}`));
