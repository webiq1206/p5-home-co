# Five-site estimator repair and acceptance plan

Owner: Jared Brost. Prepared September 24, 2026.

## Objective and release rule

Make every customer-facing estimator use the reviewed project scope, current P5 pricing policy, correct issuing brand, durable project record, and approved customer document. Implement changes directly in the five GitHub repositories. Do not delegate edits to Replit.

Completion requires evidence for each acceptance area below. A passing build establishes buildability, not live estimating accuracy. Record unexecuted, blocked, and failed checks explicitly. Do not call an environment fully qualified until real documents, provider calls, background recovery, output rendering, and delivery have passed there.

## Repositories and change control

The repositories are `webiq1206/boise-remodeling-co`, `webiq1206/p5-home-co`, `webiq1206/Boise-Construction-Co`, `webiq1206/Boise-Handyman-Co`, and `webiq1206/Boise-Cabinet-Co`.

Use Remodeling as the existing shared-engine source. Run `scripts/p5-sync.mjs` to distribute shared modules, components, routes, and tests. Preserve brand-owned database, authentication, delivery, intent, and branding adapters. Refresh manifests and verify every tracked shared file. Handle each site's legacy chat and marketing entry points in that site's repository.

Fetch current main before edits and before publication. Preserve unrelated changes. Use ordinary fast-forward updates, never force-push. Commit tested changes with an accurate release record. A GitHub update is distinct from a deployed-site update; record both identities where available.

## Work packages, ordered by dependency

### A. Baseline and reproducible checks

Inventory main/homepage forms, specialist RE-10/plans flows, assistants, old APIs, PDFs, email and return links. Confirm the shared source and effective brand adapters. Install locked dependencies, read version-specific framework instructions, and run existing estimator tests. Measure current build/type/lint failures instead of relying on old baselines. Inspect qualification runners before using them so tests cannot accidentally send customer emails, create commercial leads, or make uncontrolled provider calls.

Acceptance: documented starting commits; clean known working trees; existing failures separated from regressions; reusable offline and runtime commands.

### B. One authoritative customer pricing path

Remove legacy price issuance from the three remaining assistant paths. Preserve useful business assistance and transfer customer-entered scope into P5. Audit old RE-10/plans/calculator APIs for remaining consumers. Retire unused pricing endpoints with an explicit continuation response or adapt them to current P5 behavior. Avoid converting an obsolete numeric response into another guessed number. Update stale assistant prompts and tests that still advertise the old engines.

Acceptance: each active entry point reaches P5; no old 50% RE-10 or 22% project-floor policy leaks into a P5 customer estimate; chat continuation preserves meaningful customer input; Cabinet and parent identity remain correct.

### C. Scope and document integrity

Preserve material extracted facts and conflicts, including dense documents. Review extraction limits, chunking, page records and incomplete-source gates. Honor trade-only scope, explicit exclusions and superseded documents. Protect requested versus required scope and shared supporting work. Maintain positive examples so duplicate guards do not delete genuine repeated work or construction terms such as overhead doors.

Acceptance: no silently dropped core item; accurate page coverage; 250-page input handled or an honest recoverable limit; correct new/old sheet precedence; flooring-only scope never becomes a full-home estimate; two showers retain two waterproofing scopes; small repairs do not duplicate protection or cleanup.

### D. Pricing correctness and policy identity

Preserve current approved rates and margins. Apply direct cost, relevant remodel premium, contingency, overhead and operating profit once. Check all service/finish combinations, assemblies, owner-supplied and mixed-supply cases, quantities and unit dimensions, signed allowance deltas, single-price RE-10 and rounded line/category reconciliation. Include effective policy identity in reproducibility and internal records. Do not tune numbers merely to satisfy an old golden test.

Acceptance: current service matrix and approval guards hold; no markup-versus-margin error; no assembly/component double count; no installed/material/labor duplication; rush construction keeps project contingency; totals reconcile after rounding.

### E. Safe reuse and learned costs

Fix cached-price compatibility so new price-relevant information cannot be ignored. Fingerprint all effective pricing rules and scope decisions needed for safe reuse. Preserve learned-rate provenance, region, specification, source date/expiry, responsibility, and provisional/approved status. Reuse only eligible compatible rates, prevent duplicates, and retain owner overrides. Handle older records explicitly instead of upgrading their evidence by implication.

Acceptance: identical effective input reproduces the price; a new finish/exclusion/material responsibility causes reassessment; regional/provisional rates retain their evidence; unsupported or stale records do not become approved book facts.

### F. Continuation, revisions and secure access

