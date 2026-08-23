# P5 Financial Operating System

The finance module implements the P5 master specification's operating layer on
top of QuickBooks Online. QuickBooks remains the accounting system of record
for the ledger, AR, AP and balances; this module is authoritative only for
operational state QBO does not own - compliance, registries, reserves policy,
attention items, forecasts and audit history. It is never a second ledger.

## What is built

| Area | Where | Spec |
|---|---|---|
| QBO OAuth + encrypted token store | `app/lib/finance/qbo/oauth.ts`, `crypto.ts` | S201, S171 |
| QBO read-model sync (idempotent pull) | `app/lib/finance/qbo/sync.ts` | S155 |
| Calculation engines (pure, tested) | `app/lib/finance/engines.ts` | S48, S50, S55-57, S121, S125, S140, S145, S194 |
| Compliance + payment hard gate + lien waivers | `app/lib/finance/compliance.ts` | S87-89, S94-97, S105 |
| Needs Your Attention scanner | `app/lib/finance/attention.ts` | S149, S200 |
| Weekly Money Run assembly + history | `app/lib/finance/money-run.ts` | S139-143, S195 |
| Daily job orchestration | `app/lib/finance/jobs.ts` | S143, S176 |
| Daily financial report | `app/lib/finance/daily-report*.ts` | see `docs/knowledge-center.md` |
| Admin UI (role-gated) | `app/admin/finance/*` | S147-150, S168 |
| Schema (20 tables) | `migrations/003_finance.sql` | S8, S154, S174 |
| Engine + state-machine tests | `tests/finance-*.test.ts` | S204 |

## Environment

| Variable | Purpose |
|---|---|
| `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET` | Intuit developer app credentials |
| `QBO_TOKEN_KEY` | 32 bytes base64; AES-256-GCM key for tokens at rest |
| `QBO_ENV` | `production` (default) or `sandbox` |
| `WATCHDOG_SECRET` | already used by the watchdog; also authenticates `/api/jobs/finance` |
| `QBO_WEBHOOK_VERIFIER` | verifier token from the Intuit developer portal (Webhooks) |

Generate a token key:
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`

## Connecting QuickBooks

1. Create an Intuit developer app (Accounting scope), redirect URI
   `https://<host>/api/qbo/callback`.
2. Set the env vars, deploy, run `npm run db:migrate`.
3. As an administrator, open **/admin/finance/health** and click
   **Connect QuickBooks**. The callback stores encrypted tokens and runs the
   first sync.

### Intuit production keys

Development keys only reach sandbox companies, so a real company file needs
production keys. Intuit gates those behind an app-details step (verified email,
name, phone, business address) and a compliance questionnaire, and it requires
publicly reachable URLs. The pages exist for exactly this reason:

| Intuit field | Value |
|---|---|
| Host domain | `p5homeco.com` |
| Launch URL | `https://p5homeco.com/admin/finance` |
| Connect/Reconnect URL | `https://p5homeco.com/admin/finance/health` |
| Disconnect URL | `https://p5homeco.com/legal/quickbooks-disconnect` |
| End-user licence agreement | `https://p5homeco.com/legal/terms` |
| Privacy policy | `https://p5homeco.com/legal/privacy` |
| Redirect URI | `https://p5homeco.com/api/qbo/callback` |

## Scheduling

The daily job runs **in-process**, like the watchdog: `instrumentation.ts`
starts a timer that wakes every quarter hour and asks the database whether
today's pass has already run. Nothing external has to be configured, and there
is no scheduler that can quietly stop calling.

The decision lives in `app/lib/finance/schedule.ts` and is a pure function, so
the awkward cases are tested rather than hoped for: a restart at 3am must not
run the day's job early, a restart at 9am must still run it, a pass that
succeeded must not run twice, and a pass that failed gets one retry rather than
leaving a Wednesday Money Run unbuilt. "Today" is measured in the business
timezone, not the server's UTC, so the job fires at 6am Mountain in both
January and August.

| Variable | Default | Meaning |
|---|---|---|
| `FINANCE_JOB_IN_PROCESS` | on in production | `false` disables the timer |
| `FINANCE_JOB_HOUR` | `6` | hour the pass is due, 0-23 |
| `FINANCE_JOB_TIMEZONE` | `America/Boise` | timezone "today" is measured in |
| `FINANCE_JOB_INTERVAL_MS` | 15 min | how often the timer checks |
| `FINANCE_JOB_RETRY_MINUTES` | `60` | wait before retrying a failed pass |

Every pass is recorded in `job_run` under `finance_daily`, with the failing
step details in `error` when a pass is partial.

