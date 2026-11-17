# AthleteVerse MVP — Final Project Report

| | |
|---|---|
| Date | 2026-11-17 |
| Source of truth | *AthleteVerse SRS Version 2.0* (41 pages, 128 functional requirements) |
| Approved scope | 49 MVP requirements (26 Yes + 23 Yes†); 76 Later; 3 excluded (FR-1.25, FR-2.14, FR-4.20). Teams, Matches and Tournaments are Later; in-app messages are out of scope (SRS §1.2). |
| Evidence | Automated tests on PostgreSQL 15 (Docker), local browser check, `npm audit`. Requirement-by-requirement detail: [PHASE1_REQUIREMENTS_BASELINE.md](PHASE1_REQUIREMENTS_BASELINE.md) |
| Overall status | **Implemented and verified locally. Not deployed.** Deployment needs hosting accounts only the project owner can create. |

## 1. Status at a glance

| Category | Count | Meaning |
|---|---|---|
| Implemented and verified | 49 of 49 MVP requirements | Behaviour exercised by passing automated tests; Yes† items cover the approved slice only |
| Implemented but not verified | Production behaviour of all of the above | Nothing has run on Render, Vercel or Neon yet; e-mail delivery and real-device checks pending |
| Not implemented | None within the approved scope | |
| Excluded from MVP | 79 requirements | 76 Later + 3 No, per `MVP_SCOPE_MATRIX.csv` |

**Not claimed:** full SRS compliance (only the 49-requirement MVP), production readiness before a live check, mobile-app functionality (the Expo project is an untested health-check shell).

## 2. Implemented MVP features

**Players (web):** registration with e-mail OTP, login with lockout, profile, venue list with name/sport/city filters, venue page, availability with text labels, booking 1–3 hours with immediate confirmation and an 8-character code, My Bookings (Upcoming, Past, Cancelled), cancellation with the penalty shown first, cash receipts, credit score, tier and history.

