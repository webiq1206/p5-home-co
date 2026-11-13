# Scope and estimate platform

Internal tool at `/scopes` that turns recorded client meetings and home
walkthroughs into a scope of work and a priced, unsent QuickBooks estimate.
It stands apart from the admin panel on purpose, so contractors can be given
access to it alone. Pages and API responses carry `noindex` and `no-store`
through the existing middleware, and `/scopes` is disallowed in robots.txt.

## Who can use it

| Account | Scopes | Admin panel | Internal cost, margin, Pricing setup |
| --- | --- | --- | --- |
| P5 employee (any `app_user` role) | Yes | Yes, by role | Yes |
| Scopes-only (contractor) | Yes | No | No |

- Scopes-only accounts are `app_user` rows with `scopes_only = true`
  (migration 025). `getSessionUser()` returns null for them, so every admin
  page and admin API, including ones added later, treats them as signed out.
  The scope platform uses `getScopeUser()`.
- Administrators add and remove them at `/scopes/people` by name and email.
  Removing access also ends their sessions. Employee accounts cannot be
  changed from that screen.
- They sign in at `/scopes/login` with the Google account for that email. It
  does not need to be a P5 company address. Employees still need one.
- Cost, margin and markup are stripped on the server before the workspace is
  sent to a scopes-only account, and they never receive internal notifications.
- `/admin/scopes` redirects to `/scopes`.

**Google setup:** if the Google OAuth consent screen for this app is set to
"Internal", only P5 Workspace accounts can sign in and contractors with
outside addresses will be refused by Google. Set it to "External" in Google
Cloud Console to allow them; access is still limited to emails added in People.

Workflow: **Record, Review scope, Complete details, Review pricing, Create estimate.**

## Screens

| Screen | Path | What it does |
| --- | --- | --- |
| Project list | `/scopes` | A large New project button, a plain search box (client, project name or address), filter and sort tucked behind "Filter and sort", and one card per job with its name, client, last update and statuses. Archived jobs have their own view. |
| Workspace | `/scopes/[id]` | One page built like a phone app. Six accordion sections, one open at a time, each with a one-line summary: Record, Scope, Details (wizard), Pricing, Estimate, Project and files (type of work, finish tier, recordings, transcripts, versions, activity, archive). A dock at the bottom always offers the next step (Record walkthrough, Build or Update scope, Review changes, Complete details, Review pricing, Create, Update or View estimate). `?tab=` opens a section directly. |
| People | `/scopes/people` | Add or remove scopes-only access. Needs `manage_users`. |
| Pricing setup | `/scopes/settings` | Hourly labor rate, handyman trip charge, production rates, taxable items, item mapping, live QuickBooks setup check. Changes need `manage_settings`. |

## What was verified before building

| Question | Finding | Where |
| --- | --- | --- |
| Division names, numbers and order | The owner's cost book (`P5 Cost Database 2026.xlsx`, 1,484 lines) uses 25 divisions: 00 to 14, 21, 22, 23, 26, 27, 28, 31, 32, 33 and 90. It is not a continuous 00 to 22 list. The platform uses exactly these; a test fails if they drift. | `app/lib/scopes/divisions.ts`, `tests/scope-platform.test.ts` |
| Divisions in QuickBooks | Not verifiable from this environment. The QuickBooks connector available to the build session reaches a different company file, not P5's. The app's own connection is used at runtime: **Pricing setup, Check QuickBooks now** lists any numbered division names found in P5's items, categories and classes next to the cost book divisions. | `setupCheck()` in `app/lib/scopes/qbo.ts` |
| Separate phase taxonomy | The finance module has its own job-costing phase registry (01 Plan, 02 Design, 03-01 to 03-24 Build, CAB-*). That is how bills are coded to QuickBooks project phases, not how estimates are divided. Scopes use Phase 1 Pre-Construction and Phase 2 Construction with cost book divisions as requested. | `app/lib/finance/phases.ts` |
| Pricing source | The cost book is direct cost only. The margin policy in `lib/p5/pricing.ts` is reused, not copied: price = cost x 1.10 reserve / (1 - 20% overhead - service profit target). Kitchen and remodel targets are currently 12%. | `app/lib/scopes/pricing.ts` |
| QuickBooks items | The Knowledge Center documents P5's 13 items (Direct Labor, Subcontractor Work, Project Materials, and so on). Estimate lines map to these by name; anything missing is listed in the setup check and can be mapped by id. | `itemForEntry()`, `resolveItems()` |
| $125/hour labor | Owner rule (2026-11-11): $125/hour is the customer's price for P5 labor. It is billed as is; overhead, reserve and profit are never added to it. There is no setting that marks it up, and a test enforces it. P5's own cost per hour can be entered optionally, only to show internal margin. | `priceScope()` in `app/lib/scopes/pricing.ts` |
| Tax | The Knowledge Center records Idaho sales tax treatment as an open CPA decision. Lines are sent with tax code `NON` unless an item is marked taxable in Pricing setup. | `taxableItems` |
| Estimate status available | QuickBooks Online exposes `TxnStatus` (Pending, Accepted, Closed, Rejected), `EmailStatus`, `AcceptedBy`, `AcceptedDate` and linked invoices. Labels use only these. | `app/lib/scopes/estimate.ts` |
| QuickBooks projects | The accounting API models a project as a sub-customer. The platform links an existing one or asks QuickBooks to create one, then reads back `IsProject` and reports what QuickBooks actually holds. | `createProjectInQbo()` |

