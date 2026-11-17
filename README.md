# AthleteVerse (MVP build)

Sports venue, team and tournament platform. Source of truth: *AthleteVerse SRS v2.0*.
Status (2026-11-17): **the 49 approved MVP requirements are implemented and pass 652 automated tests on PostgreSQL 15**, with a browser check of the manager, staff and Super Admin screens at desktop and phone widths. **Not yet deployed**: hosting accounts are needed (see [docs/DEPLOY.md](docs/DEPLOY.md)). Start with [docs/FINAL_REPORT.md](docs/FINAL_REPORT.md); requirement-by-requirement evidence is in [docs/PHASE1_REQUIREMENTS_BASELINE.md](docs/PHASE1_REQUIREMENTS_BASELINE.md). The earlier [docs/MVP_COMPLETION_REPORT.md](docs/MVP_COMPLETION_REPORT.md) is kept for history and is out of date. The standalone [Expo health spike](spikes/expo-health/README.md) is untested.

## Prerequisites
Node >=22.22.0 (`.nvmrc` selects the Node 22 major line), npm 10+, Docker (for PostgreSQL 15) or any PostgreSQL 15+ with the `btree_gist` extension.

## First-time setup (about 5 minutes)
```bash
npm ci
cp apps/api/.env.example apps/api/.env     # Windows: copy apps\api\.env.example apps\api\.env
npm run db:up                              # PostgreSQL 15 + the athleteverse_test database
npm run db:generate                        # Prisma client
npm run db:init                            # init migration + integrity migration, applied  (ONCE, then commit apps/api/prisma/migrations)
npm run db:seed                            # reference data, settings, owner admin, demo venue, staff, 2 players
npm test                                   # shared tests + API tests (needs the database)
```
Demo accounts (all `Demo12345`): `manager@`, `staff@`, `player1@`, `player2@athleteverse.test`.
Owner admin: `owner@athleteverse.test` / `ChangeMe12345` (set `OWNER_*` in `.env`).

## Run the API
```bash
npm run dev:api          # http://localhost:3000/api/v1/health   and   /api/v1/docs   (OpenAPI: /api/v1/openapi.json)
```

Try the job runner locally (set `JOB_SECRET` in `apps/api/.env` first):
```bash
curl -i -X POST localhost:3000/api/jobs/tick                                  # 401: no secret
curl -s -X POST -H "X-Job-Secret: $JOB_SECRET" localhost:3000/api/jobs/tick   # returns a list of three timed jobs: auto-close bookings, restore credit, cleanup sessions
```
`GET /api/v1/health` never touches the database; add `?db=true` to check PostgreSQL (see finding F2 in docs/DEPLOY.md).

## New MVP flows (source-level additions)
- Player: `/bookings` (Upcoming/Past/Cancelled, cancellation preview, cash receipts); `/credit` (score, tier, ledger).
- Manager: `/register-manager`, email OTP and Super Admin approval; `/manager` (venues, courts and staff invitations); `/operations` (cash/no-show/unpaid and no-penalty cancellations).
- Super Admin: `/admin-login` (password + email OTP) and `/admin` (approve/reject with required reason).
- Staff: invited by a manager, `/accept-invite` sets a password, `/operations` sees ONLY their venue.
- Timed jobs: `/api/jobs/tick` auto-closes overdue bookings, restores blocked accounts after 30 days, and clears sessions. All three require live PostgreSQL to exercise.
- New API integration coverage: `apps/api/test/mvp-operations.test.ts` (requires PostgreSQL test DB).
- A standalone Expo health-check shell lives in `spikes/expo-health`; it does not alter the root npm lockfile.

## Run the web app
```bash
npm run dev:api     # terminal 1: API on http://localhost:3000
npm run dev:web     # terminal 2: web app on http://localhost:5173 (Vite forwards /api to the API, like the Vercel rewrite)
```
Open http://localhost:5173, create an account, and read the 6-digit code from the API terminal (console mailer). If your API runs elsewhere set `API_PROXY_TARGET`. `npm run build` builds the web app into `apps/web/dist`.

## Check the web app in a real browser (optional)
`npm test` uses a simulated browser. `scripts/browser-audit.mjs` drives a real one through the whole player journey (register, e-mail code,
profile) at 360, 320 and 1280 px and checks layout, 44 px touch targets, accessibility with real colour contrast, cookies and the "server is
starting up" message, saving screenshots. Setup and settings are at the top of the file.

## Try the sign-in flow locally
With `MAIL_PROVIDER=console` (the default in development) the verification code is printed in the API log instead of being e-mailed.
```bash
H='-H X-Client:web -H Content-Type:application/json'
curl $H -X POST localhost:3000/api/v1/auth/register -d '{"fullName":"Ali Khan","email":"ali@example.com","phone":"923001234567","password":"Passw0rdOK","acceptTerms":true,"confirmAge16":true}'
# read the 6-digit code from the API log, then:
curl -c jar.txt $H -X POST localhost:3000/api/v1/auth/verify-email -d '{"email":"ali@example.com","code":"123456"}'
curl -b jar.txt localhost:3000/api/v1/me
```
The seeded demo accounts (`manager@`, `staff@`, `player1@`, `player2@athleteverse.test`, password `Demo12345`) sign in at `POST /api/v1/auth/login`.

## Daily commands
| Command | What it does |
|---|---|
| `npm run lint` / `npm run typecheck` / `npm test` | Same three checks CI runs |
| `npm run db:migrate -- --name <what>` | After editing `schema.prisma` |
| `npm run db:seed` | Idempotent: never overwrites existing rows |
| `npm run dev:api` | API with auto-restart (`tsx watch`) |
| `npm run spike:db` / `spike:mail -w @athleteverse/api` | Deployment spikes S1 and S3 (docs/DEPLOY.md) |

## Database rules that Prisma cannot express
`apps/api/prisma/integrity.sql` holds the exclusion constraints (no double booking, layer 3), CHECKs, expression indexes and the
append-only audit trigger. `db:init` installs it as the first migration after `init`. From then on migrations are immutable:
change constraints with a new migration, never by editing `integrity.sql` or an applied migration.

## Tests refuse to touch a non-test database
`TEST_DATABASE_URL` must end in `_test` (the suite TRUNCATEs every table).

## API conventions (T3)
- Endpoints are declared with `defineRoute` (`apps/api/src/lib/route.ts`): one declaration gives validation, the OpenAPI document and the SRS ids. Register new routes in `src/routes.ts`.
- Errors always look like `{ error: { code, message, details? } }`; codes live in `packages/shared/src/errors.ts`.
- Never call `new Date()` or `Date.now()` in `apps/api/src` (ESLint blocks it): use `deps.clock.now()`.
- Every route declares `access` (`'public'` or `{ roles, statuses? }`): there is no way to add a route without deciding who may call it. `ctx.auth` is then the caller's identity. State-changing requests must carry an `X-Client` header (`web`, `android` or `ios`).
- Database work that changes more than one row goes through `withTx` (`src/db/tx.ts`). Lock rows in the order **users, courts, bookings** with `lockUser`, `lockCourt`, `lockBooking`; the helpers throw if you break the order.
