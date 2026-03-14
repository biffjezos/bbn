# bOOmbOOm.NOW! – Strategy & Development Document

**Document owner:** AI co‑founder  
**Founder:** User  
**Created:** 2026-03-14  

---

## 0. Origin of This Document

User request:

> “Create a single document I can download (preferably Markdown). Include everything we discussed so far. Make sections where I can add notes or provide information. Include checklists and items I can mark as done, similar to a ticket system. You manage the document, request information from me, and tell me what to do next.”

This document is designed to evolve continuously.

---

# 1. Project Overview

**Product name:** bOOmbOOm.NOW!

**Concept:**  
Privacy‑first, proximity‑based instant messaging and meeting app.  
Users can see and interact with people **physically nearby in real time**.

**Key characteristics**

- Hyper‑local discovery (hundreds of meters to a few km)
- Ephemeral communication
- Strong privacy defaults
- Real‑time interaction
- Web application (currently)

---

# 2. Core Product Principles

### Privacy by design

Implemented:

- End‑to‑end encrypted messages
- Messages auto delete after 4 hours
- No phone verification required
- No email verification required
- Location history limited to last/current location
- Location deleted after 15 minutes inactivity

### Identity

- Non‑verified email identifier
- Optional profile creation

---

# 3. Current Feature Set

## User Discovery

- Nearby users visible
- Radius configurable by tier

## Messaging

- Real‑time messaging
- Mutual “like” required
- Unliking stops messaging
- Messages auto delete after 4 hours

## Location

- Real‑time location updates
- No long‑term storage

## Infrastructure

- Microservice architecture
- Web application
- HTTPS + WebSocket communication
- MongoDB

### Hosting

- 1 GB RAM server
- Approx cost: $5/month
- Estimated capacity: ~50 concurrent users

---

# 4. Missing Critical Features

These should be implemented before public launch.

## Safety

- [ ] Block user
Notes:

-

---

- [ ] Report user
Notes:

-

---

## Anti‑abuse

- [ ] Message rate limiting
Notes:

-

---

- [ ] Spam detection basic rules
Notes:

-

---

## UX improvements

- [ ] Push notifications
Notes:

-

---

- [ ] Online indicator
Notes:

-

---

- [ ] Temporary group chats
Notes:

-

---

# 5. Market Positioning

Positioning recommendation:

**“Meet people right now within 500 meters.”**

Not primarily a dating app.  
Instead:

**Real‑time proximity social radar.**

Use cases:

- nightlife
- bars
- festivals
- campuses
- conferences
- travelers

---

# 6. Cold‑Start Strategy

Biggest risk: **empty map problem**.

Users opening the app and seeing nobody nearby will not return.

Strategy:

Launch **very small geographic zones** first.

Examples:

- single nightlife street
- university campus
- conference venue
- festival

Goal:

20–50 concurrent users within ~500m.

---

# 7. Launch Geography

Because the app is English only, prioritize English‑friendly environments.

Good early markets:

- UK
- Ireland
- Netherlands
- Sweden
- Norway
- Denmark
- Berlin startup areas

Avoid initially:

- France
- Spain
- Italy
- Japan
- South Korea

---

# 8. Growth Strategy (No Budget)

## Venue Activation

Bars and cafés promote the app.

Example:

“Meet someone from the app here and get 10% off drinks.”

Checklist

- [ ] Define venue account type
- [ ] Create venue badge on map
- [ ] Create venue promotion UI

Notes:

-

---

## Event Launches

Ideal environments:

- tech meetups
- festivals
- student orientation events
- conferences

Checklist

- [ ] Identify first event location
- [ ] Prepare QR poster

Notes:

-

---

## QR‑Code Onboarding

Simple posters.

Example text:

SEE WHO IS NEAR YOU RIGHT NOW  
boomboom.now

Checklist

- [ ] Design poster
- [ ] Generate QR code
- [ ] Print copies

Notes:

-

---

# 9. Monetization Strategy

Initial revenue options:

### Premium users

Example tiers

Free:
- basic nearby discovery

Plus (~$2/month):
- larger discovery radius

Pro (~$5/month):
- unlimited discovery range

Checklist

- [ ] Define tiers
- [ ] Implement payment gateway

Notes:

-

---

### Venue Accounts

Bars pay monthly for visibility.

Example price:

$10–20/month

Benefits:

- venue marker on map
- promotion message
- event announcements

Checklist

- [ ] Venue dashboard
- [ ] Venue listing on map

Notes:

-

---

# 10. Infrastructure Scaling

### Phase 1

Users: ~50 concurrent

Current infrastructure sufficient.

Cost:

~$5/month

---

### Phase 2

Users: ~500 concurrent

Upgrade:

- 2 GB RAM VPS
- Redis caching

Estimated cost:

~$15/month

---

### Phase 3

Users: ~2000+ concurrent

Changes:

- WebSocket gateway cluster
- Horizontal microservices
- CDN

Estimated cost:

$60–100/month

---

# 11. Legal Considerations

Operating in the EU requires:

- privacy policy
- terms of service
- data deletion process

Advantages of current design:

- minimal personal data
- ephemeral messages
- no location history

Checklist

- [ ] Privacy policy draft
- [ ] Terms of service
- [ ] GDPR data request endpoint

Notes:

-

---

# 12. Milestones

## Milestone 1 — Launchable product

Goal:

20 simultaneous users

Checklist

- [ ] block/report implemented
- [ ] rate limiting
- [ ] push notifications

Notes:

-

---

## Milestone 2 — Cover infrastructure

Target revenue:

$10/month

Possible sources:

- 10 premium users
- 1 venue partner

Notes:

-

---

## Milestone 3 — First traction

Target:

100 active users in one city

Revenue goal:

$100/month

Notes:

-

---

## Milestone 4 — Founder income

Target:

2000–3000 active users

Revenue:

$2000/month

Notes:

-

---

# 13. Open Questions (Founder Input Needed)

Answer these to guide next decisions.

## Product Design

- Is the app **map based** or **list based**?
- Should users always be visible on the map?
- Should visibility require mutual likes?

Notes:

-

---

## Moderation

If a user reports another user:

What should happen to the messages?

Options:

- store temporarily (7 days)
- store permanently
- delete immediately

Notes:

-

---

## Expansion

Future platforms:

- Native Android app?
- Native iOS app?
- Continue web‑only?

Notes:

-

---

# 14. Next Tasks for Founder

Immediate priorities.

- [ ] implement block system
- [ ] implement report system
- [ ] implement rate limiting
- [ ] add push notifications
- [ ] identify first launch hotspot
- [ ] design first QR poster

Notes:

-

---

# 15. Change Log

Use this section to track updates.

### v0.1

Initial strategy document created.

