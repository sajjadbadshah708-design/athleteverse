# AthleteVerse — Phase 1 Requirements Baseline

| | |
|---|---|
| Source of truth | *AthleteVerse SRS Version 2.0* (41 pages; the cover still says "Version 1.0", the page headers and "Replaces Version 1.0" confirm 2.0) |
| Approved scope | `docs/MVP_SCOPE_MATRIX.csv`: 128 FRs = **26 Yes + 23 Yes† = 49 MVP**, 76 Later, 3 No (FR-1.25, FR-2.14, FR-4.20) |
| Scope decision | 2026-11-17, project owner: **keep the approved scope**. Teams, Matches and Tournaments (F3, F4) stay Later. "Messages" is out of scope (SRS §1.2: no in-app chat in v2.0). |
| Evidence date | 2026-11-17, local run on PostgreSQL 15 (Docker), Node v24.18.0 |

Status words used below: **Verified** = behaviour exercised by a passing automated test; **Implemented, untested** = code exists, no test exercises it; **Partial** = only part of the approved (Yes†) slice exists; **Gap** = approved but missing.

## 1. Business problem and objectives
Indoor-sports venues take court bookings by phone and cash, with no protection against double booking or no-shows. AthleteVerse lets players find venues and book courts online, payment stays **cash at the venue after the match**, and reliability is enforced by a **credit score** instead of prepayment (SRS §1.2). The MVP delivers that booking-and-accountability loop plus the venue and admin operations that run it.

## 2. Actors and permissions (SRS Table 9, MVP slice)

| Function | Player | Arena Manager | Arena Staff | Super Admin | MVP |
|---|---|---|---|---|---|
| Register / edit own profile | Yes (web) | Yes (web, after approval) | Via invitation | Seeded owner | Yes |
| Search venues, book, cancel own booking | Yes | – | – | – | Yes |
| Review a venue | Yes | – | – | – | Later (FR-2.30) |
| Create venues, courts, prices, staff | – | Own venues | – | – | Yes (forms only) |
| Block slots | – | Own venues | – | – | Later (FR-5.4) |
| Cancel a booking without penalty, with reason | – | Own venues | – | – | Yes |
| Confirm cash, record No-Show / Unpaid | – | Own venues | Assigned venue | – (SA-11) | Yes |
| Walk-in booking | – | Own venues | Assigned venue | – | Later (FR-2.29) |
| Decide credit disputes | – | Own venues | – | Override | Later (FR-2.26) |
| Approve / reject Arena Managers (reason required) | – | – | – | Yes | Yes |
| Suspend / reactivate / delete accounts | – | Disable own staff | – | Yes | Staff disable only; admin suspend Later |
| Settings, master data, audit-log viewer | – | – | – | Yes | Later (seeded, read-only) |

Enforced on the server per request (role, account status, venue ownership): FR-1.11–1.13, **Verified** (`access.test.ts`, `mvp-operations.test.ts`).

## 3. MVP scope checklist and traceability (49 requirements)

