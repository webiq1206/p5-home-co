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

Generate a token key:
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`

## Connecting QuickBooks

1. Create an Intuit developer app (Accounting scope), redirect URI
   `https://<host>/api/qbo/callback`.
2. Set the env vars, deploy, run `npm run db:migrate`.
3. As an administrator, open **/admin/finance/health** and click
   **Connect QuickBooks**. The callback stores encrypted tokens and runs the
   first sync.

## Scheduling

Point the existing scheduler at `POST /api/jobs/finance` once per day
(Bearer `WATCHDOG_SECRET`). The job syncs QBO, rescans attention items,
persists the Money Run on Wednesdays (preliminary) and Fridays (final), and
stores the daily trend snapshot. Every step reports independently; failures
surface in Health and as critical attention items - never silently.

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

## Not yet built (deliberately)

- QBO webhooks (S155 uses daily + on-demand sync; webhook signature plumbing
  can be added without changing the read model).
- Lender draw packages (S77), Idaho disclosure document generation (S78-80):
  need the attorney-approved templates first (S206).
- Write-paths into QBO (invoice/bill creation from P5): the current module is
  read-and-orchestrate by design; money movement stays in QBO/Bill Pay.
