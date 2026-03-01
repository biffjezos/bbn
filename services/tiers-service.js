// ============================================================
// bOOmbOOm.NOW! — tiers-service.js
// Standalone service. Serves tier rules and feature checks.
// All other services call this via HTTP instead of importing.
// ============================================================

// ============================================================
// CONFIG
// ============================================================
const CFG = {
  PORT: process.env.PORT || 3005,
};
// ============================================================

import express from 'express';

// ============================================================
// TIER RANKS
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

  message_online: {
    minTier: 'regular',
  },

  message_anyone: {
    minTier: 'premium',
  },

  favourites: {
    minTier: 'premium',
  },

  // ── ADD NEW FEATURES HERE ───────────────────────────────────
  // my_new_feature: {
  //   minTier: 'regular',
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

function getNearbyRadius(tier) {
  return FEATURES.see_nearby.radius[tier] ?? FEATURES.see_nearby.radius.guest;
}

const TIER_BADGE = {
  guest:   { label: 'Guest',   cls: 'secondary' },
  regular: { label: 'Regular', cls: 'primary'   },
  premium: { label: 'Premium', cls: 'warning'   },
};

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
app.get('/tiers/features', (_req, res) => {
  res.json({ features: FEATURES });
});

// POST /tiers/can — check if a tier can use a feature
// Body: { tier: 'regular', feature: 'favourites' }
app.post('/tiers/can', (req, res) => {
  const { tier, feature } = req.body;
  if (!tier || !feature)
    return res.status(400).json({ error: 'tier and feature required.' });
  res.json({ allowed: can(tier, feature) });
});

// GET /tiers/radius/:tier — nearby radius for a tier
app.get('/tiers/radius/:tier', (req, res) => {
  const { tier } = req.params;
  if (!(tier in TIERS))
    return res.status(400).json({ error: 'Unknown tier.' });
  res.json({ tier, radiusM: getNearbyRadius(tier) });
});

// POST /tiers/check — returns 403-shaped response if not allowed.
// Used by services that want to delegate enforcement entirely.
// Body: { tier: 'regular', feature: 'favourites' }
app.post('/tiers/check', (req, res) => {
  const { tier, feature } = req.body;
  if (!tier || !feature)
    return res.status(400).json({ error: 'tier and feature required.' });

  if (!can(tier, feature)) {
    return res.status(403).json({
      error:    `This feature requires the '${FEATURES[feature]?.minTier}' tier or above.`,
      yourTier: tier,
      required: FEATURES[feature]?.minTier,
    });
  }
  res.json({ allowed: true });
});

app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));

app.listen(CFG.PORT, () => console.log(`[tiers] Running on :${CFG.PORT}`));
