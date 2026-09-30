# P5 estimator core rebuild

Authorization: Jared approved the rebuild on September 30, 2026 after reviewing the limitations of the existing approach. P5 Home Co is the only implementation and qualification target. The unfinished patch candidate is preserved on `p5-live12-validation` at `d6cc03f`; it is not the new foundation and has not been deployed.

## What changes

The replacement workflow uses one versioned project record. Source evidence, physical subjects, quantities, requirements, responsibilities, dependencies and questions have explicit identities. Pricing selects catalog records and links their coverage to existing requirements. It cannot create scope, author a price or overwrite a physical measurement. It can propose separate, explicitly linked purchase or effort quantities, using verified arithmetic or disclosed allowances. An independent review must cover the exact record and price-selection hashes. Revisions invalidate old pricing and review receipts.

The existing financial calculator and approved cost data remain in use. The new compiler bypasses legacy scope defaults, keyword corrections and prose-based decisions about whether an issue should block a total. This is an architectural boundary, not a claim that AI interpretation is already reliable.

## Current executable path

- `projectRecordContracts.ts`: separate strict contracts for scope interpretation, catalog selection and independent review, with no project-specific keyword exceptions.
- `projectRecord.ts`: immutable source identifiers, complete text retention, evidence-quote verification, subject-linked quantities, dimensional arithmetic, dependency and question validation, and record revision identity.
- `projectPricing.ts`: approved-rate selection, responsibility/unit checks, exactly-once requirement coverage, duplicate-charge detection, stale-review rejection and calculation through the approved financial policy.
- `projectWorkflow.ts`: bounded interpretation and mapping correction followed by independent structured review. Findings are never silently downgraded by their wording.
- `projectRecordWork.ts`: per-draft saved provider replies, concurrent-work leases, revision-guarded persistence and reuse. It does not update the customer’s accepted estimate or promote rates.
- Authenticated staff route: `/api/admin/p5-estimators/project-record`. The public estimator has not been switched to this path.
- `p5-project-record-qualify.mts`: text-only controlled QA entry point. Requires an existing QA-marked draft and its current revision. Uploaded private plans and RE10 documents are outside this lane.

## Acceptance criteria, established before production adoption

| Boundary | Required evidence |
| --- | --- |
| Source coverage | Every supplied file/page accounted for. Unreadable material content remains unresolved. Text blocks reconstruct the full original text. |
| Scope | Every independently identified required operation is present or positively covered; no excluded or unrelated charge. Preserve existing/proposed/demolition/replacement and labor/material responsibilities. |
| Quantities | Each quantity has a physical subject, purpose, unit and source or disclosed allowance. Calculations reconcile. Photos cannot establish unstated dimensions. |
| Questions | Questions concern actual unresolved included work, explain their consequence and do not repeat supported answers. |
| Pricing | Catalog match fits scope, specification and cost basis. Every contractor requirement has exactly one coverage owner. A single assembly may cover several requirements. |
| Revisions | Current answers supersede affected scope. Old quantity, price and review hashes cannot be reused. Unchanged work retains identity. |
| Calculations | Direct costs and customer line totals reconcile under the unchanged owner finance policy. |
| Quality | Independently reviewed source/estimate comparisons, including unfamiliar cases. Software unit tests and model self-review alone do not establish accuracy. |
| Production | Browser uploads, review, questions, revisions, final estimate and delivery all pass on the published P5 site before specialist rollout. |

## Qualification matrix

All eight categories remain required: new home, ADU, whole-home remodel, kitchen, bathroom, cabinet-only, handyman and RE10. Each needs text, individual uploads, combined input and relevant plan sets, with complete/incomplete scopes, exclusions and revisions. Existing synthetic fixtures and saved production failures are the development set, not an untouched benchmark. Separate unfamiliar projects and actual bids must be assessed independently before acceptance.

Initial unit-level reference: three owner-supplied passage handles use approved PB-08-71-01 labor at $70 per handle, $210 direct. Revising to two requires $140 direct and invalidates the old review. This checks the compiler, not market competitiveness or live AI scope interpretation.

## Remaining implementation and evidence

The handyman scope has passed real-model interpretation. Pricing has not passed, and no complete customer workflow is accepted. Document sources still depend on the existing reader’s transcripts and observations; quote verification does not prove the reader transcribed the original page correctly. Native per-page text/visual evidence and whole-plan-set reconciliation require further work. Missing catalog prices are explicit unresolved gaps; the new research-observation contract and validation path are not yet implemented. Dynamic questions and their answers now have revision-guarded persistence, but are not yet wired into the public customer interface. Public adoption, delivery verification, local bid comparisons and the full matrix remain open.

