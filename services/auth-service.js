// ============================================================
// bOOmbOOm.NOW! — auth.js
// Standalone service. Handles guest tokens, register, login.
// Every other service imports verifyToken / requireAnyToken
// by making an HTTP call — but since JWT verification is
// stateless, each service does it locally with the same secret.
// ============================================================

// ============================================================
// CONFIG
// ============================================================
const CFG = {
  PORT:             process.env.PORT       || 3001,
  MONGO_URI:        process.env.MONGO_URI  || '',
  DB_NAME:          process.env.DB_NAME    || 'boomboom',
  JWT_SECRET:       process.env.JWT_SECRET || 'change-me-in-production',
  JWT_EXPIRY_USER:  '7d',
  JWT_EXPIRY_GUEST: '15m',
  GUEST_TTL_SEC:    15 * 60,
};
// ============================================================

import express       from 'express';
import { MongoClient } from 'mongodb';
import jwt           from 'jsonwebtoken';
import bcrypt        from 'bcryptjs';

// --- DB -----------------------------------------------------
const db = (await new MongoClient(CFG.MONGO_URI).connect()).db(CFG.DB_NAME);
console.log('[auth] DB connected.');

// Indexes should be created manually in MongoDB Atlas or via a one-time migration script.
// Removed from startup to avoid disk space issues on low-storage instances.

// --- JWT helpers (duplicated in each service — same secret) -
function issueUserToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), email: user.email, nickname: user.nickname, sex: user.sex, role: 'user' },
    CFG.JWT_SECRET,
    { expiresIn: CFG.JWT_EXPIRY_USER }
  );
}

function issueGuestToken(guestId) {
  return jwt.sign(
    { sub: guestId, role: 'guest' },
    CFG.JWT_SECRET,
    { expiresIn: CFG.JWT_EXPIRY_GUEST }
  );
}

// --- Helper: clean up guest location + session docs ---------
async function cleanupGuest(guestId) {
  if (!guestId || typeof guestId !== 'string') return;
  await Promise.all([
    db.collection('locations').deleteOne({ userId: guestId }),
    db.collection('sessions').deleteOne({ guestId }),
  ]);
}

// --- Express ------------------------------------------------
const app = express();
app.use(express.json({ limit: '16kb' }));

// Verify Bearer token on every request
app.use((req, res, next) => {
  if (req.path === '/auth/guest'    && req.method === 'POST') return next();
  if (req.path === '/auth/login'    && req.method === 'POST') return next();
  if (req.path === '/auth/register' && req.method === 'POST') return next();
  if (req.path === '/health') return next();

  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token provided.' });

  try {
    req.auth = jwt.verify(token, CFG.JWT_SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: 'Token invalid or expired.' });
  }
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
      createdAt: new Date(),
    });

    const user = { _id: result.insertedId, email, nickname, sex };

    // Clean up guest location + session docs
    await cleanupGuest(req.body.guestId);

    res.status(201).json({ token: issueUserToken(user), nickname, sex });
  } catch (e) {
    if (e.code === 11000) {
      const field = Object.keys(e.keyPattern || {})[0] || 'field';
      return res.status(409).json({ error: `${field} already in use.` });
    }
    console.error('[auth/register]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// POST /auth/login
app.post('/auth/login', async (req, res) => {
  try {
    const { login, password, guestId } = req.body;
    if (!login || !password)
      return res.status(400).json({ error: 'login and password required.' });

    const query = login.includes('@')
      ? { email: login.toLowerCase().trim() }
      : { nickname: login.trim() };

    const user = await db.collection('users').findOne(query);
    if (!user || !(await bcrypt.compare(password, user.passwordHash)))
      return res.status(401).json({ error: 'Invalid credentials.' });

    // Clean up guest location + session docs so the fist icon disappears immediately
    await cleanupGuest(guestId);

    res.json({ token: issueUserToken(user), nickname: user.nickname, sex: user.sex });
  } catch (e) {
    console.error('[auth/login]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));

app.listen(CFG.PORT, () => console.log(`[auth] Running on :${CFG.PORT}`));