## Project names and addresses

Every project is named the same way, by the system: client last name, then
street number and street name, then the type of work, for example
`Sample - 100 Example Ave - Kitchen remodel` (`app/lib/scopes/naming.ts`).
City, state and zip are left out. The name follows the client, address and
type of work when they change; it is not typed by hand.

Address fields suggest matches as you type (`app/lib/scopes/address.ts`,
`/api/scopes/address`), US only and biased toward Boise. Picking one stores
the full formatted address.

The public site's Call and Request a quote bar and the site chat are hidden on
every `/scopes` page.

## Recording

- Large record button, pause, resume, stop, red recording indicator, elapsed
  time and a live input level.
- Audio is saved to the phone (IndexedDB) every 5 seconds and uploaded in
  independent 10-minute parts; each part is retried until the server confirms
  it, and the server deduplicates by part key. Parts left on a device by a
  crash or lost signal upload the next time the project is opened there.
- Screen wake lock while recording where supported. A device interruption
  (call, app switch, screen lock on iPhone) is detected; what was captured is
  kept, and Resume continues on the same timeline. The device notes are shown
  in the Record section. The recorder stays mounted when its section is
  closed, so moving around the page never stops a recording.
- Each part is transcribed with segment timestamps (`whisper-1`,
  `verbose_json`, 25 MB per part; a 10-minute part at 32 kbps is about 2.4 MB).

## When OpenAI refuses a request

Transcription and scope generation try each OpenAI connection in turn: the
`OPENAI_API_KEY` account first, then Replit's managed connection. A 429 is
read, not guessed: "out of credit" moves straight to the next connection and
skips the exhausted one for ten minutes; a real rate limit is retried with
backoff. If the timestamped model is refused, a text-only model is used and
sentence times are spread across the part and marked approximate. When every
route fails, the message names each cause and the fix. A recording that did
not transcribe is never lost: it stays saved, shows as "not transcribed yet",
and the next-step button offers to try again.

## Files of any kind, plan sets and long documents

- **What can be added.** Any file can be picked. PDFs, Word (.docx), Excel
  (.xlsx), text, CSV and images are read; anything else is stored and reported
  as not readable rather than silently ignored.
- **Size.** Files up to 20 MB go up in one request. Larger files (up to 300 MB)
  are sent in 8 MB pieces to `/api/scopes/[id]/assets/parts`, joined on the
  server and verified by size and SHA-256. Each piece is retried on its own and
  a repeated request never creates a second copy.
- **Long PDFs are read page by page** (`app/lib/scopes/sheets.ts`): more than 8
  pages or more than 20 MB. Each page is given to the model as its exact text
  layer plus an overview image and enlarged overlapping tiles (about 150 DPI,
  reduced on very large sheets), and what was read is saved per page in
  `scope_sheet`. Reading stops after about 200 seconds per request and the
  screen calls again until the set is finished, so length is not a limit and no
  page is read twice. A page that fails is recorded and retried.
- **The scope is built only when every page has been read.** Printed
  dimensions and schedules become documented measurements with page evidence.
  Things drawn but not dimensioned become missing measurements, asked in the
  details step. Anything illegible becomes a question naming the page.
- **Accuracy.** The reader copies what is printed and is told never to scale or
  calculate from a drawing. It is not a guarantee: a human still confirms
  measurements and quantities in the details step before pricing is final.

## Generating the scope

`POST /api/scopes/[id]/process` transcribes new audio, then sends every
source to the model in one pass: transcripts with timeline markers, typed
notes, documents (PDF read directly plus its text layer, Word, Excel, text),
photos, known client details, possible existing QuickBooks customers, the
division list, the full cost book catalog and the current scope. Output is
normalized (`normalize.ts`): only real divisions and cost codes survive,
evidence must point at this project's files, and a measurement with no source
becomes an estimate.

Facts are labeled confirmed, assumed, suggested, conflicting or undecided.
Work is separated into approved, optional upgrades, ideas being considered
and future work. Supporting work that is often left out (protection,
demolition and disposal, supervision across trades, permits, cleanup) is
suggested by the model and by a deterministic checklist, and is never priced
until confirmed. Every fact can be played back at its recording timestamp or
opened in its source file.