GPT-4.1 remains the configured model. Model changes require measured evaluation and an explicit recorded policy change. No claim of perfect accuracy, competitor equivalence or completed P5 qualification is made.

Local evidence at this checkpoint: 1,643 tests total, 1,628 passed, 15 database-dependent tests skipped, zero failures. A subsequent integrity regression increased the new-core focused suite to 12 passing tests. TypeScript and six database-safety tests passed. The worktree production build was blocked by Turbopack refusing a node_modules symlink outside its root; the main checkout build is the required build gate. These checks are implementation evidence, not live estimator acceptance.

## First real-model run and repair, September 30

The host ran the isolated interpretation path for existing text-only QA draft `0a3523d2-be0e-4990-92df-0405fc36ab54`, revision 4, on `cc11b8f`. Expected scope: replace three owner-supplied matching passage levers, remove old hardware, adjust/test, and perform small debris cleanup. Existing holes and doors are sound; no new doors or painting. Unlike the compiler unit fixture, the contractor performs cleanup here.

Actual result: **failed, needs-resolution; no accepted record or price**. Two interpretation requests returned verified model `gpt-4.1-2025-04-14`. Both captured the count, owner supply, requested operations and exclusions. The first asked the customer to quantify small debris cleanup unnecessarily. The second removed that question, but adjustment, testing and cleanup still had `origin: dependency` with empty `requiredBy` arrays. Their prose reasons referred to installation `req-2`, which does not substitute for the missing structured relationship. Corrections were constructed by the workflow; the host's saved receipt did not independently retain the raw outgoing request body.

Host evidence: `p5-verification/project-record-qualification/0a3523d2-be0e-4990-92df-0405fc36ab54-rev4-interpret-cc11b8f.json`. This is a host-local receipt, not a publicly accessible artifact. No public deployment, estimate delivery or rate promotion occurred.

Repairs awaiting host retest:

- Requested work and inferred dependencies have distinct schema branches. The dependency branch requires a parent ID and explanation; requested work requires source evidence. Validation now identifies the specific missing field. No task names or keyword exceptions are used.
- The instructions distinguish desired outcomes from contractor production effort; bounded effort uses a disclosed allowance instead of asking the homeowner to estimate it.
- Conditional work and unresolved responsibility require linked blocking questions; conflicting source reviews require clarification. They cannot silently disappear from pricing.
- Record, source and catalog identities now use canonical object-key ordering. PostgreSQL JSONB reordering no longer makes unchanged content appear tampered. Contract version 2 prevents reuse of the earlier incompatible identity.
- Recovery republishes saved completed work through the same atomic draft-revision check. A crash between checkpointing and publication cannot strand a completed review; an older result cannot overwrite a newer customer revision.
- Zod 4.4.3 is declared as a direct production dependency, retaining the already locked version and integrity instead of relying on the development dependency tree.

The outgoing schema uses nested `anyOf` with minimum array lengths, supported in the official [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs), consulted September 30. Schema adherence does not establish semantic correctness.

Implementation evidence: the main-checkout production build of `cc11b8f` passed, including 1,644 tests (1,629 passed, 15 database-dependent skips, zero failures) and six database-safety checks. The repaired core has 16 focused passing tests, including actual PostgreSQL-compatible JSONB persistence and revision-race checks. TypeScript passed. These results do not turn the failed real-model case into an accepted estimate.


## Second real-model run and scope/costing separation

The `5a27f2c` interpretation retest also **failed, needs-resolution**. The missing dependency links were resolved. Three provider requests (two proposals and one review) returned `gpt-4.1-2025-04-14`. Scope included the three owner-supplied handles, requested operations, cleanup and exclusions, but the reviewer demanded confirmations about applying adjustment/testing to all three handles and the unit of cleanup. The second proposal followed that criticism into unnecessary questions. No record or estimate was accepted. The public release remained unchanged.

This revealed a design problem in the core: requiring every supporting operation to have its own customer-confirmed quantity conflated physical project extent with contractor effort. Contract version 3 separates them. Operations on the same known physical items may share that physical quantity. Supporting effort bounded by included work can be derived during costing. The costing proposal may add calculation-backed quantities or disclosed positive allowance ranges, linked to the exact requirements and known physical basis. It cannot replace physical measurements, invent approved prices, or charge owner/excluded work. Missing physical extent still needs clarification. Coverage remains mandatory before calculation.

