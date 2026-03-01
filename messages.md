# Messages

## Overview

Messaging is handled by `messages-service.js`. All messaging requires a registered user account. Messages expire automatically after 4 hours. Sending a message requires both users to be physically within 100 metres of each other at the time of sending.

---

## Proximity Enforcement

Before inserting a message, the service calls `location-service.js` to fetch the current coordinates of both the sender and the recipient. If either user has no active location (i.e. they have not pushed a location within the last 10 minutes), the message is rejected. If both have locations but are more than 100 metres apart, the message is rejected with the actual distance in the response.

This check happens server-side on every send — it cannot be bypassed from the client.

---

## Get All Conversations

Returns all active (non-expired) messages involving the current user, sorted newest first. Used to build the conversation list.

```
GET /api/messages
```

**Auth:** Registered user token required.

**Response:**
```json
{
  "messages": [
    {
      "_id":        "64abc...",
      "fromUserId": "string",
      "toUserId":   "string",
      "text":       "Hey!",
      "sentAt":     "2024-01-01T12:00:00.000Z",
      "expiresAt":  "2024-01-01T16:00:00.000Z"
    }
  ]
}
```

---

## Get Thread

Returns all active messages between the current user and one other user by nickname, sorted oldest first (for display in a chat view).

```
GET /api/messages/:nickname
```

**Auth:** Registered user token required.

**Response:**
```json
{
  "messages": [
    {
      "_id":        "64abc...",
      "fromUserId": "string",
      "toUserId":   "string",
      "text":       "Hey!",
      "sentAt":     "2024-01-01T12:00:00.000Z",
      "expiresAt":  "2024-01-01T16:00:00.000Z"
    }
  ]
}
```

---

## Send a Message

Sends a message to a user by nickname. Proximity is enforced — see above.

```
POST /api/messages/:nickname
```

**Auth:** Registered user token required.

**Body:**
```json
{ "text": "Your message here" }
```

**Validation:**
- `text` is required and cannot be empty
- Maximum **144 characters**
- Cannot message yourself
- Both users must have an active location within the last 10 minutes
- Both users must be within **100 metres** of each other

**Response on success:**
```json
{
  "_id":       "64abc...",
  "expiresAt": "2024-01-01T16:00:00.000Z"
}
```

**Response on proximity failure:**
```json
{
  "error":     "Both users must be within 100m to message.",
  "distanceM": 247
}
```

---

## Delete a Message

Deletes a message. Only the sender can delete their own messages.

```
DELETE /api/messages/:id
```

**Auth:** Registered user token required.

**Response:**
```json
{ "ok": true }
```

Returns 404 if the message does not exist or was sent by someone else.

---

## Message Expiry

Messages expire 4 hours after they are sent. Expiry is enforced by a MongoDB TTL index on the `expiresAt` field. Expired messages are deleted automatically by MongoDB — no cleanup job is needed.

The UI shows a countdown to expiry on each message bubble.

---

## Database Document

```json
{
  "_id":        "ObjectId",
  "fromUserId": "string",
  "toUserId":   "string",
  "text":       "string (max 144 chars)",
  "sentAt":     "Date",
  "expiresAt":  "Date (TTL field)"
}
```

---

## Configuration

All values are in `messages-service.js` CFG:

| Key | Default | Description |
|---|---|---|
| `MESSAGE_MAX_CHARS` | 144 | Maximum message length in characters |
| `MESSAGE_TTL_MS` | 14400000 | Message lifetime in milliseconds (4 hours) |
| `MESSAGE_PROXIMITY_M` | 100 | Maximum distance between sender and recipient in metres |
