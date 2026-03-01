# Authentication

## Overview

Authentication is handled by `auth-service.js`. There are two kinds of sessions: **guest** and **registered user**. Both produce a JWT that all other services verify locally using the shared `JWT_SECRET`.

---

## Guest Sessions

Any visitor gets a guest token automatically on page load. The frontend generates a UUID, stores it in `localStorage`, and exchanges it for a short-lived JWT.

- Token lifetime: **15 minutes**
- Identified by UUID — not tied to any account
- Allows: seeing the map, seeing nearby users (50m radius)
- Does not allow: messaging, favourites

When a guest registers or logs in, their guest location and session documents are deleted from the database immediately so their guest icon disappears from the map.

### Endpoint

```
POST /api/auth/guest
```

**Body:**
```json
{ "guestId": "uuid-string" }
```

**Response:**
```json
{
  "token": "eyJ...",
  "expiresIn": 900000
}
```

---

## Registration

Creates a new user account with `tier: "regular"` written to the database at creation time.

### Endpoint

```
POST /api/auth/register
```

**Body:**
```json
{
  "email":    "user@example.com",
  "nickname": "username",
  "password": "minimum8chars",
  "age":      25,
  "sex":      "m"
}
```

**Validation:**
- All fields required
- `sex` must be `"m"` or `"f"`
- `age` must be a number between 18 and 120
- `password` minimum 8 characters
- `email` and `nickname` must be unique

**Response:**
```json
{
  "token":    "eyJ...",
  "nickname": "username",
  "sex":      "m",
  "tier":     "regular"
}
```

---

## Login

Reads the user's `tier` from the database and bakes it into the JWT. This is the only moment the database tier value is consulted — the token is the enforcement mechanism from this point on.

### Endpoint

```
POST /api/auth/login
```

**Body:**
```json
{
  "login":    "username or email",
  "password": "yourpassword",
  "guestId":  "uuid-string"
}
```

`guestId` is optional — if provided, the guest location and session are cleaned up on successful login.

**Response:**
```json
{
  "token":    "eyJ...",
  "nickname": "username",
  "sex":      "m",
  "tier":     "regular"
}
```

---

## JWT Payload

All tokens contain:

```json
{
  "sub":      "userId or guestUUID",
  "role":     "user | guest",
  "tier":     "guest | regular | premium",
  "email":    "user@example.com",
  "nickname": "username",
  "sex":      "m | f",
  "iat":      1234567890,
  "exp":      1234567890
}
```

Guest tokens only contain `sub`, `role`, `tier`, `iat`, `exp`.

User tokens expire after **7 days**. Guest tokens expire after **15 minutes**.

---

## Token Storage (Frontend)

Tokens are stored in `localStorage` under the key `bbm_token`. On page load, `auth.js` checks if a stored token exists and is not expired. If valid, the user is logged in silently without a network request. If expired or missing, a guest token is requested automatically.

---

## Tier and JWT Security

The `tier` field in the JWT is signed with `JWT_SECRET`. Changing the tier value in MongoDB has no effect on an active session — the user must log out and back in to receive a new token reflecting the updated tier.

See `docs/tiers.md` for full details on the tier system.
