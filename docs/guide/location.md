# Location

*[← User Profiles](users.md) · [Messages →](messages.md)*

---

## Overview

Location is handled by `location-service.js`. It tracks where users are, serves nearby user lookups, and exposes a per-user location endpoint used internally by `messages-service.js`.

---

## How Location Works

The frontend uses the HTML5 Geolocation API with a two-step approach:

1. **Low-accuracy fix first** — fast, uses WiFi/cell positioning, gets an immediate position
2. **High-accuracy watch** — enables GPS if available, refines position continuously

If the browser blocks geolocation (permission denied or unavailable), the frontend falls back to **IP geolocation** using a randomised list of free services tried in sequence:

- `ipwho.org`
- `iplocate.io`
- `api.ipapi.is`

The fallback services are shuffled randomly on each page load to distribute load evenly across them. If one fails or returns a CORS error, the next is tried automatically.

Each location push includes an `accuracy` field: `"gps"` for browser geolocation, `"ip"` for IP-based fallback. The map shows an "approximate location" indicator for IP-based pins.

Location documents expire automatically after **10 minutes** via a MongoDB TTL index. If a user closes the app or loses signal, they disappear from the map within 10 minutes.

---

## Push Location

Updates the caller's position in the database. Called every 30 seconds by the frontend regardless of movement.

```
PUT /api/location
```

**Auth:** Any valid token (guest or registered).

**Body:**
```json
{
  "lat":      51.5074,
  "lon":      -0.1278,
  "accuracy": "gps"
}
```

**Response:**
```json
{ "ok": true }
```

---

## Delete Location

Removes the caller's location document immediately. Called on logout (to remove the pin from the map instantly) and on login (to remove the stale guest pin before pushing the new user pin).

```
DELETE /api/location
```

**Auth:** Any valid token.

**Response:**
```json
{ "ok": true }
```

---

## Get Nearby Users

Returns all users with an active location in the last 10 minutes. The caller is never included in results.

```
GET /api/location/nearby?lat=51.5074&lon=-0.1278
```

**Auth:** Any valid token.

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
      "accuracy":     "gps",
      "distanceM":    42
    }
  ]
}
```

---

## Get User Location (Internal)

Used internally by `messages-service.js` via the service token. Not exposed publicly.

```
GET /location/user/:userId
```

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
  "accuracy":     "gps | ip",
  "updatedAt":    "Date (TTL field — document expires 10 min after this)"
}
```

---

## Configuration

| Key | Default | Description |
|---|---|---|
| `LOCATION_TTL_SEC` | 600 | Location document lifetime in seconds |
| `MAX_VISIBLE_GUESTS` | Infinity | Max users returned (currently unlimited) |
| `VISIBLE_SELECTION_STRATEGY` | `random` | Selection strategy when capping results: `random`, `nearest`, `newest` |

---

*[← User Profiles](users.md) · [Messages →](messages.md)*
