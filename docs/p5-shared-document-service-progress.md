# P5 shared document service completion ledger

Updated: 2026-09-18 UTC. Code delivery to GitHub; not a deployed or qualified worker.

## Authorization and recovered source

The owner has now authorized GitHub and Replit edits/configuration/deployment after pulling and republishing all five sites. Use direct code and Git, never Replit Agent to write code. No paid subscriptions, VM upgrades, or spending-limit increases without approval. Earlier no-Replit restriction is superseded.

Actual GitHub connector writing was demonstrated by progress commit `d8415ff88d0173c9b8e7bd047e0334a408cf2104` on `feat/shared-document-service-20260917`. Local Git can fetch public repositories, but this environment had no gh executable or authenticated Git helper. Connector Git-tree/commit/ref/PR/merge actions provided the working write path.

The initial recovered feature head was `eee403aac10cfb4eeec7e8874fd8c2fa654e0977`. During this session, newer original implementation PRs landed on main; they were fetched and preserved before hardening. Ordinary readable source is maintained. CI no longer runs transport/refinement scripts to rewrite tested source.

## Merged service and adapter hardening

| Repository | PR | Main merge | Passing PR verification run |
| --- | --- | --- | --- |
| p5-home-co | 44 | a15661e94ab32e5e95e6c2bb16a754fc56228025 | 35287891304 |
| boise-remodeling-co | 40 | e4d4436f4a96742a3bd389717fb68f7ffb1001ce | 35288272802 |
| Boise-Construction-Co | 37 | 5c9ba795962bd0049400252a1bf9269594759504 | 35288273936 |
| Boise-Handyman-Co | 35 | 92fc6373bc21b3b6a02ca5d87cec778753e222d8 | 35288275564 |
| Boise-Cabinet-Co | 34 | bbeaa04e3229eb1d8ceafb4c8ad4f0a5511e31c2 | 35288277539; E2E 35288277570 |

Hardening branch: `fix/shared-document-service-hardening-20260917`.

- Atomic document/last-page completion, lease-fenced manifest updates and recovery of saved terminal evidence.
- Reconciliation queued while sources read, independent of subsequent browser polls once uploads have receipts.
- Strict source/page coverage checks, identical-upload deduplication, verified retry responses and positive byte-limit validation in all adapters.
- Local provider schema validation, bounded network retries, failed-call metrics and distinct tenant-secret validation.
- Authenticated, tenant/project-isolated stage metrics; live benchmark concurrency/repeats, sample p95/p99 and separate quality dimensions using digest-matched reviewed truth.
- Read-only CI validates committed source without pushing or editing application code. Existing prebuild-generated PDFs/assets are explicitly excluded from the maintained-source diff guard; source remains protected.

P5 PR CI: 59 standalone service/database/HTTP/PDF/queue tests passed, none skipped. 357 estimator regressions passed. Production website build, Docker build, nonroot container boot and signed readiness against a separate disposable PostgreSQL database passed. The website's broader prebuild suite passed 965 tests, with one existing database-dependent case skipped. Child adapter SQL/HMAC integration, estimator regressions and production builds passed. Cabinet's existing Chromium desktop/Pixel emulation suite also passed. Semantic provider responses in these tests are fixtures, not live AI.

Historical run `35285444100` failed the production build and skipped container verification; newer `35286129315` passed. Use the newer hardening runs above for delivered-source evidence.

## Interface and SEO continuation

Scoped branch: `fix/p5-interface-completion-20260917`; PRs P5 45, Remodeling 41, Construction 38, Handyman 36, Cabinet 35. Only reviewed mobile/metadata pieces were recovered from the older `fix/p5-mobile-seo-20260916` branch. Older estimator, pricing and transport changes were not replayed over newer work.

The action bar uses the actual hero geometry, starts hidden, and yields to active estimators, menus, visible forms and typing. Phone controls show Call and estimate actions use Get an Estimate. Existing estimator composer, file presentation, contact fields and final submission controls remain intact. Cross-brand handoffs open `/estimate` and explicitly require copying scope/answers and reattaching files; no transfer is claimed.

Approved existing icons/seals provide favicons and sharing previews. Metadata retains canonical/noindex rules and page-specific copy; core-page titles/descriptions were improved. Article/product structured-data imagery is unchanged. No particular Google display is promised.

Interface verification runs production builds, 361 estimator/metadata regressions, Chromium viewport checks at 320/390/768/1440 pixels, and public sitemap metadata/asset checks. These are automated emulated devices, not physical-device or deployed-release verification. Final interface checks and merge status are recorded below.

## Private source measurements and unavailable qualifications

The exact `Neilsen_Preliminary_Budget_No_Numbers.pdf` was retrieved from existing files: four pages, 240892 bytes. Native parsing plus page previews took 1192 ms in this environment. Extracted native text had zero digits on all four pages. Missing numerical facts remain missing; no unredacted copy was opened to fill them.

Available real construction sets with 23 and 15 pages were also retrieved. Parser/render elapsed times were 19115 ms and 31676 ms respectively. The latter included a dense scanned page with 11720 ms rendering. These are private, local parser-only measurements, not live-provider timing, end-to-end performance, accuracy, or requested 25/100-page results. The CI 100-page document is synthetic. Customer plans and private outputs were not committed or included in public CI artifacts.

No independently reviewed exhaustive ground truth is available for the requested real 4/25/100-page workload. No measured 99.9% accuracy, 60-second p95 or 5–15-second live short-scope result is asserted. Benchmark reporting separates fact precision/recall, quantity correctness, inclusion/exclusion, revision and page completeness; model confidence is not accuracy. Stage work sums are distinct from wall time. Runner-to-worker upload is not full browser upload time.

## Activation and remaining release gates

Remote mode stays disabled by default. PDF-only stored submissions within the configured per-file byte limit can use the service; mixed/non-PDF and larger files retain the legacy path. Those slow paths have not been universally accelerated. Failed remote work preserves files and cannot silently return an unchecked estimate. Pricing books, margins, rates and responsibilities are unchanged.

The service needs an always-on process, PostgreSQL, HTTPS, five unique tenant secrets, provider credentials, explicit benchmarked model names, monitoring/resource limits/backups and retention. The new cohost mode reuses the existing P5 Reserved VM and database; a separate host/database is not required. See `services/document-service/.env.example` and README in p5-home-co. No host, paid subscription, limit increase or secrets were provisioned here.

