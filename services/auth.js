// ============================================================
// bOOmbOOm.NOW! — auth.js
// Handles: guest token, register, login.
// JWT issue/verify helpers used by other services.
// Opens its own MongoDB connection via MONGO_URI.
// ============================================================

// ============================================================
// CONFIG
// ============================================================
const CFG = {
  MONGO_URI:        process.env.MONGO_URI || '',
  DB_NAME:          process.env.DB_NAME   || 'boomboom',
  GUEST_TTL_SEC:    15 * 60,   // TTL for guest session docs
};
// ============================================================

import { Router }   from 'express';
import { MongoClient } from 'mongodb';
import jwt          from 'jsonwebtoken';
import bcrypt       from 'bcryptjs';
import { CFG as SERVER_CFG } from './server.js';

// --- DB connection ------------------------------------------
const client = new MongoClient(CFG.MONGO_URI);
await client.connect();
const db = client.db(CFG.DB_NAME);
console.log('[auth] DB connected.');

// Ensure indexes for auth-owned collections
await db.collection('users').createIndex({ email: 1 },    { unique: true, background: true });
await db.collection('users').createIndex({ nickname: 1 }, { unique: true, background: true });
await db.collection('sessions').createIndex(
  { createdAt: 1 },
  { expireAfterSeconds: CFG.GUEST_TTL_SEC, background: true }
);

// --- Helpers ------------------------------------------------

export function issueUserToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), email: user.email, nickname: user.nickname, sex: user.sex, role: 'user' },
    SERVER_CFG.JWT_SECRET,
    { expiresIn: SERVER_CFG.JWT_EXPIRY_USER }
  );
}

export function issueGuestToken(guestId) {
  return jwt.sign(
    { sub: guestId, role: 'guest' },
    SERVER_CFG.JWT_SECRET,
    { expiresIn: SERVER_CFG.JWT_EXPIRY_GUEST }
  );
}

/** Verify any token. Returns decoded payload or throws. */
export function verifyToken(token) {
  return jwt.verify(token, SERVER_CFG.JWT_SECRET);
}

/** Express middleware — accepts guest OR registered token. */
export function requireAnyToken(req, res, next) {
  const token = _extractToken(req);
  if (!token) return res.status(401).json({ error: 'No token provided.' });
  try {
    req.auth = verifyToken(token);
    next();
  } catch (e) {
    res.status(401).json({ error: 'Token invalid or expired.', detail: e.message });
  }
}

/** Express middleware — registered users only. */
export function requireUser(req, res, next) {
  const token = _extractToken(req);
  if (!token) return res.status(401).json({ error: 'No token provided.' });
  try {
    const payload = verifyToken(token);
    if (payload.role !== 'user')
      return res.status(403).json({ error: 'Registered account required.' });
    req.auth = payload;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Token invalid or expired.', detail: e.message });
  }
}

function _extractToken(req) {
  const h = req.headers['authorization'] || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

// --- Routes -------------------------------------------------
export const router = Router();

// POST /api/auth/guest
router.post('/guest', async (req, res) => {
  try {
    const { guestId } = req.body;
    if (!guestId || typeof guestId !== 'string' || guestId.length > 64)
      return res.status(400).json({ error: 'Invalid guestId.' });

    await db.collection('sessions').updateOne(
      { guestId },
      { $set: { guestId, ip: req.ip, createdAt: new Date() } },
      { upsert: true }
    );

    res.json({
      token:     issueGuestToken(guestId),
      expiresIn: SERVER_CFG.GUEST_TTL_MS,
    });
  } catch (e) {
    console.error('[auth/guest]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, nickname, password, age, sex } = req.body;

    if (!email || !nickname || !password || !age || !sex)
      return res.status(400).json({ error: 'All fields required.' });
    if (!['m', 'f', 'o'].includes(sex))
      return res.status(400).json({ error: "sex must be 'm', 'f', or 'o'." });
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

// POST /api/auth/login  (email or nickname + password)
router.post('/login', async (req, res) => {
  try {
    const { login, password } = req.body;
    if (!login || !password)
      return res.status(400).json({ error: 'login and password required.' });

    const query = login.includes('@')
      ? { email: login.toLowerCase().trim() }
      : { nickname: login.trim() };

    const user = await db.collection('users').findOne(query);
    if (!user || !(await bcrypt.compare(password, user.passwordHash)))
      return res.status(401).json({ error: 'Invalid credentials.' });

    res.json({ token: issueUserToken(user), nickname: user.nickname, sex: user.sex });
  } catch (e) {
    console.error('[auth/login]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});
