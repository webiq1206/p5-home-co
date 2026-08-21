# Testing and verification

Two layers: pure unit tests that need nothing, and integration tests that run
against a real PostgreSQL database. Both use Node's built-in test runner, so no
test dependency was added.

```bash
npm test        # unit tests; integration tests skip
npm run lint
npm run build
```

To include the integration tests, point them at a scratch database:

```bash
createdb p5test
psql -d p5test -f migrations/001_init.sql
TEST_DATABASE_URL="postgresql://localhost/p5test" npm test
```

They are skipped, not failed, when `TEST_DATABASE_URL` is unset.

Test files run serially (`--test-concurrency=1`). Both integration suites share
one database and truncate between cases, so running files in parallel lets them
clobber each other's fixtures. The suite is small and the serial run costs
about a second.

## What is covered

**Business hours and SLA (`tests/time.test.ts`)** — 7:00am Boise resolving to
UTC-7 in winter and UTC-6 in summer; the spring-forward gap, where 2:30am does
not exist and resolves to 3:30am; the fall-back overlap; Saturday open and
Sunday closed; half-open `[07:00, 18:00)` boundaries; elapsed business minutes
skipping a closed Sunday; deadlines crossing a DST boundary; holidays; and a
misconfigured calendar failing loudly rather than looping.

**Identity and duplicates (`tests/normalize.test.ts`)** — the P5 number
normalizing to E.164 from seven formats; invalid NANP numbers rejected; a
non-US country code preserved rather than mangled; address keys surviving
abbreviation differences; the same person across two brands producing two
distinct deals; the resubmit window; and deal naming.

**Rules engine (`tests/rules.test.ts`)** — escalation at 5/15/30/60 business
minutes; exactly one breach finding; after-hours leads not escalating and then
becoming due at opening; unassigned leads; missing and overdue next actions;
a snooze parking a deal but **not** hiding a breached response deadline; stage
rules; closed deals; determinism; and the deferred integrations producing no
findings.

**Permissions (`tests/permissions.test.ts`)** — administrator-only actions
across every role; a sales rep confined to assigned leads; a project manager
holding no pipeline controls; and `ForbiddenError` naming the permission.

**Intake, against real PostgreSQL (`tests/intake.integration.test.ts`)** — a
website lead creating contact, deal, first task, and audit row; the SLA
deadline landing five business minutes out; the form submission recorded as
**not** a human attempt; an identical resubmission creating no second deal; the
same person with a different brand creating a legitimate second deal; a
Facebook webhook delivered twice staying idempotent; a contactless lead
rejected; an after-hours lead due Monday 7:05am; load spread across owners; and
a closed deal not blocking a genuine new project.

**Watchdog, against real PostgreSQL (`tests/watchdog.integration.test.ts`)** —
one alert raised for a breach; **a second pass raising nothing**; escalation
resolving the lower tier; a human contact attempt resolving the alert; the job
lock forcing one of two concurrent passes to skip; the lock released after a
pass; real counters recorded; the audit entry written; health reported
connected; the deferred integrations silent; and total silence when nothing is
wrong.

## Verified in a running application

Against a local PostgreSQL instance with the dev server running:

| Check | Result |
| --- | --- |
| Valid website lead | `201`, deal created |
| Identical resubmission | `200 duplicate: true`, no second deal |
| Same person, different brand | `201`, second deal, still one contact |
| No email and no phone | `422` with a field-level message |
| Unknown brand | `400` listing valid brands |
| UTM and form name | stored on the deal |
| Watchdog, no secret | `401` |
| Watchdog, wrong secret | `401` |
| Watchdog pass 1 | 1 alert raised, 1 SLA update |
| Watchdog pass 2 | **0 raised, 0 updated** |
| `/admin` signed out | `307` to `/admin/login` |
| `/admin` signed in | `200`, board renders |
| `robots.txt` | disallows `/admin` and `/api/` |
| Marketing page | still prerenders static, unchanged |
| Mobile at 375px | no horizontal overflow, 46px touch targets |

## Not yet verified

HubSpot, Gmail, and Facebook were not exercised because none is connected. The
management reviews, digests, and reporting are not built, so nothing about them
is claimed. There is no production verification: the watchdog has no scheduler
and the app is not deployed with a database attached.