Focused reference verification: three owner-supplied handle replacements use $210 direct approved labor. A separately disclosed 0.5-hour cleanup allowance at the approved $45/hour rate adds $22.50, with a 0.25–0.75-hour effort range. This is a compiler test of an explicit estimating assumption, not an independently established production rate or passed live case. The original count stays three. The compiler rejects measurement replacement and owner-material charges.

`projectConversation.ts` now saves the exact question, answer, affected work and sequence. Answers are free-form evidence rather than entries forced into the legacy answer-field list. Editing a resolved answer replaces its active value while preserving the audit history and unrelated answers. Ordered free-form scope revisions remain available. Each accepted change atomically advances the draft revision and invalidates prior interpretation/pricing. A lost-acknowledgement retry cannot duplicate a change; changing the same request ID is rejected. A simulated interruption between the revision write and answer write rolled back both in PostgreSQL-compatible tests.

Saved qualification work is now identified by the actual instructions and schemas as well as source/revision/catalog hashes. A prompt or contract change cannot silently reuse an old failed or accepted result. Exact stage inputs are checkpointed before provider dispatch, and completion receipts identify returned models and completed provider response IDs. This captures the application's dispatch arguments, not an independently captured gateway HTTP body.

Current local evidence: `5a27f2c` main production build passed, with 1,648 tests total (1,633 passed, 15 database-dependent skips, zero failures), plus six database-safety tests. The next version has 18 focused tests passing and clean TypeScript. Its real-model retest, public interface, uploads, pricing research, independent bid comparisons and category matrix remain open.

## Third real-model run and rate-choice review

On `d19e302`, interpretation **passed its bounded workflow**: three handle sets, requested work, owner supply and exclusions, with no outstanding questions or findings. Pricing **failed**. Across both phases, four requests returned `gpt-4.1-2025-04-14` (two interpretation/review stages and two pricing attempts). No customer estimate was accepted, delivered or published.

The pricing proposal grouped the work into a 1.5-hour allowance (range 1–2 hours) at approved generic handyman rate `PB-01-01-01`, $65/hour. Arithmetic alone would be $97.50 direct, range $65–$130; these were not accepted estimate amounts. The compiler rejected that estimating quantity because replacement work belonged to the handle fixture while cleanup belonged to its broader existing-door subject. The current fix gives estimating quantities explicit work-group ownership, separate from the physical subject ownership of measurements. Grouped effort must still name every included contractor requirement it covers, preserve physical quantities and pass complete coverage and independent review.

The proposal also exposed a price-choice risk: a generic hourly assumption could replace the more specific approved per-door hardware labor rate. The selection and review policy now prefers a compatible approved task/assembly rate, requiring a scope-supported explanation for using generic labor instead. Independent price review now receives the full approved catalog, so it can evaluate competing rates instead of seeing only the model's selection. This does not assert that the approved book equals current market bids; independent price validation is still required.

Host-local evidence for this run: `p5-verification/project-record-qualification/0a3523d2-be0e-4990-92df-0405fc36ab54-rev4-interpret-d19e302.json` and the corresponding `rev4-price-d19e302.json`.

## Source provenance repair in progress

The legacy draft can contain AI-populated answer fields alongside real customer answers. The migration boundary now labels those separately. A saved reader value is not silently promoted to a customer-confirmed answer. Explicit question resolutions and an unchanged customer-reviewed scope can establish customer confirmation; untracked legacy provenance is identified as unconfirmed. A regression preserves the explicitly answered three-handle count while keeping an extracted floor area labeled as a reader observation.

A new signed, read-only document-service route exposes P5's original per-page native text, geometry and reader observations separately. It returns a page manifest or one complete requested page, preserving the source checksum and original page number. It does not enqueue reading, transfer a new document, run a model, summarize the text or claim unreadable content is verified. Other tenants cannot use this new P5-only route. Its HTTP tests verify signing and project boundaries, complete text retention, and preservation of partial-page status. This is not yet connected to the project interpreter; native-page integration and document qualification remain open.

The `d19e302` main production build passed with 1,650 tests total, 1,635 passed, 15 database-dependent skips and zero failures, plus six database-safety passes. This remains software evidence, not acceptance of the full estimator.

## Fourth real-model run: retrieval and contradictory review

The exact `4b5a74d` run again accepted the handyman scope: three handles, removal, installation, adjustment/testing, contractor cleanup, owner supply, no painting and no door replacement. No questions or scope findings remained. Pricing failed after two proposals and one review, with five provider requests across both phases. All returned `gpt-4.1-2025-04-14`. The unchanged second pricing proposal reused the saved identical review; it did not make a second review provider request.

