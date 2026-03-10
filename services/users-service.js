// ============================================================
// bOOmbOOm.NOW! — users-service.js
// Standalone service. Profile get, update, delete account.
// Public profile endpoint uses userId, not nickname.
// ============================================================

// ============================================================
// CONFIG
// ============================================================
const CFG = {
  PORT:            process.env.PORT       || 3002,
  MONGO_URI:       process.env.MONGO_URI  || '',
  DB_NAME:         process.env.DB_NAME    || 'boomboom',
  JWT_SECRET:      process.env.JWT_SECRET,
  JWT_EXPIRY_USER: '7d',
};
if (!CFG.JWT_SECRET) { console.error('FATAL: JWT_SECRET not set'); process.exit(1); }
// ============================================================

import express                   from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import jwt                       from 'jsonwebtoken';
import bcrypt                    from 'bcryptjs';

// --- DB -----------------------------------------------------
const db = (await new MongoClient(CFG.MONGO_URI).connect()).db(CFG.DB_NAME);
console.log('[users] DB connected.');

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

function issueUserToken(user) {
  return jwt.sign(
    {
      sub:      user._id.toString(),
      email:    user.email,
      nickname: user.nickname,
      sex:      user.sex,
      age:      user.age      ?? null,
      role:     'user',
      tier:     user.tier || 'regular',
      tv:       user.tokenVersion ?? 0,
    },
    CFG.JWT_SECRET,
    { expiresIn: CFG.JWT_EXPIRY_USER }
  );
}

const _tvCache = new Map(); // userId -> { tv: number, exp: number }
const TV_CACHE_TTL_MS = 15_000;

async function verifyToken(req, res, next, requireRegistered = false) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token provided.', code: 'NO_TOKEN' });
  let payload;
  try {
    payload = jwt.verify(token, CFG.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Token invalid or expired.', code: 'TOKEN_INVALID' });
  }
  if (requireRegistered && payload.role !== 'user')
    return res.status(403).json({ error: 'Registered account required.', code: 'REGISTERED_REQUIRED' });

  // Verify tokenVersion so password changes invalidate old JWTs.
  // Tokens issued before this field existed have tv=undefined; treat as 0.
  if (payload.role === 'user') {
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
  }

  req.auth = payload;
  next();
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

    if (req.body.nickname !== undefined) {
      const nick = req.body.nickname.trim();
      if (nick.length < 2 || nick.length > 32)
        return res.status(400).json({ error: 'Nickname must be 2–32 characters.' });
      update.nickname = nick;
    }
    if (req.body.age      !== undefined) update.age      = parseInt(req.body.age, 10);
    if (req.body.sex      !== undefined) update.sex      = req.body.sex;
    if (req.body.email    !== undefined) update.email    = req.body.email.toLowerCase().trim();
    const changingPassword = req.body.password !== undefined && req.body.password.length >= 8;
    if (changingPassword) {
      if (!req.body.currentPassword)
        return res.status(400).json({ error: 'currentPassword is required to change your password.' });
      const existing = await db.collection('users').findOne(
        { _id: new ObjectId(req.auth.sub) },
        { projection: { passwordHash: 1 } }
      );
      if (!existing || !(await bcrypt.compare(req.body.currentPassword, existing.passwordHash)))
        return res.status(403).json({ error: 'Current password is incorrect.' });
      update.passwordHash = await bcrypt.hash(req.body.password, 12);
    }

    if (!Object.keys(update).length)
      return res.status(400).json({ error: 'Nothing to update.' });

    if (update.age !== undefined && (!Number.isInteger(update.age) || update.age < 18 || update.age > 120))
      return res.status(400).json({ error: 'Age must be 18-120.' });
    if (update.sex && !['m', 'f'].includes(update.sex))
      return res.status(400).json({ error: "sex must be 'm' or 'f'." });

    const mongoUpdate = { $set: update };
    // Increment tokenVersion on password change so all existing JWTs are invalidated.
    if (changingPassword) {
      mongoUpdate.$inc = { tokenVersion: 1 };
      _tvCache.delete(req.auth.sub); // evict so next request re-reads the new version
    }

    await db.collection('users').updateOne(
      { _id: new ObjectId(req.auth.sub) },
      mongoUpdate
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

    // Return a fresh JWT after password change so the client can keep working.
    if (changingPassword) {
      const updatedUser = await db.collection('users').findOne(
        { _id: new ObjectId(req.auth.sub) },
        { projection: { passwordHash: 0 } }
      );
      return res.json({ ok: true, token: issueUserToken(updatedUser) });
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

// GET /users/search — global user search (registered users only)
// Query params: nickname, ageMin, ageMax, sex, online (yes|no)
app.get('/users/search', requireUser, async (req, res) => {
  try {
    const { nickname, ageMin, ageMax, sex, online } = req.query;

    const filter = {};
    if (nickname) {
      // Substring (contains) match — escape special regex chars
      const esc = nickname.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&');
      filter.nickname = { $regex: esc, $options: 'i' };
    }
    if (sex && ['m', 'f'].includes(sex)) filter.sex = sex;
    if (ageMin || ageMax) {
      filter.age = {};
      if (ageMin) filter.age.$gte = parseInt(ageMin, 10);
      if (ageMax) filter.age.$lte = parseInt(ageMax, 10);
    }

    const users = await db.collection('users').find(filter, {
      projection: { nickname: 1, age: 1, sex: 1 },
      limit: 50,
    }).toArray();

    if (users.length === 0) return res.json({ users: [] });

    // Determine online status: location updated within 10 min
    const userIds = users.map(u => u._id.toString());
    const cutoff  = new Date(Date.now() - 10 * 60 * 1000);
    const onlineDocs = await db.collection('locations').find(
      { userId: { $in: userIds }, updatedAt: { $gt: cutoff } },
      { projection: { userId: 1 } }
    ).toArray();
    const onlineSet = new Set(onlineDocs.map(l => l.userId));

    let results = users.map(u => ({
      userId:   u._id.toString(),
      nickname: u.nickname,
      age:      u.age  ?? null,
      sex:      u.sex  ?? null,
      online:   onlineSet.has(u._id.toString()),
    }));

    if (online === 'yes') results = results.filter(u => u.online);
    if (online === 'no')  results = results.filter(u => !u.online);

    res.json({ users: results });
  } catch (e) {
    console.error('[users/search]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// GET /users/:userId/profile — public profile for map modal
// Uses userId (not nickname) — nickname is display-only
app.get('/users/:userId/profile', requireAny, async (req, res) => {
  try {
    const oid = safeObjectId(req.params.userId);
    if (!oid) return res.status(400).json({ error: 'Invalid userId.' });
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
