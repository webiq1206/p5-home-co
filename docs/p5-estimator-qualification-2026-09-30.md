# P5 estimator research, repair plan and acceptance record

Status: **not qualified for rollout to the specialist sites**. Scope of this work is P5 only. This record separates vendor documentation, observed behavior, implemented fixes and unverified work. A number returned by the software is not an accuracy pass.

## Baseline and evidence

- Repository: `webiq1206/p5-home-co`. Baseline Git commit: `86d2e13b92d10284c19b617131492488c43af350`, estimator release `2026-09-30.3`.
- Initial live check: `2026-09-30.2`, build SHA `610b22cd7dc37871c14a10cd95ef01251dd9afe5`, dirty build. Git and production were not identical. Deployment provider success alone is insufficient evidence of current code.
- Production policy reported 1,484 source cost-book lines, 1,473 rateable lines, 185 owner-planning rates and nine learned rates. Counts do not establish suitability or current local accuracy.
- Existing controlled fixtures: `tests/fixtures/p5-qualification/cases.json`. Eight categories have text, PDF and rasterized-scan inputs. Synthetic repair forms must never be described as actual RE10 transaction documents.
- Earlier `.2` production receipts show bathroom PDF/scan, new-home scan, RE10 PDF and whole-home PDF stopping at needs-review. Handyman PDF and scanned versions returned substantially different ranges ($300-325 and $620-670). These are failures or unresolved discrepancies, not passes.
- `P5-Camp-Orchard-Bid-Review.pdf` is an internal, 56-page commercial bid review. Preserve its original. It provides reference scope and arithmetic, not a certified residential unit-price benchmark or an actual RE10 form. Do not disclose its internal profit information in customer estimates or upload it to competitors.

## Official product research

Research date: September 30, 2026 UTC. The following is documented behavior, not an independent accuracy certification. No paid competitor subscription has been purchased. Authenticated estimating access must be established before claiming hands-on estimate results.

| Dimension | Skoper, documented | Handoff, documented | P5 requirement |
| --- | --- | --- | --- |
| Intake | Plans with optional scope notes; description-only mode is labeled ROM. | Project-based estimate chat, voice text and file attachments; scope can be refined conversationally. | One intake combining description, files and explicit boundaries; retain source history. |
| Uploads | PDF, JPG, PNG, WebP, Excel; optional specifications. FAQ states 500 MB per upload, 600 pages per estimate, 150 pages for the trial. | General file workflow includes PDF, photos, Word, Excel and CSV; HEIC appears in file-management help. Dedicated takeoff accepts PDF, PNG, JPG, TIFF, up to 300 pages/200 MB combined. | Enforce the actual supported format, byte and page limits before paid processing. Never infer one route's limits from another route. |
| Plan reading | FAQ and process page say every sheet is supplied as image plus text. Quantities cite drawings or are marked estimated. | Dedicated AI Takeoff scales, measures and counts drawings; designed for residential work up to 5,000 SF. | Full page ledger, appropriate detail views, dimension evidence, formulas and explicit uncertain quantities. |
| Timing | Typical set about three minutes; large sets can take 15-20 minutes. | Conversational estimating differs from Scale-plan AI Takeoff, documented at 1-2 hours. | Honest progress and durable processing; measure actual latency by workload. |
| Scope and questions | Scope notes steer inclusions/exclusions. Public documents do not establish a comprehensive adaptive-question algorithm. | Text/file chat and later corrections are documented. Public help does not establish the exact missing-information or conflict logic. | Ask about cost-significant unresolved facts, preserve prior answers, and distinguish contradictions from deliberate revisions. |
| Pricing | User price book precedes market-rate estimates; origin is labeled. | Saved presets/catalogs override defaults. Supplier relationships and regional labor data are vendor claims; individual rate accuracy still needs checking. | Match scope, material specification, location, UOM and supply responsibility before selecting a rate. Track date, source and provenance. |
| Organization | Excel summary, detailed takeoffs, assumptions/sources, plus Word scope. Summary links to detail; overhead/profit/insurance/bond/contingency are separate formulas. | Group/room-based editable estimate, manual line editing and AI revisions; proposal workflow follows review. | Clear customer range, complete included work, exclusions, allowances and traceable internal line calculations. |
| Editing | Quantity, UOM, description, cost, added/deleted rows; regenerated downloads. | Edit via chat or rows; add/remove groups, rooms and lines. | Revision changes only intended facts, recalculates affected work, archives earlier versions and updates PDF/delivery. |
| Product pricing | Starter $149/month for 10 estimates; Professional $349 for 30; annual $1,490/$3,490; three free estimates advertised. | Annual page displays Flex $119/month, Pro $239 and Scale $719, with $149/$299/$899 comparators. Pro/Scale state 12-month commitment; Scale includes dedicated takeoff. | Competitor pricing is context, not authorization to subscribe or a P5 cost assumption. |

