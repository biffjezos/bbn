# bOOmbOOm.NOW

The greatest privacy-by-design location-based instant messaging and dating app in the Universe.

## The Project

The project was hosted and developed on [gitlab.com](https://gitlab.com/aspera-non-spernit/bbn) from 27 February 2026 to 8 March 2026, but moved to github due to better intergration with Claude Code.

## Features

bOOmnOOm.NOW! attempts a privacy-by-design architecture with minimal collection of persona data.

**Note:** The app is under development. The actual time scopes, encryption, hashing machanisms may change without notice.

- E2EE for User-to-User instant messaging.
- Server stores hashed passwords (with salt), encrypted private keys, plain public keys
- TTL-based auto-deletion of:
  - instant messages after 4 hours
  - location information after 15 minutes of inactivity
- Decrypted private keys live only in the memory of a SharedWorker thread (in the browser) and will be locked after 30 seconds of inactivity (unlocking needs new password check). Keys are wiped on tab-close.
- JWT protected authentication and middle layer services.
- Upgradable database layout by migration-service (currently schemaless mongodb)
- Planned: Hashed eMail address (lost passwords, lost access + Auto-Delete of inactive accounts after 90 days)

## Technology

### Frontend / UI

- Github Pages
- Jekyll SSG + Thymeleaf templating
- CSS + Bootstrap library

### Middle Layers

- Microservices architecture (gateway server, auth, fav, loc, msg, migr, tiers, usr)
- node.js

### Persistence Layer

- mongodb (+ redis planned)

## Live Demo

The ```dev``` main branch and the ```claude**``` branches automatically deploy to [https://biffjezos.github.io/bbn](https://biffjezos.github.io/bbn). Due to lack of financing the services may not be running at the time of your visit. If you want to use bOOmbOOm.NOW! - donate!

### Donate

If you would like to see this project going forward and be live - donate. 

The current financial expenditure amounts to 26,42€ per month.

- 21,42€ Claude Code as Developer
-  5,00€ railway.com to run the micro-services and the persistence layer (current: mongodb -> redis + mongodb)
- ??.??€ Building efforts by a real human

You can donate by:

- Apple Pay
- Credit (Debit) Card
- revolut 

Visit [https://biffjezos.github.io/bbn/donate/](https://biffjezos.github.io/bbn/donate/), add the amount you wish to donate enter a note if you want to be named as donor.

### Future Plans

- Port from node.js to rust
- Adding a redis db for the location- and the instant messaging service.
- Improving user expiernce by developing a more robust, privacy-by-design architecture and more fun features.