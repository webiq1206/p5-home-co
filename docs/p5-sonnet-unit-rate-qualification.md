# Saved unit costs and Sonnet qualification

The unit-rate library extends the existing site database. No new database,
deployment, subscription, spending limit or Replit Agent is involved.

## Reusable costs

After a pricing result passes its complete-scope release checks, supported
published benchmarks and disclosed provisional planning allowances are saved
as direct unit costs. Supported reusable units are LF, SF, each, hour and CY;
aliases normalize to the same unit. Whole-project or lump-sum allowances are
not automatically reused as generic unit prices.

Each entry retains specification/description, USD rate/range, material-only,
labor-only or subcontractor-installed basis, inclusions, exclusions, locality,
source evidence, assumptions, original retrieval date and expiry. Rates remain
estimated; reuse does not turn a planning allowance into an approved rate or
reset its 30-day evidence window. The approved cost book remains preferred.
Distinct specifications and responsibilities are not averaged together.

The next project supplies its own quantity, uncertainty range and scope.
Previous quantities, cutting waste, building/floor and project conditions are
removed from the reusable record. Matching and final scope audit still check
specification, responsibility and completeness before releasing a range.

Storage uses the existing p5_estimator_work table and a versioned namespace;
no schema migration is needed. Each website retains its own library, isolated
by brand and locality. This release does not create a cross-site shared rate
API. Old v2 records remain stored but are not used as v3 records because they
lack the separated rate assumptions needed for safe reuse. No customer data
or rate database is checked into Git.

## Sonnet document test

The private p5-sonnet-fixtures.json bundle contains the original four-page
redacted scope and a 23-page mixed native/scanned construction set. It contains
data, not executable code. Keep it and the .p5-model-qa reports outside Git.
Both paths are excluded from Git and deployment packaging.

After pulling this release, upload the supplied bundle to P5's Files and run:

```sh
node services/document-service/scripts/check-sonnet-documents.mjs p5-sonnet-fixtures.json
```

The command uses the existing ANTHROPIC_API_KEY only in the P5 Shell, forces
claude-sonnet-5 for page reading and verification, and runs the real maintained
parser, provider, pipeline and queue code against private local PGlite storage.
It never connects to DATABASE_URL or changes production models. PGlite is
already a development dependency; no hosted database is provisioned.

The short file runs first. The plans run only after its page-completeness and
targeted source checks pass. The guard reserves estimated generation costs
before calls, using the provider token-count endpoint and conservative headroom.
It stops at estimated limits of $1 for the short file and $3 for the plans,
with separate request/time limits. These are estimates, not billing hard caps.
Timeouts with unknown charges retain their reservation. No automatic Opus
fallback occurs. Successful work persists locally and is reused if restarted;
exhausted failures require inspection rather than automatic paid reprocessing.

### Investigating a timeout

The first real four-page run on 2026-09-18 parsed all pages but exhausted three
40-second provider calls before any page evidence completed. The plans did not
run. This does not qualify Sonnet accuracy or prove what caused provider latency.

Multi-page reader timeouts now use the existing adaptive single-page recovery
path. The parent job and child jobs change atomically under its valid lease.
Completed pages remain cached. Cancellation, authentication and rate limits do
not trigger splits; single-page failures retain the existing bounded retries.
Provider metrics include page numbers, model, attempt, configured deadline and
input size, without source text or secrets. No deadline, output limit, provider
slot limit or QA spending limit was raised.

Before another paid attempt, inspect the private report at the path printed by
the failed run. Keep that checkpoint. Processing-source changes create a new
checkpoint directory and a new cost ledger, so its budget does not include old
attempts. A failed run's reserved estimate is not a verified provider charge.
The recovery change has controlled local/CI tests; real-file success still
requires a separately observed Sonnet run.

Reports include stage timings, usage, estimated costs, all page evidence and
reconciled output. Native parsing/rendering, provider capacity waits, AI reading,
verification and reconciliation are distinguished. Upload, production queue and
customer wait are explicitly unmeasured. Provider token counting adds test
overhead. Summed parallel stages are not total customer wall time.

Source review must check redactions, quantities, scope, exclusions, revisions and
responsibilities. In the short fixture, appliance product allowances exclude
ancillary costs that are carried separately elsewhere in the project; this is
not a whole-project exclusion. No house or garage areas can be recovered from
another version. Targeted automated checks are not exhaustive ground truth or
99.9% accuracy qualification. The 23-page source is not a 100-page benchmark.

The isolated test does not verify deployed adapters, customer pricing, PDFs,
emails, production performance or percentile targets. Production model changes
and all-site activation remain separate release steps after qualification.

For a free parser-only check, append `parse` to the command. No provider key is
needed for that mode. Source PDFs and resulting reports must remain private.
