# User Guide

*[← README](README.md)*

---

bOOmbOOm.NOW! connects you with the people physically around you — right now. There are no follows, no feeds, no history. If someone is nearby, you can message them. When the moment passes, so do the messages.

---

## Table of Contents

1. [Opening the App](#opening-the-app)
2. [Guest Mode](#guest-mode)
3. [Creating an Account](#creating-an-account)
4. [Logging In](#logging-in)
5. [The Map](#the-map)
6. [Viewing Someone's Profile](#viewing-someones-profile)
7. [Sending a Message](#sending-a-message)
8. [Reading Your Messages](#reading-your-messages)
9. [Favourites](#favourites)
10. [Your Profile](#your-profile)
11. [Session Lock](#session-lock)
12. [Logging Out](#logging-out)
13. [Deleting Your Account](#deleting-your-account)

---

## Opening the App

Go to the app URL in any modern browser. No installation required.

On first load you are automatically a **guest**. Your location is shared immediately (the browser may ask for permission) and you appear as a pin on the map. You can see the map and nearby users straight away.

---

## Guest Mode

As a guest you can:

- See the live map with all nearby users
- Tap pins to see a brief public profile
- Appear on the map yourself

As a guest you cannot:

- Send or receive messages
- Add favourites
- Keep any persistent identity between sessions

Your guest session lasts 15 minutes, after which a new token is issued automatically. Your pin disappears from the map within 10 minutes of your last location push.

---

## Creating an Account

Tap **Register** in the top navigation bar.

Fill in:

| Field | Notes |
|---|---|
| Email | Used for login only — never shown to other users |
| Nickname | Your display name on the map and in messages |
| Password | Minimum 8 characters |
| Age | Must be 18 or older |
| Sex | Used for the pin icon on the map |

After registering you are logged in immediately. Your guest pin is removed and your registered pin takes its place.

---

## Logging In

Tap **Login** in the top navigation bar. Enter your email and password.

On login the app fetches your encrypted private key from the server and unlocks it with your password. This is what enables end-to-end encrypted messaging — your keys stay in your browser, not on the server.

---

## The Map

The map is the home screen. It shows everyone who has pushed their location in the last 10 minutes.

- **Registered user pins** show the person's sex icon and nickname on hover/tap
- **Guest pins** appear as generic markers
- **Approximate pins** (marked with an indicator) come from users whose browser blocked location access and are using IP-based positioning

Your own pin is always on the map as long as you have the app open. Location is pushed automatically every 30 seconds.

**If you deny location permission**, the app falls back to IP geolocation. Your pin will be marked as approximate and placed at roughly your city or neighbourhood level.

---

## Viewing Someone's Profile

Tap any pin on the map. A popup shows:

- Nickname
- Age
- Sex

If you are logged in, you will also see a **Send Message** button.

---

## Sending a Message

You can only message registered users who are currently on the map (active in the last 10 minutes).

1. Tap the person's pin on the map
2. Tap **Send Message**
3. Type your message and send

Your message is encrypted in your browser before it leaves your device. The server never sees the plaintext. The recipient decrypts it on their end using their private key.

**Message limits:**
- Messages expire **4 hours** after being sent — there is no way to recover them after expiry
- Maximum message length: 4096 characters (covers the encrypted payload)

---

## Reading Your Messages

Tap **Messages** in the navigation bar to see all your active conversations. Tap a conversation to open the thread.

Each message bubble shows a countdown to expiry. When the timer reaches zero, the message is gone from the server permanently.

If a message shows as unreadable or blank, it may be a legacy message sent before end-to-end encryption was introduced. New messages are always encrypted.

---

## Favourites

Tap **Favourites** in the navigation bar to manage your favourites list.

To add someone: open their pin popup and tap **Add to Favourites**. They are not notified.

Your favourites list shows:

- Nickname and sex icon
- **Online status** — green if they have pushed a location in the last 10 minutes

To remove a favourite: tap the remove button next to their entry.

---

## Your Profile

Tap **Profile** in the navigation bar to view or edit your account.

You can update:

- Nickname
- Email
- Password
- Age
- Sex

If you change your password, your private key is re-encrypted with the new password automatically so your existing messages remain readable.

If you change your nickname or sex, the map updates immediately — other users will see the new values on your pin without you needing to log out.

---

## Session Lock

Your private key lives in memory only. It is wiped automatically when:

- You have been **inactive for 30 minutes**
- Your **tab has been hidden for 3 minutes**

When this happens, a lock screen appears over the app. Enter your password to restore your keys and continue. This is **not** a full logout — your session is still valid, only the keys need to be re-derived.

If you close the browser and reopen the app with a saved session, the lock screen appears immediately on load, since the password is needed to unlock your keys.

---

## Logging Out

Tap your nickname or the logout option in the navigation bar. On logout:

- Your JWT is discarded
- Your private key is wiped from memory
- Your location pin is removed from the map immediately

---

## Deleting Your Account

Go to **Profile** and tap **Delete Account**. This is permanent and cannot be undone.

Everything is deleted:

- Your user account
- Your location document
- All messages you sent or received
- All your favourites entries (and entries others have for you)

---

*[← README](README.md)*