Website server-only settings, verified against the adapter:

```text
P5_DOCUMENT_SERVICE_MODE=remote
P5_DOCUMENT_SERVICE_URL=https://p5homeco.com/api/p5-documents
P5_DOCUMENT_SERVICE_KEY=unique-secret-for-this-site
P5_DOCUMENT_SERVICE_MAX_BYTES=52428800
```

Never use NEXT_PUBLIC_ for these secrets. Qualification must precede activation. Rollback uses `P5_DOCUMENT_SERVICE_MODE=legacy`; mode changes alter job keys, and regression tests preserve existing upload support. Live operational rollback is still untested.

`hello@p5homeco.com` was verified through the connected business inbox. No controlled estimate submission or customer email was sent during this continuation. Live numeric pricing, source accuracy, branded PDF contents/download, actual email receipt, reload/resume, keyboard and all-site/RE-10 full journeys still require a configured worker/provider environment. No real prospects were contacted, appointments scheduled or calls placed.

Next concrete action: obtain supported direct workspace configuration access, synchronize the reviewed mains, and configure P5 cohosting with existing resources and secure tenant/provider settings. Keep adapters in legacy mode during worker qualification. Run the available redacted fixture first, then the benchmark matrix and one complete QA journey before enabling the other four. Real 25/100-page fixtures and independent truth remain missing. Any new recurring infrastructure cost requires owner approval.

## Final GitHub delivery checkpoint

All ten implementation PRs listed above were merged after their applicable checks passed. These are the resulting implementation commits in main; a later documentation-only commit may follow.

| Repository | UI/SEO PR | Implementation main commit | Passing interface run |
| --- | --- | --- | --- |
| p5-home-co | 45 | 6cc78a3b0d436470aca29ebf038d6699bd2811f9 | 35288635582 |
| boise-remodeling-co | 41 | 343c3cfffb4da635fcca31073854867cbb8ab9c3 | 35288637805 |
| Boise-Construction-Co | 38 | 068c1cb15801885e409123e18b4917056b3820fd | 35288640284 |
| Boise-Handyman-Co | 36 | ee96baa5dcdc0ad87be4fc7a69dc9f131554f667 | 35288639297 |
| Boise-Cabinet-Co | 35 | 79538ab55a7d0cf6faf55571c0f4b058192e4215 | 35288641417 |

The final interface audit passed 361 estimator/metadata regressions per repository, all five production builds, and public-page audits of 6 P5, 201 Remodeling, 161 Construction, 150 Handyman and 136 Cabinet sitemap pages (654 total). All audited indexable titles and descriptions were unique within their site; approved brand previews and assets were present. Chromium checked no horizontal overflow at 320/390/768/1440 pixels and mobile hero visibility, after-hero visibility, returning-to-top suppression, labeled Call and at least 44px action targets. Cabinet E2E run 35288641517 also passed. These observations apply to production builds in CI, not the live domains.

PR review covered the scoped diffs and passing automated evidence; no independent human reviewer approval is claimed. GitHub accepted ordinary squash merges using the exact expected PR heads. No branch protection was bypassed.


## Existing P5 host integration — 2026-09-18

Working branch: `feat/p5-cohost-document-service-20260918`, based on main
`a8b38de25354722eee2932b75de83debeefa4d85`. Prior delivered five-site changes remain intact.
Read-only connected Replit inspection confirmed P5 app
`2d29af42-b4a0-47ed-be90-6bb8bfc2c140`, Reserved VM (gce), 0.5 vCPU / 2 GB,
PostgreSQL 16.15 and existing DATABASE_URL. No new service purchase is required by
this implementation. These resources have not demonstrated the target workload SLA.

Implemented opt-in streaming host launcher, private worker, existing database reuse,
conservative concurrency/storage/retention, sampled RSS protection and bounded
restarts. All adapters must support the `/api/p5-documents` URL prefix. Originals
remain unchanged; universal file compression is not claimed. README contains exact
configuration and rollback. No secrets committed. No production activation performed.

Local cohost isolation/HMAC/parser/restart tests and prefixed saved-file adapter test
pass. CI adds actual built Next.js + worker + disposable shared-database startup.
This is infrastructure validation, not live semantic or performance qualification.

Replit cloud-browser access is blocked by its persistent security-verification screen.
Available connector lacks direct shell/secrets/Git-sync operations; Agent writing is
not an acceptable workaround. Finish reviewed Git delivery, then obtain supported
workspace access or owner-applied secure configuration. Do not publish an unsynced
workspace. Worker readiness, real provider benchmarks, all-site remote activation,
customer QA PDF/email and deployed rollback remain open.


## Cohost GitHub delivery evidence

All five PRs merged after their required checks passed:

| Repository | PR | Implementation merge |
| --- | --- | --- |
| p5-home-co | 47 | 86b7e60ae1619de2ded6b9eedce19dac175ae0e3 |
| boise-remodeling-co | 42 | 8ebf9383b3798e3a74d594c7546e7783732c0fe8 |
| Boise-Construction-Co | 39 | a925ee7bb2bc8daaa9194556eece53e5a7552843 |
| Boise-Handyman-Co | 37 | 03072279b5c540d8bd5ce7292543118972aead83 |
| Boise-Cabinet-Co | 36 | f02d348d6661e73435816697d00a9a47a040da0d |

P5 PR run `35296428956` passed: 64 service tests (none skipped), 361 estimator
regressions, saved-file adapter integration, production build (969 broader prebuild
tests passed; one existing database-dependent test skipped), actual cohost startup,
and standalone container boot/authenticated readiness. The cohost smoke verified
existing database reuse and an unchanged website sentinel table. No provider calls.
Satellite PR adapter regressions/builds passed; Cabinet desktop Chrome/Pixel 7
emulated browser suite passed. These are CI environments, not physical devices.

Post-merge workflows are checked separately. Replit remains unchanged during this
continuation because direct workspace access is blocked. No new subscription,
server upgrade, deployment type change, or spending-limit increase was made.


## Follow-up browser focus correction

Post-merge broader browser workflows exposed intermittent WebKit failures on P5,
Construction and Cabinet: scope text was not retained, Continue stayed disabled,
or contact entry did not reveal the submission control. Cohost/service/build checks
passed independently. Do not describe those initial browser runs as all green.

