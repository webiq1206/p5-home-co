# P5 reference qualification, September 30, 2026

Status: working evidence, not estimator acceptance. P5 only. These references were explicitly supplied for comparison and testing. A competitor estimate is not an approved cost book, completed-job actual, accepted subcontractor bid, or proof that its quantities and scope are correct.

## Recovered checkpoint

The host reports that the previous bounded qualification at `627b158` completed before the stop request. Handyman reached a preliminary $320 to $345 range with hardware labor and a disclosed 0.25-hour cleanup allowance. Bathroom, kitchen, new construction and synthetic RE10 reached questions. The new-construction garage remained conditional. All 15 provider stages reported GPT-4.1. This is host-reported qualification evidence, not published customer acceptance. The published release remains `ac43af0`, version 2026-09-30.12. The source-first completion candidate `a6efa68` is undergoing a separate bounded host test.

## Attachment identity and local ingestion

There are 19 unique source files: 18 PDFs containing 111 pages and one workbook containing three worksheets. The three newly attached addition files are byte-identical to their copies in Sources; they must not become duplicate physical work.

| Reference | SHA-256 | Structure |
| --- | --- | --- |
| Addition permit plans | `8fb95035e8d449bea200a2c0542a3ab4b0065d073b2838548384d1a8808f97a4` | 13 PDF pages |
| Handoff addition estimate | `6705b91a97774138a8f122cc9366c5a9eff50f8333bfde596b78b64926836fe4` | 6 PDF pages |
| Skoper addition estimate | `2c88047240577455964095a95405d5d8d6c78447dc6bfec0be631cf4c1a4f8e7` | Contractor Estimate, Takeoffs, Assumptions & Sources |

The actual P5 native PDF parser read and rendered all 111 pages with sequential complete manifests and no parser errors. This verifies local ingestion and retention, not the semantic completeness of the AI reader. The plan contact sheet and enlarged A201, A401 and S101 drawings were visually inspected against extracted text. Native artifacts remain in the private test workspace. `scripts/p5-reference-files.mts` reproduces the read-only parser audit without network, model, database or delivery calls.

The actual Skoper workbook initially failed P5 conversion because ExcelJS attempted to stringify a null merged-cell value. The corrected reader preserves the anchor of a merged region once, tolerates empty merged regions and retains all worksheets. It calculates 94 supported formulas from inputs, with zero unresolved formulas in this workbook. Original formula and saved-cache status remain explicit. Unsupported formulas, external references, errors, cycles and calculation limits stay unresolved; a saved result is not silently certified or replaced with zero. The uploaded workbook is never modified.

## Addition comparison

Handoff's displayed total is **$119,935.84**. Independent decimal arithmetic using Skoper's Takeoffs quantity and unit-cost cells produces **$133,702.80 direct costs**, plus $13,370.28 overhead, $11,765.8464 profit, $2,674.056 insurance, $2,382.583896 bond and $9,359.196 contingency. Its unrounded total is $173,254.762296, or **$173,254.76** to cents. P5's new formula evaluator independently returns the same values. Skoper has no cached formula results in the supplied file. Its Labor Cost column is empty; the export does not independently establish labor hours behind the bundled prices.

These totals are not comparable bids with identical scope or financial treatment. Preserve P5's approved finance policy. Do not copy a reference's percentages, bond, marked-up hourly rates, or final total into P5's direct cost book.