The first run saves version 1. Later runs produce **proposed changes** that
the employee accepts or dismisses. Fields edited by hand are never
overwritten; confirmed measurements are never replaced (a different new value
is flagged); generated tasks are only proposed for removal; manual tasks stay.

## Completing missing details

Questions are derived, never stored, from the scope and pricing every time
either changes. One measurement used by several tasks is one question, and
its answer updates every task. Duplicate measurements are merged. Answers that
exist, approved production rates and cost book rules are applied first, so the
wizard appears only for what is genuinely missing:

measurement or quantity (with unit), confirm an estimated value, trade or
supplier quote (currency plus attachment), labor hours (proposal pre-filled),
allowance approval, client choice between options, conflict resolution,
undecided work, supporting-task confirmation, open questions.

One field per step, Next, Back, progress, typing or dictation, and "save for
later". Each step says whether it blocks the estimate. Every answer saves a new
version immediately, so work continues on another device.

### Asked once, in scope order

- Questions follow the scope itself: phase, then division, then room, then one
  task at a time, so everything about one item is asked together. Items saved
  for later come after everything else; clarifications tied to no task are last.
- Two measurements for the same thing in different words are merged into one.
- A quantity missing on several tasks for the same thing in the same room and
  unit (remove, install and paint the same baseboards) is asked once and the
  answer fills every task.
- A free-text clarification is dropped when a measurement, quantity or selection
  already covers it, when the scope already holds the answer, or when it repeats
  one that was answered earlier in different words. The model is also told not
  to raise such clarifications in the first place.
- On a phone, the current question is held at the top of the visible screen and
  number questions share one answer box, so the keyboard stays up between them.

## Pricing

Each line records phase, division, task, QuickBooks item, quantity, unit, unit
price, extended price, internal cost and the source of the rate. Rules:

- Bundled cost book lines (installed, labor plus disposal, assemblies) never
  also get internal labor.
- A labor-only cost book line is replaced by internal labor when P5's crew
  does the work; a material-only line gets internal labor added once.
- P5 labor is $125/hour, billed as is and never marked up, with its hours and
  their basis visible (production rate, stated, proposed, confirmed).
- Handyman trip charge: shown on the estimate with an equal credit line, so it
  never adds to the total (owner rule: it is removed when the client moves
  forward). The amount is $45 by default and can be changed in Pricing setup; a cost book trip charge task
  (01-01-08) is credited the same way and never charged twice.
- Written quotes replace the book price and are treated as direct cost.
- Allowances are labeled and must be approved.
- Percentage lines are computed from construction direct cost.
- Optional upgrades are priced but kept out of the base total and the
  QuickBooks amount.
- The cost book is flagged as outdated after 365 days (configurable).
- Overhead comes from the finance policy saved by the estimator admin
  (`p5_estimator_policy`), falling back to the approved default.
- A quantity in a different unit than the cost book rate (linear feet against
  a per-square-foot rate) is never priced; the wizard asks for it in the
  rate's unit.
- The scope cannot read "Ready" while any blocking pricing issue is open,
  whether or not a wizard question exists for it.

### Profit check

The Pricing section shows employees (never scopes-only accounts) where the
money goes on the base estimate: direct cost, gross profit and margin, the
overhead share at the policy rate, the reserve built into marked-up lines, and
the expected profit against the profit target. Status is On target, Above
target (more than double, a prompt to check the price against the market),
Thin (at least half the target) or Below target, with the price that would
reach the target. It also calls out labor billed at or below its cost and any
line priced below cost.

Cost and margin need P5's own cost per labor hour (wages, payroll taxes,
workers' compensation, benefits), entered once under Pricing setup. Until then
the panel says exactly what is missing and links to the setting. The system
has no market price data, so "competitive" is a prompt to check, not a verdict.

## QuickBooks

- **Customer:** searched by email, phone, name and address; the employee
  picks a match or creates a new customer. Creation goes through the existing
  idempotent write ledger keyed by project, so it cannot duplicate.
- **Estimate:** one per project, keyed by project in the write ledger, so
  repeated taps and retries return the same estimate. Lines are grouped under
  Phase and Division headings with customer-facing descriptions; optional
  upgrades and exclusions go in the customer message. Internal costs never
  leave the platform. `EmailStatus` is `NotSet`; nothing is sent.
- **Under the project when linked:** if a QuickBooks project is already
  linked, the estimate is created under it; otherwise under the customer.
- **Exact version:** the estimate stores the scope version and the exact
  payload sent. If settings changed since the last save, the scope is
  re-priced as a new version first.
