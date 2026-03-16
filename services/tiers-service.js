// ============================================================
// bOOmbOOm.NOW! — tiers-service.js
// Single source of truth for all feature/tier rules.
// Tier display info and radii are stored in the `tiers` MongoDB
// collection (seeded by migration 004_tiers_seed). Static fallback
// is used if the collection is empty (e.g. migration pending).
//
// TO ADD A NEW FEATURE:
//   1. Add an entry to FEATURES below with a minTier
//   2. Add the route in server.js with the feature key
//   That's it. The gateway enforces it automatically.
// ============================================================

const CFG = {
  PORT:       process.env.PORT       || 8080,
  JWT_SECRET: process.env.JWT_SECRET,
  MONGO_URI:  process.env.MONGO_URI,
  DB_NAME:    process.env.DB_NAME    || 'boomboom',
};
const _missingCfg = ['JWT_SECRET', 'MONGO_URI'].filter(k => !CFG[k]);
if (_missingCfg.length) { console.error('FATAL: missing env vars:', _missingCfg.join(', ')); process.exit(1); }

import express        from 'express';
import { MongoClient } from 'mongodb';
import jwt            from 'jsonwebtoken';

const db = (await new MongoClient(CFG.MONGO_URI).connect()).db(CFG.DB_NAME);
console.log('[tiers] DB connected.');

// ============================================================
// TIER RANKS — higher number = more access
// Includes developer (code-only until admin UI is ready — T-01)
// ============================================================
const TIERS = {
  guest:     0,
  regular:   1,
  premium:   2,
  developer: 3,
};

// ============================================================
// STATIC FALLBACK — used when tiers collection is empty
// (e.g. migration 004_tiers_seed not yet applied)
// ============================================================
const STATIC_TIERS = {
  guest:   { name: 'guest',   label: 'Guest',   cls: 'secondary', rank: 0, nearbyRadiusM: 500,    messageRadiusM: null   },
  regular: { name: 'regular', label: 'Regular', cls: 'primary',   rank: 1, nearbyRadiusM: 1_000,  messageRadiusM: 100    },
  premium: { name: 'premium', label: 'Premium', cls: 'warning',   rank: 2, nearbyRadiusM: 23_000, messageRadiusM: 23_000 },
};

// ============================================================
// TIER CACHE — 60 s TTL; reloads from DB on expiry
// ============================================================
let _tiersCache      = null;
let _tiersCacheExpiry = 0;
const TIERS_CACHE_TTL_MS = 60_000;

async function loadTiers() {
  if (_tiersCache && Date.now() < _tiersCacheExpiry) return _tiersCache;
  try {
    const docs = await db.collection('tiers').find({}).toArray();
    _tiersCache = docs.length > 0
      ? Object.fromEntries(docs.map(t => [t.name, t]))
      : STATIC_TIERS; // migration not yet applied
  } catch {
    _tiersCache = STATIC_TIERS; // DB unreachable — serve static data
  }
  _tiersCacheExpiry = Date.now() + TIERS_CACHE_TTL_MS;
  return _tiersCache;
}

// ============================================================
// FEATURE DEFINITIONS
// ============================================================
const FEATURES = {

  see_map: {
    minTier: 'guest',
  },

  see_nearby: {
    minTier: 'guest',
  },

  // Message a user who is currently online (has active location)
  message_online: {
    minTier: 'regular',
  },

  // Message a user who is offline (no active location doc)
  message_offline: {
    minTier: 'regular',
  },

  message_radius: {
    minTier: 'regular',
  },

  manage_favourites: {
    minTier: 'regular',
  },

  // ── ADD NEW FEATURES HERE ───────────────────────────────────
  // search_users: {
  //   minTier: 'premium',
  // },

};

// ============================================================
// HELPERS
// ============================================================
function can(tier, feature) {
  const f = FEATURES[feature];
  if (!f) return false;
  const userRank     = TIERS[tier]      ?? TIERS.guest;
  const requiredRank = TIERS[f.minTier] ?? TIERS.guest;
  return userRank >= requiredRank;
}

async function getNearbyRadius(tier) {
  const tiers = await loadTiers();
  return tiers[tier]?.nearbyRadiusM ?? STATIC_TIERS.guest.nearbyRadiusM;
}

async function getMessageRadius(tier) {
  const tiers = await loadTiers();
  return tiers[tier]?.messageRadiusM ?? null;
}

// ============================================================
// EXPRESS
// ============================================================
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

app.get('/health', async (_req, res) => {
  try {
    await db.command({ ping: 1 });
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false, error: 'DB unreachable' });
  }
});

// GET /tiers/info — badge labels and colours for all tiers (internal)
app.get('/tiers/info', async (_req, res) => {
  const tiers = await loadTiers();
  const info = Object.fromEntries(
    Object.entries(tiers).map(([name, t]) => [name, { label: t.label, cls: t.cls }])
  );
  res.json({ tiers: info });
});

// GET /tiers/:name/info — full tier info for UI rendering (profile badge)
app.get('/tiers/:name/info', async (req, res) => {
  const tiers = await loadTiers();
  const tier  = tiers[req.params.name];
  if (!tier) return res.status(404).json({ error: 'Unknown tier.' });
  res.json({
    name:          tier.name,
    label:         tier.label,
    cls:           tier.cls,
    nearbyRadiusM: tier.nearbyRadiusM,
    messageRadiusM: tier.messageRadiusM,
    features:      Object.keys(FEATURES).filter(f => can(tier.name, f)),
  });
});

// GET /tiers/features — full feature definitions
app.get('/tiers/features', (_req, res) => {
  res.json({ features: FEATURES });
});

// POST /tiers/check — primary enforcement endpoint used by gateway
// Body: { tier: 'regular', feature: 'message_online' }
// Returns 200 { allowed: true } or 403 with reason
app.post('/tiers/check', (req, res) => {
  const { tier, feature } = req.body;
  if (!tier || !feature)
    return res.status(400).json({ error: 'tier and feature required.' });

  if (!can(tier, feature)) {
    return res.status(403).json({
      error:    `This feature requires the '${FEATURES[feature]?.minTier ?? 'unknown'}' tier or above.`,
      yourTier: tier,
      required: FEATURES[feature]?.minTier ?? null,
    });
  }

  res.json({ allowed: true });
});

// GET /tiers/radius/nearby/:tier — nearby radius for a tier
app.get('/tiers/radius/nearby/:tier', async (req, res) => {
  const { tier } = req.params;
  if (!(tier in TIERS))
    return res.status(400).json({ error: 'Unknown tier.' });
  const radiusM = await getNearbyRadius(tier);
  res.json({ tier, radiusM });
});

// GET /tiers/radius/message/:tier — message radius for a tier
// Returns -1 to represent Infinity/null (JSON safe)
app.get('/tiers/radius/message/:tier', async (req, res) => {
  const { tier } = req.params;
  if (!(tier in TIERS))
    return res.status(400).json({ error: 'Unknown tier.' });
  const radiusM = await getMessageRadius(tier);
  res.json({ tier, radiusM: radiusM == null ? -1 : radiusM });
});

app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));

app.listen(CFG.PORT, () => console.log(`[tiers] Running on :${CFG.PORT}`));
