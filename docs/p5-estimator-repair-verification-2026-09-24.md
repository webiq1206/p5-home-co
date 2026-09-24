# Estimator repair release 2026-09-24.1

This release implements the repair plan in `p5-estimator-repair-plan-2026-09-24.md` directly in the five GitHub repositories. It is a source-code repair release with substantial automated verification. It is not a claim that every production scenario has been proven correct.

## Changes delivered

1. **One pricing path.** Remodeling, Construction and Handyman assistant pricing actions now direct customers into P5. Their continuation buttons preserve customer messages and unsent notes; existing projects are archived before a new chat project is created. Old assistant prices cannot become approved pricing evidence. Obsolete project, RE-10 and plans API endpoints return HTTP 410 with `/estimate` as the continuation. Cabinet already used this pricing path.
2. **Scope preservation.** Accepted extraction responses retain all valid facts, conflicts and summary text, within the overall response limit. Large mapping batches are bounded to 32 tasks without discarding genuine scope. Both cross-brand handoff links use the transfer operation. Transfers retain full accepted text/answers and a manifest of original files that must be reattached. Missing originals remain visible and cannot silently disappear when only one file is reselected.
3. **Correct price reuse.** Cache identity includes the actual financial policy, catalog details, complete fixed cost rules, regional evidence and corrections. Newly supplied or removed customer decisions invalidate reuse. Prose is ignored only when attributable to an exact extracted fact in an unchanged uploaded document. A reader repeating a customer clarification cannot erase that decision from the identity.
4. **Learned costs retain evidence.** Learned rates carry provisional/review-required status, service, region, finish, validity, responsibility, source evidence and unit context. They are no longer promoted into owner-approved catalog rates. Reuse drops the old project's quantity. Expired records can be refreshed under a stable identity with prior versions retained. Legacy records remain reviewable but cannot silently acquire approval.
5. **Durable completion.** The worker heartbeat wakes the complete estimator driver. The authenticated cron route advances jobs, finishes requested submissions and processes delivery. Temporary 408/429/5xx responses remain retryable. An older completion cannot mark a newer submission request finished.
6. **Immutable revisions.** Reopening and archiving a submitted estimate is atomic and revision-fenced. Concurrent change requests produce one winner and one original archive. Customer and administrator history reference the same preserved issue.
7. **Truthful progress.** Analysis ETA includes downstream pricing and final checks. It remains a workload-based estimate, not a processing-time guarantee.
8. **Navigation.** Construction, Handyman and Cabinet marketing headers mount separately from estimator routes so client-side transitions cannot change React hook order.
9. **Verification maintenance.** Tests were updated where old assertions required retired prices, mandatory email, automatic CRM delivery, a superseded PDF filename, a one-page legacy document, obsolete profit targets or an older batch size. Current policy values and customer requirements were preserved. The workflow test explicitly uses a simulated CRM adapter when testing optional CRM failure handling; production CRM remains off by default.

Shared source remains Remodeling. The shared manifest tracks 275 files; brand database, delivery, authentication, identity and intent adapters remain brand-owned. No live schema migration or customer-data edit was performed.

## Local evidence

| Repository | Full test run | Production build | TypeScript |
| --- | --- | --- | --- |
| boise-remodeling-co | 669 passed, 6 skipped, 0 failed | Passed | Passed |
| p5-home-co | 1,279 passed, 15 skipped, 0 failed | Passed | Passed |
| Boise-Construction-Co | 674 passed, 7 skipped, 0 failed | Passed in an isolated source copy | Passed |
| Boise-Handyman-Co | 677 passed, 7 skipped, 0 failed | Passed | Passed |
| Boise-Cabinet-Co | 677 passed, 7 skipped, 0 failed | Passed | Passed |

After the last cache provenance tightening, a focused 98-test run passed, including scope pricing, repair regressions and manifest validation. Counts above are the completed full-run checkpoints; skipped tests are not represented as passed. The same shared source is distributed to each repository.

Additional checks passed:

- `tests/p5-legacy-entrypoints.test.ts`: real retired API handlers and child assistant tools return continuation without prices, leads or delivery receipts.
- `scripts/test-p5-repair-persistence.mts`: real isolated PostgreSQL semantics for competing revisions, customer/admin archive parity, concurrent single-use transfer claims, retryable completion and revision fencing.
- `scripts/test-p5-pricing-work.mts`: persisted pricing stages, unchanged-scope reuse, changed-scope invalidation, incomplete-price withholding and concurrent lease ownership.
- `scripts/test-p5-pricing-recovery.mts`: bounded retries, retained completed work, split mapping retries, complete task coverage and no delivery of incomplete prices.
- `scripts/test-p5-background.mts` and `scripts/test-p5-background-drain.mts`: continued work without browser polling, stale-lease recovery, retry exhaustion/restart, checkpoint retention and bounded draining.
- `scripts/test-p5-resumable.mts`: 25 MB upload, corrupted segment rejection, deduplication, authorization, byte comparison, all 250 pages, failed-page retry and final-page preservation. Storage and model responses were simulated. This is not an OCR accuracy benchmark.
- `scripts/test-p5-workflow.mts`: draft authorization, atomic submission, customer delivery retry, ambiguous acknowledgement handling, manual review, distinct owner approvals, immutable history and customer/internal disclosure boundaries using captured transports.
- `scripts/test-p5-pricing-qualification.mts`: 34 checks of accounting guards and captured PDF/email consistency, with zero provider network calls, business writes or external sends. CRM-off capture creates no CRM job.
- Generated customer PDFs for all five brands were rendered and visually inspected across both pages. Brand identity, category/total agreement, exclusions, assumptions, next steps and preliminary notice were present. The four additional PDFs came from the second GitHub CI pass; subsequent changes did not modify the PDF renderer. Phone review/result screenshots for P5, Handyman and Cabinet were also inspected.

