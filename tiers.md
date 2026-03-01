# bOOmbOOm.NOW! — Tier System

## Overview

The tier system controls which features each user can access. It is built around a single file — `services/tiers.js` — which is the **only** place feature rules are defined. All backend services import from it. The enforcement lives in the JWT, making it impossible to fake by changing a database value alone.

---

## How It Works

### The JWT Is the Enforcement Mechanism

When a user logs in, `auth-service.js` reads their `tier` from the database and **bakes it into the signed JWT**:

```
{ sub, email, nickname, sex, tier: "regular", role: "user" }
```

Every subsequent request carries this token. All services verify it locally using the shared `JWT_SECRET`. The `tier` field inside the token is what every feature check reads — **not** the database.

This means:

- Changing `tier` in MongoDB has **zero effect** until the user logs out and back in
- A forged token without the `JWT_SECRET` is rejected immediately
- The database is only consulted at login — after that the token is self-contained

The only legitimate way to gain a higher tier is for the server to issue a new token with a higher tier value, which only happens after a verified payment webhook updates the DB and the user re-authenticates.

---

## Tiers

Defined in `TIERS` as an ordered rank. Higher number = more access.

| Tier | Rank | Description |
|---|---|---|
| `guest` | 0 | Not logged in. UUID-identified. Short-lived token (15 min). |
| `regular` | 1 | Registered account. Default for all new users. |
| `premium` | 2 | Paid tier. Full feature access. |

The rank system means access is always additive — a `premium` user implicitly passes any check that requires `regular` or `guest`.

---

## Features

Defined in `FEATURES`. Each entry maps a feature key to its rules.

```js
export const FEATURES = {

  see_map: {
    minTier: 'guest',
  },

  see_nearby: {
    minTier: 'guest',
    radius: {
      guest:   50,    // metres
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

};
```

### Fields

| Field | Required | Description |
|---|---|---|
| `minTier` | Yes | Minimum tier string needed. One of `'guest'`, `'regular'`, `'premium'`. |
| Any extra keys | No | Feature-specific per-tier config. E.g. `radius` for `see_nearby`. Read with `FEATURES.my_feature.myConfig[tier]`. |

---

## Exports

### `TIERS`

```js
export const TIERS = {
  guest:   0,
  regular: 1,
  premium: 2,
};
```

The rank lookup table. Used internally by `can()`. Import if you need to compare ranks manually.

---

### `FEATURES`

```js
export const FEATURES = { ... };
```

The full feature definition map. Import to read per-tier config values in a route handler. Example:

```js
import { FEATURES } from '.../tiers.js';

const radius = FEATURES.see_nearby.radius[req.auth.tier] ?? FEATURES.see_nearby.radius.guest;
```

---

### `can(tier, feature)`

```js
export function can(tier, feature)
```

Returns `true` if the given tier has access to the feature, `false` otherwise.

| Parameter | Type | Description |
|---|---|---|
| `tier` | `string` | The user's tier. Typically `req.auth.tier`. |
| `feature` | `string` | A key from `FEATURES`. |

**Returns:** `boolean`

**Example — manual check inside a handler:**

```js
import { can } from '.../tiers.js';

app.get('/my-route', requireUser, async (req, res) => {
  if (!can(req.auth.tier, 'message_online')) {
    return res.status(403).json({ error: 'Regular account required.' });
  }
  // ... handler logic
});
```

Use this when the tier check depends on runtime conditions (e.g. the check is inside a loop, or combined with other logic).

---

### `requireTier(feature)`

```js
export function requireTier(feature)
```

Express middleware factory. Returns a middleware function that automatically rejects the request with a `403` if the user's tier is too low. Use this for straightforward route-level enforcement.

| Parameter | Type | Description |
|---|---|---|
| `feature` | `string` | A key from `FEATURES`. |

**Returns:** Express middleware `(req, res, next) => void`

**On rejection, responds with:**

```json
{
  "error": "This feature requires the 'premium' tier or above.",
  "yourTier": "regular",
  "required": "premium"
}
```

**Example — middleware on a route:**

```js
import { requireTier } from '.../tiers.js';

app.get('/favourites', requireUser, requireTier('favourites'), async (req, res) => {
  // Only reaches here if req.auth.tier is 'premium' or above
});
```

