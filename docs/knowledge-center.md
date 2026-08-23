# Knowledge Center and the daily financial report

Two features, one purpose: an admin who has never used QuickBooks or HubSpot
can learn how P5 works from inside the panel, and ownership can read the
financial position of the business in under a minute each morning.

## Knowledge Center

Lives at **/admin/kb**, open to every signed-in staff role (the finance
*pages* stay role-gated; documentation about them is not secret to staff).

| Piece | Where |
|---|---|
| Content (38 articles, 11 sections) | `app/lib/kb/content/*.ts` |
| Registry and lookups | `app/lib/kb/index.ts` |
| Search engine (pure) | `app/lib/kb/search.ts` |
| Ask P5 (pure) | `app/lib/kb/ask.ts` |
| Drift detection | `app/lib/kb/drift.ts` |
| Per-article verification state | `app/lib/kb/state.ts`, table `kb_article_state` |
| Pages and block renderer | `app/admin/kb/*` |

### Articles are data, not prose files

Every page is a typed list of blocks (`app/lib/kb/types.ts`): paragraphs,
steps, tables, flow diagrams, callouts, FAQ, glossary terms, link lists. One
representation feeds three consumers - the rendered page, the search index,
and Ask P5's retrieval - so search can never surface text the page does not
show, and Ask P5 can never quote something that is not written down.

Callouts carry the automation distinction the whole system leans on:
`automatic` ("P5 does this automatically"), `action` ("You need to do this"),
`review` ("Review required"), plus `warning` and `info`. Flow steps carry the
same marker per step. Tests assert both kinds appear throughout the corpus.

### Writing or editing an article

1. Edit the relevant file in `app/lib/kb/content/`.
2. Set `lastVerified` to the date you actually checked the live systems.
3. Add `verifies: ["<check-key>"]` if a drift check should watch the page.
4. Add `keywords` for words people would search that the prose does not use.
5. `npm test` - the content tests check slugs, sections, dead internal links,
   empty blocks, and that every page carries a summary and a verified date.

### Search

Field-weighted token matching with light stemming and a query-side synonym
map, so "pay subcontractor" finds the AP pages even though nobody wrote that
phrase. `tests/kb-search.test.ts` pins the phrases from the brief to the
pages that must answer them - if a rewrite breaks that mapping, the build
fails rather than the admin.

### Ask P5

Two grounded tiers and an honest floor. There is no generative step, which is
how "never invent an answer" is actually guaranteed rather than asked for:

1. **Curated bank** (`ANSWER_BANK`) - written against the real configuration.
   The only tier that asserts an answer. Matching is bidirectional token
   overlap, so a stray shared word cannot trigger a confident reply.
2. **Retrieval** - offers the pages that cover the topic, worded as exactly
   that ("I do not have a prepared answer... these pages cover what you asked
   about"). It never claims to have answered.
3. **Refusal** - and if the question uses a word the corpus has never seen
   ("wifi", "forklift"), it refuses *by name* instead of pattern-matching the
   rest of the sentence onto an unrelated page.

To add an answer, append to `ANSWER_BANK` with `patterns` (several phrasings),
plain-language `paragraphs`, optional `steps`, `automatic`/`action` lines, and
`links` into the Knowledge Center.

### Keeping documentation current

`runKbDriftScan()` runs inside the daily finance job. It compares live
configuration against what the documentation claims:

| Check key | Compares |
|---|---|
| `qbo-classes` | The six classes exist and are named as documented |
| `qbo-key-accounts` | 1010 / 1030 / 1040 / 2100 exist with documented names |
| `qbo-accounts` | Full numbered chart against the accepted baseline |
| `hubspot-pipeline` | All 8 stages, **by internal stage id**, labels included |
| `hubspot-properties` | Required `p5_*` deal properties still exist |

On a mismatch the watching articles are **flagged**, never rewritten - a
configuration change can be a mistake as easily as a decision - and a
`kb_drift` attention item is raised. When a check passes, its articles have
their Last Verified date bumped automatically and the attention item resolves.
A check that cannot run (no token, no sync yet) reports `unverifiable` and
changes nothing, so a missing credential never masquerades as drift.

The chart-of-accounts baseline lives in `kb_config_baseline`; accepting a
deliberate change means re-capturing it via `captureAccountsBaseline()`.

## Daily financial report

Assembled by the daily finance job and emailed to the recipients in
Finance > Settings (default `accounting@p5homeco.com`). Viewable with history
at **/admin/finance/daily-report**, where "Generate & send now" runs exactly
the step the scheduler runs.

| Piece | Where |
|---|---|
| Assembly, diff, persistence | `app/lib/finance/daily-report.ts` |
| Email rendering (HTML + text) | `app/lib/finance/daily-report-render.ts` |
| Job step | `runDailyReportStep()` in `app/lib/finance/jobs.ts` |
| Storage | table `daily_report`, one row per day |

Structure, in the order a phone reader needs it: Needs Your Attention,
Company Snapshot, What Changed, Active Projects, Upcoming, and links back
into the panel and QuickBooks.

### Accuracy rules

- Every figure comes from the synced QBO read model plus the P5 project
  registry. The report computes; it never estimates.
- **A number that cannot be computed is named, not guessed.** No budget shows
  as "not set" and lands in that project's data notes.
- **A project whose data is incomplete is never labelled healthy.** Without a
  budget or a QuickBooks link there is no cost basis, so margin would read as
  100% - a confident-looking lie. Those projects report ACTION REQUIRED with
  "financial health cannot be assessed".
- Overdue receivables are never counted as available cash.
- Not connected or not yet synced is stated plainly instead of mailing stale
  figures as fresh.
- Health labels are **words** (ON TRACK / WATCH / ACTION REQUIRED), not just
  colours, so they survive dark mode, printing, and screen readers.

### What changed since yesterday

A diff of two stored report payloads, not a re-derivation of history. New
transactions are detected by id-set difference, so a re-synced transaction can
never be reported as new. `tests/daily-report.test.ts` pins this, including
the case where two identical days produce zero changes.

### Email delivery

Uses the existing notification transport. With no `SMTP_USER` /
`SMTP_PASSWORD` configured, the report is still generated, persisted, and
visible in the panel, and the send is logged rather than silently dropped -
the stored `email_status` says which happened.

## Setup

1. Apply `migrations/007_knowledge_center.sql` (`npm run db:migrate`) - it is
   idempotent.
2. Ensure the daily job is scheduled (`POST /api/jobs/finance`, bearer
   `WATCHDOG_SECRET`); the drift scan and the report are steps 5 and 6.
3. Set `SMTP_USER` / `SMTP_PASSWORD` for real email delivery, and
   `APP_BASE_URL` so the report's links point at the deployed host.
4. Confirm recipients in Finance > Settings.
