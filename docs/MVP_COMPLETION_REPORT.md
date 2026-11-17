# AthleteVerse MVP — Source Implementation and Verification Report

**Source documents:** Uploaded *AthleteVerse_SRS.pdf* (Version 2.0 detail, 41 actual PDF pages) and *PHASE 1: MVP Scope* (`Pasted text.txt`). The latter selects 49 of 128 requirements: 26 `Yes`, 23 `Yes†`; 76 `Later` and 3 `No`. The spreadsheet-like source-preserving full traceability table is [MVP_SCOPE_MATRIX.csv](MVP_SCOPE_MATRIX.csv).

**Delivery classification: SOURCE-IMPLEMENTED / RUNTIME NOT VERIFIED.** The extended project is **not certified release-ready**, SRS-complete, or proven end-to-end in a database-backed environment. It is an extension of the supplied `athleteverse-T1-T9.zip`, not a rewrite.

## What the existing T1–T9 source already contained

- A Node/Express modular-monolith API with explicit role authorization, Zod request/response schemas, JWT cookie sessions, idempotent job endpoint framework and OpenAPI endpoints.
- A Prisma/PostgreSQL database schema, GiST exclusion constraints for court/player booking overlap, settings, seed and CI/test framework.
- Player registration, email OTP, login, narrowed MVP profile completion, venue discovery/availability and concurrency-safe booking creation.
- React/Vite/Tailwind frontend for the original player registration, profile and booking creation flow.

## Newly implemented in source

| Workstream | Source-level additions | Key SRS/MVP coverage |
|---|---|---|
| Player booking history | `/me/bookings`; Upcoming/Past/Cancelled web tabs, booking details | FR-2.13 |
| Cancellation | Server-clock preview and cancellation; >6h free, 1–6h inclusive -10, <1h -20; transactionally release and ledger | FR-2.20, FR-2.21, FR-2.24 |
| Credit ledger | Central credit engine with score clamped to 0–100; score/tier/history endpoint and web page | FR-2.24, FR-2.27 |
| Front desk cash outcomes | Venue-scoped search; Paid/default amount, Unpaid -50, No-Show -30 from +15 min; Paid +5; receipt to booking owner | FR-2.16, FR-2.17, FR-2.23, FR-5.3 |
| Venue cancellation | Manager-only cancellation requires a reason; 0 player penalty, append-only audit | FR-2.22, FR-1.23 |
| Automatic jobs | 24-hour booking auto-close without penalty; blocked-player 30-day restoration to 20 and ledger; session cleanup | FR-2.18, FR-2.28, SRS Table 8 subset |
| Manager onboarding | Separate manager registration, OTP verification, pending-approval status; admin decision with audited reason | FR-1.1, FR-1.5, FR-1.9, FR-1.20, FR-1.23 |
| Super Admin login | Separate password + email OTP endpoints; admin inactivity rules | FR-1.9, SA-3 |
| Manager setup | Owned-venue listing/creation (3 limit), court creation (10 limit), city/sport/price validation | FR-1.13, FR-1.18, FR-5.8 |
| Staff lifecycle | Venue-scoped 48-hour invite, one-use password activation; staff list, disable/enable and active session revocation (5 per venue) | FR-1.6, FR-1.13, FR-1.18, FR-5.6 |
| React screens | My Bookings, Credit, Front Desk, Manager setup, Super Admin approval, manager registration, Admin 2FA, staff invitation | MVP web scope |
| Phone connectivity smoke test | **Standalone** `spikes/expo-health` Expo SDK 58 scaffold calls `/api/v1/health` with retry | MVP Sprint-0 shell ONLY; not a complete mobile client |

### Files to look at

- `apps/api/src/modules/bookings/booking-actions.ts`, `booking-view.ts`, `operations.routes.ts`
- `apps/api/src/modules/credit/credit.service.ts`
- `apps/api/src/modules/management/management.service.ts`, `management.routes.ts`
- `apps/api/src/modules/jobs/timed-jobs.ts`
- `apps/web/src/pages/{MyBookingsPage,CreditPage,OperationsPage,ManagerPage,AdminPage,ManagerRegisterPage,AdminLoginPage,AcceptInvitePage}.tsx`
- `packages/shared/src/schemas/{operations,management}.ts`
- `apps/api/test/mvp-operations.test.ts`
- `spikes/expo-health/README.md`

## Validation actually performed in the artifact editing environment