### F1 Accounts, roles and profiles (19)
| FR | Scope | Approved slice | Code | Status / evidence |
|---|---|---|---|---|
| 1.1 | Yes† | Player + Manager registration, web | `auth.routes.ts`, `RegisterPage`, `ManagerRegisterPage` | Verified (`auth.register.test`) |
| 1.2 | Yes | Unique e-mail and phone | `auth.service.ts`, DB unique | Verified (`auth.register.test`, `constraints.test`) |
| 1.3 | Yes | 6-digit OTP, 10 min, 5 attempts, 60 s resend | `otp.ts` | Verified (`auth.verify.test`) |
| 1.4 | Yes | Password rule, bcrypt | `password.ts`, shared schema | Verified (`authPrimitives.test`, `shared.test`) |
| 1.5 | Yes† | Pending Approval, no venue before approval (resubmission Later) | `management.service.ts` | Verified (`mvp-operations.test`) |
| 1.6 | Yes† | Staff by 48 h invitation; owner admin by seed | `management.service.ts`, `seed` | Verified (`mvp-operations.test`, `seed.test`) |
| 1.7 | Yes | Lock 15 min after 5 failures | `auth.service.ts` | Verified (`auth.login.test`) |
| 1.8 | Yes† | 15 min access + 7-day HttpOnly refresh cookie | `tokens.ts`, `cookies.ts` | Verified (`auth.session.test`) |
| 1.9 | Yes | Admin login needs e-mail OTP | `auth.routes.ts` | Verified (`mvp-operations.test`) |
| 1.11 | Yes | One role, checked every request | `authenticate.ts` | Verified (`access.test`) |
| 1.12 | Yes | 403 + logged attempt | `authenticate.ts` | Verified (`access.test`) |
| 1.13 | Yes | Own / assigned venue only | `findVenueForOperator` | Verified (`mvp-operations.test`) |
| 1.14 | Yes† | Basic profile (city, area, DOB); sports with Teams | `profile.service.ts` | Verified (`profile.test`) |
| 1.15 | Yes† | Booking blocked until profile complete | `completeness.ts` | Verified (`bookings.test`, `completeness.test`) |
| 1.16 | Yes† | Phone only to booking venue; never e-mail/DOB | `route.ts` response filter | Verified (`privacy.test`, `route.test`) |
| 1.18 | Yes | Limits 3 venues / 10 courts / 5 staff | `management.service.ts` | **Implemented, untested** |
| 1.20 | Yes† | Admin approve/reject only | `management.service.ts`, `AdminPage` | Verified (`mvp-operations.test`) |
| 1.23 | Yes† | Reason + audit for approvals, rejections, cancellations | `auditLog.create` calls | Verified for approval (`mvp-operations.test`); cancellation reason untested |
| 1.24 | Yes† | Sessions recorded, 5-cap, **revoke**; device UI Later | `sessions.ts` | **Partial**: cap and per-client records verified (`auth.login.test`); no endpoint for a user to sign out their other sessions (**G1**) |
### F2 Venue discovery and court booking (22)
| FR | Scope | Approved slice | Status / evidence |
|---|---|---|---|
| 2.1 | Yes† | List view (map Later) | Verified (`venues.test`) |
| 2.2 | Yes† | Name, sport, city filters | Verified (`venues.test`) |
| 2.3 | Yes† | Courts, prices, hours, policy | Verified (`venues.test`) |
| 2.5 | Yes | Available / Booked / Blocked / Past with text labels | Verified (`venues.test`, `slots.test`, web `venue.test`) |
| 2.7 | Yes | 1–3 slots, ≤14 days, ≥30 min ahead | Verified (`bookings.test`) |
| 2.8 | Yes | Immediate confirmation, 8-char code | Verified (`bookings.test`) |
| 2.9 | Yes | Three-layer double-booking guard | Verified (`bookings.test`: 10 concurrent players → 1 booking; exclusion constraint) |
| 2.10 | Yes | Price snapshot | Verified (`bookings.test`) |
| 2.11 | Yes | Tier limits 3/2/1/0; no player overlap | Verified (`bookings.test`) |
| 2.13 | Yes | My Bookings Upcoming / Past / Cancelled | **Implemented, untested** (API list and web page have no test) |
| 2.15 | Yes | No online payment; "pay cash" copy | Verified (`bookings.test`: confirmation mail) |
| 2.16 | Yes | Record Paid / Unpaid / No-Show | Paid and No-Show verified; **Unpaid (−50) untested** |
| 2.17 | Yes | Paid → Completed, +5 (cap 100), receipt | Verified (`mvp-operations.test`) |
| 2.18 | Yes | Auto-close after 24 h, no penalty | **Implemented, untested** (`timed-jobs.ts`) |
| 2.20 | Yes | Cancellation preview shows rule and points | Verified (`mvp-operations.test`) |
| 2.21 | Yes | Windows 0 / −10 / −20 on server time | Free and Late verified; **Last-minute (−20) untested** |
| 2.22 | Yes† | Manager cancels with reason, no penalty | **Implemented, untested** |
| 2.23 | Yes | No-Show only ≥15 min after start | Verified (`mvp-operations.test`) |
| 2.24 | Yes | Credit once, same transaction, 0–100, ledger | Verified (`mvp-operations.test`, `constraints.test`) |
| 2.25 | Yes† | Tier booking limits and block (tournament ban Later) | Verified (`bookings.test`) |
| 2.27 | Yes | Score, tier, history; tier badge for venue | API implemented; **player credit page and badge untested** |
| 2.28 | Yes† | Auto-restore blocked → 20 after 30 days | **Implemented, untested** (`timed-jobs.ts`) |

### F5 Management dashboards (8)
| FR | Scope | Approved slice | Status / evidence |
|---|---|---|---|
| 5.1 | Yes† | Manager home: today's bookings and open actions | **Gap G2**: no home view; only the operations list |
| 5.3 | Yes† | List, search by code/name/phone, detail with status history from audit log | **Partial**: list and search exist; no detail view (**G3**); defect **D1** |
| 5.6 | Yes† | Invite and disable staff (remove, log Later) | Invite verified; disable verified (`auth.session.test`) |
| 5.8 | Yes† | Venue / court / price forms (preview Later) | Implemented (`ManagerPage`); court form untested |
| 5.10 | Yes† | Accounts list and approvals | **Partial**: only the pending-manager list (**G4**) |
| 5.14 | Yes† | Append-only audit write path | Verified (`constraints.test`: UPDATE/DELETE refused) |
| 5.15 | Yes† | E-mail for OTP and invitations (bell Later) | Verified (`mail.test`, `mailer.test`, `bookings.test`) |
| 5.17 | Yes | Same rules on every client | By architecture: rules live only in the API; shared Zod package |

## 4. Business rules checklist (values from `settingsDefaults.ts`, checked against SRS Tables 14, 16, 26)

