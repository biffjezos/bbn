# Favourites

## Overview

Favourites allow a premium user to maintain a list of registered users they want to keep track of. The list shows live online status for each favourited user. Favourites are managed by `users-service.js`.

**Tier required: Premium.**

---

## How It Works

A favourite is a link between two user IDs — the owner and the target. The target user is not notified and does not need to accept. Favourites are one-directional.

When fetching the favourites list, the service:
1. Loads all favourite entries for the owner
2. Joins against the `users` collection to get current nicknames and sex (in case they were updated since the favourite was added)
3. Checks the `locations` collection to determine which users have been active in the last 10 minutes (online status)
4. Silently drops any entries where the target account no longer exists

---

## List Favourites

Returns all favourites for the current user with live nickname and online status.

```
GET /api/favourites
```

**Auth:** Registered user token required. **Tier: Premium.**

**Response:**
```json
{
  "favourites": [
    {
      "userId":   "64abc...",
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

Adds a user to the current user's favourites list by their user ID.

```
POST /api/favourites/:userId
```

**Auth:** Registered user token required. **Tier: Premium.**

**Validation:**
- Cannot favourite yourself
- Target user must exist
- Cannot add the same user twice (returns 409 if already in favourites)

**Response:**
```json
{ "ok": true }
```

---

## Remove a Favourite

Removes a user from the current user's favourites list.

```
DELETE /api/favourites/:userId
```

**Auth:** Registered user token required. **Tier: Premium.**

**Response:**
```json
{ "ok": true }
```

Returns 404 if the entry does not exist.

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