Follow-up PRs: P5 #49, Remodeling #43, Construction #40, Handyman #38, Cabinet #37.
The shared estimator focused stage headings synchronously and again on the next
animation frame. The correction retains synchronous accessible focus, makes the
later frame scroll-only, and cancels stale callbacks. Existing recovery, missing-
information and submission assertions are retained. The full estimator/browser
workflow now runs on relevant PRs before merge. Each linked PR and its exact-head
checks are the authoritative verification record for this follow-up.

No Replit configuration/deployment or live-provider QA occurred during this fix.

## Live cohost qualification: 2026-09-18

Owner configured and republished the existing P5 Reserved VM (0.5 vCPU, 2 GiB)
with the existing production database. Host enabled; estimator mode remains legacy.
No new machine, subscription, or spending limit was requested. Owner confirmed five
unique tenant keys, direct Anthropic model-list HTTP 200, and signed production
readiness HTTP 200. Public homepage returned 200; unsigned readiness returned 401.

A synthetic one-page scope completed with 120 lf painted baseboard, four interior
doors, plumbing/electrical exclusions, and absent door dimensions correctly retained.
Observed customer wait including upload/polling: 20,734 ms. Metrics: parse queue
323 ms, parse job 6,117 ms (page native 59 ms, render 556 ms), read queue 139 ms,
provider reservation wait 213 ms, Anthropic claude-opus-5 reading 11,086 ms.
These nested work durations are not additive wall time. Upload duration was not
separately instrumented in this manual smoke. This is not a p95 or accuracy study.

Reconciliation failed with provider-http-400. A synthetic direct request confirmed
Anthropic's "compiled grammar is too large" rejection. The correction simplifies
large string enums only in the Anthropic wire schema. The original full schema is
still used for local validation; the field vocabulary remains in the system prompt.
Evidence schemas and other providers are unchanged. Regression tests exercise
rejection of unknown fact, conflict and clarification fields after simplification.

Branch: fix/p5-review-schema-20260918. Live acceptance of the simplified schema is
still pending. After reviewed merge, pull P5 and republish, then retry the existing
failed review using its retry endpoint; do not reupload or reread the successful PDF.
Synthetic project: p5-qa-1789704249953.
Review: d331348c215480aeb7464fa574ef0d2c3d2cb7c1a90e5def5030b84b4d470ea9.
All five remote adapters remain unqualified. Real documents, full customer journeys,
PDFs, QA email, resource/recovery checks and performance targets remain open.

## Reconciliation grammar follow-up: 2026-09-18

PR #50 merged as 6a1fc872f64bd50d595fa4d9c6f12a23704fe577 after all service/database,
adapter, estimator, production-build, cohost and container CI checks passed. The
owner pulled and republished. Replit initially proposed dropping all seven p5ds_
production tables; publication was stopped. Owner ran the additive schema setup
against the verified Helium development database and reported PASS, then published.
The saved production review remained present, but its retry failed with HTTP 400
in 3,680 ms. A direct synthetic request confirmed the first patch was present and
claude-opus-5 still rejected its compiled grammar. That patch did NOT resolve the
live failure. The source document is still read; do not reupload it.

Branch fix/p5-review-tool-output-20260918 replaces Anthropic reconciliation's
compiled JSON output with one regular client-tool data payload. No tool actions
are executed. The original schema and existing semantic validator remain required.
Source readers and other providers retain their prior request formats. Regression
coverage rejects unknown fields, missing/extra properties, string quantities,
truncation/refusal, absent/wrong/multiple tool calls, and unexpected tool responses
to source-reading requests. Global provider capacity is released on validation
failure; no second request or page reread is introduced. Token reservations now
include schema characters. This format requires a model supporting forced tools.

A single-request synthetic preflight is checked in at
services/document-service/scripts/check-review-provider.mjs. Run it in the P5
workspace after pulling reviewed main and BEFORE another publish. Inspect provider
acceptance and the validated scope result. Then republish without destructive
migrations and retry the existing saved review. Live acceptance of this new format,
all-site remote activation, real-fixture accuracy/performance, pricing/PDF/email
and full browser journeys remain unverified. No cost increase or new infrastructure.

## Custom scope and choice validation follow-up: 2026-09-18