- **Revisions:** an open estimate can be updated to the current version. The
  platform reads QuickBooks first; if someone changed the estimate there, it
  shows the differences and requires explicit confirmation to replace them.
  Updates are sparse: lines are replaced, and the estimate number, dates,
  customer and sent flag stay as QuickBooks has them. Accepted, declined,
  closed or invoiced estimates are not changed; record changes as a change
  order in QuickBooks.
- **Deleted in QuickBooks:** detected on refresh and shown as "Deleted in
  QuickBooks" with history kept. Only then can a new estimate be created.
- **Status:** the existing webhook mirrors every estimate change into
  `qbo_txn`; the workspace folds that in on every view, refreshes from
  QuickBooks automatically when older than 15 minutes, and has a Refresh
  button. A failed refresh is shown with the time of the last good status.
  Every distinct QuickBooks state is kept as a snapshot.
- **Project:** tracked separately. An accepted estimate never shows a linked
  project until someone links or creates it.

### Sending, acceptance and what happens after

- **Send from the page.** An employee (never a scopes-only account) taps Send
  estimate to client, confirms the address and amount, and QuickBooks emails
  the estimate (`POST /estimate/{id}/send`). It refuses when the scope changed
  after the estimate was created, when the saved email differs from the one on
  screen, or when the estimate is no longer open in QuickBooks.
- **Acceptance creates the project.** When QuickBooks reports the estimate
  Accepted (webhook, daily sync, a refresh or a page view), the QuickBooks
  project is created under the customer with no one asking. It is idempotent
  and a failure is logged on the project and retried at the next change.
  The accepted estimate itself is not edited, so it stays filed under the
  customer; move it onto the project in QuickBooks if wanted.
- **Following the job.** Statuses come from QuickBooks: not sent, sent,
  accepted, declined, closed, invoiced, and completed and paid in full.
  QuickBooks does not share a project's own Completed flag through this
  connection, so "completed" means the linked invoices cover the whole
  estimate and nothing is owed.

## Data

Migration `024_scope_platform.sql` (additive only): `scope_project`,
`scope_asset`, `scope_version`, `scope_answer`, `scope_estimate`,
`scope_estimate_snapshot`, `qbo_item`, `scope_settings`, `scope_event`.
Nothing is deleted by the application; archive is a timestamp.

Files are stored in the p5homeco.com object storage bucket when
`P5_OBJECT_STORAGE_ENABLED=true`, otherwise in the database row, and every
read is verified by size and SHA-256. Uploads are limited to 23 MB each (the
server's request buffer is 24 MiB). Only audio, video, common image types and
PDF are served inline; anything else downloads as a plain file.

## Configuration

| Setting | Where |
| --- | --- |
| `OPENAI_API_KEY` | Replit Secrets (already present). Read on the server only. |
| Replit managed OpenAI (`AI_INTEGRATIONS_OPENAI_*`) | Second connection, tried automatically when the key above is refused (out of credit, revoked, rate limited). |
| `SCOPE_TRANSCRIBE_FALLBACK_MODEL` | Optional, default `gpt-4o-mini-transcribe`. Used when the timestamped model is refused; timestamps are then approximate. |
| `SCOPE_MODEL` | Optional, default `gpt-4.1`. |
| `SCOPE_TRANSCRIBE_MODEL` | Optional, default `whisper-1`. |
| QuickBooks | The existing Finance connection (`QBO_*`). |
| `GOOGLE_MAPS_API_KEY` | Replit Secrets. Turns on address suggestions (Google "Places API (New)"). Read on the server only; without it the address fields are plain text boxes. If the key is restricted to websites, `p5homeco.com` must be an allowed site: the server sends that address with each request (`GOOGLE_MAPS_REFERER` overrides it). |

## Before first use

1. `npm run db:migrate` (adds the tables above).
2. An administrator opens **Pricing setup**, enters the handyman trip charge,
   and taps **Check QuickBooks now** to confirm the estimate items exist in
   P5's company and to see whether QuickBooks holds numbered divisions.
3. Optional: add approved production rates so labor hours stop being asked.

## Tests

- `tests/scope-platform.test.ts`: division registry against the cost book,
  margin formula, estimated vs documented quantities, one answer updating
  several tasks, bundled-labor and labor-only rules, labor never marked up, handyman
  trip charge credit, quotes,
  optional upgrades, suggestions, conflicts, deferral, merge rules, estimate
  payload grouping and totals, status labels, drift detection, normalization.
- `tests/scope-platform.db.test.ts`: the same workflow against a real
  Postgres (versions, answers, idempotent uploads, processing lock,
  proposals, restore, search, archive, webhook-fed status and drift). Runs when
  `TEST_DATABASE_URL` is set.

Not exercised here: live OpenAI transcription and extraction, live QuickBooks
writes, and recording on physical phones. Those need the deployed app with its
secrets and a device.
