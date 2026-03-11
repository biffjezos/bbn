# **How Our Encryption Works**

*Last updated: 13 May 2026*

This document explains, in clear and accessible terms, how encryption and security work within our Service. It is intended for users who want to understand how their data is protected.

---

## 🔐 **1. End‑to‑End Encryption (E2EE)**

All messages sent through the Service are protected using end‑to‑end encryption. This means:

- Messages are encrypted on your device before they leave it.  
- Only the intended recipient can decrypt them.  
- We cannot read or access message content at any point.

Even if someone intercepts the data, it appears as unreadable ciphertext.

---

## 🔑 **2. Your Encryption Keys**

When you create an account:

- Your device generates a **private encryption key** (kept only on your device).  
- A corresponding **public key** is created and stored on our servers.  
- The private key never leaves your device and is never shared with us.

Your private key is used to decrypt incoming messages.  
Your public key is used by others to encrypt messages sent to you.

---

## 📨 **3. How Messages Are Encrypted**

When you send a message:

1. Your device encrypts the message using the recipient’s public key.  
2. The encrypted message is transmitted to our servers.  
3. We store only the encrypted version — we cannot decrypt it.  
4. The recipient’s device uses their private key to decrypt the message.

At no point do we have access to the plaintext message.

---

## 🧰 **4. Per‑Account Encryption Key**

During account creation, your device generates a **per‑account encryption key** used for:

- encrypting message history,  
- securing local session data,  
- protecting stored content.

This key is encrypted with your login password (via bcrypt‑derived key material) so that only you can unlock it.

---

## 🧠 **5. Session Security**

To protect your data during active use:

- A secure session is created in your browser.  
- Sensitive data (keys, session state) is stored only in volatile memory (SharedWorker).  
- After inactivity or loss of focus, the session is locked and keys are re‑encrypted.  
- When the browser tab closes, all session data is wiped.

No session data is stored permanently on our servers.

---

## 📍 **6. Temporary Geolocation**

If you enable location‑based features:

- Your approximate location is processed temporarily.  
- It is stored for no more than 15 minutes.  
- It is deleted after logout, inactivity, or when no longer needed.  
- It is never stored permanently or linked to message content.

---

## 🛡️ **7. Transport Encryption**

All communication between your device and our servers uses **TLS encryption**, protecting data from interception during transmission.

This is separate from end‑to‑end encryption, which protects message content itself.

---

## 🧹 **8. Data Deletion**

When you delete your account:

- Your account data is permanently erased.  
- Your encryption keys are deleted.  
- Encrypted messages associated with your account become unreadable.  
- No recovery is possible.

This ensures complete removal of your personal data.

---

## 🧭 **9. Why Zero‑Access Matters**

Our architecture is designed so that:

- We cannot decrypt your messages.  
- We cannot access your private keys.  
- We cannot read your conversations.  
- We cannot provide message content to third parties.

Your privacy is protected by cryptography, not by trust.

---
