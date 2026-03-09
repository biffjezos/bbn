// ============================================================
// bOOmbOOm.NOW! — auth-service.js
// Standalone service. Handles guest tokens, register, login.
// ============================================================

// ============================================================
// CONFIG
// ============================================================
const CFG = {
  PORT:             process.env.PORT       || 8080,
  MONGO_URI:        process.env.MONGO_URI  || '',
  DB_NAME:          process.env.DB_NAME    || 'boomboom',
  JWT_SECRET:       process.env.JWT_SECRET,
  JWT_EXPIRY_USER:  '7d',
  JWT_EXPIRY_GUEST: '15m',
  GUEST_TTL_SEC:    15 * 60,
};
if (!CFG.JWT_SECRET) { console.error('FATAL: JWT_SECRET not set'); process.exit(1); }
// ============================================================

import express         from 'express';
import { MongoClient } from 'mongodb';
import jwt             from 'jsonwebtoken';
import bcrypt          from 'bcryptjs';

// --- DB -----------------------------------------------------
const db = (await new MongoClient(CFG.MONGO_URI).connect()).db(CFG.DB_NAME);
console.log('[auth] DB connected.');

// --- JWT helpers --------------------------------------------

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

function issueGuestToken(guestId) {
  return jwt.sign(
    { sub: guestId, role: 'guest', tier: 'guest' },
    CFG.JWT_SECRET,
    { expiresIn: CFG.JWT_EXPIRY_GUEST }
  );
}

// --- Helper: clean up guest session + location on login -----
async function cleanupGuest(guestId) {
  if (!guestId || typeof guestId !== 'string') return;
  await Promise.all([
    db.collection('locations').deleteOne({ userId: guestId }),
    db.collection('sessions').deleteOne({ guestId }),
  ]);
}

// --- Helper: migrate guest location to new registered user --
// Re-associates the location doc so the user stays visible on
// the map right after registration without needing a new GPS fix.
async function migrateGuestLocation(guestId, newUserId, nickname, sex) {
  if (!guestId || typeof guestId !== 'string') return;
  await Promise.all([
    db.collection('locations').updateOne(
      { userId: guestId },
      { $set: { userId: newUserId, isRegistered: true, nickname, sex } }
    ),
    db.collection('sessions').deleteOne({ guestId }),
  ]);
}

// --- Express ------------------------------------------------
const app = express();
app.use(express.json({ limit: '16kb' }));

// --- Service token guard ------------------------------------
// Rejects requests that carry neither a valid user token
// nor a valid X-Service-Token from an internal service.
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

// Apply to all routes except public auth endpoints and health
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  if (req.path === '/auth/guest'    && req.method === 'POST') return next();
  if (req.path === '/auth/login'    && req.method === 'POST') return next();
  if (req.path === '/auth/register' && req.method === 'POST') return next();
  requireServiceToken(req, res, next);
});

app.get('/health', (_req, res) => res.json({ ok: true }));

// POST /auth/guest
app.post('/auth/guest', async (req, res) => {
  try {
    const { guestId } = req.body;
    if (!guestId || typeof guestId !== 'string' || guestId.length > 64)
      return res.status(400).json({ error: 'Invalid guestId.' });

    await db.collection('sessions').updateOne(
      { guestId },
      { $set: { guestId, ip: req.ip, createdAt: new Date() } },
      { upsert: true }
    );

    res.json({ token: issueGuestToken(guestId), expiresIn: CFG.GUEST_TTL_SEC * 1000 });
  } catch (e) {
    console.error('[auth/guest]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// POST /auth/register
app.post('/auth/register', async (req, res) => {
  try {
    const { email, nickname, password, age, sex } = req.body;

    if (!email || !nickname || !password || !age || !sex)
      return res.status(400).json({ error: 'All fields required.' });
    if (typeof nickname !== 'string' || nickname.trim().length < 2 || nickname.trim().length > 32)
      return res.status(400).json({ error: 'Nickname must be 2–32 characters.' });
    if (!['m', 'f'].includes(sex))
      return res.status(400).json({ error: "sex must be 'm' or 'f'." });
    if (typeof age !== 'number' || age < 18 || age > 120)
      return res.status(400).json({ error: 'Age must be 18–120.' });
    if (password.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const hash   = await bcrypt.hash(password, 12);
    const result = await db.collection('users').insertOne({
      email:        email.toLowerCase().trim(),
      nickname:     nickname.trim(),
      passwordHash: hash,
      age,
      sex,
      tier:         'regular',
      tokenVersion: 0,
      createdAt:    new Date(),
    });

    const user = {
      _id:      result.insertedId,
      email:    email.toLowerCase().trim(),
      nickname: nickname.trim(),
      sex,
      tier:     'regular',
    };

    await migrateGuestLocation(req.body.guestId, user._id.toString(), user.nickname, user.sex);

    res.status(201).json({
      token:    issueUserToken(user),
      nickname: user.nickname,
      sex:      user.sex,
      tier:     user.tier,
    });
  } catch (e) {
    if (e.code === 11000)
      return res.status(409).json({ error: 'Email already in use.' });
    console.error('[auth/register]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// POST /auth/login — email + password only
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password, guestId } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password required.' });

    const user = await db.collection('users').findOne({
      email: email.toLowerCase().trim(),
    });
    if (!user || !(await bcrypt.compare(password, user.passwordHash)))
      return res.status(401).json({ error: 'Invalid credentials.' });

    await cleanupGuest(guestId);

    // Whitelist tier — unknown or missing values fall back to 'regular'
    const VALID_TIERS = ['regular', 'premium'];
    const tier = VALID_TIERS.includes(user.tier) ? user.tier : 'regular';

    res.json({
      token:    issueUserToken({ ...user, tier }),
      nickname: user.nickname,
      sex:      user.sex,
      tier,
    });
  } catch (e) {
    console.error('[auth/login]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));

app.listen(CFG.PORT, () => console.log(`[auth] Running on :${CFG.PORT}`));