Skoper publishes a useful failure example: default partition heights understated drywall compared with a trade takeoff. Its stated remedy uses wall types and building sections. The relevant lesson is to validate dimensions against authoritative drawing evidence, not assume a room-height average. Handoff's correction documentation explicitly anticipates scope, quantity and rate errors. Neither product supplies grounds to promise error-free estimating.

### Research sources

1. https://www.skoper.io/faq
2. https://www.skoper.io/how-it-works
3. https://www.skoper.io/what-you-get
4. https://www.skoper.io/pricing
5. https://help.handoff.ai/en/articles/9778443-ai-create-an-estimate
6. https://help.handoff.ai/en/articles/15423812-how-to-run-an-ai-takeoff
7. https://help.handoff.ai/en/articles/11714923-file-management-powered-by-ai
8. https://help.handoff.ai/en/articles/11684954-ai-create-estimates-from-drawings-photos-and-videos
9. https://help.handoff.ai/en/articles/9563971-how-do-i-fix-errors-in-my-estimates
10. https://help.handoff.ai/en/articles/9564039-ai-understand-pricing-data
11. https://help.handoff.ai/en/articles/9778395-how-do-i-get-local-pricing-in-my-estimates
12. https://help.handoff.ai/en/articles/13251919-catalogs-a-smarter-way-to-control-pricing-in-handoff
13. https://www.handoff.ai/pricing

## Root causes and repair decisions

| Finding | Evidence/basis | Repair decision | Required verification |
| --- | --- | --- | --- |
| Production/version mismatch | Live release API versus Git HEAD. | Publish only tested source and verify SHA/tree through the public release API. | Live identity matches reviewed code; known fix fails on baseline and passes after release. |
| Scope facts lose component context | Prior failures collapse unlike fixtures, confuse vanity width with count, and combine different flooring areas. `.3` contains targeted repairs. | Keep quantity attached to the named component, room, operation and UOM; do not replace a typed group with a global count. Retest `.3` instead of assuming it works. | One 30-inch vanity remains one fixture; 1,600 SF LVP plus 80 SF tile stays separate; two shower wall quantities remain distinct. |
| Unreadable detail can appear covered | `documentLedger.ts` merges read plus unreadable into partial and derives completion from free-text notes. An unreadable status with a note outside the keyword list can be accepted. | Enforce structured unreadable status independently of note wording; preserve failures while merging detail views. | Mixed read/unreadable tiles never claim complete; blank-price but legible documents still qualify as read. |
| Ambiguous page provenance | Page-only fallback can associate an unidentified record with one of multiple files sharing a page number. | Permit fallback only when a unique original-page mapping exists. | Two page-one sources cannot borrow a third source's record. |
| Fuzzy price compatibility | Earlier runs matched wrong fixture/repair sizes and generated duplicate assemblies. | Repair compatibility checks and task coverage, with explicit component coverage of installed assemblies. Never solve duplicates by deleting required separate work. | Correct patch-size band, vanity width, handle count, no duplicate complete-building components, garage/porch/utilities retained. |
| Unsupported research/conversion | Earlier failures involved supplier package arithmetic and unsupported citations. | Validate evidence before arithmetic, normalize coverage per package and distinguish material from installed rates. Persist only validated reusable rates. | Unit conversions reconcile to quoted package cost; citation actually supports the selected product and amount. |
| Valid projects stop at pricing review | Prior receipts terminate with no range. | Trace the exact failing task and recover compatible approved/sourced pricing. Offer explicit supported allowance where a quantity/selection is uncertain. Never return zero or invented local rates. | All controlled scenarios reach a usable, scope-complete estimate; unresolved evidence is visible and not falsely certified. |
| Question logic is partly field/catalog driven | `questionPolicy.ts` and adaptive logic choose fields from cost-book needs; misclassified facts can cause irrelevant questions. | Gate questions by requested component and unresolved cost impact. Revised instructions must outrank superseded quantities; true conflicts remain questions. | No countertop-area question for a stated integrated-top vanity; no room size for handles; no material-cost question for owner-supplied parts. |