Build-generated marketing resources were restored to their pre-test versions; they are not part of this repair. Cabinet's first CI pass also detected two stale entries in its generated image-variant manifest. The manifest was regenerated from the existing build assets and committed; the source-integrity check remains enabled. Local repeated Next builds encountered stale `.next/export` directory cleanup errors in two children. Handyman passed after its disposable output was moved aside. Construction passed in an isolated `/tmp` source copy using the same dependencies and assets, without changing production logic.

## Outstanding qualification

**Browser execution:** the local Playwright browser download returned an invalid/truncated archive. No local browser result is claimed. GitHub's existing Chromium/WebKit verification workflow includes the repair tests and remains a release qualification gate. The mobile test checks that the current action is visible and unobstructed, including the approved bottom action area.

**Lint:** TypeScript passed in all five repositories. Repository-wide lint is not clean: P5's baseline had 650 errors and 88 warnings; three children have no configured noninteractive ESLint run; Cabinet has unrelated existing lint errors. The repaired estimator/navigation files passed the focused Cabinet lint check with warnings only. Conditional navigation hook errors were repaired, not suppressed. These facts must not be reported as a clean repository-wide lint result.

**Live deployment:** no hosting, production database, model-provider or mail-provider credentials are available in this workspace. Public release endpoint reads were unavailable through the web reader. GitHub publication is distinct from hosting deployment. Verify `/api/p5-estimator/release` on each deployed site against the published commit and version before using live outcomes to qualify this release.

**Operational recovery:** each repository includes `.github/workflows/p5-estimator-recovery.yml`. Configure that repository's `P5_ESTIMATOR_CRON_SECRET` with the matching site's existing hosting `CRON_SECRET`, then set repository variable `P5_ESTIMATOR_RECOVERY_ENABLED=true`. The schedule is disabled until enabled; a manual dispatch explicitly tests configuration. It uses authenticated POST, never logs the secret, and wakes the entire pipeline every five minutes. GitHub schedules may be delayed; they are a recovery mechanism, not a low-latency guarantee. Confirm the site's public origin and signed self-driver work from the hosting environment.

**Final acceptance cases:** run the plan's matrix on the actual deployed configuration: real RE-10 documents and native/scanned plans, dense/large sources, owner-supplied and trade-only cases, multiple rooms/buildings, changed selections, closed-browser and restart recovery, all five customer PDFs, return/revision links and confirmed inbox receipt to the authorized test recipient. Use the existing bounded qualification runner with an explicit provider allowance. Preserve source hashes, exact commit/configuration, timings, task-level expected results and receipts. Do not rerun paid inference to recover a downstream capture failure.

**Accuracy calibration:** compare estimated task quantities and prices against reviewed reference projects and completed costs. Passing deterministic policy tests does not measure model extraction accuracy or guarantee a preliminary range covers every project's final cost. No business margin or range policy was changed merely to make a test pass.

## Reproduction

Run `npm ci`, `node --import tsx --test --test-concurrency=2 tests/p5-*.test.ts`, the isolated scripts listed above, `npx tsc --noEmit` and `npm run build`. P5 also runs its complete `npm test` suite in prebuild. For local capture-only integration scripts, `P5_ESTIMATE_DRIVER=off` prevents a self-driver request; `scripts/offline-network-guard.cjs` can be preloaded to deny outbound network while permitting explicit test callbacks.

Use `node scripts/p5-sync.mjs --all` only from the canonical Remodeling checkout with the other four sibling repositories present. Verify `tests/p5-shared-engine.test.ts` in each repository. Recovery cron routes, legacy assistants, navigation and repository workflows are reviewed separately because they include brand-owned integration code.

## CI follow-up

The initial GitHub pass confirmed the full conversation/recovery and document adapter workflows in Remodeling, Construction and Handyman, and the P5 conversation/recovery workflow. It also exposed stale upload and pricing-ledger assertions. The invalid upload integration now verifies HTTP 422, unchanged storage and no provider call. The ledger integration verifies one uncapped retry owner, an audit note and capped unknown-charge blocking; per-request transaction locking now prevents competing retries.

Browser qualification was updated to the approved bottom action and optional-email flow. The interface now treats an absent email consistently: the review hint permits name-only submission, and the result says the PDF is saved instead of falsely claiming an email is sending. The browser fixture tests both email delivery and name-only display. CI remains a required gate; consult the workflow result for the exact commit being deployed.

The second pass confirmed conversation/recovery and document-adapter builds across all five sites, P5's actual PostgreSQL/document-service workflow, and Cabinet's desktop/mobile E2E suite. The broader browser suite passed its normal workflow scenarios but still used retired progress headings; its assertions now match the material-aware stage labels and also require the ETA and wait choice.

Construction's stricter source-coverage gate exposed a real diagnostic gap: its incomplete local read discarded the unread-page explanation. A typed failure now carries that explanation into the draft, while still refusing incomplete source acceptance. Background reading preserves the source/page failure and waits for explicit retry after per-page attempts are exhausted. Construction's 25 MB/250-page test passed locally with the final-page and retry-without-rereading checks; the isolated worker test passed actionable-failure and explicit-retry recovery.

P5 uses Node native TypeScript loading for its full prebuild suite. The incomplete-source error class uses explicit property assignment for that loader. The final full local native-loader run passed 1,279 tests with 15 explicitly skipped and zero failures.
