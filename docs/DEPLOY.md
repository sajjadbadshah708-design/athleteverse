# Deploying AthleteVerse on free tiers (T4)

Targets: web on **Vercel**, API on **Render**, database on **Neon**, cron on **GitHub Actions** (SRS 3.3, Tables 7 and 8).
Everything in this repository is built and tested. The steps below need **your accounts** and cannot be done from code.

## 0. Findings that shaped this task (checked October 2026)

| # | Finding | Consequence in the code |
|---|---|---|
| F1 | **Render free:** a web service sleeps after 15 minutes without inbound traffic. Each workspace gets 750 free instance hours a month, counted only while a service runs; when they run out, all free services are suspended until the next month. Render calls the health-check path **every few seconds** (5 s timeout) and restarts the service after 60 s of failures. *(render.com/docs/free, /docs/health-checks)* | The 10-minute tick keeps the API awake, which uses about 744 of 750 hours: **one always-on free service per Render workspace**. |
| F2 | **Neon free:** 100 compute-hours per project per month, 0.5 GB storage, compute suspends after 5 minutes without activity (cannot be switched off on the free plan), and when the quota is used up compute stays suspended until next month. *(neon.com/faqs/free-plan-limits-and-quotas)* | `GET /api/v1/health` does **not** query the database. Otherwise Render's polling keeps Neon awake: 0.25 CU x 730 h is about 182 CU-hours, so the quota would end around day 16. Add `?db=true` for a real database check. My arithmetic, to be confirmed by spike S4. |
| F3 | **Regions.** Render: oregon, ohio, virginia, frankfurt, singapore (a service's region cannot be changed later). Neon: aws-us-east-1/2, aws-us-west-2, aws-eu-central-1, aws-eu-west-2, aws-ap-southeast-1 (Singapore), aws-ap-southeast-2, aws-sa-east-1. | Put API and database in the same region, nearest your users. `render.yaml` defaults to `singapore`: change it before the first deploy if OI-1 says otherwise. |
| F4 | **Mail.** Resend free: delivers only to your own account address until you verify **a domain you own** (otherwise HTTP 403); 100 a day, 3,000 a month. Brevo free: 300 a day including the transactional API; the sender address must be validated in Brevo. | Resend is unusable for OTP to real users without a domain (zero budget, C1). **Brevo is the candidate.** Whether Brevo mail from your sender address reaches inboxes rather than spam is exactly what spike S3 measures. |
| F5 | GitHub Actions scheduled workflows are best effort (they can start late) and are paused on a public repository after 60 days without activity. *(from Phase 1; not re-verified)* | `tick.yml` retries once and fails loudly. Spike S5 measures the real cadence. |
| F6 | Vercel Hobby is for non-commercial use (SRS Table 7); forwarding `/api/*` to an external host with `rewrites` is standard. *(not re-verified)* | Fine for an academic pilot. Netlify or Cloudflare Pages are drop-in alternatives. |
| F7 | **Signals through npm.** Tested here: with `npm run start` a SIGTERM sent to npm never reaches the server (no shutdown log line, the process keeps running); with `exec node --import tsx ...` it does and the server stops gracefully. | `render.yaml` starts Node directly. `tsx` therefore lives in `dependencies`, and a test pins the start command. |

## 1. Decide before you start

1. **Region pair** for Render and Neon (F3).
2. **Mail:** do you own a domain? If not, Brevo with a validated single sender is the only free route (F4).
3. **Repository visibility:** a private repository avoids the 60-day schedule pause (F5) but check the Actions minutes of your GitHub plan (a tick takes well under a minute).

## 2. Neon (database)

1. Create a project in your chosen region, PostgreSQL 15 or newer (16 or 17 is fine).
2. From the **Connect** dialog copy two connection strings: **pooled** (switch "Connection pooling" on; the host contains `-pooler`) and **direct** (switch it off).
3. Apply the migrations from your machine (Render repeats this on every deploy):
   ```bash
   DATABASE_URL="<pooled>" DIRECT_URL="<direct>" npm run db:deploy
   ```
4. Seed (owner admin is mandatory in production; demo data is an explicit opt-in):
   ```bash
   NODE_ENV=production DATABASE_URL="<pooled>" OWNER_EMAIL="you@example.com" OWNER_PHONE="92xxxxxxxxxx" \
     OWNER_PASSWORD="<strong password>" SEED_DEMO=true SEED_PASSWORD="<demo password>" npm run db:seed
   ```
   On Windows use Git Bash, or put the variables in `apps/api/.env` temporarily and delete them afterwards.

## 3. Render (API)

1. Edit `region` in `render.yaml` if needed, commit and push.
2. Render dashboard -> **New** -> **Blueprint** -> select the repository. When asked, paste `DATABASE_URL` (pooled) and `DIRECT_URL` (direct).
   Also enter `MAIL_PROVIDER` (`brevo`, `resend` or `console`), `MAIL_API_KEY` and `MAIL_FROM`. With `console` the verification codes appear in the Render **Logs** instead of an inbox: acceptable for a supervised demo, not for real users. The other two values are ignored then, but Render asks for them: enter any text.
   Enter `WEB_BASE_URL` = the public address of the Vercel site, for example `https://athleteverse.vercel.app` (no trailing slash). Staff invitation e-mails link there; the API refuses to start in production without an `https` address. If you create the Render service before the Vercel site exists, deploy Vercel first (section 4) or enter the expected `https://<project>.vercel.app` address now.
   `PLATFORM_TZ` is preset to `Asia/Karachi` in `render.yaml` (OI-1, assumed); change it there if the launch city differs.
3. After the first deploy, open **Environment** and copy the generated `JOB_SECRET` (you need it in step 5). `JWT_SECRET` and `OTP_PEPPER` are generated too; do not copy them anywhere.
4. Check: `curl https://<service>.onrender.com/api/v1/health` returns `"status":"ok"`.

## 4. Vercel (the web app)

1. In `apps/web/vercel.json` replace `REPLACE-WITH-YOUR-RENDER-HOST.onrender.com` with your Render host, commit and push.
2. Vercel -> **Add New Project** -> import the repository -> set **Root Directory** to `apps/web`. Leave the build settings: `vercel.json` defines them (it installs from the repository root, then builds the Vite app into `dist`). Under **Settings -> General** set **Node.js Version** to 22.x (React Router 8 needs Node 22.22 or newer) and keep "Include source files outside of the Root Directory" switched on; the build needs `packages/shared`.
3. **Done when (part 1):** open `https://<site>.vercel.app`. It shows the **Sign in** page (not an error), and `curl https://<site>.vercel.app/api/v1/health` returns the API's health JSON through the rewrite. If the build fails with "cannot find @athleteverse/shared", the "source files outside the Root Directory" setting is off.

## 5. GitHub (cron)

1. Repository -> **Settings** -> **Secrets and variables** -> **Actions** -> add `API_URL` (the Render URL, no trailing slash) and `JOB_SECRET` (copied in step 3.3).
2. **Actions** -> **tick** -> **Run workflow**. It must finish green.
3. **Done when (part 2):** a call without the secret is refused:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<service>.onrender.com/api/jobs/tick     # 401
   curl -s -X POST -H "X-Job-Secret: <secret>" https://<service>.onrender.com/api/jobs/tick           # {"ok":true,...}
   ```

## 6. Spikes: run them, then record the answers

| Spike | How | Pass criteria | It decides |
|---|---|---|---|
| **S1 database** | `DATABASE_URL="<pooled>" DIRECT_URL="<direct>" npm run spike:db -w @athleteverse/api` (needs the demo seed) | Every line PASS: `btree_gist` and the 3 exclusion constraints present, pooled and direct hosts differ, 30 concurrent queries, `FOR UPDATE` blocks, **10 simultaneous bookings give exactly one winner**, a real deadlock is retried through the pooler | Whether the booking integrity rules hold on Neon's pooler. If a line fails, send me the output before T5. |
| **S2 proxy chain** | In Render set `ENABLE_SPIKES=true` (it redeploys). Then `curl -s -H "X-Job-Secret: <secret>" <url>/api/v1/_spike/proxy` against (a) the **Render URL** (the path the mobile app will use) and (b) the **Vercel URL** (the web path). Compare `ipIfTrustHopsIs` with your real public IP (`curl ifconfig.me`). Switch `ENABLE_SPIKES` back to `false`. | For each path, note the hop count N whose value equals your real IP | `TRUST_PROXY_HOPS` and the rate-limit design in T5. **Expect the web path to need a larger N than the direct path.** One number cannot be right for both: trusting too many hops lets a direct caller spoof `X-Forwarded-For` (test `spike.test.ts` shows it). If the two differ, T5 keys the login limiter on e-mail plus IP and treats the IP limit as soft. |
| **S3 mail** | `MAIL_PROVIDER=brevo MAIL_API_KEY=... MAIL_FROM="AthleteVerse <your validated sender>" npm run spike:mail -w @athleteverse/api -- you@gmail.com friend@outlook.com another@yahoo.com` | All ACCEPTED **and** the mail is in the inbox (not spam) on each; "show original" shows SPF and DKIM pass | Which provider and sender address T5 uses. If mail lands in spam, you need an own-domain sender (OI-6). |
| **S4 cold start and quota** | Disable the `tick` workflow for 30 minutes. Then `curl -s -o /dev/null -w "%{time_total}s\n" <vercel-url>/api/v1/health` (API wake) and the same with `?db=true` (database wake). After 24 hours with the tick enabled read the project's compute hours in the Neon console and multiply by 30. | API wake about a minute at worst (PERF-2); Neon projection well under 100 compute-hours | Whether the "starting up" banner copy is right, and whether the tick may touch the database every 10 minutes (decision Q5 below). |
| **S6 cookies through the rewrite** (after T5 is deployed) | `curl -i -X POST -H "X-Client: web" -H "Content-Type: application/json" -d '{"email":"player1@athleteverse.test","password":"<demo password>"}' https://<site>.vercel.app/api/v1/auth/login` | Two `set-cookie` lines on the **Vercel** URL: `av_access=...; Path=/api/v1; HttpOnly; Secure; SameSite=Strict` and `av_refresh=...; Path=/api/v1/auth; ...`, with **no** `Domain=` attribute. Then in a browser: sign in on the placeholder or any page you call the API from and check the cookies are stored for the Vercel domain. | Whether cookie sign-in works through the rewrite at all (Phase 2's whole "single origin" design). If the cookies are missing, send me the headers before T6. |
| **S5 cron cadence** | After a few hours open the **tick** run history. | Runs about 10 minutes apart, no long gaps | Whether GitHub's cron is reliable enough as the only scheduler. |

**Why S2 matters more now.** T5 adds per-IP rate limits (register, e-mail code, sign-in). With `TRUST_PROXY_HOPS=0` every web user shares the proxy's address, so one bucket serves everybody; the per-e-mail limits and the five-failure account lock keep working, but the IP limits become useless or, worse, block real users. `server.ts` logs a warning in production while it is 0.

**Decision Q5 for T17.** The tick will query the database once jobs exist. Neon stays awake 5 minutes after each query, so a query every 10 minutes keeps it awake about half the time: roughly 0.25 CU x 365 h, about 91 compute-hours, which leaves almost nothing for real traffic. Proposed: each job declares how often it needs to run, and the tick only runs DB-touching jobs that are due (for example every 30 minutes, about 30 compute-hours), while still being called every 10 minutes to keep the API awake. No SRS job needs 10-minute precision. S4 gives the real numbers.

## 7. After the spikes

- [ ] `ENABLE_SPIKES` is `false` again in Render.
- [ ] `TRUST_PROXY_HOPS` in `render.yaml` (and the Render dashboard) holds the measured value, with the web/direct difference written down.
- [ ] The mail provider and sender are chosen and recorded (OI-6).
- [ ] The Render `JOB_SECRET` exists only in Render and in the GitHub secret, nowhere else.
- [ ] You have written the S1 to S5 results into the project log for your supervisor.
