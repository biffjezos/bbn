# Favourites

*[← Messages](messages.md) · [Tiers →](tiers.md)*

---

## Overview

Favourites allow a registered user to maintain a list of other registered users they want to keep track of. The list shows live online status for each favourited user. Favourites are managed by `favourites-service.js`.

**Available to all registered users.**

---

## How It Works

A favourite is a one-directional link between two user IDs — the owner and the target. The target is not notified and does not need to accept.

When fetching the favourites list, the service:
1. Loads all favourite entries for the owner
2. Joins against `users` to get current nicknames and sex
3. Checks `locations` to determine which users have been active in the last 10 minutes (online status)
4. Silently drops entries where the target account no longer exists

---

## List Favourites

```
GET /api/favourites
```

**Auth:** Registered user token required.

**Response:**
```json
{
  "favourites": [
    {
      "userId":   "64abc…",
      "nickname": "username",
      "sex":      "f",
      "online":   true,
      "addedAt":  "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

`online: true` means the user has pushed a location in the last 10 minutes.

---

## Add a Favourite

```
POST /api/favourites/:userId
```

**Auth:** Registered user token required.

**Validation:**
- Cannot favourite yourself
- Target user must exist
- Cannot add the same user twice (returns 409)

**Response:**
```json
{ "ok": true }
```

---

## Remove a Favourite

```
DELETE /api/favourites/:userId
```

**Auth:** Registered user token required.

Returns 404 if the entry does not exist.

**Response:**
```json
{ "ok": true }
```

---

## Database Document

```json
{
  "_id":             "ObjectId",
  "ownerUserId":     "string",
  "favouriteUserId": "string",
  "addedAt":         "Date"
}
```

A unique compound index on `{ ownerUserId, favouriteUserId }` prevents duplicates.

---

## Account Deletion

When a user deletes their account, all favourites documents are cleaned up — both entries they own and entries that reference their userId in other users' lists.

---

*[← Messages](messages.md) · [Tiers →](tiers.md)*