`POST /api/jobs/finance` (Bearer `WATCHDOG_SECRET`) remains, because an
external scheduler is still the right answer on a host that scales to zero,
and because triggering a pass by hand is worth keeping. Both paths write the
same `job_run` rows.

The job syncs QBO, rescans attention items, persists the Money Run on
Wednesdays (preliminary) and Fridays (final), and stores the daily trend
snapshot. Every step reports independently; failures surface in Health and as
critical attention items - never silently.

## Design rules carried from the spec

- Uncertain AR is never treated as cash (S139); Safe Cash shows its full
  component breakdown and marks itself provisional until the operating-reserve
  and tax-rate decisions are confirmed (S208, S125).
- Payment holds always carry a reason, and releasing one requires a reason too;
  both are audited (S105, S174, S175).
- The payment gate fails closed: a misconfigured approval matrix resolves to
  the highest tier, not to no approval (S106).
- Recurring corporate obligations roll forward automatically on completion
  (S135).
- All engine math runs in integer cents; rounding happens once at output.

## Portals (S151-S152)

External vendors and clients sign in at **/portal** with one-time emailed
links (15-minute, single-use, hash-stored) that exchange for a 30-day portal
session in its own cookie - no passwords ever exist for external users.
Administrators invite contacts from **/admin/finance/portal**; disabling a
contact ends their live sessions immediately.

Scoping is structural: every query filters by the contact's vendor_id or
project_id in SQL, and the pages render only what the pure projection layer
(`app/lib/portal/views.ts`) returns. A unit test walks the client projection
against a forbidden-key list (cost, budget, margin, vendor, contingency...) so
a leak fails the build, not a review. Vendors see their own compliance
documents, payment statuses, lien-waiver requests and awarded projects - never
other vendors or P5 margin. Clients see contract + approved change orders,
invoices, payments and balance - revenue side only.

Vendor submissions (invoice references, waiver confirmations, questions) are
recorded in portal_submission and surface as attention items until reviewed
(S99: nothing important lives only in an inbox). Invoice files themselves go
to the AP intake email (S100); e-signature of waivers stays with the
attorney-approved process (S206).

## Webhooks (S155)

Register `https://<host>/api/qbo/webhook` in the Intuit developer portal and
set `QBO_WEBHOOK_VERIFIER`. Deliveries are HMAC-verified against the raw
body (timing-safe compare) before anything touches the database; unverified
requests are 401s. Events persist to qbo_webhook_event - one pending row per
entity so bursts coalesce - then the changed entities are refetched after the
response is sent. The daily job re-processes anything still pending, which is
the scheduled reconciliation fallback the spec requires alongside webhooks
and the daily full sync. Deletes and merges remove read-model rows; replays
are harmless because every write is the same idempotent upsert the bulk sync
uses. Webhook health reports separately as 'quickbooks-webhooks'.

## Lender draws (S77)

Projects funded by a construction loan get a lender configuration (contact,
loan number, approved budget, and which requirements this lender enforces:
inspection, lien waivers, invoices, photos) and a numbered draw sequence at
**/admin/finance/draws**. The lifecycle is draft -> submitted -> approved ->
funded, with rejection reworkable; funded is terminal.

Submission is gated the same way payments are: the readiness evaluation names
every unmet lender requirement, and the amount cannot exceed the remaining
approved loan budget (approved budget minus prior funded draws). The draw
package - pay application summary, invoice schedule, vendor schedule with
billed/committed amounts, lien waiver register, draw history - assembles
automatically from the QBO read model and project registry, renders
print-ready at /admin/finance/draws/[id]/package, and **freezes as a JSONB
snapshot at submission** so the record of what the lender received never
changes afterwards. Draws sitting submitted for 14+ days surface as urgent
attention items.

## Daily report and Knowledge Center

The daily job also assembles the daily financial snapshot (emailed to
accounting, viewable at /admin/finance/daily-report) and runs the
documentation drift scan. Both are documented in
`docs/knowledge-center.md`. Two attention scanners were added alongside them:
`project_missing_budget` (an active project with no budget makes remaining
budget uncomputable) and `bill_unassigned` (an open bill with no project is
either miscoded or deliberate overhead - either way a person decides).

## Not yet built (deliberately)

- Idaho disclosure document generation (S78-80): templates are sourced (IHBA
  Forms 1 and 2, in the owner's build/legal folder) and await attorney
  approval (S206) before automation.
- Write-paths into QBO (invoice/bill creation from P5): the current module is
  read-and-orchestrate by design; money movement stays in QBO/Bill Pay.
