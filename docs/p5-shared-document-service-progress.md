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
times. The full CI production build, cohost and container gates remain required.

Next: finish the full test/build/cohost checks, merge reviewed source, and publish
the P5 update. The existing check-saved-qa-review.mjs command then verifies the
cached review and pending website questions with no further provider call. The
P5 website adapter still requires explicit remote activation for the controlled
customer journey. All-site rollout, independent real-document accuracy/performance,
reload/resume, pricing, branded PDF, QA email and rollback remain open.