| Evidence | Observation | Expected P5 behavior |
| --- | --- | --- |
| A000 sheet list; all 13 title blocks | The index lists S401 Structural Details; no S401 page is present. | Identify the missing sheet and request it or a source-supported explanation that it is not applicable. Do not claim the uploaded set includes every listed sheet. |
| A201 area schedule | Existing house 2,262 SF, main-floor addition 26 SF, upper-floor addition 471 SF. | Preserve separate existing/proposed subjects. The additions sum to 497 SF; existing area does not become new construction. |
| A201 room notes | Upper bedroom and walk-in closet have carpet; bath has tile; 9-foot ceiling labels. | Retain exact specified finishes and heights. Handoff's bathroom LVP is a discrepancy requiring an authorized override before adoption. The original prompts supplied to Handoff are unavailable, so this is not proof of its internal failure. |
| A201 windows, doors and drawings | Four upper windows. Three ordinary upper interior doors plus a separately identified glass shower door. Some main-floor schedule entries have 0 by 0 dimensions. | Count physical instances once; separate shower glazing from ordinary doors. Do not derive dimensions from identifier digits or convert placeholder dimensions into actual products. |
| A401 sections; S201 framing | TJI labels show 16-inch spacing in one section and 24-inch in another; S201 shows 16-inch. | Preserve the conflict and ask for controlling design confirmation rather than inventing a resolved takeoff. |
| S101 and S201 | The same beam/header schedule appears on both sheets: seven double 2x6, four double 2x8, one triple LVL. | Reconcile the schedule to physical marks; do not double quantities because the schedule is repeated. |
| S101 and A402 | Existing foundation verification is called out; main-floor addition and floor/footing details require interpretation. | Include applicable new work and a visible uncertainty for existing support. A generic slab note does not establish a new slab everywhere. Handoff has no separately visible foundation line. Skoper's 20 LF foundation and $800 slab/miscellaneous allowance need verification. |
| A402 | R-49 attic, R-21 cavity plus R-6 continuous wall assembly; R-30 floor callout. | Reconcile assembly boundaries and avoid charging both a complete insulated sheathing assembly and duplicate layers. Do not treat a general energy table as proof that every listed component is new work. |
| A301/A302 | Siding per owner specification; board and batten front gable only; fascia/soffit/gutters to match. | Ask or disclose a supported selection allowance. Different elevations of the same surface do not create extra area. Handoff uses 670 SF siding versus Skoper's 1,650 SF; neither becomes a validated measured area solely because it was quoted. |
| A202 and structural/architectural views | Roof geometry includes multiple slopes and tie-ins. | Reconcile new, removed, retained and re-covered surfaces. Handoff's 7 squares and Skoper's 1,200 SF are provisional until their takeoff extents are reconciled. |
| Competing HVAC lines | Handoff selects a 12,000 BTU mini-split; Skoper assumes duct extension and explicitly says equipment is not detailed. | Ask about the intended system and existing capacity, or present an explicitly bounded alternative. Do not choose a system as an extracted fact. |
| A101 demolition and retained house | Roof/truss/ceiling and siding demolition, openings and infill are shown. | Capture protection, weather exposure, necessary temporary support, disposal, making good and cleaning as applicable. Do not count retained kitchen/bathrooms as full remodels. |
| Entire reference comparison | Skoper includes temporary weather protection and exterior painting; Handoff has no separately visible lines for those. | Establish explicit coverage or an exclusion supported by the customer, rather than assuming another line absorbs the work. A line's absence does not prove the supplier excluded it internally. |

The reference workbooks' claims of Nampa market rates and engineering completeness are claims in the exports, not verified supplier quotations, site measurements or professional design approval.

The printed line amounts reconcile exactly to the displayed total in all 17 estimate PDFs. Handoff's addition has 99 line amounts summing to $119,935.84; multiplying its displayed rounded unit prices by quantities gives $119,932.31. The export therefore does not expose enough precision to reproduce its line amounts from displayed rates alone. This is not evidence of a $3.53 overcharge. P5 should preserve actual calculation precision and make its presentation reconcile.

## Broader reference cases

The following displayed totals are extracted for reconciliation, not price acceptance. Original detailed scope, job location, pricing date, financial basis and alternatives must be matched before using any as a numeric comparator.

| Source prefix / case | Pages | Displayed total | Primary test purpose |
| --- | ---: | ---: | --- |
| 04, 500 SF second-story addition | 5 | $230,176.80 | Structural tie-ins, staircase, temporary work, soft costs, supporting trades |
| 05, Primrose remodel | 5 | $444,345.69 | Structural repair, kitchen/baths, quantity basis and broad remodel boundaries |
| 06, Mountain View remodel/repair | 5 | $75,000.00 | Retained cabinets, mixed repair/replacement, disposal and final cleaning |
| 07, 20 by 60 driveway | 2 | $25,372.00 | Area/volume conversion, base depth, concrete thickness, formwork units |
| 08, exterior painting example | 1 | $13,658.32 | Building floor area versus painted surface, material coverage and labor allowance |
| 09, five-bedroom flip | 5 | $63,123.38 | Zero-quantity rows versus actual inclusions; roofing/permit decisions |
| 10, 676 SF garage conversion | 12 | $235,733.96 | Conversion rather than detached new build, utility trenching and retained structure |
| 11, basement/main-level repairs | 2 | $92,937.85 | Mitigation, limited affected areas, restoration; Colorado location is not Boise pricing |
| 12, multiple-room renovation | 7 | $124,010.20 | Room/trade hierarchy, zero placeholders, atypical labor rates needing confirmation |
| 13, cabinets/bench/shelves | 2 | $14,575.38 | Mutually exclusive alternatives and incorrect-looking unit labels |
| 14, Winterhaven proposal | 2 | $185,141.36 | Referenced missing SOW, separate OH&P, negative deductions, Colorado location |
| 15, shop and ADU | 13 | $530,739.06 | Separate buildings/uses and full contents rather than title-based scope |
| 16, restaurant flooring/millwork | 5 | $690,928.87 | Limited trades in a commercial reference; no automatic expansion of P5 services |
| 17, two bathrooms | 5 | $42,596.83 | Distinct rooms, shower versus full-room work, trim and waterproofing |
| 18, preconstruction/design agreement | 2 | $118,849.13 | Design-only deliverables must not turn into a construction bid |
| 19, new residence | 19 | $1,436,125.06 | Conditioned space, garage, porch/patio quantities and project duration |