| Rule | SRS | Code | Test |
|---|---|---|---|
| 6-digit e-mail OTP, 10 min, 5 attempts, resend after 60 s | FR-1.3 | ✔ | ✔ |
| Lockout: 5 failures → 15 min | FR-1.7 | ✔ | ✔ |
| Slot 60 min, whole hours, 1–3 consecutive on one court | Table 14 | ✔ (code constant + `max_slots` 3) | ✔ |
| Book ≤14 days ahead, ≥30 min before start | Table 14 | ✔ | ✔ |
| Cancel >6 h: 0; 1–6 h (inclusive): −10; <1 h: −20; none after start | Table 16 | ✔ `cancellationBand` | 0 and −10 ✔; −20 ✘ |
| No-Show only from start + 15 min: −30 | Table 15/16 | ✔ | ✔ |
| Unpaid: Completed / Unpaid, −50 | Table 15/16 | ✔ | ✘ |
| Paid: Completed / Paid, +5, max 100 | Table 15/16 | ✔ | ✔ |
| Auto-close 24 h after end: Completed / Pending, no penalty | Table 8, FR-2.18 | ✔ | ✘ |
| Manager may still confirm cash on an auto-closed booking for 7 days | Table 15 | ✔ (manager only; 7 days hard-coded) | ✘ |
| Score 0–100; each event once per booking | §5.5, FR-2.24 | ✔ + DB unique | ✔ |
| Tiers: Good ≥70, Caution ≥40, Restricted 1–39, Blocked 0 | Figure 7, Table 26 | ✔ `tierOf` | ✔ |
| Upcoming bookings by tier 3/2/1/0 | Table 14 | ✔ | ✔ |
| Blocked 30 days → 20 points | §5.5, FR-2.28 | ✔ | ✘ |
| Manager cancellation: no penalty, reason required | FR-2.22 | ✔ | ✘ |
| Cash is recorded, never processed | Principle 2 | ✔ (no payment code) | n/a |
| Limits 3 venues / 10 courts / 5 staff | Table 11 | ✔ | ✘ |
| 5 active sessions per user | Table 26 | ✔ | ✔ |
| Super Admin: OTP each login, 15 min inactivity | SA-3 | ✔ | OTP ✔; inactivity: to confirm |

## 5. Defects and gaps found

| ID | Kind | Description | Requirement |
|---|---|---|---|
| **D1** | Defect | `venueBookings` reads the 200 *earliest* bookings of a venue (`orderBy startTime asc, take 200`) and filters by date in memory afterwards. Once a venue has more than 200 bookings, today's and upcoming bookings disappear from the operations list and search. Also not paginated (PERF-4: 20 per page). | FR-5.3, FR-2.16, PERF-4 |
| G1 | Gap | No endpoint or screen for a user to see their sessions and sign out the others. | FR-1.24 (Yes†) |
| G2 | Gap | No manager home with today's bookings and open actions (missing outcomes). | FR-5.1 (Yes†) |
| G3 | Gap | No booking detail with status history and credit badge. | FR-5.3 (Yes†) |
| G4 | Gap | Admin sees only pending managers; no account list with role/status filter. | FR-5.10 (Yes†) |
| T1 | Test gap | No tests for: auto-close job, blocked-restore job, −20 last-minute, −50 Unpaid, manager cancel, venue/court/staff limits, My Bookings tabs. | FR-2.13, 2.16, 2.18, 2.21, 2.22, 2.28, 1.18 |

## 6. Ambiguities and conflicts (to confirm; not acted on)

| ID | Item | Current behaviour | Question |
|---|---|---|---|
| A1 | Requested player menu (Teams, Matches, Tournaments, Messages) vs approved scope | **Resolved 2026-11-17**: keep approved scope; no Messages | – |
| A2 | Leaving Blocked early: `applyCredit` clears `blockedAt` whenever the score rises above 0, so a +5 Paid outcome on an older booking lifts a block before 30 days. SRS §5.5 says Blocked returns after 30 days "or earlier if the Super Admin restores". | Unblocks at 5 points | Should only the 30-day job or an admin end a block? |
| A3 | Table 15 "Unpaid … flagged to the manager" | No flag; Unpaid only shows as a payment status | Is the status label enough for the MVP (notifications are Later)? |
| A4 | Manager cancellation of a booking that has already started | Allowed while status is Confirmed | Should it be limited to upcoming bookings, like the player's cancel? FR-2.22 says "any booking". |
| A5 | OI-1 launch time zone and currency | `PLATFORM_TZ=UTC` | Which IANA zone (e.g. `Asia/Karachi`)? |
| A6 | Runtime | Local Node v24.18.0; project and Render target Node 22 | Install Node 22 locally for parity? |
| A7 | FR-2.12 (booking notifications) and FR-2.26 (disputes) are SRS **Must** but scoped Later | Booking e-mail sent; no disputes | Stakeholder acknowledgement of the fairness risk is recorded in `MVP_COMPLETION_REPORT.md` |

## 7. Exit criteria for Phase 1
- [x] SRS read in full; 128 FRs reconciled with the scope matrix (49 / 76 / 3).
- [x] Actors, permissions, business rules and MVP traceability recorded above.
- [x] Scope decision recorded (A1).
- [ ] A2–A6 answered by the project owner (A2 and A4 change behaviour; the rest are configuration).