**Arena Managers (web):** registration and Super Admin approval, venues/courts/prices set-up (limits 3/10), staff invitations (limit 5) and disabling, **manager home** (today's bookings by court, outcome missing, cash still to confirm), front desk with search, **paging**, cash outcome **with the amount received**, no-show, unpaid, cancellation with reason, **booking detail with status history**.

**Arena Staff (web):** invitation-only account, front desk for the assigned venue only, outcomes, booking history.

**Super Admin (web):** password + e-mail OTP sign-in, 15-minute inactivity sign-out, manager approval/rejection with an audited reason, **account list** with search, role and status filters (read-only).

**Every account:** list own signed-in sessions, sign out one or all others (API; the device screen is Later per scope).

**Platform rules enforced on the server and database:** three-layer double-booking guard (screen, row lock, PostgreSQL exclusion constraint), credit engine (0–100, each event once, same transaction), cancellation windows 0/−10/−20, No-Show −30 only after 15 minutes, Unpaid −50, Paid +5, tier booking limits 3/2/1/0, Blocked until the 30-day restore or the Super Admin, auto-close after 24 hours without penalty, append-only audit log, per-request role/status/ownership checks.

## 3. Work done in this engagement

| Stage | Commit(s) | Content |
|---|---|---|
| Baseline | `f5da316` | Imported the latest copy into `D:\MVP`, git initialised, Phase 1 requirements baseline |
| Stage 1 | `44b6fb1` | D1 fixed (front desk hid today's bookings after 200 old ones); tests for every untested MVP rule |
| Stage 2 | `fedc462` | Gaps G1–G4 built (sessions, booking history, manager home, accounts list); D2–D5 fixed |
| Browser check | `e237b92` | D6 (history order with the real clock) and D7 (44 px link targets) fixed |
| Stage 3 | `ec77984` + final commit | A2 block rule; front-desk paging; F1 phone navigation; time zone; D8 production invitation links; `body-parser` security patch; this report |

Defects found and fixed: D1–D8 and S1 (details in the baseline, section 5).

## 4. Database and API

- **Database:** PostgreSQL 15, Prisma 6.19.3, 15 tables (the remaining tables of the SRS's 26 belong to Later features), 2 migrations (`init`, `integrity_constraints`), exclusion constraints, CHECKs, append-only audit trigger. No schema change was needed in this engagement.
- **API:** Express 5, `/api/v1`, every route declared once with Zod validation, access rule, SRS ids and OpenAPI (`/api/v1/docs`). New in this engagement: `GET /me/sessions`, `POST /me/sessions/:id/revoke`, `POST /me/sessions/revoke-others`, `GET /operations/bookings/:id`, `GET /manager/home`, `GET /admin/accounts`. Changed compatibly: `GET /operations/venues/:venueId/bookings` now pages (adds `page`, `pageSize`, `total`; keeps `items`).

## 5. Testing results (2026-11-17, all executed)

| Check | Result |
|---|---|
| TypeScript typecheck (api, web, shared) | Pass |
| ESLint | Pass |
| Production build (web) | Pass |
| API tests (Vitest + Supertest, real PostgreSQL 15) | **412 / 412 pass** (34 files) |
| Web tests (Vitest + Testing Library, jsdom, axe accessibility) | **204 / 204 pass** (17 files) |
| Shared package tests | **36 / 36 pass** |
| Browser check (local, seeded data) | Manager, staff, Super Admin flows at 1280 px; layout and touch targets at 375 and 320 px |

SRS acceptance scenarios (Table 35) covered by automated tests: 1 (simultaneous booking), 2 (cancellation windows), 3 (no-show timing and double tap), 4 (tier limit; the tournament part is Later), 6 (cross-venue access refused with a log entry). Not applicable to the MVP: 5 and 10 (disputes and suspension are Later), 7–9 (tournaments), 11–14 (mobile app).

Not performed: load test (PERF-3: 100 users, 10 bookings/s), five-user usability test (USA-1), Playwright end-to-end tests, real Android/iOS devices, screen-reader walkthrough.

## 6. Security review

- Passwords hashed with bcrypt; 15-minute access tokens; HttpOnly, Secure, SameSite=Strict cookies; refresh-token rotation and revocation; lockout and rate limits on login, OTP and reset; Super Admin second factor and inactivity sign-out.
- Role, status and venue ownership checked on every request; a test scans every route so e-mail, phone and ID numbers are sent only on SRS-authorised routes (FR-1.16).
- Inputs validated with Zod; queries parameterised by Prisma; LIKE wildcards escaped in searches (D4).
- Secrets only in environment variables; production refuses to start without them, and now also without an https web address (D8).
- `npm audit --omit=dev`: `body-parser` denial-of-service patched (S1). **Accepted risk (S2):** `deepmerge-ts` inside the Prisma CLI, reached only at build time; the fix requires Prisma 7, outside the approved stack.

## 7. Deployment status

> **Changed 2026-11-17 (owner approved):** Render requires a payment card even for its free plan, and the budget is zero (C1). The API therefore runs as a **Vercel function in the same project as the web app** (`apps/api/src/vercel.ts`, `scripts/vercel-output.mjs`), with Neon in Singapore and the GitHub timer every 30 minutes. The packaged function was checked locally from an isolated folder. `render.yaml` remains as the alternative. The steps below describe the original Render plan; the current steps are at the top of [DEPLOY.md](DEPLOY.md).

**Not deployed.** The configuration is ready and guarded by tests: `render.yaml` (free plan, Node 22, migrations at build, liveness-only health check, generated secrets), `apps/web/vercel.json` (one origin through the `/api` rewrite), `.github/workflows/ci.yml` (Node 22, PostgreSQL 15) and `tick.yml` (timed jobs every 10 minutes).

**Owner actions required (in order):**
1. Create a GitHub repository and push `main`.
2. Create a Neon project; copy the pooled and direct connection strings.
3. Choose and set up an e-mail provider (Brevo or Resend) with a validated sender (OI-6).
4. Follow [DEPLOY.md](DEPLOY.md): Render blueprint (enter database URLs, mail settings, `WEB_BASE_URL`), seed the owner admin, Vercel project (replace the Render host in `vercel.json`), GitHub secrets `API_URL` and `JOB_SECRET`.
5. Then the live checks in DEPLOY.md: health, cookies through the rewrite, one booking, one invitation e-mail.

## 8. Known limitations

- **Later by scope:** teams, matches, tournaments, disputes (FR-2.26: a wrongly recorded penalty cannot be disputed in the MVP), notifications bell and push (bookings send only the confirmation e-mail), walk-in bookings, reviews, slot blocking, cash report, admin suspension/deletion, settings and master-data screens, device-session screen, mobile app.
- **Assumption:** platform time zone `Asia/Karachi` (OI-1). Change one line in `render.yaml` if wrong.
- **Phone layout:** a player's five navigation links take two rows (all visible, 44 px targets), making the sticky header taller on phones.
- **Open product question A3:** "Unpaid" is shown as a payment status; there is no separate flag to the manager.
- **Local runtime:** development machine on Node 24; the project and Render use Node 22 (A6).

## 9. Remaining defects

None known in the approved scope after the fixes above. Production behaviour is unverified until deployment.

## 10. Running the project locally

Prerequisites: Node 22 (Node 24 also works locally), npm 10+, Docker Desktop.

```bash
npm ci
npm run db:up            # PostgreSQL 15 in Docker
npm run db:generate
npm run db:deploy        # apply migrations to the database in apps/api/.env
npm run db:seed          # owner admin, demo venue, staff, two players
npm test                 # needs TEST_DATABASE_URL (database name ending in _test)
npm run dev:api          # http://localhost:3000/api/v1/health
npm run dev:web          # http://localhost:5173
```

Copy `apps/api/.env.example` to `apps/api/.env` first. Demo sign-ins: `manager@`, `staff@`, `player1@`, `player2@athleteverse.test` with `Demo12345`; Super Admin at `/admin-login` with the `OWNER_*` values from `.env`; with `MAIL_PROVIDER=console` the e-mail codes appear in the API log. Never use demo passwords outside your own machine.

## 11. Deployment and maintenance

- Deploy: [DEPLOY.md](DEPLOY.md). Pushing to `main` redeploys both services once connected.
- Schema changes only through new Prisma migrations; never edit an applied migration or `integrity.sql`.
- Keep the tick workflow enabled (timed jobs and keep-alive); re-enable it after 60 days without repository activity.
- Weekly database dump and one restore rehearsal before a demonstration (REL-2).
- Run `npm audit --omit=dev` before each release; revisit S2 when upgrading Prisma.
- Never run seed or migration commands against production from a laptop unless following DEPLOY.md; tests refuse any database whose name does not end in `_test`.
