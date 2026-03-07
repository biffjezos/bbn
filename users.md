# User Profiles & Keys

*[← Authentication](auth.md) · [Location →](location.md)*

---

## Overview

User profile management is handled by `users-service.js`. This service also stores and serves the cryptographic keys used for end-to-end encrypted messaging.

---

## Nickname

Nickname is a **display name only** — not unique. All internal service communication uses `userId` (the MongoDB `_id` as a string). Nicknames are shown in the UI but never used as identifiers in API calls.

---

## Get My Profile

Returns the current user's full profile, excluding `passwordHash`, `encryptedPrivateKey`.

```
GET /api/users/me
```

**Auth:** Registered user token required.

**Response:**
```json
{
  "_id":       "64abc…",
  "email":     "user@example.com",
  "nickname":  "username",
  "age":       25,
  "sex":       "m",
  "tier":      "regular",
  "publicKey": "BEB…",
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

---

## Update My Profile

Updates one or more profile fields.

```
PUT /api/users/me
```

**Auth:** Registered user token required.

**Body (all fields optional):**
```json
{
  "nickname": "newname",
  "email":    "new@example.com",
  "password": "newpassword",
  "age":      26,
  "sex":      "f"
}
```

If `nickname` or `sex` are updated, the change is also written to the active location document so the map updates without re-login.

If `password` is changed, the frontend re-encrypts the private key blob with the new password before saving — so old messages remain readable. See [Crypto Keys](#crypto-keys).

---

## Delete Account

Permanently deletes the account and all associated data.

```
DELETE /api/users/me
```

Deletes: user document, location document, all messages sent or received, all favourites.

---

## Get Public Profile

Returns the public-facing profile for any user by userId. Includes the public key so senders can encrypt messages to this user.

```
GET /api/users/:userId/profile
```

**Auth:** Any valid token.

**Response:**
```json
{
  "nickname":  "username",
  "age":       25,
  "sex":       "m",
  "publicKey": "BEB…"
}
```

Only `nickname`, `age`, `sex`, and `publicKey` are returned. Email, tier, and internal fields are never exposed.

---

## Crypto Keys

### Save Keys

Called after registration or when a legacy account (no keys) logs in for the first time.

```
PUT /api/users/me/keys
```

**Auth:** Registered user token required.

**Body:**
```json
{
  "publicKey": "BEB…",
  "encryptedPrivateKey": {
    "saltB64":      "base64…",
    "ivB64":        "base64…",
    "encryptedB64": "base64…"
  }
}
```

The `encryptedPrivateKey` blob is the user's ECDH private key encrypted with a key derived from their password using PBKDF2 (200,000 iterations, SHA-256) + AES-GCM. The server stores this blob but cannot decrypt it without the user's password.

### Get My Keys

Called on login to retrieve the encrypted blob for client-side decryption.

```
GET /api/users/me/keys
```

**Auth:** Registered user token required.

**Response:**
```json
{
  "publicKey": "BEB…",
  "encryptedPrivateKey": {
    "saltB64":      "base64…",
    "ivB64":        "base64…",
    "encryptedB64": "base64…"
  }
}
```

---

## Database Document

```json
{
  "_id":                 "ObjectId",
  "email":              "string (unique, lowercase)",
  "nickname":           "string (display only, not unique)",
  "passwordHash":       "string (bcrypt, never returned in API)",
  "age":                "number",
  "sex":                "m | f",
  "tier":               "regular | premium",
  "publicKey":          "string (base64 ECDH public key)",
  "encryptedPrivateKey": {
    "saltB64":      "string",
    "ivB64":        "string",
    "encryptedB64": "string"
  },
  "createdAt": "Date"
}
```

---

*[← Authentication](auth.md) · [Location →](location.md)*