| Check | Result |
|---|---|
| Parse TS/TSX with TypeScript compiler frontend | **PASS**: 179 source files, 0 syntax errors, 0 unresolved relative imports (includes new standalone Expo app) |
| Execute cancellation time boundaries as extracted JavaScript | **PASS**: 8 boundary cases |
| Execute credit score clamp as extracted JavaScript | **PASS**: 5 cases |
| API unit and PostgreSQL integration tests | **NOT RUN**: package installation unavailable; no running PostgreSQL |
| Full typecheck, ESLint, production build | **NOT RUN**: required package dependencies unavailable |
| Expo app installation and device test | **NOT RUN**: could not download dependencies or use a phone |
| Performance load test at 10 attempts/s and 100 concurrent users | **NOT RUN**: requires running services and test data |

The original source's booking concurrency cases remain in `apps/api/test/bookings.test.ts`. Additional tests for API booking/cash/credit, onboarding, permission isolation and OTP approval were authored in `apps/api/test/mvp-operations.test.ts` **but have not passed an actual test runner yet**. Do not treat a written test as a passing test.

**Execution blocker:** Local Node version was `v22.16.0`; root `package.json` requires `>=22.22.0`. `npm ci` could not fetch required packages (`EAI_AGAIN`/network resolution), and the local offline cache lacked dependencies. No PostgreSQL instance or Docker was available. Hence the project cannot honestly be described as a fully verified MVP.

## Strict SRS versus approved first-phase scope

These are *pre-existing decisions in the MVP description*, not fixes of the full SRS:

- Manager, player and staff workflows: **responsive web only** for the real screens; the Expo scaffold is health-check only. Full Android/iOS workflows deferred.
- FR-1.14/FR-1.15: MVP player profile is narrowed to core personal information, city and DOB; sports/position/level/availability are deferred. **Not full SRS compliance**.
- Venue photos, map pin, map view, availability-search refinements, ratings and reviews deferred (M5/FR-2.1–2.3 and Table 11). **Not full SRS compliance**.
- FR-2.26 and FR-5.7/5.13: player credit-penalty disputes and manager review inbox deferred. Wrongly recorded outcomes have no full MVP dispute resolution. **A fairness/security risk requiring stakeholder acknowledgement**.
- Notifications (in-app bell/push/email events except existing OTP/invites and booking confirmation) deferred; cash confirmation and venue cancellation do not produce an in-app event. **Not full SRS compliance**.
- Password reset, manager rejection resubmission, account suspension/deletion, device/session management UI, reports, slot-block UI, notifications, and other `Later` rows remain deferred as listed in the scope matrix.
- Feature 3 (Teams) and Feature 4 (Tournaments) intentionally untouched; excluded from 49-item MVP target.

## Reproduction steps on a supported development computer

1. Install **Node >=22.22**, npm 10+, Docker with PostgreSQL 15+, or connect to PostgreSQL 15+ where `btree_gist` can be installed. Run all commands from the project root.
2. Run `npm ci` with internet access. Copy `apps/api/.env.example` to `apps/api/.env` and set the development values including `PLATFORM_TZ`, `WEB_BASE_URL=http://localhost:5173`, `JOB_SECRET`, and suitable demo email provider.
3. Start PostgreSQL: `npm run db:up` (if using Docker); then `npm run db:generate`, `npm run db:init`, and `npm run db:seed`. **Check the actual environment before initializing a database; do not point these commands at production**.
4. Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. Fix any issue that these reveal before deployment.
5. In separate terminals start `npm run dev:api` and `npm run dev:web`; follow `README.md` for initial demo users and email codes. From a player account test booking, cancellation, cash payment, receipt and credit ledger. From a new manager account test OTP, approval, venue, court and staff invite. From a staff account test venue-only bookings.
6. With a correctly configured secret call `POST /api/jobs/tick` and verify auto-close/credit-restoration with controlled DB data; do not rely on wall time alone. Confirm job idempotence.
7. From `spikes/expo-health` independently run `npm install`, set `.env` and `npx expo start`; check `GET /api/v1/health` against a reachable API using Android and iOS test devices.
8. Run the provided database-backed concurrency suite under CI and load-test before publicly demonstrating a **verified** release. Confirm exact versions, time zone/currency, sports, Terms/Privacy text, SMTP provider, and manager document policy from MVP Q1–Q4/SRS OI-1–OI-8.

## Production safety notes

- Development seed accounts/passwords in the original README must be changed; never use demo passwords on the public web.
- The local `console` email provider prints OTP codes to logs. Use a properly configured real provider for production.
- Never mark payment as proof of actual cash reception: the SRS explicitly says cash is recorded by venue staff, not processed by the platform.
- Keep `.env`, secret keys, local databases, user uploads and `node_modules` out of distributed ZIP files. This delivery intentionally includes only source/config examples and documentation.
- Do not claim 100% SRS compliance or passing tests without actual clean CI and PostgreSQL/device validation.