The cabinet reference's $14,575.38 total includes the $7,467.69 base and all four alternative tops. Base plus each individual option is approximately $9,310.76 butcher block, $8,573.85 painted top, $8,326.15 laminate or $10,767.69 quartz using printed section totals. That all-options grand total is not a usable target for a one-top project. Several line labels also conflict with quantities/units, including a one-day assembly label priced as two hours. These require clarification, not blind unit-price learning.

No supplied file has been identified as an actual RE10 transaction/repair request. The repair estimates provide useful scope examples but do not satisfy actual-RE10-upload acceptance.

## Acceptance and remaining work

Each benchmark needs the source manifest, unchanged test input, expected inclusions/exclusions, unresolved decisions, actual record/questions, pricing coverage, revision behavior and request receipts. The competitor total is hidden from plan-only model input to avoid anchoring. Compare totals only after normalizing scope, unit basis, labor/material responsibility, allowances and financial treatment. Exact supplied dimensions/counts and arithmetic must reconcile; a dollar tolerance cannot excuse missing work or fabricated measurements. Local market price tolerances remain unset until comparable current supplier/trade evidence or approved bids establish them.

Implemented candidate changes: safe spreadsheet arithmetic with merged-cell handling; explicit per-specification price evidence and customer-visible provisional allowances. Unit/contract tests check missing support, fabricated quotations, duplicate assessments and disclosure propagation. A quoted phrase still requires semantic review: structural checks do not establish that it proves an attribute.

Outstanding: real-model retest of these repairs, complete drawing-set reconciliation, image/scan semantic checks, all eight categories with answers and revisions, supported research for missing rates, final estimate review/delivery and published production acceptance. No other estimator has been modified or accepted.

## Live plan baseline and candidate verification

The actual 13-page addition plan PDF was uploaded through the published P5 customer interface with the unchanged instruction: "[QA] Addition plan benchmark. Please estimate the addition shown in these plans, including the necessary demolition, construction, tie-ins, and finish work. Leave existing rooms unchanged except where the plans show alterations."

The live UI showed reading progress (7 of 13 pages at 136 seconds), then reported 15 captured details and six questions. Its first question was **"Addition square footage missing"**. The expanded details repeated many paraphrases of the same demolition, location, exclusion and specification information. It did not display the stated addition areas. This is a failed baseline, not a completed estimate. The independently run P5 native parser retained A201's exact area schedule, including 26 and 471 SQFT. The evidence places the fault after native text extraction; the live reader/aggregation/question stages still need inspection before assigning a more specific cause. No answer was supplied to conceal the failure, and no estimate or customer notification was delivered.

The corrected local candidate passed 41 focused tests and TypeScript. Its complete production build passed 1,676 tests (1,661 passing, 15 database-dependent skips), all six database-safety checks, compilation, TypeScript and static-page generation. An earlier attempt failed because the local worktree's dependency symlink pointed outside Turbopack's filesystem root. Restoring a proper local dependency directory resolved that environment failure; no product configuration was changed to suppress it.

## Saved-stage diagnosis and subsequent repairs

Read-only host inspection identified the live addition draft as `3f891f50-dec8-4ffc-bfe5-d23669b84338`, revision 2. It confirms all 13 original pages completed with zero unread sections. The A201 areas survived both as takeoffs and as a calculated 497 SF fact. The native text on original page 11 says `FLOOR AREA = 495 SF/1500 = 0.33 SF VENTING REQ.` The legacy reader classified this separate crawl-space ventilation area into the same generic `sqft` field. Aggregation therefore kept a 497-versus-495 conflict, left the project-area answer empty, and retained page 1's earlier missing-area question. This is a quantity-subject and cross-page reconciliation defect, not lost PDF text. The public baseline remains failed. No customer answer was supplied to hide it.

