# User Profiles

## Overview

User profile management is handled by `users-service.js`. All routes require a registered user token (`role: "user"`).

---

## Nickname

Nickname is a **display name only**. It is not unique — multiple users may share the same nickname. All internal service-to-service communication uses `userId` (the MongoDB `_id` as a string). Nicknames are shown in the UI but never used as identifiers in API calls.

---

## Get My Profile

Returns the current user's full profile document, excluding `passwordHash`.

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
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

---

## Update My Profile

Updates one or more profile fields. Only fields included in the request body are changed.

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

**Validation:**
- `sex` must be `"m"` or `"f"` if provided
- `age` must be between 18 and 120 if provided
- `password` must be at least 8 characters if provided
- `nickname` has no uniqueness constraint

If `nickname` or `sex` are updated, the change is also written to the user's active location document so the map icon updates correctly without a re-login.

**Response:**
```json
{ "ok": true }
```

---

## Delete Account

Permanently deletes the account and all associated data.

```
DELETE /api/users/me
```

**Auth:** Registered user token required.

Deletes:
- User document
- Location document
- All messages sent or received
- All favourites (owned or referencing this user)

**Response:**
```json
{ "ok": true }
```

---

## Get Public Profile

Returns the public-facing profile for a user by their **userId**.

```
GET /api/users/:userId/profile
```

**Auth:** Any valid token (guest or registered).

**Response:**
```json
{
  "nickname": "username",
  "age":      25,
  "sex":      "m"
}
```

Only `nickname`, `age`, and `sex` are returned. Email, tier, and internal fields are never exposed.

---

## Database Document

```json
{
  "_id":          "ObjectId",
  "email":        "string (unique, lowercase)",
  "nickname":     "string (display only, not unique, min 2 chars, max 32 chars)",
  "passwordHash": "string (bcrypt, never returned in API responses)",
  "age":          "number",
  "sex":          "m | f",
  "tier":         "regular | premium",
  "createdAt":    "Date"
}
```