Recovery base: main d6d68116cb18598297a3c3dcd335d51207cf1822 (PR #51).
Working branch: fix/p5-custom-scope-facts-20260918. Owner's synthetic preflight
returned HTTP 200 and a validated review in 22,321 ms. After republishing, the
saved production review reached semantic validation but failed with
invalid-choice-fact after 29,824 ms. The exact rejected field is not available;
the saved page's finish hint "Painted baseboard" is one regression case, not a
confirmed diagnosis of the rejected response. Successful PDF evidence remains saved.

Owner requests automatic custom work items and average-price allowances for work
outside the catalog. The existing complete-scope pricing engine supports dynamic
tasks, maintained rates, researched averages and explicitly disclosed regional
planning allowances. The immediate gap is earlier: a non-enum description in a
known choice field aborts the entire document review before pricing.

Write access proved with documentation-only branch commit
ecee797cb924ca2c748d1214f02a6d74a3a45db9 before implementation.

Implemented: exact choice spelling normalization (case, spaces and underscores),
with unmatched descriptions retained as otherDetails including the original field
label, value, confidence, basis and source evidence. No guessed category or grade,
extra AI call, source reread, new price database or cost-book change. Prompt guidance
distinguishes physical finishes from finish grades and keeps specification questions
off quantity fields. Numeric, structural, takeoff-provenance and coverage validation
remain enforced. Preflight input now includes the saved synthetic page's field hints.

Local results: 75 service tests passed; nine PostgreSQL-dependent tests skipped
locally and required in CI. All 362 estimator regressions passed. Type checking
passed. New regressions preserve unknown scope through the website extraction
adapter and dynamic pricing, including a sourced average and a disclosed planning
allowance after research timeout, positive quantities, one line per physical item,
electrical exclusions and unchanged financial reconciliation. These use synthetic
rates and mocked provider responses, not real market prices or live-provider proof.
Saved-file/SQL adapter integration also passed. Repository-wide lint remains failing
on pre-existing violations; the changed pricing test has the same lint findings as
main, and all changed service code/scripts/tests pass scoped lint. No new lint
violations are introduced. The final pricing regression rerun passed all 44 tests.

Release: PR #52 merged as 9e71382acc049a265385a44d599c6a1e1009bdac.
Reviewed head: 83f8d0552491914474f47ebd0b877839df5016f7.
The merged tree exactly matches tested tree 37749982508102176efec4400c213ce3eb023377.
CI run https://github.com/webiq1206/p5-home-co/actions/runs/35310610662 passed:
real PostgreSQL/HTTP/PDF/coverage tests, saved-file adapter integration, estimator
regressions, production build, existing-server cohost startup, and worker container
build/startup/authenticated readiness. No live provider was called by these tests.

Latest satellite main branches were fetched and compared: Remodeling d5c2b14e,
Construction c3d63f0b, Handyman 267e919d, Cabinet 26d41d89. All five share identical
scopePricing.ts and pricing.ts blobs (a8e1194be3efb3a8dd4087ecf35fade3236d3926 and
d76a128018a88ab51c865012055dfd628056896f). Their existing custom-task and allowance
engine does not need duplication. This release changes shared P5 service behavior.

Deployment remains pending. This session cannot run the Replit Shell through the
available connector; the owner must pull P5 main and republish without destructive
migrations. Then run:

    node services/document-service/scripts/check-saved-qa-review.mjs

This script retries only the existing failed synthetic review once and polls it.
It never uploads or rereads the saved PDF and never sends email. Inspect the returned
120 lf baseboard, four doors, unknown door dimensions and plumbing/electrical
exclusions. Direct Replit shell/configuration remains unavailable to this session;
the owner executes this single command. A passing result is only deployed review
qualification. All-site activation, real-document performance/accuracy and full
pricing/PDF/email/browser qualification remain open. No new infrastructure or spend.

## Deployed reconciliation PASS and website handoff: 2026-09-18

Owner ran the saved-review check after publishing PR #52. The existing synthetic
review completed in reported 23,244 ms, retaining 120 lf baseboard, four doors,
unknown door dimensions and plumbing/electrical exclusions. Painted baseboard is
now a materials fact, not a finish-grade choice. This timing covers reconciliation
of cached source evidence only, not upload/extraction, a p95 sample or full pricing.
The original document was not uploaded or read again. No numeric price, PDF or
customer email has yet been qualified through the remote website path.

Follow-up branch: fix/p5-document-followups-20260918, based on main
a8deccd32c747487ec04450baa1baab064826405. Reproduced a website question bug with
the successful synthetic result: existing materials and otherDetails values hide
the still-unanswered material-supply and door-dimension questions. The API now
projects text clarifications into independent saved question cards, including for
cached completed reviews. Numeric/optional-field handling is retained. Evidence,
takeoffs, coverage and the stored result are unchanged, and no extra AI call runs.
Both the reproduction and answered-question removal regressions pass locally.

Also freeze terminal elapsed times at updated_at; later polling previously counted
idle time since completion. P5 cohost startup now reuses its own existing tenant
key and HTTPS URL only when remote mode is explicitly selected. It never enables
remote mode itself, sends that key to an external URL, or configures satellite
sites. Explicit configuration wins. No new infrastructure, secret values in source,
database migration or raised budget. Keep satellite adapters in legacy during P5 QA.

Local verification: 79 service tests passed, nine PostgreSQL tests reserved for CI;
364 estimator regressions passed. Saved-file SQL adapter integration, TypeScript
and lint on every changed source/script/test passed. New authenticated HTTP tests
cover cached GET and POST responses, no stored-result mutation, and stable elapsed
times. CI run https://github.com/webiq1206/p5-home-co/actions/runs/35346825830
passed all service/database/HTTP/PDF tests, adapter integration, estimator
regressions, production build, existing-server cohost startup and actual worker
container build/startup/readiness checks. No live provider was called by CI.

Release: PR #54 merged as d48fd9586bbc717d204225b1c64f651f1c9d7510.
Reviewed head: 4ec036f8eb03bcc2fcf8f5559a1fd81de085b638. The merged tree exactly
matches tested tree 23d04dca4b1bb1e8f894543866d62d40cebfb099. Replit deployment
of this release remains pending; direct Shell/configuration access is unavailable
to this session, so the owner must pull P5 main and republish. No database
migration is part of this release; do not approve deletion of production tables.

Next: publish the P5 update. The existing check-saved-qa-review.mjs command then verifies the
cached review and pending website questions with no further provider call. The
P5 website adapter still requires explicit remote activation for the controlled
customer journey. All-site rollout, independent real-document accuracy/performance,
reload/resume, pricing, branded PDF, QA email and rollback remain open.

## Deployed question handoff verified: 2026-09-18

The owner published PR #54 and ran check-saved-qa-review.mjs. Both deployed
checks passed: the saved synthetic review is complete, and the door/material
follow-up questions are present in instructions.questions. The saved result
retains 120 lf baseboard, four doors, unknown door dimensions and plumbing/
electrical exclusions. Reported terminal reconciliation time is 22,700 ms;
this reads the existing completed result, with no new upload or provider call.
It is not total customer wait, a new benchmark sample or evidence of a speedup.

Recovery main: 6521ef0b83763175675c2edff4b0f00f8e1f28f9. Compared with ledger
release 582e3e864528318cea354d78c622003f0002451c, the six newer commits record
Replit publishes and introduce no file changes. Existing code was preserved.
Connected Gmail profile confirms hello@p5homeco.com is the authorized QA inbox.
No new infrastructure, machine upgrade, spending-limit change or subscription.

A controlled live website test used an isolated cloud-browser
tab at https://p5homeco.com/quote, not the owner's browser or a physical device.
The synthetic typed scope specifies 120 lf painted MDF baseboard and four
30x80-inch prehung interior doors including casing, hardware and painting,
contractor supply, Caldwell location, ready openings and explicit exclusions.
The UI asked only for the service choice and retained all supplied scope details.
Reload/resume preserved the reviewed scope and contact form; the required review
checkbox correctly needed confirmation again. Phone is blank, and the test name
is P5 QA Trim Journey 20260918. No real prospect is involved. This typed test does not exercise the remote PDF
adapter, which still requires explicit P5-only activation after qualification.

### Live pricing failure and scoped correction

The typed QA journey released $6,825-$8,925 after more than five minutes of
pricing. This is an observed slow run, not a percentile benchmark. Actual customer
email reached the verified business inbox at 2026-09-18T13:14:01Z, reference
95d669b3, with a 16-page PDF attachment. This is NOT a valid completed estimate:
the email/PDF audit explicitly says baseboard material and installation fasteners
are unpriced. The total nevertheless shipped because the final release policy
demoted non-question audit failures to assumptions, including after the repair
time budget expired. No customer range from this QA run is approved for use.

The material mapper proposed 132 LF against 120 installed LF. Rejection of that
unvalidated quantity did not remove it from research's "already covered" input,
so subsequent finishing allowances omitted the actual baseboard material.
Changes on qa/p5-deployed-followups-20260918:

- Preserve missing-work, quantity-conflict and duplicate-charge findings as
  blocking. A time budget or partial allowance cannot authorize incomplete totals.
- Research receives actual positive priced components only, including validated
  additions once, excluding rejected proposals and removed components.
- Permit explicitly labeled material procurement waste with reviewed base
  quantity, percentage, containing range and checked arithmetic. Installed labor
  keeps its reviewed quantity. No pricing rates, finance policy or measured source
  quantities were changed.
- Stop presenting unresolved pricing blockers as routine "To confirm" assumptions.
- Fix a separately reproduced saved-timeout replay bug: small failed stages now
  make bounded real attempts, successful replies remain cached, large mappings
  retain their split children, and three actual timeouts exhaust the stage.

The chat PDF download event did not complete in the cloud-browser check; its
download remains unverified. Email receipt and PDF text were inspected, but PDF
visual layout, physical devices, all-site email and complete-price correctness
remain unqualified. The verbose 16-page small-job report needs a later presentation
review. Remote PDF adapters, RE-10, live 4/25/100-page benchmarks, independent
accuracy qualification, concurrency and live rollback remain open.

No deployment settings, database rows, production documents or provider limits
were changed by these fixes. No new paid infrastructure. After reviewed merges,
the owner must pull and republish because direct Replit Shell/configuration
access remains unavailable. Next live check is a new complete-scope QA price,
then P5-only remote-PDF qualification. Do not re-run the cached review checker as
a substitute for either, and do not enable all five adapters yet.

Validation before PR: all 366 estimator regressions pass. The new PGlite-backed
test exercises actual saved pricing claims, persistence and replay with synthetic
provider replies, including one-time recovery, three-attempt exhaustion and split
mapping cache reuse. TypeScript passes; the new script passes ESLint. Existing
scope-pricing source/tests contain pre-existing explicit-any lint errors, so a
repository-wide clean lint is not claimed. Production builds and CI are required
before merge. No new live provider performance claim follows from these tests.

Write-path checkpoint: progress-only commit 0973a360cadcc0ef5d264a2bad80672bebb8c838
was committed and pushed to qa/p5-deployed-followups-20260918 using the authenticated
GitHub connector. It changes no production source.

## Verified pricing release: 2026-09-18

All five scoped source PRs were merged only after their exact-head checks passed.
Each merged tree was checked against the reviewed source tree. No branch
protection was disabled or bypassed. Deployment remains PENDING on all five apps.

| Repository | Merged PR | Main source commit | Verification run |
| --- | --- | --- | --- |
| p5-home-co | [#56](https://github.com/webiq1206/p5-home-co/pull/56) | `c69cbeee1d8a8bd234fab29b1fbddb599dc652ff` | [CI 35350835851](https://github.com/webiq1206/p5-home-co/actions/runs/35350835851) |
| boise-remodeling-co | [#44](https://github.com/webiq1206/boise-remodeling-co/pull/44) | `3af8609a0bb5851b0f789e4bbaf638230287bb55` | [CI 35350912261](https://github.com/webiq1206/boise-remodeling-co/actions/runs/35350912261) |
| Boise-Construction-Co | [#41](https://github.com/webiq1206/Boise-Construction-Co/pull/41) | `2b7bc3177a05364c19ce21737ed3e9e4f619aa75` | [CI 35350918661](https://github.com/webiq1206/Boise-Construction-Co/actions/runs/35350918661) |
| Boise-Handyman-Co | [#39](https://github.com/webiq1206/Boise-Handyman-Co/pull/39) | `e3a0c3130745bc84094c8b54db45ee8997da042a` | [CI 35350926876](https://github.com/webiq1206/Boise-Handyman-Co/actions/runs/35350926876) |
| Boise-Cabinet-Co | [#38](https://github.com/webiq1206/Boise-Cabinet-Co/pull/38) | `525b7c7037bd32b942c3212ca9c6a3eeb84d8853` | [CI 35350934070](https://github.com/webiq1206/Boise-Cabinet-Co/actions/runs/35350934070) |

Exact reviewed source:
- p5-home-co: head `06a3b149cea7194c12da8ce6b8c3d9ad627b1e18`; tree `bc5b3b9136b73237c8a4d893ee8d45ea4e5d57e2`.
- boise-remodeling-co: head `62ecff1396d80ee530d15da003d1bab999ea25fd`; tree `5c9ad3665210f604fcc83f93513fa75d09a2805c`.
- Boise-Construction-Co: head `9abe8d6476c3688ee49ec9c84d42a7fa05b8809c`; tree `b5cca429df368e34c83c3eabcb9fa886be4db452`.
- Boise-Handyman-Co: head `b323695fa175c40b17be02e52027df29219df690`; tree `e4d5654745ee3029e350e40f27822603cec180bb`.
- Boise-Cabinet-Co: head `18a51c4fceaab8380b3e8acceb958b78ca6ed5dd`; tree `ecdebaeb4b92a4e362729fd4b1355f78e25088e7`.

P5 CI passed 88 standalone service/database/HTTP/PDF tests, saved-file adapter
integration, 366 estimator regressions, saved-pricing SQL recovery, production
website build, cohost startup and actual container build/startup/readiness.
The site's prebuild suite recorded 974 passed, zero failed and one skipped.
Each satellite passed 363 estimator regressions, saved-file adapter integration,
saved-pricing recovery, TypeScript with its own dependencies and its production
build. Cabinet additionally passed 54 browser tests in Desktop Chrome and
emulated Pixel 7 under [E2E run 35350934074](https://github.com/webiq1206/Boise-Cabinet-Co/actions/runs/35350934074).
These browser checks use CI fixtures; they do not establish live-provider,
customer-email, physical-device or document-performance qualification.

The original Neilsen_Preliminary_Budget_No_Numbers.pdf was retrieved from the
available files. The two exact-name copies are byte-identical: 240,892 bytes,
SHA-256 ef5caf06821319350a3f672d98a1c42db2311d601d570cb5345d76f9808a3018.
It has four pages with native text. Local text extraction contains zero digit
characters. This is a file-availability/parser observation, not a live document
benchmark or independently reviewed accuracy score. No unredacted copy was read,
no missing values were supplied from another source, and no file contents were
committed or uploaded to public CI. The fixture does not need to be re-uploaded.

Owner deployment action:
1. In each existing Replit app, pull its matching repository's main branch.
   Preserve any unpushed workspace changes and resolve rather than discard them.
2. Republish using the existing deployment settings. This release has no database
   migration and requires no new secret, capacity increase or subscription.
3. Run a new controlled P5 customer price to confirm all material and labor
   components, complete range, concise PDF and actual QA-email contents. The
   previous 95d669b3 QA range remains invalid; cached review success is not this
   check.
4. Then qualify the P5-only remote PDF path using the retrieved four-page
   redacted fixture. Expand to the other sites only after that passes.

Direct Replit shell/configuration control is unavailable in this session; owner
pull/republish is the current deployment blocker. No live deployment of the
pricing fix, all-site activation or performance target is claimed. The retained
completion ledger above still governs document benchmarks, accuracy review,
RE-10, rollback, PDF presentation and remaining UI/SEO verification.

## Sonnet model qualification in progress: 2026-09-18

Working branch: qa/p5-sonnet-real-documents-20260918, recovered from main
115d9f3382e8173cf6a0995632e63babb9778d46. Preserve the five pricing releases above.
Owner authorizes testing Sonnet on the original four-page redacted PDF and a
larger real plan set. Existing planning-cost logic already permits disclosed
standard-profile and regional-average allowances; asking more questions is not
itself an accuracy measure. Missing source quantities and exclusions stay intact.

The owner-run single synthetic Sonnet 5 review passed structural/provenance checks
in 11,541 ms, versus the earlier Opus 5 check at 22,321 ms. This one comparison
is not an average, percentile, independent accuracy score or PDF processing test.
The Sonnet result retained 120 lf baseboard, four doors, absent door dimensions
and excluded plumbing/electrical. It did not flag baseboard supply/paint choices;
their eventual handling as questions or disclosed allowances needs qualification.

Available private fixtures: exact Neilsen four-page file (digest above), Lot 23
construction set (23 pages, 12,468,822 bytes), Lot 29 (15 pages, 19,107,678 bytes).
Earlier parser-only runs do not establish provider behavior. No 100-page real
set has been selected. Never pad a plan set to claim that workload was tested.

Direct Replit Shell execution and provider credentials are unavailable here.
No keys were requested or exposed, no production model/configuration was changed,
and no paid provider calls have been made by this session. Next: prepare an
isolated, bounded runner using the actual service pipeline, then have the owner
execute it where the existing provider key is available. Keep source documents
and reports outside public Git and CI artifacts. No new server/database service.

## Unit-rate persistence and bounded Sonnet runner: implementation checkpoint

GitHub write path proved on this branch with progress commit aec26c9.
Extended the existing site-local regional rate store to retain both sourced
benchmarks and disclosed provisional planning costs by normalized unit. Approved
cost books retain priority. Specifications, cost responsibility, includes/excludes,
locality, source dates and unchanged expiry travel with the rate. Project
quantities, uncertainty ranges, building/floor and conditions do not.
Only publishable complete-scope pricing results enter the reusable store.
No new database schema or paid infrastructure. Legacy v2 rows are preserved.

New regressions verify reuse without another research call, fresh quantities,
expiry, distinct specifications/responsibilities and rejection of unsupported
rate bases. Actual isolated-SQL persistence verifies idempotency and site/location
isolation. Five unit-rate tests pass; complete P5 website suite: 979 passed,
one pre-existing database-dependent watchdog test skipped. TypeScript passes.
Full repository lint remains failing on existing debt (351 errors, 53 warnings);
it is not represented as passed. Production/CI verification follows this commit.

Added a private-bundle Sonnet-only runner using the actual service parser, queue,
Reader and reconciliation code in isolated PGlite. No production DB, pricing,
email or model configuration changes. Estimated guards: short $1/12 requests,
plans $3/64 requests; these are estimates, not a guaranteed provider billing cap.
Completed work persists, failures stop rather than silently using unchecked data.

Four-page exact fixture: parser-only 1,083 ms, all four pages native.
Real 23-page plan set: parser-only 19,555 ms, nine pages without native text.
These exclude upload and AI, were run locally, and are NOT customer performance.
Original four-page source visually reviewed including appliance product-only
allowance versus separately carried ancillary work; no missing values recovered
from another file. Targeted plan check identifies scanned page 10 as A5.1.
Mocked-provider SQL/parser/pipeline and cached-resume tests pass, as do the
manifest persistence tests. Fixed a worker-exit race when all pages are cached
and the final manifest checkpoint is still saving, preventing a false reparse.

Live Sonnet tests remain blocked on execution in the owner's authenticated
Replit Shell. The private bundle is available separately, outside public Git.
Run instructions and test limitations: docs/p5-sonnet-unit-rate-qualification.md.
Next concrete step after reviewed merges: pull P5, upload that bundle, run the
single documented command, inspect reports before changing production models.
All five websites require pull/republish for rate-library activation. There is
no cross-site rate API or claim that live adapters, prices, PDFs and emails have
passed from these tests. Full original completion ledger remains open.

## Reviewed main releases and remaining owner action

All five unit-rate releases passed their applicable PR checks before merge:

| Repository | PR | Reviewed source | Main merge | Passing checks |
| --- | --- | --- | --- | --- |
| webiq1206/p5-home-co | [#58](https://github.com/webiq1206/p5-home-co/pull/58) | `2fc26581eded41ac8a6ad1042bdeb175d4b31197` | `6165f9d87d01930d020b5fd6701e55466e285fc4` | [35355404000](https://github.com/webiq1206/p5-home-co/actions/runs/35355404000) |
| webiq1206/boise-remodeling-co | [#45](https://github.com/webiq1206/boise-remodeling-co/pull/45) | `ad41824fe4b514b3c4580ffe1be68fc24d7c2e0a` | `ba86dfdff04d4a76f3bd118fa9b9dce1cc19ea05` | [35355462177](https://github.com/webiq1206/boise-remodeling-co/actions/runs/35355462177) |
| webiq1206/Boise-Construction-Co | [#42](https://github.com/webiq1206/Boise-Construction-Co/pull/42) | `184d89d145e04a67a4da6b8677ff6d16ac75b8c1` | `fd2b82e26a91476f01d9cbd41e0391b986552502` | [35355470200](https://github.com/webiq1206/Boise-Construction-Co/actions/runs/35355470200) |
| webiq1206/Boise-Handyman-Co | [#40](https://github.com/webiq1206/Boise-Handyman-Co/pull/40) | `83c56f8bd495eb909d92d466e67322d746b37391` | `6583b47af65f6ba9da9da61769d6d7d249a5b1fc` | [35355477578](https://github.com/webiq1206/Boise-Handyman-Co/actions/runs/35355477578) |
| webiq1206/Boise-Cabinet-Co | [#39](https://github.com/webiq1206/Boise-Cabinet-Co/pull/39) | `fc6d9b0e9cdda559c5e6610ce08c254f370f35e6` | `32305f51d6433e1b922da57262acaddf663d5df7` | [35355490109](https://github.com/webiq1206/Boise-Cabinet-Co/actions/runs/35355490109), [35355490172](https://github.com/webiq1206/Boise-Cabinet-Co/actions/runs/35355490172) |

P5 CI: 94 service tests, 371 estimator regressions, 979 full website tests
passed (one existing database-dependent watchdog test skipped), actual isolated
SQL unit-rate persistence, adapter integration, saved pricing recovery, production
build, cohosting smoke and production container/database readiness passed.
All four satellite estimator/type/build gates passed. Cabinet additionally passed
54 Chromium/Pixel 7 browser tests using emulated devices, not physical devices.
These are CI/infrastructure checks with controlled semantic providers, not live
Sonnet accuracy or deployed customer journey qualification.

Deployment was not changed. Owner action: pull main in the existing Replit apps
and republish to activate unit-rate reuse. No new secrets, tables, server or
subscription is required for this change. Preserve any unrelated workspace
commits when pulling. Revert the corresponding unit-rate PR and republish to
roll back; retained v3 rate records can remain unused. Do not delete tables.

For live model qualification, download the private p5-sonnet-fixtures.json bundle,
upload it into the P5 workspace root, then run the command in
[the qualification instructions](p5-sonnet-unit-rate-qualification.md).
This uses the existing provider credential in Shell without changing production
models. Return the printed summaries and private report files for source review.
No paid model request was made from this session. Production Sonnet activation,
real-file extraction precision/recall, quantity correctness, all-site customer
prices/PDFs/emails, and 100-page percentile targets remain unverified.


## Sonnet transition handoff and preflight recheck, 2026-09-18

Owner requested a full next-session execution prompt, exact Sonnet settings and
complete all-site qualification. Added docs/p5-sonnet-switch-runbook.md with
verified document/scope/pricing model names, the higher-priority scope override,
provider-routing distinction, private test command, limits and remaining gates.
The full private continuation prompt and fixture bundle are supplied separately.

All five main SHAs and successful source PR workflows listed above were rechecked.
An additional 25 focused local tests passed with mocked provider responses and no
paid AI calls: 10 QA/cohost tests plus 15 unit-rate/adapter/provider tests. Existing
production build evidence is unchanged; documentation does not claim a new build.

The P5 connector reports a successful publication but no deployed Git SHA; it
still exposes no direct Shell or configuration editing. No production model,
secret, database, spend limit, deployment setting or code was changed here.

Private read-only inspection of the earlier QA email confirmed repeated customer
PDF exclusions and verification/assumption text. No presentation/download fix was
made. Chat PDF delivery, latest pricing fixes and all-site journeys remain open.

Next concrete action: run the already merged bounded Sonnet runner in the existing
P5 Shell with the private fixture bundle. Review its private reports before
claiming document qualification or extending remote activation. Sonnet production
settings and broader website pricing/provider routing require separate observed
verification. Do not reuse completed old review results as fresh Sonnet evidence.


## First real Sonnet short-file failure, 2026-09-18

Owner ran the bounded private four-page fixture in Replit. Parsing reached four
pages, but zero pages completed AI verification. The same read job returned
provider-timeout on three attempts; current invocation was 126398 ms. The runner
stopped before the 23-page plans. Its approximately $0.465 cost reservation has
no returned usage and is not a verified Anthropic charge.

Source inspection confirms a 40000 ms default call deadline and up to three
transient retries. Text pages can share a four-page read request. Timeout recovery
currently repeats that batch; existing adaptive page splitting only covers invalid
or incomplete outputs. The cause of provider latency is not yet established.

Working branch: fix/document-read-timeout-recovery-20260918. Preserve the failed
private checkpoint. Investigate bounded single-page recovery and add no-cost
regressions before requesting another paid run. Do not raise limits, republish,
change production data or claim real-file qualification from synthetic tests.

Local source parsing confirmed this exact short PDF groups pages 1-4 into one
read (13982 native text characters). Implemented lease-fenced atomic single-page
recovery for multi-page provider timeouts and numeric request-shape metrics.
66 focused tests pass, including isolated SQL rollback, stale-lease fencing,
cancellation, cached-page preservation, bounded single-page failure, existing
provider schemas and QA cost guards. These tests use controlled responses and
make no paid AI calls. Live latency and accuracy remain unverified. No timeout,
output budget, model, slot setting or spend limit was raised. Await PR checks and
inspect the owner's private failed report before a further paid test. The existing
source-fingerprinted runner creates a fresh ledger after a source update; previous
estimated costs are not part of the new ledger.


## Second real Sonnet short-file failure, 2026-09-18

Owner reran after PR #61. Adaptive splitting preserved one completed page, but
single-page reads still timed out. Eight paid requests were started, seven had
unknown charges, and the estimated spend guard stopped the run at $0.935268.
The only returned usage included 3478 output tokens. Invocation time was 164919
ms. The 23-page plans did not run. This is not a successful document test.

Stop further paid reruns. Source inspection cannot yet distinguish provider wait
from response generation within the 40-second limit. Larger generated output is
a hypothesis, not a confirmed root cause. Working branch:
fix/sonnet-qa-stop-on-unknown-charge-20260918. Add a persistent stop after unknown
charges and a no-network inspection of saved timings and completed evidence.
Do not raise deadlines, spend limits or change production models speculatively.

The QA guard now pauses after the first interrupted/unknown-charge generation,
persists that stop across restarts and checks it again after concurrent token
counts. QA concurrency is reduced to one. Production processing, models, limits
and fingerprint e887478622096021 are unchanged; this patch does not silently
reset the failed run's checkpoint or budget. Incomplete reports preserve saved
page evidence. The free inspector selects the latest short report and queries a
disposable database copy, printing timings and evidence counts without source
text, secrets, provider calls or changes to the original checkpoint.

16 focused local tests passed (11 QA/inspection and five existing read-recovery),
including response interruptions, missing/invalid usage, estimate caps, concurrent
pause races, restart blocking and preserving a completed page. Original checkpoint
file sizes/modification times were unchanged by inspection. No paid request or
production deployment was made. Await PR CI before merge. Actual Sonnet latency,
source accuracy and the 23-page test remain unresolved; obtain the free saved-run
diagnostic before selecting another processing change or paid experiment.


## Saved-page Sonnet effort investigation, 2026-09-18

The owner's free diagnostic confirms 3692 ms parsing, negligible provider
admission wait and one completed page in 30618 ms. That response used 3478
output tokens including 1007 thinking tokens. Pages 2-4 still hit the 40000 ms
call deadline. Seven interrupted requests have unknown actual charges. Thinking
is a measurable contributor, but incomplete responses cannot establish what
caused their delays. No larger fixture or full-file accuracy pass is established.

Working branch: test/sonnet-medium-effort-saved-page-20260918. Anthropic's current
effort guidance confirms Sonnet 5 defaults high and supports medium; reduced
effort can trade quality for speed. Prepare a QA-only, single saved page-2 probe
at medium effort using the original request, schema, image, quote checks and
40-second deadline. Preserve production defaults and the existing failed run.
Limit the experiment to one generation request and a separate, explicit $0.20
estimated reservation. Repeated invocations must reuse its saved outcome or stop,
never retry or reset the ledger. No new PDF upload, parsing or production access.
Validate the probe with controlled responses before another live request.

Implemented check-sonnet-saved-page.mjs as a QA-only request decorator: only
output_config.effort changes to medium. Production source, defaults and the
full-run fingerprint remain unchanged. Page 2 is taken from a disposable copy
of saved QA storage; the original page evidence and failed cost ledger stay
untouched. The probe has a permanent one-attempt directory lock, one-call guard,
$0.20 additional estimated reservation and durable outcome. Repeated commands
read the outcome or stop. Visual/calculated evidence requires further verification;
structure and quotes are never reported as measured accuracy.

20 focused local tests passed without paid API calls, covering exact request
parity apart from effort, page selection, schema/quote/truncation rejection,
unknown-charge stop, estimate cap, concurrent/crashed attempts, cache reuse and
original-checkpoint immutability. The existing free inspector also passed its
regression after sharing its disposable-copy helper. Await full PR CI before
merge. No production deployment or model change has been made. Next live action
is one saved-page probe, followed by source review; the full file and plans remain
blocked on qualification.


## Real saved-response failures and completion work, 2026-09-18

Owner supplied the medium-effort page-2 response and requested finalization.
Provider completed in 36604 ms, returning 4554 output tokens with 291 thinking
tokens; estimated reported-usage cost is $0.058087. Schema passed. Native quote
validation rejected a fact joining two real source excerpts with an ellipsis.
The response also requested crops to recover deliberately absent values. This
is not an accuracy pass, even though all 15 main table divisions were retained.

Working branch: fix/document-evidence-recovery-20260918. Verify abbreviated quotes
against every ordered source fragment, preserve missing values, prevent crops
whose only request is to recover explicit blanks, reduce duplicated reader output
and use supported Sonnet read effort. Revalidate the actual saved response free
of further AI calls. Prepare one resumable qualification command that preserves
successful pages and old cost ledgers, then processes only unfinished work under
existing bounded estimates. Check live websites and address PDF presentation and
download faults with observed evidence. Full-file, pricing and all-site live
qualification remain open until their real results pass.


### Completion implementation and local evidence

The actual saved response replays successfully with all 15 table items. Ordered
ellipsis fragments must each occur exactly and in order; invented/reordered
fragments still fail. Crops solely requesting recovery of explicit redacted
numbers on reliable native text are removed. Scans, drawings, mixed visual
concerns and already-partial pages remain subject to verification. Missing
numbers are never filled. Counts remain component-specific at reconciliation.

Sonnet source reading now uses one page per call and explicit medium effort;
visual verification and reconciliation retain their existing effort. Prompts
reduce redundant output without shrinking the schema or omitting distinct work.
No production timeout, output, concurrency, account limit or infrastructure size
was increased. Full semantic quality and latency still need live qualification.

The consolidated completion runner validates source checksums and saved native
text, imports only completed evidence, preserves original databases/ledgers,
processes remaining work and gates the plans on the short result. Tests prove
pages 1 and 2 make no further provider requests, parsing is bypassed for saved
native pages, a repeated completion incurs no extra calls, and original files
remain byte-for-byte unchanged. A fixed profile and exclusive lock prevent
concurrent processing and source-fingerprint budget resets.

Local checks passed: 71 document validation, recovery, cost-guard and probe
regressions; 57 estimator presentation, pricing and unit-rate regressions;
TypeScript; isolated estimate persistence, PDF generation and simulated email
retry/CRM tests. The one-page branded customer PDF was rendered and inspected.
These are offline tests with intercepted providers, not paid source qualification.

Read-only browser checks loaded all five live estimator entry forms. The older
P5 QA result displayed duplicate exclusion sections. Its browser download event
did not complete during the observation window; no server root cause is inferred.
Shared changes consolidate exclusions and exact duplicate assumptions, apply
compact PDF spacing, validate PDF responses, attach the download link to the DOM
and allow a longer object URL lifetime. Release browser tests cover download
bytes and error retry in Chromium and WebKit at mobile and desktop viewports.

Await exact-head release CI before merge. No new provider charge, customer email,
production database mutation or Replit deployment occurred during these checks.
The direct Replit Shell/configuration connection remains unavailable; the owner
must pull reviewed main and publish before deployed behavior can be verified.
