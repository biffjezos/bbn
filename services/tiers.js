// ============================================================
// bOOmbOOm.NOW! — tiers.js
// Single source of truth for the tier system.
// Imported by every service that enforces feature access.
//
// HOW TO ADD A NEW FEATURE:
//   1. Add an entry to FEATURES below.
//   2. Call can(req.auth.tier, 'your_feature') in your route.
//   3. That's it. No other files need changing.
//
// HOW TO ADD A NEW TIER:
//   1. Add it to TIERS with a rank number higher than existing.
//   2. Add it to any FEATURES entries where it should be allowed.
//   3. Add a migration in server.js to backfill existing users.
// ============================================================

// ============================================================
// TIER RANKS
// Higher number = more access.
// ============================================================
export const TIERS = {
  guest:   0,
  regular: 1,
  premium: 2,
};

// ============================================================
// FEATURE DEFINITIONS
// minTier  — minimum tier string required to use this feature.
// Any extra keys are feature-specific config per tier.
// ============================================================
export const FEATURES = {

  // Map is visible to everyone
  see_map: {
    minTier: 'guest',
  },

  // Nearby lookup — guests see a tiny radius, regular/premium see more
  see_nearby: {
    minTier:  'guest',
    radius: {
      guest:   50,    // metres
      regular: 500,
      premium: 2000,
    },
  },

  // Messaging — regular can message users who are currently online/nearby
  message_online: {
    minTier: 'regular',
  },

  // Messaging — premium can message any registered user at any time
  message_anyone: {
    minTier: 'premium',
  },

  // Favourites list — premium only
  favourites: {
    minTier: 'premium',
  },

  // ── ADD NEW FEATURES HERE ───────────────────────────────────
  // my_new_feature: {
  //   minTier: 'regular',         // 'guest' | 'regular' | 'premium'
  //   someExtraConfig: { ... },   // optional per-tier config
  // },

};

// ============================================================
// HELPERS
// ============================================================

/**
 * Check whether a tier has access to a feature.
 * @param {string} tier    - 'guest' | 'regular' | 'premium'
 * @param {string} feature - key from FEATURES
 * @returns {boolean}
 */
export function can(tier, feature) {
  const f = FEATURES[feature];
  if (!f) return false;
  const userRank    = TIERS[tier]         ?? TIERS.guest;
  const requiredRank = TIERS[f.minTier]  ?? TIERS.guest;
  return userRank >= requiredRank;
}

/**
 * Get the nearby radius in metres for a given tier.
 * @param {string} tier
 * @returns {number}
 */
export function getNearbyRadius(tier) {
  return FEATURES.see_nearby.radius[tier] ?? FEATURES.see_nearby.radius.guest;
}

/**
 * Express middleware — rejects request if tier cannot use feature.
 * Usage: app.get('/route', requireTier('favourites'), handler)
 * @param {string} feature
 */
export function requireTier(feature) {
  return (req, res, next) => {
    const tier = req.auth?.tier ?? 'guest';
    if (!can(tier, feature)) {
      return res.status(403).json({
        error:    `This feature requires the '${FEATURES[feature]?.minTier}' tier or above.`,
        yourTier: tier,
        required: FEATURES[feature]?.minTier,
      });
    }
    next();
  };
}

/**
 * Badge label and Bootstrap colour class for each tier.
 * Used by the UI — exported so a /tiers/info endpoint can serve it.
 */
export const TIER_BADGE = {
  guest:   { label: 'Guest',   cls: 'secondary' },
  regular: { label: 'Regular', cls: 'primary'   },
  premium: { label: 'Premium', cls: 'warning'   },
};
