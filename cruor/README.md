# Cruor

*Cruor* (Latin: "blood") is a trusted platform that makes blood donation easier, more engaging and more rewarding — connecting donors, blood banks, hospitals, sponsors and verified charities.

> One act of generosity can create another.

This is the **first iteration (MVP)** of the PRD: a working web app (mobile-first, installable as a PWA) plus a JSON API that a native app can later reuse.

## Quick start

Requires **Node.js 22.13+**. There are no npm dependencies.

```bash
npm start          # http://localhost:3000 — seeds demo data on first run
npm test           # API tests (in-memory database)
npm run seed       # wipe data/cruor.db and reseed
```

Demo accounts (password `cruor-demo-1`):

| Role  | Login              | What to try |
|-------|--------------------|-------------|
| Donor | `donor@cruor.test` | Find a center → book a slot → show the code/QR |
| Staff | `staff@cruor.test` | Cedar Regional Blood Bank: look up the donor's code → confirm donation |
| Admin | `admin@cruor.test` | Success metrics, moderate charity messages, audit log |

All seeded organisations (centers, sponsors, charities) are fictional placeholders.

## What's in v1 (PRD → implementation)

| PRD requirement | Status |
|---|---|
| Register with email **or** phone, secure login | ✅ scrypt password hashes, hashed session tokens, login rate limiting |
| Blood type, location, eligibility info | ✅ Blood type, city + optional geolocation, DOB/weight/last donation pre-check |
| Dashboard: upcoming appointments, history, points, reminders | ✅ Reminders computed live (upcoming slot, eligible again, profile gaps) + in-app notifications |
| Search nearby centers, opening hours, book | ✅ Distance sorting, text search, 30-min slots with capacity, one active booking per donor |
| Verification by QR / staff portal / code | ✅ Single-use 8-char code + QR; staff portal with camera scanning (where `BarcodeDetector` is supported) |
| Donor automatically receives points | ✅ Atomic transaction: donation + ledger + thank-you note + audit entry |
| Redeem sponsor rewards / donate to approved charities / save | ✅ Vouchers with stock, wishlist-style causes via verified charities, points persist |
| Role-based permissions | ✅ donor / staff (bound to one center) / admin |
| Encrypted user data | ✅ Phone + date of birth AES-256-GCM at rest; blind index for phone login |
| Audit logs for verification | ✅ Append-only (enforced by DB triggers) |
| Accept no unverified charities, no fake claims | ✅ Unverified charities/centers never listed; staff can only verify codes for **their** center, **on the day**, **once** |

Pulled forward from the post-MVP "human connection" layer, because they were cheap and reinforce trust:

- **Thank-you notes** from the blood bank after verification, and **impact updates** that never identify recipients.
- **Wishlist-based charity paths** (meal, school supplies, tree, holiday gift) — donors choose a path, never an individual.
- **Charity-mediated messages**: optional, 280 chars, links/handles/phone numbers blocked, moderated by an admin who **cannot see the sender's identity**.

### Ethics guardrails built in

- Points are labelled sponsor-funded with **no cash value** — Cruor never pays for blood.
- Eligibility is a **general pre-check**, always shown with a disclaimer; staff make the final call. Bookings are blocked only for clear failures (age, weight, the 56-day interval).
- **Deferral** is a first-class outcome: staff can record it, the donor gets a kind message, no points, and no medical detail is stored.
- "People potentially helped" is shown as an estimate, never as a record of specific recipients.

## Architecture

```
src/
  server.js     HTTP entry point
  app.js        API routes + business rules
  domain.js     eligibility, opening hours, slots, distance
  security.js   password hashing, field encryption, codes
  db.js         SQLite schema (node:sqlite)
  seed.js       demo data
public/         dependency-free SPA (hash routing), PWA manifest
test/           node:test API tests
```

Deliberately boring and dependency-free so it is easy to read and reason about. The API is the contract — swapping the frontend for React Native/Flutter, or SQLite for Postgres, doesn't change it.

### Configuration

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` | |
| `CRUOR_DB` | `data/cruor.db` | SQLite file |
| `CRUOR_DATA_KEY` | dev placeholder | **Required in production.** Key for field encryption |
| `CRUOR_INDEX_KEY` | dev placeholder | **Required in production.** Key for blind indexes |
| `CRUOR_POINTS_PER_DONATION` | `100` | |
| `NODE_ENV` | | `production` refuses to start without keys |

Opening hours and slots use the server's local time zone — run the server in the region's time zone (`TZ=Asia/Beirut npm start`).

## Known gaps / next steps

These are for the engineering discussion in the PRD ("Technical Considerations"):

1. **Native apps** — the SPA is installable, but push notifications need a native shell or Web Push + a scheduler.
2. **Verification of contact details** — email/SMS OTP is not wired up yet.
3. **Partner onboarding** — centers, staff, sponsors and charities are seeded; an admin UI for onboarding and verifying partners is next.
4. **Postgres + migrations** for production, and per-center time zones.
5. **Sponsor budget accounting** — points are minted per donation; linking them to sponsor-funded pools comes with the sponsor marketplace.
6. **Hospital integrations** (blood stock levels → shortage alerts) — a Future Feature in the PRD.
7. **Compliance review** (local privacy and healthcare regulations) before any real donor data is collected.
