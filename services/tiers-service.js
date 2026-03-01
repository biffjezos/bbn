// ============================================================
// bOOmbOOm.NOW! — tiers-service.js
// Single source of truth for all feature/tier rules.
// The gateway calls this before proxying any request.
//
// TO ADD A NEW FEATURE:
//   1. Add an entry to FEATURES below with a minTier
//   2. Add the route in server.js with the feature key
//   That's it. The gateway enforces it automatically.
// ============================================================

const CFG = {
  PORT: process.env.PORT || 8080,
};

import express from 'express';

// ============================================================
// TIER RANKS — higher number = more access
// ============================================================
const TIERS = {
  guest:   0,
  regular: 1,
  premium: 2,
};

// ============================================================
// FEATURE DEFINITIONS
// ============================================================
const FEATURES = {

  see_map: {
    minTier: 'guest',
  },

  see_nearby: {
    minTier: 'guest',
    radius: {
      guest:   50,
      regular: 500,
      premium: 2000,
    },
  },

  // Message a user who is currently online (has active location)
  message_online: {
    minTier: 'regular',
  },

  // Message a user who is offline (no active location doc)
  message_offline: {
    minTier: 'premium',
  },

  // Distance cap when messaging — premium has no limit
  message_radius: {
    minTier: 'regular',
    radius: {
      regular: 100,
      premium: Infinity,
    },
  },

  manage_favourites: {
    minTier: 'premium',
  },

  // ── ADD NEW FEATURES HERE ───────────────────────────────────
  // search_users: {
  //   minTier: 'premium',
  // },

};

// ============================================================
// TIER BADGE — UI display config
// ============================================================
const TIER_BADGE = {
  guest:   { label: 'Guest',   cls: 'secondary' },
  regular: { label: 'Regular', cls: 'primary'   },
  premium: { label: 'Premium', cls: 'warning'   },
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

function getNearbyRadius(tier) {
  return FEATURES.see_nearby.radius[tier] ?? FEATURES.see_nearby.radius.guest;
}

function getMessageRadius(tier) {
  return FEATURES.message_radius.radius[tier] ?? FEATURES.message_radius.radius.regular;
}

// ============================================================
// EXPRESS
// ============================================================
const app = express();
app.use(express.json({ limit: '16kb' }));

app.get('/health', (_req, res) => res.json({ ok: true }));

// GET /tiers/info — badge labels and colours for the UI
app.get('/tiers/info', (_req, res) => {
  res.json({ tiers: TIER_BADGE });
});

// GET /tiers/features — full feature definitions
// Note: Infinity is not valid JSON — serialised as null here.
// Services should use /tiers/radius/message/:tier for numeric values.
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
app.get('/tiers/radius/nearby/:tier', (req, res) => {
  const { tier } = req.params;
  if (!(tier in TIERS))
    return res.status(400).json({ error: 'Unknown tier.' });
  res.json({ tier, radiusM: getNearbyRadius(tier) });
});

// GET /tiers/radius/message/:tier — message radius for a tier
// Returns -1 to represent Infinity (JSON safe)
app.get('/tiers/radius/message/:tier', (req, res) => {
  const { tier } = req.params;
  if (!(tier in TIERS))
    return res.status(400).json({ error: 'Unknown tier.' });
  const radiusM = getMessageRadius(tier);
  res.json({ tier, radiusM: radiusM === Infinity ? -1 : radiusM });
});

app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));

app.listen(CFG.PORT, () => console.log(`[tiers] Running on :${CFG.PORT}`));
