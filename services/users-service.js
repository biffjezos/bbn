// ============================================================
// bOOmbOOm.NOW! — users-service.js
// Handles user profile and favourites.
// ============================================================

// ============================================================
// CONFIG
// ============================================================
const CFG = {
  PORT:             process.env.PORT       || 3002,
  MONGO_URI:        process.env.MONGO_URI  || '',
  DB_NAME:          process.env.DB_NAME    || 'boomboom',
  JWT_SECRET:       process.env.JWT_SECRET || 'change-me-in-production',
  LOCATION_TTL_SEC: 10 * 60,   // must match location-service
};
// ============================================================

import express                   from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import jwt                       from 'jsonwebtoken';

// --- DB -----------------------------------------------------
const db = (await new MongoClient(CFG.MONGO_URI).connect()).db(CFG.DB_NAME);
console.log('[users] DB connected.');

// Unique index — one favourite entry per owner+target pair
await db.collection('favourites').createIndex(
  { ownerUserId: 1, favouriteUserId: 1 },
  { unique: true, background: true }
);

// --- Express ------------------------------------------------
const app = express();
app.use(express.json({ limit: '16kb' }));

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

// ============================================================
// Users
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
    if (update.sex && !['m', 'f', 'o'].includes(update.sex))
      return res.status(400).json({ error: "sex must be 'm', 'f', or 'o'." });

    await db.collection('users').updateOne(
      { _id: new ObjectId(req.auth.sub) },
      { $set: update }
    );

    // Keep location doc in sync
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

// DELETE /users/me — removes account, location, messages, and favourites
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
app.get('/users/:userId/profile', requireAny, async (req, res) => {
  try {
    let oid;
    try   { oid = new ObjectId(req.params.userId); }
    catch { return res.status(400).json({ error: 'Invalid user id.' }); }

    const user = await db.collection('users').findOne(
      { _id: oid },
      { projection: { nickname: 1, age: 1, sex: 1, _id: 0 } }
    );
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json(user);
  } catch (e) {
    console.error('[users/:userId/profile]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// ============================================================
// Favourites
// ============================================================

// GET /favourites — list all favourites with live nickname + online status
app.get('/favourites', requireUser, async (req, res) => {
  try {
    const entries = await db.collection('favourites')
      .find({ ownerUserId: req.auth.sub })
      .sort({ addedAt: -1 })
      .toArray();

    if (entries.length === 0) return res.json({ favourites: [] });

    const ids = entries.map(e => new ObjectId(e.favouriteUserId));

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

    const onlineSet = new Set(locations.map(l => l.userId));

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

// POST /favourites/:userId — add a favourite
app.post('/favourites/:userId', requireUser, async (req, res) => {
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

// DELETE /favourites/:userId — remove a favourite
app.delete('/favourites/:userId', requireUser, async (req, res) => {
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
