# Competitor workflow evidence for the P5 rebuild

Reviewed September 30, 2026. These are official product descriptions and documentation, not independently demonstrated accuracy. Authenticated hands-on work stopped at access walls; no paid account or completed competitor estimate was available for comparison. No proprietary algorithm is inferred from a marketing claim. Earlier qualification research is preserved separately.

## Handoff

| Topic | Documented behavior and limit of verification | P5 implication |
| --- | --- | --- |
| Reading versus measurement | [File Analysis vs Takeoff Mode](https://help.handoff.ai/en/articles/16007034-explaining-the-differences-file-analysis-vs-takeoff-mode), dated July 20, 2026, distinguishes quick reading of written dimensions/callouts from deeper takeoff. It describes file analysis as roughly 5–10 minutes for simpler inputs; takeoff separates sheets into regions, scales regions and produces annotated drawings. The stated duration for complex sets is 1–2 hours. These are vendor descriptions, not measured performance in this audit. | Distinguish extracted labels from scaled measurements. Use durable, resumable page/region work for large sets. A short request timeout is not an analysis-completion criterion. |
| Plan uploads | [AI Takeoffs](https://help.handoff.ai/en/articles/15442746-ai-takeoffs-in-handoff) describes multiple PDFs in a takeoff. [How to run a takeoff](https://help.handoff.ai/en/articles/15423812-how-to-run-an-ai-takeoff) has differing plan/eligibility wording. Account-specific file support and entitlement were not tested. | Multiple uploads need one manifest with immutable file/page identities and cross-file reconciliation. Do not copy unverified competitor limits into P5 promises. |
| Quantities | [Quantity calculations](https://help.handoff.ai/en/articles/9778473-understand-quantity-calculations) explains use of supplied project details and standard assumptions or ratios when detail is missing, followed by user review. It does not promise that every quantity is measured from a plan. | Keep measured facts, calculated quantities and estimated production/consumption distinct. Show the basis and uncertainty rather than presenting an assumption as extraction. |
| Pricing | [Pricing data](https://help.handoff.ai/en/articles/9564039-ai-understand-pricing-data), dated August 26, 2025, says supplier relationships and labor tracking inform geographically localized prices, with daily updates. It does not expose enough feed-level evidence here to independently validate coverage, update frequency or project accuracy. | Record price source, locality, date, unit and included cost components. Preserve approved owner rates; do not manufacture “live local” evidence. |
| Corrections | [Fix estimate errors](https://help.handoff.ai/en/articles/9563971-how-do-i-fix-errors-in-my-estimates), dated February 19, 2026, acknowledges scope, quantity and rate errors and describes conversational corrections, direct editing and groups/rooms. | Support exact question/answer history, direct corrections and dependent recalculation. Revision must invalidate stale prices and review receipts. |
| Combining work | [Combine estimates](https://help.handoff.ai/en/articles/13893198-how-to-combine-estimates-in-handoff) tells users to review combined work for duplicates. This does not establish automatic duplicate elimination across overlapping drawings. | Test coverage and duplication explicitly; a successful merge is not proof of complete, unique scope. |

The reviewed pages do not establish how Handoff ranks follow-up questions, resolves all contradictory revisions, represents trade dependencies internally, or independently verifies every source measurement. P5 should implement and test those requirements on their own merits.

## Skoper

The [FAQ](https://www.skoper.io/faq) describes PDF, image and Excel inputs with written project context, and advertises limits of 500 MB and 600 pages. Its current free-use wording differs from older search snippets; live account eligibility was not verified. It says supplied price books take precedence where applicable and distinguishes those entries from estimated market rates. It describes editable descriptions, quantities, units and costs, added/deleted lines, recalculated totals, and refreshed Excel/Word exports. These are documented features, not completed hands-on tests.

[How it works](https://www.skoper.io/how-it-works) describes reading page text and imagery. It also publishes a useful limitation: on a roughly 200-sheet Florida municipal set, its initial drywall estimate used 9-foot heights; subcontractor review using wall types/sections produced about 1.9 times the area, with heights of 13 feet 8 inches to 19 feet 6 inches. Skoper says it improved section/wall-type reading and still calls for human review. This is the vendor's reported example, not our independently reproduced benchmark. It directly supports checking sections and wall assemblies instead of extending a footprint with an unstated default height.

[What you get](https://www.skoper.io/what-you-get) describes linked estimate/takeoff spreadsheets with source assumptions, distinct financial rows, and a written scope with exclusions and risks. Text-only rough estimates are distinguished from bid-ready takeoffs. P5 should likewise show quantities, financial arithmetic and uncertainty together, with line-level traceability and customer-readable scope boundaries.

## Implementation decisions and evidence required

1. One versioned P5 project record ties source evidence to physical subjects, requirements and questions. Current implementation is isolated from the public flow.
2. Native page text and reader interpretations are separate evidence types. The read-only page endpoint is implemented; connecting and qualifying it remains work in progress.
3. Semantic catalog discovery precedes costing. Approved rates, explicit quantities and deterministic financial arithmetic remain authoritative. No competitor claim justifies inventing a missing price.
4. Clarifications resolve material scope gaps. Bounded contractor effort belongs in disclosed estimating assumptions, not homeowner production-rate questionnaires.
5. Revisions retain history and invalidate dependent pricing. This is implemented and locally tested; published customer interaction remains unverified.
6. Large plans require resumable page/region processing and independent reconciliation. Reading every page does not prove that dimensions, overlap or scope were understood correctly.
7. Acceptance requires source-to-estimate comparison, independent quantity/cost references, unfamiliar projects and the published customer workflow. Neither competitor documentation nor a P5 model's self-review substitutes for this evidence.

No claim is made that P5 currently equals either product, that the competitor products are perfectly accurate, or that this research alone establishes a defensible construction bid.
