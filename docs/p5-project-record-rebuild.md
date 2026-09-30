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

The current foundation has not passed a real-model qualification run. Document sources still depend on the existing reader’s transcripts and observations; quote verification does not prove the reader transcribed the original page correctly. Native per-page text/visual evidence and whole-plan-set reconciliation require further work. Missing catalog prices are explicit unresolved gaps; the new research-observation contract and validation path are not yet implemented. Dynamic questions and their answers now have revision-guarded persistence, but are not yet wired into the public customer interface. Public adoption, delivery verification, local bid comparisons and the full matrix remain open.

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
