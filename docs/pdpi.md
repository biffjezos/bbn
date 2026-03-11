# **Privacy & Data Protection Information**

*Last updated: 11 March 2026*

This document explains how our service processes, protects, and stores personal data. We designed our platform according to internationally recognized privacy principles, including the EU General Data Protection Regulation (GDPR), the Swiss Federal Act on Data Protection (FADP), and comparable global standards.

Our goal is simple: **collect as little data as possible, keep it only as long as necessary, and ensure that only you can access your private communications.**

---

## 🌍 **1. Guiding Principles**

We follow widely accepted privacy and security principles:

- **Data minimization** — we only collect what is strictly necessary.
- **Purpose limitation** — data is used only for the function it was collected for.
- **Security by design** — encryption and secure architecture are built into the system.
- **Transparency** — you always know what data we process.
- **User control** — you can delete your account and all associated data at any time.
- **Zero‑access architecture** — we cannot read your messages.

These principles align with GDPR, Swiss FADP, OECD Privacy Guidelines, and similar international frameworks.

---

## 🔐 **2. What Data We Collect**

We intentionally collect **very little** information. Below is a complete list.

### **2.1 Account Information**
We store the following to create and maintain your account:

- **Email address** (used as your login credential)
- **bcrypt‑hashed password**
- **Nickname**
- **Self‑chosen age and sex** (visible to other users)

These fields are stored until you delete your account.

---

### **2.2 Temporary Geolocation**
If you enable location‑based features, we process:

- **Approximate geolocation**, stored for **a maximum of 15 minutes**  
- Automatically deleted after logout, inactivity, or when no longer needed

This data is used only to provide location‑based functionality and is never stored permanently.

---

### **2.3 Encrypted Messaging Data**
Messages are:

- **End‑to‑end encrypted**
- Encrypted with a **per‑account key** generated during account creation
- Delivered using the **recipient’s public key**
- Stored on our servers **only in encrypted form**
- **Unreadable to us** (zero‑access)

We cannot decrypt or access message content.

---

### **2.4 Session Data (Local Only)**
During an active session, the browser may temporarily store:

- Session keys  
- User state  
- Temporary identifiers  

This data is stored **only in your browser’s memory** (SharedWorker thread) and:

- Never leaves your device
- Is encrypted and locked after inactivity
- Is wiped immediately when the browser tab closes

This is considered **local processing**, not server‑side storage.

---

## 🧹 **3. Data Retention & Deletion**

We keep personal data only as long as necessary to provide the service.

- **Account data** → deleted immediately when you delete your account  
- **Temporary geolocation** → deleted after 15 minutes or logout  
- **Session data** → deleted when the browser tab closes  
- **Encrypted messages** → stored only as long as needed for delivery or user access  

Once deleted, data cannot be recovered.

---

## 🛡️ **4. How We Protect Your Data**

We use modern security practices, including:

- **bcrypt hashing** for passwords  
- **End‑to‑end encryption** for messages  
- **Zero‑access architecture** (we cannot decrypt your messages)  
- **Transport encryption (TLS)** for all network communication  
- **Session locking** after inactivity  
- **Automatic memory wiping** on session end  

We continuously improve our security measures to meet or exceed international standards.

---

## ⚖️ **5. Legal Basis for Processing**

Depending on your jurisdiction, our processing relies on one or more of the following principles:

- **Contract necessity** — to provide the messaging service  
- **User consent** — for optional features like geolocation  
- **Legitimate interest** — to maintain security and prevent abuse  
- **Compliance with legal obligations** — responding to lawful requests  

We do **not** sell, rent, or share your data with third parties.

---

## 📨 **6. Law Enforcement Requests**

Because of our zero‑access design:

- We cannot provide message content  
- We cannot decrypt user data  
- We can only provide the minimal account information we store (e.g., email)

We comply with lawful requests but cannot provide data we do not have.

---

## 🌐 **7. International Data Transfers**

If data is processed outside your country, we ensure appropriate safeguards such as:

- Standard contractual clauses  
- Adequate protection assessments  
- Secure encryption  

We follow internationally recognized transfer principles.

---

## 🧑‍💻 **8. Your Rights**

Depending on your jurisdiction, you may have rights such as:

- Access to your personal data  
- Correction of inaccurate data  
- Deletion of your account and data  
- Restriction of processing  
- Data portability  
- Withdrawal of consent  

You can exercise these rights through your account settings or by contacting us.

---

## 📞 **9. Contact**

If you have questions about privacy or data protection, you can reach us at:

**Email:** {{YOUR CONTACT EMAIL}}  
**Responsible Entity:** {{YOUR COMPANY / OPERATOR NAME}}  

---

## 🧭 **10. Updates to This Document**

We may update this page to reflect changes in technology, regulations, or our service.  
The “Last updated” date at the top will always show the current version.
