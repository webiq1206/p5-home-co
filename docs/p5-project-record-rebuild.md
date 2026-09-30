# P5 estimator core rebuild

Authorization: Jared approved the rebuild on September 30, 2026 after reviewing the limitations of the existing approach. P5 Home Co is the only implementation and qualification target. The unfinished patch candidate is preserved on `p5-live12-validation` at `d6cc03f`; it is not the new foundation and has not been deployed.

## What changes

The replacement workflow uses one versioned project record. Source evidence, physical subjects, quantities, requirements, responsibilities, dependencies and questions have explicit identities. Pricing selects catalog records and links their coverage to existing requirements. It cannot create scope, author a price or change a quantity. An independent review must cover the exact record and price-selection hashes. Revisions invalidate old pricing and review receipts.

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

The current foundation has not passed a real-model qualification run. Document sources still depend on the existing reader’s transcripts and observations; quote verification does not prove the reader transcribed the original page correctly. Native per-page text/visual evidence and whole-plan-set reconciliation require further work. Missing catalog prices are explicit unresolved gaps; the new research-observation contract and validation path are not yet implemented. Dynamic questions are stored but are not yet wired into the public customer interface. Public adoption, delivery verification, local bid comparisons and the full matrix remain open.

GPT-4.1 remains the configured model. Model changes require measured evaluation and an explicit recorded policy change. No claim of perfect accuracy, competitor equivalence or completed P5 qualification is made.

Local evidence at this checkpoint: 1,643 tests total, 1,628 passed, 15 database-dependent tests skipped, zero failures. A subsequent integrity regression increased the new-core focused suite to 12 passing tests. TypeScript and six database-safety tests passed. The worktree production build was blocked by Turbopack refusing a node_modules symlink outside its root; the main checkout build is the required build gate. These checks are implementation evidence, not live estimator acceptance.
