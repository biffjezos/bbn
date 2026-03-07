# Authentication

*[← README](README.md) · [User Profiles →](users.md)*

---

## Overview

Authentication is handled by `auth-service.js`. There are two kinds of sessions: **guest** and **registered user**. Both produce a JWT that all other services verify locally using the shared `JWT_SECRET`.

Inter-service requests (gateway → microservice) are additionally authenticated with a short-lived `X-Service-Token` JWT signed with the same `JWT_SECRET`. Each service rejects requests without a valid service token.

---

## Guest Sessions

Any visitor gets a guest token automatically on page load. The frontend generates a UUID, stores it in `localStorage`, and exchanges it for a short-lived JWT.

- Token lifetime: **15 minutes**
- Identified by UUID — not tied to any account
- Allows: seeing the map, seeing nearby users
- Does not allow: messaging, favourites

When a guest registers or logs in, their guest location document is deleted from the database immediately so their guest pin disappears from the map.

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
  "token":     "eyJ…",
  "expiresIn": 900000
}
```

---

## Registration

Creates a new user account with `tier: "regular"`. On registration, the frontend also generates an ECDH keypair and saves the encrypted private key blob — see [User Profiles & Keys](users.md#crypto-keys).

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
- `age` must be between 18 and 120
- `password` minimum 8 characters
- `email` must be unique

**Response:**
```json
{
  "token":    "eyJ…",
  "nickname": "username",
  "sex":      "m",
  "tier":     "regular"
}
```

---

## Login

Login is by email and password. On successful login, the frontend fetches the encrypted private key blob and decrypts it client-side to unlock E2EE — see [Messages](messages.md#end-to-end-encryption).

### Endpoint

```
POST /api/auth/login
```

**Body:**
```json
{
  "email":    "user@example.com",
  "password": "yourpassword",
  "guestId":  "uuid-string"
}
```

`guestId` is optional — if provided, the guest location document is deleted on successful login.

**Response:**
```json
{
  "token":    "eyJ…",
  "nickname": "username",
  "sex":      "m",
  "tier":     "regular"
}
```

---

## JWT Payload

```json
{
  "sub":      "userId or guestUUID",
  "role":     "user | guest",
  "tier":     "regular | premium | guest",
  "email":    "user@example.com",
  "nickname": "username",
  "sex":      "m | f",
  "iat":      1234567890,
  "exp":      1234567890
}
```

Guest tokens only contain `sub`, `role`, `tier`, `iat`, `exp`.

- User tokens expire after **7 days**
- Guest tokens expire after **15 minutes**

---

## Token Storage (Frontend)

Tokens are stored in `localStorage` under `bbm_token`. On page load, `auth.js` checks if a stored token exists and is not expired. If valid, the session is restored silently — but since the private key cannot be recovered without the password, the session lock modal is shown immediately asking for the password to unlock E2EE.

---

## Session Lock

After restoring a session from storage, or after inactivity, registered users see a lock screen. This is not a logout — the JWT is still valid. It exists to protect the E2EE private key, which is wiped from memory when the session locks. Entering the password re-derives and restores the key without a full re-login.

See [Messages — Session Lock](messages.md#session-lock) for full details.

---

*[← README](README.md) · [User Profiles →](users.md)*