The replacement interpreter already has separately owned physical quantities. Its source/review instructions now explicitly reconcile index-versus-upload inventory, the physical boundary and purpose of each measurement, repeated schedules, page-local questions answered elsewhere, and competitor assumptions versus actual customer authority. These generic instructions are not a claim that the actual drawing-set test passed.

The `a6efa68` host qualifications failed: whole-home and cabinets stopped after two work-method proposals used shortened or paraphrased quotations. The whole-home source said `paint 4,000 SF of walls and 1,800 SF of ceilings`; the rejected quote said `paint 1,800 SF of ceilings`. Cabinet quotations repeatedly inserted ellipses. The citation validator now returns the rejected quotation alongside the actual original wording as actionable repair feedback. Invalid quotations remain rejected; there is no fuzzy acceptance or silent alteration of source evidence.

Handyman interpretation reached five method steps, eight requirements and no questions. Its first pricing review claimed a cheaper `PB-03-19-04-L` rate at $20/EA existed. A separate read-only inspection of the exact saved 1,830-entry review catalog confirmed that code, and every code beginning `PB-03-19-04`, were absent. The actual selected `PB-08-71-01` was $70/EA, labor only. The reviewer invented the competing catalog entry. The resulting price correction also failed units, arithmetic, literal catalog evidence and four uncovered requirements; no customer amount was accepted.

The replacement now requires structured literal catalog evidence for review findings. Its provider schema restricts reviewer rate IDs to the actual supplied catalog. Server checks independently reject absent IDs, fabricated description excerpts and undeclared catalog-code references in findings. Invalid review evidence receives at most one review-only correction while keeping the selected prices unchanged. A second invalid review stops with its concrete error; it cannot silently pass or redirect the pricing model. Genuine supported findings still require correction. Tests reproduce the invented alternative and ensure one price-selection call, two review calls, an unchanged selection and no release after repeated invalid review evidence. Quotation existence still does not prove semantic accuracy, so human benchmark review remains necessary.

The new targeted verification passed 33 project-record tests and TypeScript. The full production build then exited successfully: 1,679 tests, 1,664 passing, 15 database-dependent skips, no failures, all six database-safety checks, compilation, TypeScript and 26/26 static pages. Exact-commit host retests remain outstanding. The local screenshot `qa-private/p5-addition-area-failure.jpg` preserves the customer-visible failed baseline.

## Hosted 7dfa746 results and continuation repairs

The exact host build passed 1,664 tests with 15 skips and zero failures. Whole-home, cabinets and handyman reached accepted intermediate interpretation without questions or validation problems. Whole-home retained the six distinct quantities and 14 work requirements; cabinets retained two materials-only requirements with 12 LF base and 8 LF wall cabinets and specified construction/hardware; handyman retained eight requirements and its owner supply/exclusions. Ten interpretation replies reported the required GPT-4.1 snapshot. These are interpretation outcomes, not priced-estimate or customer-experience acceptance.

Handyman pricing stopped at catalog selection because the paid-request ledger already contained a completed identical request but the response was saved under an older workflow key. It did not buy the request again. The continuation repair recovers only a same-project response with exact instructions/input, matching request hash, verified requested/returned model and provider response IDs. Multiple differing replies remain ambiguous and are not selected opportunistically. The recovered response passes current validators and review; old acceptance decisions are never reused. Recovery provenance is saved with the new work record. The spending ledger is not reset or bypassed.

The addition did not start replacement interpretation: its complete 13-page, 52-detail-section local read lacked the remote-reader manifest expected by the qualification loader. A new local-source connection verifies the original stored file checksum and reads all native text and page geometry without a new AI read. It retains overlapping historical observations separately, clearly labeled as interpretations, and marks absent or incomplete visual reads partial. It uses the same evidence format as remote files. Original text is not truncated at the legacy 60,000-character page-context limit. Source geometry remains explicitly digital page coordinates, not construction dimensions.

The actual uploaded Goeckner PDF passed this new native connection's parser check: 13 pages, 40,181 retained text characters, A201's 26/471 SF schedule and S101's separate 495 SF ventilation basis present, zero provider calls. Forty-four focused boundary tests and TypeScript passed. This does not yet establish correct model reconciliation, a qualified addition estimate, or a published customer-flow pass.

The full local build passed 1,685 tests (1,670 passes, 15 database-dependent skips, zero failures), database safety, compilation, TypeScript and static generation. A final malformed-checkpoint input guard was then covered by two passing recovery tests and a fresh production compilation. Hosted model retests remain required before any production rollout.
