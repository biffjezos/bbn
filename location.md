# Location

## Overview

Location is handled by `location-service.js`. It tracks where users are, serves nearby user lookups, and is consulted by `messages-service.js` before allowing a message to be sent.

---

## How Location Works

The browser uses the Geolocation API (`navigator.geolocation.watchPosition`) to continuously track the user. The frontend pushes the position to the server, but only when:

- It is the first position fix, **or**
- At least 15 seconds have passed since the last push, **or**
- The user has moved more than 100 metres

This prevents unnecessary writes while keeping the server in sync with the user's real position.

Location documents expire automatically after **10 minutes** via a MongoDB TTL index. If a user closes the app or loses signal, they disappear from the map within 10 minutes.

---

## Push Location

Updates the caller's position in the database.

```
PUT /api/location
```

**Auth:** Any valid token (guest or registered).

**Body:**
```json
{
  "lat": 51.5074,
  "lon": -0.1278
}
```

**Validation:**
- `lat` must be a number between -90 and 90
- `lon` must be a number between -180 and 180

If the position has not changed enough since the last push (time or distance threshold not met), the write is skipped and `skipped: true` is returned.

**Response:**
```json
{ "ok": true }
```

or if skipped:

```json
{ "ok": true, "skipped": true }
```

---

## Get Nearby Users

Returns users visible to the caller within their tier's radius. The caller is never included in their own results.

```
GET /api/location/nearby?lat=51.5074&lon=-0.1278
```

**Auth:** Any valid token.

**Tier radius:**

| Tier | Radius |
|---|---|
| Guest | 50 metres |
| Regular | 500 metres |
| Premium | 2000 metres |

Only users whose location was updated within the last **10 minutes** are returned.

Guests see a maximum of 5 other users. Registered users see all users within range.

**Response:**
```json
{
  "users": [
    {
      "userId":       "string",
      "lat":          51.5075,
      "lon":          -0.1279,
      "isRegistered": true,
      "sex":          "f",
      "nickname":     "username",
      "distanceM":    42
    }
  ]
}
```

---

## Visibility Strategy

When the number of visible users exceeds the maximum (applies to guests), the service selects which users to show using the `VISIBLE_SELECTION_STRATEGY` config value:

| Strategy | Behaviour |
|---|---|
| `random` (default) | Random selection from users in range |
| `nearest` | Closest users are shown first |
| `newest` | Most recently active users are shown first |

Change `VISIBLE_SELECTION_STRATEGY` in `location-service.js` CFG to switch strategy.

---

## Location Document

```json
{
  "userId":       "string (ObjectId for users, UUID for guests)",
  "lat":          "number",
  "lon":          "number",
  "isRegistered": "boolean",
  "sex":          "m | f | null",
  "nickname":     "string | null",
  "updatedAt":    "Date (TTL field — document expires 10 min after this)"
}
```

---

## Configuration

All values are in `location-service.js` CFG:

| Key | Default | Description |
|---|---|---|
| `UPDATE_INTERVAL_MS` | 15000 | Min time between location pushes (ms) |
| `UPDATE_DISTANCE_M` | 100 | Min movement before a push is triggered (metres) |
| `LOCATION_TTL_SEC` | 600 | Location document lifetime (seconds) |
| `VICINITY_RADIUS_M` | 100 | Hard server-side radius cap (metres) — tier radius in `tiers.js` applies on top |
| `MAX_VISIBLE_GUESTS` | 5 | Max users returned to a guest caller |
| `MAX_VISIBLE_REGISTERED` | Infinity | Max users returned to a registered caller |
| `VISIBLE_SELECTION_STRATEGY` | `random` | Selection strategy when capping results |
