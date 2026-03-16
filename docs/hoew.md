# **How Our Encryption Works**

*Last updated: 11 March 2026*

This document explains, in clear and accessible terms, how encryption and security work within our Service. It is intended for users who want to understand how their data is protected.

---

## 🔐 **1. End‑to‑End Encryption (E2EE)**

All messages sent through the Service are protected using end‑to‑end encryption. This means:

- Messages are encrypted on your device before they leave it.  
- Only the intended recipient can decrypt them.  
- We cannot read or access message content at any point.

Even if someone intercepts the data, it appears as unreadable ciphertext.

---

Thanks for the correction — and that’s an important one. Let’s update the encryption‑explanation document so it accurately reflects your architecture: **the private key is generated on the client, encrypted, stored on the server, and wiped locally when the tab closes.**

Below is a clean, corrected version of the relevant section, written in the same style as the rest of the “How Our Encryption Works” document. You can replace the earlier section with this one.

---

Got it — thanks for the clarification. Let’s update the explanation so it reflects your actual key‑handling model precisely: **both the encrypted private key and the public key are stored in the database**, and **both are wiped from the client when the browser tab closes**.

Here is the corrected section, rewritten cleanly and consistently with the rest of the document. You can drop this directly into your “How Our Encryption Works” page.

---

# 🔑 **2. Your Encryption Keys**

When you create an account, your device generates a **public/private key pair** used for end‑to‑end encryption. The system handles these keys as follows:

---

## **Private Key**
- Generated **locally on your device** during account creation  
- Immediately encrypted using key material derived from your login password  
- The **encrypted private key is uploaded and stored in our database**  
- The **unencrypted private key never leaves your device**  
- After encryption and upload, the plaintext private key is **wiped from local memory**  
- On each login, the encrypted private key is downloaded and decrypted **locally** using your password  
- During an active session, the plaintext private key exists **only in volatile browser memory**  
- When the browser tab closes, the session ends, or inactivity triggers a lock, the plaintext key is encrypted and/or wiped  

This ensures that we never have access to your unencrypted private key.

---

## **Public Key**
- Generated alongside the private key  
- Uploaded and stored in our database  
- Used by other users to encrypt messages to you
- Exists in your browser only during an active session
- Wiped from your device when the browser tab closes  

The public key is not sensitive, but it is still removed from the client when the session ends to maintain a clean, minimal local footprint.

---

## **Key Lifecycle Summary**
- **Plaintext private key exists only in your browser’s memory during an active session**  
- **Encrypted private key + public key are stored server‑side**  
- **Local copies are wiped on tab close, logout, or inactivity lock**  
- **Only your password can decrypt your private key**  

This design ensures that:

- We cannot decrypt your messages  
- We cannot access your private key  
- Your device is the only place where decryption is possible  
- Your privacy is protected even if our servers were compromised  

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
