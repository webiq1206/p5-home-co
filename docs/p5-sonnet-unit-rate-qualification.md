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

## Sonnet document completion

The private bundle and successful saved work already exist in the P5 workspace.
Use the current completion command after pulling reviewed main:

```sh
node services/document-service/scripts/finish-sonnet-qualification.mjs
```

This recovers validated saved pages 1 and 2 free, preserves their original
checkpoints and cost ledgers, reads only missing pages, then reconciles the
short scope. Plans run only after the short file passes its targeted checks.
It uses real production processing modules with isolated local SQL storage,
never DATABASE_URL. All source PDFs and reports remain outside Git.

Additional estimated reservations remain bounded to $1 unfinished short work
and $3 plans, with the existing request/time limits. The original failed-run and
probe estimates are recorded separately. Returned provider usage determines
reported estimates; interrupted calls keep their reservation and pause further
requests. The fixed completion profile and exclusive lock prevent concurrent
runs and silent budget resets. Cache reuse is not a cold performance benchmark.

See p5-sonnet-switch-runbook.md for current settings and the remaining deployed
checks. The historical diagnostic below is retained as evidence, not the next
command to run.

### Investigating a timeout

Historical experiment: one medium-effort saved-page probe. This is now complete.
Sonnet 5's default is high effort; the completed page used 1007 thinking tokens
out of 3478 output tokens and took 30618 ms. This suggests an experiment, not a
proven explanation for the interrupted calls. Anthropic documents the supported
control and the quality tradeoff at
https://platform.claude.com/docs/en/build-with-claude/effort.

The historical probe command was:

```sh
node services/document-service/scripts/check-sonnet-saved-page.mjs
```

This reuses page 2's saved native text and overview, obtained from a disposable
copy of the latest failed QA database. It uses the maintained production request
builder, prompt, JSON schema and native quote checks, changing only the request's
output_config.effort to medium. The call deadline stays at most 40 seconds and
the output limit at most 10000 tokens, honoring lower configured limits. No
PDF upload, parsing, production database or model-setting change is involved.

The experiment has a separate additional $0.20 estimated reservation and allows
one generation request only. This is not an actual charge or guaranteed billing
cap. It does not clear or draw down the old failed run's ledger. The per-source
probe directory is an atomic permanent attempt lock: a repeated command returns
the saved report or stops, including after an interrupted run. No automatic
retry, verification call, review or 23-page run follows. Do not delete its files
to retry. No source-code fingerprint change resets this probe. Production source
and the full-run checkpoint fingerprint are unchanged by this QA-only release.

Return the printed report for comparison with its nativeText, including missing
numbers, all scope, exclusions and responsibilities. A structurally valid response
with source quotes is not an accuracy pass. Visual or calculated evidence remains
unverified and blocks readyForSourceReview. Even a successful page does not qualify
the four-page file, larger plans, pricing, PDF/email or live websites. Lower effort
must be measured before changing production defaults.

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

The second real short-file run completed one page, but seven of its eight
requests returned no usage before timing out or being cancelled. It stopped at
the estimated spend limit. The first recovery change was insufficient. Further
paid reruns are paused pending diagnosis, and no timeout or spend limit was raised.

After the Shell test has finished, inspect its saved state for free:

```sh
node services/document-service/scripts/inspect-sonnet-run.mjs
```

The inspector selects the latest short-file report and queries a disposable copy
of its private local QA database. It prints request timings, page numbers, output
usage and evidence counts. It makes no provider calls, reads no API credential,
does not connect to the production database and preserves the original checkpoint.
It does not parse or reread the PDF and does not print document text. An explicit
report path can be supplied as its only argument. Stop any running QA command
before inspecting its saved database. Interrupted non-streaming responses do not
reveal time to first output or generation progress; do not invent those timings.

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
