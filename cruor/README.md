# Cruor

*Cruor* (Latin: "blood") is a trusted platform that makes blood donation easier, more engaging and more rewarding — connecting donors, blood banks, hospitals, sponsors and verified charities.

> One act of generosity can create another.

This is the **first iteration (MVP)** of the PRD: a working web app (mobile-first, installable as a PWA), a JSON API, and an **Android demo APK** that runs entirely on the phone.

## Quick start

Requires **Node.js 22.13+**. The server itself has no npm dependencies; `npm install` is only needed for tests of the on-device stack and the Android build.

```bash
npm start          # http://localhost:3000 — seeds demo data on first run
npm install && npm test   # API tests: server stack + on-device stack
npm run seed       # wipe data/cruor.db and reseed
```

Demo accounts (password `cruor-demo-1`):

| Role  | Login              | What to try |
|-------|--------------------|-------------|
| Donor | `donor@cruor.test` | Find a center → book a slot → show the code/QR |
| Staff | `staff@cruor.test` | Cedar Regional Blood Bank: look up the donor's code → confirm donation |
| Admin | `admin@cruor.test` | Success metrics, moderate charity messages, audit log |

All seeded organisations (centers, sponsors, charities) are fictional placeholders.

## Android APK (demo)

The APK is a **self-contained demo**: the same API core runs inside the app on an SQLite database compiled to WebAssembly, saved on the phone. No server or internet connection is needed, and nothing leaves the device.

- **Get it:** every push that touches `cruor/` runs the *Cruor Android APK* GitHub Actions workflow (`.github/workflows/cruor-android.yml`). Download the APK from the run's **Artifacts**, or from the **cruor-latest** release on the repository.
- **Install:** open the APK on an Android 7+ phone and allow installs from your browser or files app when asked.
- **Try it:** the sign-in screen has one-tap **Donor / Blood bank staff / Admin** buttons, so one person can play every role on one phone. *Reset demo data* in the footer starts over.
- **Demo-only difference:** staff may verify an appointment *before* its day, so the whole journey can be tried in one sitting. The real server only allows it on the day (tests cover both).
- **Signing:** without secrets, CI signs with a throwaway debug key, so to install a newer build you may need to uninstall the old one first. For a stable key, add repository secrets `CRUOR_KEYSTORE_BASE64` (a base64-encoded `.jks`), `CRUOR_KEYSTORE_PASSWORD`, `CRUOR_KEY_ALIAS` and `CRUOR_KEY_PASSWORD`; CI then builds a signed release APK.
- **Build locally** (needs the Android SDK and JDK 21): `npm run android:apk`, or `npm run android:sync` and open `android/` in Android Studio.

On-device encryption keys are stored next to the data in the app's private storage, so field encryption there is defence-in-depth only. That's fine for demo data; a production app would use the Android Keystore and a real server.

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
  core.js       API routes + business rules (platform-neutral)
  domain.js     eligibility, opening hours, slots, distance
  schema.js     SQLite schema
  seed.js       demo data
  router.js, normalize.js, settings.js   shared helpers
  app.js        Node HTTP adapter (static files + /api → core)
  server.js     Node entry point
  security.js   Node crypto (scrypt, AES-256-GCM, HMAC)
  db.js         node:sqlite driver
mobile/
  local-api.js          on-device backend: core + sql.js, persisted locally
  security.browser.js   same crypto via audited @noble libraries
  sqljs-adapter.js      makes sql.js look like node:sqlite
  build.mjs             bundles mobile/www for Capacitor
android/        Capacitor Android project
public/         dependency-free SPA (hash routing), PWA manifest
test/           node:test: server stack and on-device stack
```

Deliberately boring so it is easy to read and reason about. `src/core.js` is the single source of business rules: the Node server and the Android app both run it, just with different database and crypto drivers. Swapping the frontend for React Native/Flutter, or SQLite for Postgres, doesn't change the API.

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

1. **Connected mobile app** — the APK is an on-device demo. Next: point it at a hosted server, and add push notifications and an iOS build.
2. **Verification of contact details** — email/SMS OTP is not wired up yet.
3. **Partner onboarding** — centers, staff, sponsors and charities are seeded; an admin UI for onboarding and verifying partners is next.
4. **Postgres + migrations** for production, and per-center time zones.
5. **Sponsor budget accounting** — points are minted per donation; linking them to sponsor-funded pools comes with the sponsor marketplace.
6. **Hospital integrations** (blood stock levels → shortage alerts) — a Future Feature in the PRD.
7. **Compliance review** (local privacy and healthcare regulations) before any real donor data is collected.
