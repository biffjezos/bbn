// ============================================================
// bOOmbOOm.NOW! — favourites-service.js
// Standalone service. Add, remove, list favourite contacts.
// ============================================================

// ============================================================
// CONFIG
// ============================================================
const CFG = {
  PORT:             process.env.PORT             || 3006,
  MONGO_URI:        process.env.MONGO_URI        || '',
  DB_NAME:          process.env.DB_NAME          || 'test',
  JWT_SECRET:       process.env.JWT_SECRET       || 'change-me-in-production',
  LOCATION_TTL_SEC: 10 * 60,   // must match location-service
};
// ============================================================

import express                   from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import jwt                       from 'jsonwebtoken';

// --- DB -----------------------------------------------------
const db = (await new MongoClient(CFG.MONGO_URI).connect()).db(CFG.DB_NAME);
console.log('[favourites] DB connected.');

await db.collection('favourites').createIndex(
  { ownerUserId: 1, favouriteUserId: 1 },
  { unique: true, background: true }
);

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

// Verify Bearer token — registered users only
function verifyToken(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token provided.' });
  try {
    const payload = jwt.verify(token, CFG.JWT_SECRET);
    if (payload.role !== 'user')
      return res.status(403).json({ error: 'Registered account required.' });
    req.auth = payload;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Token invalid or expired.' });
  }
}


app.get('/health', (_req, res) => res.json({ ok: true }));

// GET /favourites — list all favourites with live nickname + online status
app.get('/favourites', verifyToken, async (req, res) => {
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

    const cutoff = new Date(Date.now() - CFG.LOCATION_TTL_SEC * 1000);
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
app.post('/favourites/:userId', verifyToken, async (req, res) => {
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
app.delete('/favourites/:userId', verifyToken, async (req, res) => {
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

app.listen(CFG.PORT, () => console.log(`[favourites] Running on :${CFG.PORT}`));