The middleware always goes **after** `requireUser` / `requireAny` so that `req.auth` is populated before the tier is checked.

---

### `getNearbyRadius(tier)`

```js
export function getNearbyRadius(tier)
```

Convenience helper for the `see_nearby` radius config. Returns the radius in metres for the given tier. Falls back to the guest radius if the tier is unknown.

| Parameter | Type | Description |
|---|---|---|
| `tier` | `string` | The user's tier. |

**Returns:** `number` (metres)

**Example:**

```js
import { getNearbyRadius } from '.../tiers.js';

const radius = getNearbyRadius(req.auth.tier); // 50 | 500 | 2000
```

---

### `TIER_BADGE`

```js
export const TIER_BADGE = {
  guest:   { label: 'Guest',   cls: 'secondary' },
  regular: { label: 'Regular', cls: 'primary'   },
  premium: { label: 'Premium', cls: 'warning'   },
};
```

Badge display config for each tier. Used by `server.js` to serve the `/api/tiers/info` endpoint, which the UI consumes to render Bootstrap badges without hardcoding labels or colours on the frontend.

| Field | Description |
|---|---|
| `label` | Human-readable tier name shown in the badge. |
| `cls` | Bootstrap background colour utility class. |

---

## Adding a New Feature

**1. Add the feature to `FEATURES` in `tiers.js`:**

```js
profile_views: {
  minTier: 'premium',
},
```

If the feature has per-tier config (like a limit or radius):

```js
search_results: {
  minTier: 'regular',
  limit: {
    guest:   0,
    regular: 20,
    premium: 100,
  },
},
```

**2. Drop `requireTier` on the route in the relevant service:**

```js
app.get('/search', requireUser, requireTier('search_results'), async (req, res) => {
  const limit = FEATURES.search_results.limit[req.auth.tier] ?? 0;
  // ...
});
```

**3. Add the proxy route in `server.js` if it's a new endpoint:**

```js
app.get('/api/search', (req, res) => proxy(req, res, `${CFG.USER_SERVICE_URL}/search`));
```

**4. If the feature needs a new DB collection or index, add a migration in `server.js`:**

```js
{
  id: '004_search_index',
  async up(db) {
    await db.collection('search_cache').createIndex({ userId: 1 }, { background: true });
  },
},
```

That is the complete checklist. The tier check itself requires only step 1 and 2.

---

## Adding a New Tier

**1. Add it to `TIERS` with the next rank number:**

```js
export const TIERS = {
  guest:    0,
  regular:  1,
  premium:  2,
  platinum: 3,  // ← new
};
```

**2. Update `TIER_BADGE`:**

```js
platinum: { label: 'Platinum', cls: 'info' },
```

**3. Set `minTier` on any features the new tier should unlock:**

```js
ultra_search: {
  minTier: 'platinum',
},
```

**4. Add a migration in `server.js` to handle any existing users being upgraded (if needed):**

```js
{
  id: '005_platinum_tier',
  async up(db) {
    // Example: upgrade specific users by email
    await db.collection('users').updateMany(
      { email: { $in: ['vip@example.com'] } },
      { $set: { tier: 'platinum' } }
    );
  },
},
```

**5. Update `TIER_BADGE` in `app.js`** (frontend mirror — kept in sync manually):

```js
var TIER_BADGE = {
  guest:    { label: 'Guest',    cls: 'bg-secondary' },
  regular:  { label: 'Regular',  cls: 'bg-primary'   },
  premium:  { label: 'Premium',  cls: 'bg-warning text-dark' },
  platinum: { label: 'Platinum', cls: 'bg-info text-dark' },  // ← new
};
```

---

## Security Notes

- **Never enforce tiers by reading from the database at request time.** The DB is only read at login. After that, `req.auth.tier` from the verified JWT is the source of truth.
- **Never trust `req.body.tier` or any client-supplied tier value.** The tier in the JWT is set exclusively by `auth-service.js`.
- **Upgrading a user's tier** requires updating the DB value and having the user log in again to receive a new token. A DB change alone grants nothing.
- **`JWT_SECRET` must be kept secret.** It is the only thing standing between a tampered token and a successful forgery. Rotate it if compromised — all existing sessions will be invalidated immediately.