Prevent silent truncation during cross-brand continuation. Carry source files through an authorized bounded mechanism where the storage architecture supports it; otherwise make the missing-file state explicit and block a false complete-scope claim. Keep active source identities separate from archived evidence. Preserve old issue records and PDFs when revising. Verify single-use continuation and estimate-scoped access.

Acceptance: no lost instructions claimed as carried; uploaded evidence remains recoverable; old versions do not reprice themselves; changed source invalidates affected work; another customer's estimate cannot be opened through a modified identifier.

### G. Background completion and truthful progress

Review durable job leases, submission finishing, retry recovery, and the server driver. Provide a deployable wake/recovery path for unfinished jobs that does not require an open customer browser. Preserve completed work across provider waits and focused repairs. Show an estimate of full remaining processing time through QA alongside the stay/email choice; distinguish actual page counts from text progress.

Acceptance: close-browser, lost-network, expired-lease and process-restart scenarios recover; repeated requests do not duplicate work; stalled jobs reach a recoverable state; ETA describes the complete result and does not hide failures.

### H. Delivery and output parity

Keep estimate finalization and outbox writes atomic and idempotent. Preserve CRM-off behavior. Validate customer versus internal disclosure boundaries and dynamic brand/template use. Distinguish provider acknowledgement from inbox receipt. Confirm delivery retries never regenerate a different estimate. Render customer PDFs and inspect layout, category totals, finish, allowances, exclusions, options and next steps.

Acceptance: screen/email/PDF share reference, issue date, scope and total; internal financial details remain internal; no duplicate sends; no CRM enqueue while off; no contract/deposit/signature implication in the preliminary template.

### I. Desktop and mobile workflow

Verify the dedicated page, embedded form and specialist entry points at representative phone, tablet and desktop widths. Check typing, answer chips, speech input support/fallback, uploads, correction, review, waiting choice, result, return and revision. Preserve brand typography and colors, readable contrast, accessible focus and controls. Fix interference from chat/marketing chrome and scrolling traps without redesigning unrelated pages.

Acceptance: usable viewport and controls, no clipped result or bottom action, meaningful focus/scroll after transitions, no loss of typed details, and working recovery after refresh.

### J. Cross-site qualification and publication

Run shared regressions against the canonical source and manifest verification in all five sites. Run required lint/build/type checks and repair estimator regressions. Use representative real RE-10 and plan sources, including the largest available plan set, alongside controlled fixtures. Retain source hashes, expected scope, exclusions, measured duration, returned reference, output reconciliation and actual failure evidence.

Publish reviewed changes directly to each GitHub main using the connected GitHub capability. Verify remote trees and commits. Repeat read-only route/version checks on deployed sites. If hosting has not deployed the new commits, identify that exact dependency rather than representing old production behavior as validation of new code.

## Required scenario matrix

| Area | Cases |
| --- | --- |
| Entry points | Five main forms; child homepages; RE-10 pages; plans page; four child assistants; legacy APIs |
| Scope | Text only; mixed files/text; full plan set; trade-only; explicit exclusions; whole assembly; supporting work; multiple rooms/buildings |
| Quantity | Living versus garage; base versus upper cabinets; repeated schedule; owner supplies three of four doors; unknown quantity; contradictory measurement |
| Documents | Native PDF; scan; image; spreadsheet; unreadable page; large/dense file; replacement/addendum; upload interrupted and resumed |
| Cost | All services and finishes; installed versus labor/material only; compatible units; percentage row; out-of-book allowance; regional reuse; owner override |
| Finance | Current target/floor/stretch; fixed contingency groups; rush; rounding; allowance credit; both-owner below-floor approval; overhead-funded owner salaries |
| Reuse | Identical project; new field; changed finish; changed exclusion; changed rate; changed finance/rule; expired learned rate |
| Reliability | Browser closed; connection lost; provider 429; malformed response; stale lease; restart; duplicate submit; ambiguous email acknowledgement |
| Output | Five brands; RE-10 single price; range; customer/internal separation; optional items; all totals; archived versus current revision |
| Security | Invalid return link; cross-estimate ID; single-use transfer; file access; administrative export; protected financial approval |

## Evidence and completion record

For each package record: reproduced problem, implementation, regression coverage, test result, repository commit, and deployment qualification. Add precise blockers with the missing capability or configuration. Preserve the owner's business rules unless the owner approves a change. Do not equate the absence of a reproduced failure with proof that all production workflows work.

This plan is approved for execution by the user's instruction to prepare the plan and begin all fixes directly in GitHub. Implementation proceeds without another planning approval step.