The selected PB-01-01-03 allowance was 2 HR at $70/HR, range 1–3 HR. Its coverage explanation incorrectly claimed no labor-only hardware replacement rate existed. PB-08-71-01 is present at $70/EA. The reviewer identified that specific rate but placed a contradictory statement justifying the generic rate inside a blocking finding. The repeated proposal therefore remained blocked. $140 direct and a $70–$210 direct range are arithmetic on a rejected proposal, not accepted customer totals. Neither attempt produced a finalized customer amount.

The source master book contains 1,484 rows. Passing its expanded descriptions to a single task combining catalog search, work grouping and estimating effort did not reliably find the specific rate. The next version separates semantic catalog discovery from costing. Discovery sees a complete compact index and must account for every included contractor requirement. Costing and review receive these candidates alongside the full approved book; no keyword filter hides the other rates. Candidate retrieval is not price acceptance. A main-task rate can coexist with separate supporting coverage rather than being discarded because no single rate covers the entire sequence.

Review findings now require an actionable correction. Ordinary alternatives and confirmations belong in notes. Findings are still never waived based on phrases such as “no defect.” Malformed pricing proposals also receive their exact shape errors on retry; previously the feedback was omitted until a valid selection existed. Accepted project classification now determines catalog context rather than the legacy service answer. Saved owner rates and financial policy remain unchanged. Per-item finish selection and independent market validation remain open.

Implementation evidence: `4b5a74d` full build process exited 0 with 1,651 tests, 1,636 passes, 15 database-dependent skips and zero failures. The build log records successful compilation and TypeScript; its final static-page progress output is incomplete, so this is not evidence that the public deployment was validated. The new retrieval/retry boundary has 23 passing focused tests and clean TypeScript, awaiting its real-model retest.

Host receipts: `p5-verification/project-record-qualification/0a3523d2-be0e-4990-92df-0405fc36ab54-rev4-interpret-4b5a74d.json` and the matching `rev4-price-4b5a74d.json`. No public deployment, customer delivery or other-site update occurred.

## Fifth real-model run: candidates found, harmless acknowledgement rejected

At `b4d95a3`, interpretation again passed without questions or findings. Both catalog proposals found PB-08-71-01 for removal/installation/adjustment and PB-01-74-10 for cleanup. They also acknowledged owner supply with an empty candidate list. The first included excluded-work acknowledgements too; after correction the second retained only the empty owner-supply acknowledgement. The validator rejected that extra row, so no price selection or pricing review occurred. Four requests returned verified GPT-4.1. No direct or customer totals were produced.

The validator now distinguishes an empty acknowledgement of known nonchargeable work from an attempt to assign it a cost. Unknown IDs, duplicates, missing contractor coverage and nonempty candidate lists for owner/excluded work remain errors. No requirement is deleted from the project record and no pricing-coverage rule is relaxed. Regression evidence includes both an accepted empty owner acknowledgement and a rejected attempt to price it.

Host receipts use the same qualification prefix with suffixes `interpret-b4d95a3.json` and `price-b4d95a3.json`.

## Native page evidence connected to staff qualification

Contract version 4 retrieves existing remote-PDF evidence before interpreting a draft. Retrieval is GET-only and signed for P5's tenant/project. It checks the upload digest, document ID, original page number/count and reader generation. Every page is independently checkpointed, with at most four page requests in flight. A failed later page leaves earlier pages reusable. Duplicate bytes are read once. Original text, digital layout and model observations remain distinct sources. Page coordinates are explicitly identified as digital geometry, not site dimensions.

Known partial/unreadable pages now reach scope interpretation as unresolved sources, allowing a useful clarification rather than an unconditional pre-interpretation failure. Missing page inventory still blocks. A later customer clarification can explicitly resolve a source's material uncertainty through cited evidence, without claiming that the original became readable. A reader observation cannot provide that customer resolution. The independent reviewer must still assess whether the answer actually resolves the problem.

Local evidence: complete text retention beyond 48,000 characters on a page; bounded concurrency; duplicate-file identity; interrupted retrieval/recovery; mismatched digest/page/generation and incomplete inventory rejection; signed cross-project/tenant restrictions; partial-page clarification; and rejection of a model observation presented as a customer resolution. These use synthetic fixtures. Actual plans, photographs, scanned documents and RE10 uploads have not passed this new path. Local-reader image/spreadsheet evidence still relies on legacy observations. Whole-plan reconciliation and measured takeoff remain open.