Keep the existing durable drafts, upload storage, revision checks, workers, cost-book infrastructure, independent pricing audit and delivery outbox. Replace faulty decisions at their shared boundaries. A wholesale rewrite would discard useful recovery and security controls without proving better estimates.

## Ordered implementation and validation

1. **Freeze scope and capture the baseline.** Work only in the P5 repository. Preserve unrelated changes and real customer records. Save release identity and private QA receipts. Do not reset production databases or migrate destructively.
2. **Repair source integrity.** Check every physical page and detail section; preserve dimensions, notes, schedule references and exclusions. Keep read failures distinct from blank values. Verify scanned, digital, multipage, duplicate and conflicting inputs before pricing.
3. **Repair scope and clarification.** Validate category, requested operation, room/building and responsibility. Track existing conditions separately from proposed work, demolition, replacement, installation, material-only and labor-only. Resolve user revisions without resurrecting stale facts. Ask one clear question about each actual uncertainty.
4. **Repair quantity and rate matching.** Validate dimensional formulas and UOM, component identity, size/specification, region/date and included labor/material coverage. Apply complete assemblies once and retain separate garage, porch, exterior utility and excluded-scope boundaries. Check materials supplied by owner versus contractor at task level.
5. **Repair calculation and recovery.** Use deterministic arithmetic for quantity times rate, waste, minimums, contingency and markup. Reuse exact successful stages, invalidate stale release-dependent prices and retain failures for diagnosis. Avoid repeated paid retries when no relevant input or code changed.
6. **Qualify controlled cases on a known release.** Review extracted facts and questions before submitting pricing. Compare text/PDF/scan equivalents and inspect line items, not just totals. Exercise missing facts, changes and exclusions independently. Preserve private draft credentials outside Git.
7. **Qualify real source documents.** Actual RE10, real plans and reference estimates require independently established expected scope. Synthetic fixtures are useful regressions but cannot certify real-document accuracy. A multipage count test does not certify drawing interpretation.
8. **Verify the published customer journey.** Upload, combined input, questions, review, submission, saved recovery, revisions, PDF and authorized test delivery. Record elapsed time and release. Desktop success does not certify physical iPhone/Safari behavior.
9. **Release decision.** Every critical criterion below must pass. Otherwise record the exact blocker and continue P5 work. Only then consider integration into child sites, with independent restricted-scope tests per site.

## Acceptance criteria

Common requirements: all explicitly requested work is priced exactly once or clearly included in another priced assembly; no expressly excluded or unrelated work is charged. All stated counts and dimensions must be preserved exactly. Calculated quantities must reconcile to their cited formula, with only stated rounding/waste rules. Arithmetic reconciles to cents internally; displayed ranges use disclosed rounding. Unknowns cannot be presented as measured facts. Missing required work is a failure even when total cost looks plausible.

Rates require compatible owner-approved prices, documented supplier/trade pricing or clearly labeled supported allowances. A generic published cost-per-square-foot range is a plausibility check, not evidence for an exact project bid. Benchmark variance must be explained by scope, date, specification, quantity, geography, tax and markup differences. No universal percentage tolerance certifies all projects. Use exact line arithmetic for controlled fixtures and a reconciled scope-adjusted reference for real bids.

