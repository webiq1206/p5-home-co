# P5 Home Co always-on lead manager

The lead manager lives inside the P5 Next.js app at `/admin`. It exists to make
four things true: every legitimate lead is captured, every lead gets a timely
human response, every lead has an owner and a next action, and anything overdue
becomes visible without anyone going looking for it.

## Status

| Area | State |
| --- | --- |
| Business-hours and SLA engine | **Built and tested** (Mon–Sat, 7:00am–6:00pm, America/Boise, DST-correct) |
| Duplicate prevention | **Built and verified** against PostgreSQL |
| Lead intake (`POST /api/leads/intake`) | **Built and verified** end to end |
| Rules engine | **Built and tested** |
| Five-minute watchdog | **Built and verified idempotent**; not yet scheduled — see Deployment |
| Admin panel, Needs Your Attention | **Built and verified** on desktop and mobile |
| Roles and permissions | **Built and tested** |
| Admin sign-in | **Blocked** — needs a Google OAuth client |
| HubSpot | **Not started** — no authorized access in this session |
| Gmail | **Blocked** — the connected mailbox is not the P5 one |
| Facebook Lead Ads | **Not started** — the P5 ad account was located but forms are not mapped |
| Management reviews and digests | **Not built** |
| Reporting | **Not built** |
| Handoff / QuickBooks | **Intentionally disconnected**, flags default false |

## Architecture

Next.js 16 App Router, PostgreSQL, no new frameworks. The marketing site is
untouched and still prerenders as static.

```
app/lib/leads/time.ts        DST-correct business-hours arithmetic
app/lib/leads/rules.ts       the deterministic rules engine
app/lib/leads/normalize.ts   contact and deal identity, duplicate detection
app/lib/leads/intake.ts      the single path every lead source converges on
app/lib/leads/watchdog.ts    the five-minute pass
app/lib/leads/settings.ts    administrator-configurable settings
app/lib/leads/permissions.ts the role matrix
app/lib/auth.ts              sessions
app/admin/                   the panel
app/api/leads/intake/        public intake endpoint
app/api/jobs/watchdog/       scheduler endpoint
migrations/001_init.sql      schema
```

### Who owns what

This application owns operational state only: users, assignment, SLA timers,
escalation state, audit history, job health, and settings. Contact and deal
rows carry `hubspot_*` id columns so HubSpot can become the CRM system of
record without a rewrite. The goal is not a second CRM.

Gmail will own email. Handoff will own estimates and proposals. QuickBooks
remains the accounting system of record. Neither deferred integration is
connected.

## Two clocks

The system tracks **time to first human attempt** and **time to first two-way
contact** separately, because "we tried to call" and "we actually spoke" are
different promises. A website form submission is recorded on the timeline with
`is_human_attempt = false`, so evidence that the customer wrote in can never
satisfy the promise that a person replies. The same applies to any automatic
acknowledgment, if one is ever enabled.

## Deployment

The app deploys on Replit to `p5-home-co.replit.app`, currently an **autoscale**
target. Autoscale scales to zero between requests, so **it cannot run the
five-minute watchdog**. The watchdog is built and verified, but it needs a
caller. Options, cheapest first:

1. **An external scheduler** hitting `POST /api/jobs/watchdog` with the bearer
   secret every five minutes. Works with autoscale and needs no plan change.
2. **A Replit Reserved VM**, which stays always-on and can run the schedule
   in-process. A paid plan.

Whichever is chosen, `WATCHDOG_SECRET` must be set or the endpoint refuses to
run. See `docs/automation-rules.md`.

Note that `p5homeco.com` currently points at Wix and returns HTTP 404. This app
is not served there. Where the admin panel should ultimately live is an open
decision.

## Setup

1. Set `DATABASE_URL` in Replit Secrets (the Database pane provides it).
2. Apply `migrations/001_init.sql`. It is idempotent and safe to re-run.
3. Insert the first administrator into `app_user`.
4. Set `WATCHDOG_SECRET` and schedule the watchdog.
5. Create a Google OAuth client and set `GOOGLE_CLIENT_ID` /
   `GOOGLE_CLIENT_SECRET` to enable sign-in.
6. Turn off `automation.testMode` only once the workflow has been approved.
