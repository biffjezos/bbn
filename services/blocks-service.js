// ============================================================
// bOOmbOOm.NOW! — blocks-service.js
// Block / unblock users. Stores the blocks collection.
// ============================================================

// ============================================================
// CONFIG
// ============================================================
const CFG = {
  PORT:       process.env.PORT       || 3007,
  MONGO_URI:  process.env.MONGO_URI,
  DB_NAME:    process.env.DB_NAME    || 'boomboom',
  JWT_SECRET: process.env.JWT_SECRET,
};
const _missingCfg = ['JWT_SECRET', 'MONGO_URI'].filter(k => !CFG[k]);
if (_missingCfg.length) { console.error('FATAL: missing env vars:', _missingCfg.join(', ')); process.exit(1); }
// ============================================================

import express                   from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import jwt                       from 'jsonwebtoken';

// --- DB -----------------------------------------------------
const db = (await new MongoClient(CFG.MONGO_URI).connect()).db(CFG.DB_NAME);
console.log('[blocks] DB connected.');

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

// --- User token verification --------------------------------
const _tvCache = new Map(); // userId -> { tv: number, exp: number }
const TV_CACHE_TTL_MS = 15_000;

async function verifyToken(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token provided.', code: 'NO_TOKEN' });
  let payload;
  try {
    payload = jwt.verify(token, CFG.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Token invalid or expired.', code: 'TOKEN_INVALID' });
  }
  if (!['user','admin'].includes(payload.role))
    return res.status(403).json({ error: 'Registered account required.', code: 'REGISTERED_REQUIRED' });

  // Admin tokens skip tokenVersion check — consistent with users-service and location-service.
  if (payload.role === 'user') try {
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

  req.auth = payload;
  next();
}

const VALID_REASONS = ['spam', 'harassment', 'inappropriate_content', 'fake_profile', 'other'];

app.get('/health', async (_req, res) => {
  try {
    await db.command({ ping: 1 });
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false, error: 'DB unreachable' });
  }
});

// GET /blocks — list users the authenticated user has blocked
app.get('/blocks', verifyToken, async (req, res) => {
  try {
    const entries = await db.collection('blocks')
      .find({ blockerUserId: req.auth.sub })
      .sort({ createdAt: -1 })
      .toArray();

    if (entries.length === 0) return res.json({ blocks: [] });

    const ids   = entries.map(e => safeObjectId(e.blockedUserId)).filter(Boolean);
    const users = await db.collection('users')
      .find({ _id: { $in: ids } })
      .project({ _id: 1, nickname: 1, sex: 1 })
      .toArray();
    const userMap = Object.fromEntries(users.map(u => [u._id.toString(), u]));

    res.json({
      blocks: entries.map(e => ({
        userId:    e.blockedUserId,
        nickname:  userMap[e.blockedUserId]?.nickname || e.blockedUserId,
        sex:       userMap[e.blockedUserId]?.sex      || null,
        reason:    e.reason,
        createdAt: e.createdAt,
      })),
    });
  } catch (e) {
    console.error('[blocks GET]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// POST /blocks/:userId — block a user
app.post('/blocks/:userId', verifyToken, async (req, res) => {
  try {
    const blockerId = req.auth.sub;
    const blockedId = req.params.userId;

    if (blockerId === blockedId)
      return res.status(400).json({ error: 'Cannot block yourself.' });

    const { reason } = req.body;
    if (!reason || !VALID_REASONS.includes(reason))
      return res.status(400).json({ error: `reason must be one of: ${VALID_REASONS.join(', ')}.` });

    const oid = safeObjectId(blockedId);
    if (!oid) return res.status(400).json({ error: 'Invalid user id.' });

    const target = await db.collection('users').findOne({ _id: oid }, { projection: { _id: 1 } });
    if (!target) return res.status(404).json({ error: 'User not found.' });

    await db.collection('blocks').insertOne({
      blockerUserId: blockerId,
      blockedUserId: blockedId,
      reason,
      createdAt: new Date(),
    });

    res.status(201).json({ ok: true });
  } catch (e) {
    if (e.code === 11000)
      return res.status(409).json({ error: 'User is already blocked.' });
    console.error('[blocks POST]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

// DELETE /blocks/:userId — unblock a user
app.delete('/blocks/:userId', verifyToken, async (req, res) => {
  try {
    const result = await db.collection('blocks').deleteOne({
      blockerUserId: req.auth.sub,
      blockedUserId: req.params.userId,
    });
    if (!result.deletedCount)
      return res.status(404).json({ error: 'Block not found.' });
    res.json({ ok: true });
  } catch (e) {
    console.error('[blocks DELETE]', e);
    res.status(500).json({ error: 'Internal error.' });
  }
});

app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));

app.listen(CFG.PORT, () => console.log(`[blocks] Running on :${CFG.PORT}`));
