
# bOOmbOOm.NOW! – Living Strategy & Development Document

**Document owner:** AI co‑founder / strategy agent  
**Founder:** Dan  
**Created:** 2026-03-14  
**Document type:** Living document (strategy + task system + discussion log)

---

# 0. Origin of This Document

This document was created based on the founder request:

> Create a single downloadable document (Markdown) that contains the strategy, decisions, tasks, and open questions for the project. The document should allow the founder and AI agents to collaborate, add notes, check off tasks, and understand the reasoning behind every decision.

This document therefore serves several purposes simultaneously:

1. Project strategy
2. Technical planning
3. Decision log
4. Task / ticket system
5. Discussion area for alternative approaches

Every strategic recommendation includes a **rationale** explaining *why the suggestion exists* so future contributors can challenge or improve decisions.

---

# 1. Project Overview

## Product name

**bOOmbOOm.NOW!**

## Concept

A **privacy‑first, proximity‑based instant messaging and meeting platform**.

Users can see and communicate with **other users who are physically nearby in real time**.

Typical discovery radius:

- a few hundred meters
- up to several kilometers depending on tier

Example use cases:

- meeting people in nightlife districts
- meeting travelers
- spontaneous dates
- meeting people at festivals
- meeting people at conferences
- social interaction in dense urban areas

---

# 2. Core Product Philosophy

## Real‑time proximity

Users interact with **people who are physically nearby right now**.

### Rationale

Most social platforms connect people across distance and time.  
This app instead answers the question:

> “Who near me right now wants to interact?”

The product only becomes valuable when **multiple users exist within the same physical area simultaneously**.

Therefore density is the central design constraint.

---

## Ephemeral interaction

Messages disappear after **4 hours**.

Location history is not stored long‑term.

### Rationale

Ephemeral systems reduce:

- privacy risk
- legal liability
- long‑term database storage

They also encourage spontaneous behavior because users know interactions are temporary.

---

## Minimal identity

Users are mostly anonymous.

Current identity system:

- non‑verified email identifier
- optional profile

### Rationale

Low friction onboarding is critical for spontaneous environments such as nightlife or events.

However anonymity increases abuse risk, so moderation tools must exist.

---

# 3. Current Technical Architecture

## Application type

Web application accessible via browsers.

Potential issues:

- Safari compatibility due to shared worker thread support.

---

## Backend

Architecture:

- HTTP gateway server
- internal microservices
- WebSocket communication
- MongoDB database

---

## Hosting

Current infrastructure:

- 1 GB RAM VPS
- several internal microservices
- MongoDB

Cost:

~$5 per month.

Estimated capacity:

~50 concurrent users.

### Rationale

Infrastructure should remain extremely cheap during early development.

Scaling before real users exist would waste resources.

---

# 4. Current Feature Set

## Discovery

Users can see nearby users.

Discovery radius configurable via tier system.

---

## Messaging

Messaging requires **mutual likes**.

If either user unlikes, messaging stops.

### Rationale

Mutual likes act as a built‑in spam filter and prevent unsolicited messages.

---

## Message lifecycle

Messages auto‑delete after **4 hours**.

### Rationale

Supports privacy positioning and keeps infrastructure lightweight.

---

## Location storage

Only most recent location stored.

Deleted after **15 minutes of inactivity**.

### Rationale

Minimizes risk of location tracking abuse.

---

# 5. Safety Features Required

## Block feature

Task

- [ ] Implement block system

### Rationale

Even though messaging requires mutual likes, blocking is still required.

Reasons:

1. Users may not want specific people to see their location on the map.
2. Prevent repeated re‑matching attempts.
3. Prepare for future features like group chats.

---

## Report feature

Task

- [ ] Implement report system

### Rationale

Allows the system to detect harassment, spam bots, or abusive behavior.

Even without moderators, reports can inform automated responses.

---

## Rate limiting

Task

- [ ] Implement message rate limiting

### Rationale

Protects system from spam attacks and server overload.

---

# 6. Cold‑Start Problem

Proximity apps suffer from **empty network syndrome**.

If users open the app and see nobody nearby, they leave permanently.

### Strategy

Launch in **small dense locations first**.

Examples:

- nightlife streets
- university campuses
- conferences
- festivals

Goal:

20–50 concurrent users within a few hundred meters.

---

# 7. Early Market Selection

Because the interface is English only, choose English‑friendly environments.

Suggested markets:

- United Kingdom
- Ireland
- Netherlands
- Sweden
- Norway
- Denmark
- Berlin tech community

Avoid initially:

- France
- Spain
- Italy
- Japan
- South Korea

### Rationale

Language friction kills early adoption.

---

# 8. Growth Without Budget

## Venue activation

Bars or cafés promote the app.

Example:

“Meet someone from the app here and get a drink discount.”

Tasks

- [ ] venue account system
- [ ] venue map markers

### Rationale

Venues gain customers and users gain safe meeting places.

---

## Event launches

Events concentrate strangers already open to interaction.

Examples:

- tech meetups
- festivals
- conferences

Tasks

- [ ] identify first test event

---

## QR onboarding

Posters linking to the web app.

Tasks

- [ ] generate QR codes
- [ ] design poster

### Rationale

Physical discovery is ideal for proximity apps.

---

# 9. Monetization

## Premium tiers

Free:

basic discovery

Plus (~$2/month):

extended radius

Pro (~$5/month):

unlimited radius

### Rationale

Low infrastructure costs mean even small revenue covers expenses.

---

## Venue accounts

Venues pay monthly for map visibility.

Example:

$10–20/month.

### Rationale

Businesses benefit from attracting customers.

---

# 10. Infrastructure Scaling

Phase 1:

50 users — current VPS

Phase 2:

500 users — 2GB server + Redis

Phase 3:

2000+ users — clustered services

### Rationale

Scale gradually with real demand.

---

# 11. Legal Requirements

EU operation requires:

- privacy policy
- terms of service
- data deletion mechanism

### Rationale

Even minimal data systems must comply with EU privacy regulation.

---

# 12. Milestones

Milestone 1:

Launchable prototype (20 concurrent users)

Tasks

- [ ] block system
- [ ] report system
- [ ] rate limiting
- [ ] push notifications

Milestone 2:

$10 revenue/month

Milestone 3:

100 active users

Milestone 4:

$2000 monthly founder income

---

# 13. Open Questions

## Map visibility model

Questions

- Are users always visible on the map?
- Should visibility depend on likes?

Notes:

-

---

## Moderation data retention

When reports occur:

Should messages be stored temporarily or deleted immediately?

Notes:

-

---

# 14. Founder Task List

Immediate priorities

- [ ] implement block feature
- [ ] implement report feature
- [ ] implement rate limiting
- [ ] add push notifications
- [ ] select first launch location

Notes:

-

---

# 15. Change Log

v0.2 – expanded document with rationales and collaborative design.