| Category | Required controlled outcome | Main negative/revision cases |
| --- | --- | --- |
| New home | 2,000 SF living + 440 SF garage + 80 SF porch; complete house coverage; separate required site work. | No 2,520 SF conditioned house; no duplicated kitchen/baths; land/appliance exclusions. Change garage only. |
| Bathroom | 60 SF floor, 84 SF shower walls, one 30-inch vanity, individually specified fixtures; prep, waterproofing and disposal covered. | No 30 vanities; no invented countertop depth; unchanged plumbing is reconnection; change wall-tile area only. |
| Kitchen | 18 LF base, 12 LF uppers, 45 SF quartz, 30 SF backsplash, one sink/faucet. | Existing floor/appliances remain; detach/reset is separate from new appliance supply; remove backsplash revision. |
| Whole home | 1,600 SF LVP + 80 SF tile, 120 SF floor retained; 4,000 SF walls + 1,800 SF ceilings, 12 doors, 550 LF baseboard. | No gut/new-build package; no shower/roof/window scope; unlike quantities not merged. |
| ADU | 600 SF complete unit plus 20 LF water and 20 LF sewer; no garage. | No double pricing of contained kitchen/bath; utility runs not merged; update one utility length. |
| Cabinets only | 12 LF base + 8 LF uppers + zero tall; product only. | No delivery/install/consumables or room-area dependency; update uppers to 10 LF while preserving base. |
| Handyman | Three owner-supplied handle replacements, testing/adjustment/cleanup included once. | No hardware supply or door replacement; no whole-house cleanup; change count to two. |
| RE10 | Controlled test: two GFCIs, one P-trap, one 12x12-inch Type X patch. Actual form: all requested repairs and only those repairs. | One-square-foot patch, no new circuits/sink/whole-room paint; legal boilerplate creates no work. Add/remove one repair. |

Each category needs text-only, relevant upload-only and combined input. Add incomplete-scope and explicit revision cases. Document format cases must include digital PDF, scanned PDF, photos, multipage plans, unreadable content and contradictory source data. A photo cannot establish hidden conditions or precise dimensions without a scale or stated measurements.

## Evidence ledger

Update each entry with input filename/hash, release SHA/tree, expected behavior, observed facts/questions, line-item arithmetic, price evidence, duration, failure, fix commit and retest. Keep input/output evidence and delivery tokens private. The public repository should contain synthetic fixtures and sanitized observations only.

| ID | Scenario | Observation | Status |
| --- | --- | --- | --- |
| BASE-01 | Published identity | `.2` live while `.3` is Git HEAD. | Unqualified baseline |
| DOC-01 | One readable plus one unreadable detail record | Baseline marks the page complete when the unreadable note says only that detail is too blurry. | Reproduced defect |
| DOC-02 | Unidentified page-one record across two PDF sources | New regression requires both source identities to remain unresolved unless identified. | Fixed locally; production pending |
| UI-01 | Cabinet 8 LF to 10 LF upper revision on `.2` | Preserved 12 LF base, changed upper to 10 LF, supply-only lines, earlier version retained. Range $7,675-8,500. Displayed upper cabinet scope under an incorrect Painting category. | Quantity/revision pass; presentation failure |
| UI-02 | Inline qualifiers in trade classification | `upper (wall) kitchen cabinets` was truncated before the cabinet noun; a painted finish became Painting. | Reproduced and repaired locally; live retest pending |

No overall completion, real-plan accuracy, real-RE10 accuracy, complete delivery or specialized-site rollout is claimed by this initial record.

### Current repair verification

`documentLedger.ts` now preserves an unreadable status across both report and detail-tile merges, regardless of wording or input order. Page-number fallback requires an unambiguous original page; section-relative fallback is restricted to a single source. Thirteen focused document tests pass, including the reproduced failure, source ambiguity, legitimate filename/relative-page normalization, and legible redacted-price documents. Release `.4` contains this repair plus the existing `.3` fixes. Historical cached outputs are not retrospectively certified by this test.

Both competitor application URLs displayed sign-in screens in the available browser. Public documentation was reviewed; no authenticated competitor estimate or accuracy comparison is claimed.

Trade classification now removes parenthetical qualifiers while retaining the rest of the item description. Explicit painting work still selects Painting. Regression cases include the exact live upper-cabinet text, nested qualifiers, cabinet installation catalog suffixes, actual cabinet painting and primed doors.

P5 now applies the existing complete-source guard to local reads and both pricing entry points. The baseline enabled this policy only for Construction. A page marked read but accompanied by an explicit unreadable-content note also fails coverage validation. Unread source content must be resolved before pricing; uncertain but legible quantities remain eligible for clarification or supported allowances.

The final full production build passed 1,528 tests, with 15 explicit skips and zero failures. This includes both P5 source-admission paths rejecting unread content before database or provider work. The Next.js production build and type checks passed.

The original two-page Marcliffe RE10 was recovered from an email attachment, along with a genuine multipage residential addition permit set. These are available for real-source qualification. The cabinet revision email is present in the P5 sender's Sent mailbox with the expected $7,675-8,500 range and PDF attachment. This establishes dispatch; recipient inbox receipt remains unverified.
