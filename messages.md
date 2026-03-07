# Messages

*[← Location](location.md) · [Favourites →](favourites.md)*

---

## Overview

Messaging is handled by `messages-service.js`. All messaging requires a registered user account. Messages are **end-to-end encrypted** — the server stores only ciphertext and cannot read message content. Messages expire automatically after 4 hours.

---

## End-to-End Encryption

### How it works

Messages are encrypted client-side using the Web Crypto API (ECDH P-256 + AES-GCM) before being sent to the server. The server stores the ciphertext as-is.

**Sending a message:**

1. Fetch the recipient's public key from `GET /api/users/:userId/profile`
2. Fetch your own public key from the same endpoint (for your copy)
3. Derive a shared ECDH secret: your private key + recipient's public key → shared AES key
4. Encrypt the plaintext with AES-GCM → `{ ivB64, cipherB64 }` (for recipient)
5. Derive your own shared secret: your private key + your own public key → AES key
6. Encrypt again → `{ ivB64, cipherB64 }` (for sender)
7. Send `{ forRecipient: {...}, forSender: {...} }` as the message text

**Receiving a message:**

1. Determine whether you are the sender or recipient
2. Select the correct ciphertext (`forSender` or `forRecipient`)
3. Fetch the other person's public key
4. Derive the shared ECDH secret: your private key + their public key
5. AES-GCM decrypt → plaintext

Both parties can read their copy. The server sees only base64 ciphertext.

### Legacy messages

Messages sent before E2EE was introduced are stored as plaintext. The client detects this by checking whether the `text` field is valid JSON with `forRecipient`/`forSender` keys. If not, it displays the text as-is.

### Fallback behaviour

If the recipient has no public key (has not logged in since E2EE was introduced), encryption fails and the message is sent as plaintext with a console warning. Once both users have logged in at least once after the E2EE update, all new messages are encrypted.

---

## Session Lock

The private key exists in memory only while the session is active and unlocked. It is wiped:

- After **30 minutes** of inactivity
- After the tab has been hidden for **3 minutes**
- On logout

When locked, a modal prompts for the password. Entering it re-derives the private key from the encrypted blob stored on the server — no full re-login required.

If the page is loaded with a saved session (token in localStorage), the lock modal is shown immediately on page load since the password is not available to unlock the keys automatically.

---

## Get All Conversations

Returns all active (non-expired) messages involving the current user, sorted newest first.

```
GET /api/messages
```

**Auth:** Registered user token required.

**Response:**
```json
{
  "messages": [
    {
      "_id":        "64abc…",
      "fromUserId": "string",
      "toUserId":   "string",
      "text":       "{\"forRecipient\":{…},\"forSender\":{…}}",
      "sentAt":     "2024-01-01T12:00:00.000Z",
      "expiresAt":  "2024-01-01T16:00:00.000Z"
    }
  ]
}
```

The `text` field is JSON-encoded ciphertext. The UI decrypts it client-side before display.

---

## Get Thread

Returns all active messages between the current user and one other user, sorted oldest first.

```
GET /api/messages/:userId
```

**Auth:** Registered user token required.

---

## Send a Message

```
POST /api/messages/:userId
```

**Auth:** Registered user token required.

**Body:**
```json
{ "text": "{\"forRecipient\":{…},\"forSender\":{…}}" }
```

The `text` field contains the JSON-encoded dual ciphertext produced by the client. Maximum 4096 characters (to accommodate the encrypted payload, which is larger than the original plaintext).

**Validation:**
- `text` is required and cannot be empty
- Maximum **4096 characters**
- Cannot message yourself

**Response:**
```json
{
  "_id":       "64abc…",
  "expiresAt": "2024-01-01T16:00:00.000Z"
}
```

---

## Delete a Message

Only the sender can delete their own messages.

```
DELETE /api/messages/:id
```

**Auth:** Registered user token required.

**Response:**
```json
{ "ok": true }
```

---

## Message Expiry

Messages expire 4 hours after they are sent via a MongoDB TTL index on `expiresAt`. The UI shows a countdown to expiry on each message bubble.

---

## Database Document

```json
{
  "_id":        "ObjectId",
  "fromUserId": "string",
  "toUserId":   "string",
  "text":       "string (JSON ciphertext, max 4096 chars)",
  "sentAt":     "Date",
  "expiresAt":  "Date (TTL field)"
}
```

---

## Configuration

| Key | Default | Description |
|-----|---------|-------------|
| `MESSAGE_MAX_CHARS` | 4096 | Maximum message text length (covers encrypted payload) |
| `MESSAGE_TTL_MS` | 14400000 | Message lifetime in milliseconds (4 hours) |

---

*[← Location](location.md) · [Favourites →](favourites.md)*
