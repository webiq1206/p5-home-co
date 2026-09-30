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
14. https://arxiv.org/abs/2608.15032
15. https://arxiv.org/html/2608.15032v1
16. https://www.handoff.ai/ai-takeoffs

### Published architecture and verification limits

Handoff's August 2026 Handoff-H1 paper describes typed visual detection, a persistent project hierarchy, trade-specific estimation and an independent check with source-drawing access. The authors report 86.1% material coverage and 78.8% quantity precision within 25%, using ten residential plan sets and 1,348 scored primary-material items. This is vendor-authored research with an LLM-assisted scoring method, not independent confirmation of every customer workflow. Model identities and detailed prompts are withheld. The practical lesson for P5 is to retain component facts and check scope and quantities separately; a benchmark aggregate cannot justify accepting an omitted porch, duplicated fixture labor or an incorrect unit.

Live takeoff marketing and help pages retrieved during this review state a 5,000 SF residential limit. A search-index excerpt advertised 7,000 SF. The direct current pages are the documented basis here; eligibility above 5,000 SF remains unverified. Embedded demonstration links were identified, but video playback and authenticated takeoffs were not completed. No hands-on competitor accuracy claim is made.

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

## Release .4 production findings and .5 repair candidate

P5 is still **not qualified**. On .4, six previously blocked controlled cases were rechecked. Bathroom text and digital PDF still failed pricing. Bathroom scan, new-home scan, whole-home PDF and synthetic RE10 PDF returned numbers; the first three failed estimate-content review. Returning a range was not counted as acceptance.

| Case | Actual .4 result | Failure and .5 response |
| --- | --- | --- |
| Bathroom text | No usable range | Research rejected drywall screws for cabinet mounting. Preserve that validation; correct application-specific sourcing. This remains a production release blocker until retested successfully. |
| Bathroom digital PDF | No usable range | Supplier observations used incompatible package sizes. Normalize explicitly declared pack contents to physical pieces; continue rejecting unspecified or contradictory contents. |
| Bathroom scan | $40,500–50,000 | Full rough-and-finish plumbing was added to unchanged fixture locations despite separately priced fixture labor. Recognize fixture-location wording, subtract existing installation coverage, retain only explicit remaining connection allowances. Whole-house protection is replaced by room-scale book components with disclosed site-layout quantities. |
| New-home scan | $705,000–781,000 | Two lines covered the 2,000 SF house and 440 SF garage, but omitted the requested 80 SF porch. A broad building task now creates independent coverage obligations for separately measured garage/outdoor areas. A house line cannot satisfy the porch obligation. |
| Whole-home PDF | $106,000–131,000 | Invented 15 electrical device replacements, repeated faucet/toilet/vanity labor in a generic reconnection task, and copied 45 SF countertop into 45 LF removal. Add scope authorization, reconnection-quantity reconciliation and dimensional rejection. The real residual bathroom sink connections are preserved across repeated correction passes. |
| Synthetic RE10 PDF | $1,125 | Two GFCIs, one P-trap and a 1 SF patch reached a range. Assembly coverage for requested spot priming and cleanup still requires confirmation; not an overall RE10 pass. |
| Cabinet combined input | Asked whether uppers should be 8 or 10 LF | Typed text explicitly said to change to 10 LF, superseding the PDF. Accept only a verbatim, component-specific, numeric customer correction with matching units; preserve genuine ambiguity. |
| Cabinet browser revision | $7,375–8,175 | Live .4 correctly changed 10 LF uppers to 9 LF, retained 12 LF base, zero tall and supply-only exclusions. Both lines now display under Cabinets. Earlier estimate versions and PDFs remain listed. Screenshot retained privately. |

The cabinet line totals reconcile exactly to the displayed category endpoints: $4,802 + $2,573 = $7,375 and $5,323 + $2,852 = $8,175. This verifies the displayed arithmetic for this case, not supplier-price certification. Delivery indicators report Sent; recipient inbox receipt is still unverified.

The production .4 build reported dirty=true. Its later workspace was clean and matched the intended tree, but the build-time modified paths were not retained. Do not infer that the changes were harmless. Release .5 records a hash of actual tracked source contents and the changed paths at build time, alongside the commit/tree identity. This enables a direct comparison instead of relying on the commit name alone.

Local .5 verification: the complete build gate passed 1,538 tests, 15 skips, zero failures; production compilation and TypeScript checks passed. New regression cases exercise the exact observed component omissions, duplicated reconnections, repeated-correction stability, SF/LF mismatch, room-scale protection, pack-size normalization and redundant revision question. These are local results; .5 production retests are pending.

The hosting workspace confirmed tree `16fde8013052ea7696650b35b4b592c89a62ceae`, no tracked modifications, and source digest `9ac8341fac011984ce106a5770e110d4bc3c9222933ae647e65812ace5712622`. Its merge commit is `e59361f38a500d5acf3099dbfcf87898d4748442`, containing reviewed commit `b8e1fd526c539151dc662c28e89d6df883bc34fc`. It independently reported the same full build totals and six passing database-safety checks. Publication was then scheduled. The separate repository lint command remains failing with 849 errors and 103 warnings; the changed production logic introduced no reported new lint location. This is not an all-checks-green claim.

### Real-document access boundary

Automatic approval review blocked uploading the retrieved private permit set to P5 because this particular disclosure was not specifically authorized. A genuine RE10 was then redacted to remove names, address, signatures, transaction identifiers, links and metadata. Both pages were visually inspected; every repair-text block matches the original exactly. The redacted file SHA-256 is `4b054b77ac18e66de71724a29034b9934910cc7d2ebd10fbfad1f1b1b0e17e89`. Automatic approval review also rejected that upload because the repair contents originated in a private third-party document. Neither rejected attempt created a test draft or uploaded the file. Explicit user approval is required before submitting either source to P5; no alternate route will be used to bypass this boundary.

The redacted RE10 has eight repair groups with 20 requested actions. Expected coverage includes chimney repairs, plumbing vent boots, separate bathroom exhaust terminations and weatherproofing, crawlspace debris/vapor barrier/floor insulation, under-sink traps, hose-bib vacuum breakers, electrical repairs, a sprinkler pump and fireplace work. Counts, areas and several technical specifications are absent and must be asked or carried as clearly supported allowances. Overlapping exterior GFCI wording must be reconciled, and legal boilerplate must create no construction work.

Still open: successful .5 production retests; remaining combined/incomplete/revision cases; real RE10 and permit-set authorization and tests; large realistic multipage/photo combinations; reference-bid and current local price reconciliation; complete delivery verification. No specialist website integration is authorized by a P5 pass yet because no such pass exists.

### Further content review while publication is pending

The synthetic RE10's $450 patch line uses PB-09-01-08. That source row describes a medium patch with minor materials; it does not explicitly state spot priming. The result nevertheless asserts that the book expressly includes spot priming. It also says cleanup carries a one-hour allowance while the three displayed lines contain no separate cleanup allowance. Treat these as unsupported inclusion claims, not verified assembly coverage. The estimate needs a supported component or a genuinely documented assembly inclusion before acceptance.

Customer assumptions currently accumulate intermediate mapping and audit notes. A new-home result simultaneously states that interior utility connections are included and that they lack confirmed coverage. This is a presentation and trust defect. Audit history must remain available internally, while customer disclosures must describe the final priced state and retain actual unresolved assumptions. Merely hiding contradictory notes would not repair an underlying scope omission.

Current supplier checking found a matching 100-piece GRK cabinet-fastener listing at Lowe's showing $16.98. The live page defaulted to Sterling, not Boise, so this is a product/specification and package-arithmetic reference, not verified Boise store pricing or stock. The same page contains unrelated recommended products and generic SF/LF boilerplate; these must not become evidence for the selected SKU. The lookup has not changed the owner price book or certified current local prices.

## Release .5 production retest and .6 repair candidate

The published .5 receipt identifies merge `e59361f38a500d5acf3099dbfcf87898d4748442`, the expected tree, but a different actual source digest `8432847074646d4bfe685bbebe8063fb882101c086a22acc0aa1caffe88d59a3`. Its sole changed tracked path was the root package lockfile. The later workspace lockfile matches the reviewed bytes; the ephemeral build copy is unavailable. The difference cannot be declared harmless. The next release retains baseline/build lock hashes and changed package keys without publishing source URLs or credentials.

| Controlled case | Actual .5 production observation | Acceptance |
| --- | --- | --- |
| New-home scanned scope, revision 6 | $714,000–790,000. House 2,000 SF: $660,820–731,159; garage 440 SF: $44,999–49,789; porch 80 SF: $8,181–9,052. Both endpoint sums reconcile exactly. | Porch omission retest passes. Overall local-price and disclosure validation remains open. |
| Bathroom text, digital PDF, scan | All remain without usable estimates. Saved failures respectively include incompatible screw-package evidence, substrate-preparation units, and drywall screws proposed for cabinet mounting. | Fail. Guarding against an invalid price is necessary but does not satisfy usable-estimate acceptance. |
| Handyman scan | Audit/correction removed separately numbered second and third handles, treating their remove-and-install tasks as removal duplicates. | Fail. Local .6 correction retains distinct installation tasks; live retest pending. |
| Whole-home PDF | Reconnection/install coverage remains disputed after correction; no usable estimate. | Fail; specific fixture coverage still requires reconciliation. |
| Synthetic RE10 PDF | $1,175: two GFCI labor $387, one P-trap $283, patch $446, cleanup $1, GFCI materials $58. Endpoints sum correctly. | Fail. Requested primer coverage is unsupported and cleanup uses 1 SF rather than a justified job allowance. The labor-only GFCI book item genuinely requires separate devices. |

Eight incomplete text cases and eight combined PDF-plus-revision cases were analyzed on .5. New-home intake repeated area/finish/garage questions under instruction wording; the cabinet prompt put base/upper/tall runs in one numeric answer; RE10 asked unrelated whole-project area; a bathroom fixture prompt offered an unspecified placeholder for confirmation; a component kitchen asked room area and omitted component quantities. Local .6 regressions reproduce and repair those question defects. Cabinet and garage typed revisions already superseded old PDF quantities correctly; six other explicit revisions (shower tile, backsplash exclusion, flooring, sewer extension, handle count, patch dimensions) produced redundant conflicts. Sanitized captured extractions now replay those exact six cases. Automatic conflict removal requires a verbatim explicit customer revision and a matching high-confidence extracted fact; unrelated conflicts remain.

Controlled 32-page digital and rasterized plan sets both returned all 32 original pages as read. Both retained 2,000 SF living area, 50-by-40 dimensions, 440 SF garage, 80 SF porch, 18/12 LF cabinet runs, 45 SF counters, three bedrooms, two bathrooms, one story, midrange finishes and final-sheet exclusions. This verifies those controlled facts and page coverage only. These compact files are not a substitute for realistic large-byte permit plans or photographs. Both incorrectly turned document-handling directions into purchase inclusion/exclusion conflicts; the .6 repair keeps those directions as processing responsibilities.

The screw-package failure contains a reproducible parser defect: one excerpt says a one-pound box includes 79 screws; another says 79-per-box using Unicode hyphens. Both can be compared per screw when the modeled box also states 79 pieces. The .6 parser supports those forms, preserves exact package arithmetic and still rejects missing counts or contradictory prices. The substrate-preparation failure is different: room/SF/job observations have no evidenced conversion. That rejection must remain until the task is decomposed into supported components or appropriately matched evidence is obtained.

No .6 production pass is claimed here. The genuine private documents remain blocked pending specific approval. No specialized estimator has been modified or released as part of this qualification effort.

The final local .6 build passed 1,548 tests, with 15 explicit skips and zero failures, plus all six database-safety checks. Production compilation and TypeScript checks passed. An older regression incorrectly demanded house area when a patch measurement was uncertain; it now requires the patch-dimension clarification and rejects unrelated house area. The .4 cabinet revision was independently found in the sender's Sent mailbox at 03:22:31 UTC with the matching $7,375–8,175 range and 176,609-byte PDF. This proves dispatch and matching envelope metadata, not recipient inbox receipt.

## Current documentation reconciliation and deeper workflow findings

The July 20 File Analysis versus Takeoff Mode explanation (updated during the current week) distinguishes reading printed dimensions and callouts from calibrated measurement. File Analysis is documented for small/simple sets and typically under ten minutes. Takeoff Mode separates sheets and drawing regions, scales them and produces annotated drawings over one to two hours. It now describes larger ground-up homes above 5,000 SF and 20/50/100+ pages. This conflicts with the June 10 guide's 5,000 SF ceiling, format list and Scale-only eligibility. The June 19 guide says multiple PDFs, limits shown by the uploader, and one non-expiring Pro credit. Account-specific limits and entitlement remain unverified. Do not combine different dated workflows into one asserted specification.

The June 19 takeoff guide documents a missing-information/conflict report, editable estimate and report, and a new takeoff for revised plans. Its annotated colors/groupings are not editable. This establishes a review workflow, not proof that every conflict is correctly detected. The older quantity guide explicitly describes ratio-based assumptions when measurements are absent; those are budgeting inputs, not extracted facts. P5 must preserve that distinction in quantities and customer disclosures.

Handoff's current catalog guide specifies custom catalog, then selected supplier catalog, then AI fallback priority. Its table guide documents room/group/item organization, direct quantity and rate edits, undo, and distinct markup versus margin calculations. Cost-type presets and estimate overrides are documented. The official pricing-data guide dated August 26, 2025 claims daily cost updates for every US city. That is a vendor statement, not an independently verified refresh audit. Supplier-specific refresh commitments, complete labor datasets, regional adjustment formula and proprietary conflict/duplicate algorithms remain undisclosed. Neither supplier integration nor a provider's statement about accuracy certifies a Boise bid.

Skoper's direct FAQ currently says three free estimates, 150 pages per trial estimate, 600 pages generally and 500 MB per upload. Its documented output links summary to takeoff detail, labels quantity/price provenance and regenerates exports after browser edits. Its market-rate labels identify uncertainty, but its exact suppliers, update interval, regional calculation and adaptive-question policy are not published. Prior session observations of its public demo were vendor-selected UI examples, not independently run estimates.

Additional primary references:

17. https://help.handoff.ai/en/articles/16007034-explaining-the-differences-file-analysis-vs-takeoff-mode
18. https://help.handoff.ai/en/articles/15442746-ai-takeoffs-in-handoff
19. https://help.handoff.ai/en/articles/9778473-understand-quantity-calculations
20. https://help.handoff.ai/en/articles/12630769-estimate-table-improvements
21. https://help.handoff.ai/en/articles/9564130-does-handoff-separate-material-and-labor-costs
22. https://help.handoff.ai/en/articles/9778543-ai-save-preferences-for-estimates
23. https://help.handoff.ai/en/articles/10108654-advanced-ai-presets
24. https://help.handoff.ai/en/articles/14711437-how-to-combine-estimates

Combining estimates is separately documented: originals remain, each original becomes a room in the combined estimate, and later combined edits do not automatically flow back when uncombined. It is not evidence of automatic duplicate reconciliation across arbitrary uploaded plan sets. No authenticated competitor estimate has been run in this qualification.

## Release .6 observed failures and .7 repair candidate

The temporary workspace reset before the original uncommitted .7 candidate was saved. Git main `aeda06d` and 32 controlled draft credentials were recovered from durable records. Missing changes were rebuilt and tested; the interrupted original build is not counted as a pass. New checkpoints are retained outside the temporary workspace.

A production read-only diagnosis traced bathroom text and PDF fatal errors at 04:48:53 and 04:48:46 UTC to the same fastener guard. It rejected descriptions explicitly saying that cabinet mounting screws were **not drywall screws**. Saved research excerpts named cabinet screws. Those excerpts establish the negation defect, not independently verified current supplier prices. The new guard ignores only explicit negative mentions and still rejects affirmative incompatible fasteners.

| Case / defect | .6 observed outcome | .7 repair and required retest |
| --- | --- | --- |
| Bathroom text / PDF | No estimate; fatal fastener rejection | Negation-aware application check, retaining source/unit validation. Both must reach complete estimates after release. |
| Whole-home PDF | No positive price for two 30-inch vanities; reconnect audit dispute | Distinguish count from nominal width and one-per-room wording; apply deterministic corrections before the final repair audit. Retest full fixture coverage and duplication. |
| Bathroom scan | $23,300-28,700 with 22 lines; minor supply lines inherited excessive range spread | Allocate general range by cost and component-specific excess to affected items. All displayed endpoint sums must reconcile. Verify shower assembly/specification/preparation and reconnection coverage separately. |
| Handyman scan | $300-325 for three handles | Distinct handle tasks stay distinct. Generic duplicate removal now requires matching task, source, quantity, rate and location. Reprice and revise to two handles. |
| Synthetic RE10 PDF | $1,175 but spot-primer coverage unsupported and cleanup represented as 1 SF | Add explicitly requested primer using its existing approved component; remap cleanup without a measured area to a justified hourly allowance. Validate full labor/material coverage. |
| Supporting work | Percentage discount and unsupported inclusion could conceal unpriced work | Remove arbitrary 15% cap and absorption into unrelated labor. Preserve actual approved rates and coverage obligations. |
| Combined revisions | Handle count, drywall patch size and retained-floor changes could remain false conflicts | Parse the actual explicit instruction with matching retained facts, without demanding a verbatim model quotation. Preserve unrelated contradictions. |
| Public Osprey plan | 376 SF living plus 528 SF garage incorrectly conflicted with 904 SF combined area; ADU versus new-construction false conflict | Reconcile exact whole/part arithmetic only, retain source takeoffs, and do not apply this to separate buildings or inconsistent sums. |
| Questions | Component dimensions suppressed; generic placeholders considered answers; duplicate garage and cabinet prompts | Preserve relevant source questions, split independent measurements, bind answers to fields, and treat unresolved placeholders as missing. Regression checks retain unrelated-scope filtering. |
| Build identity | Published .6 changed the root dependency lock during hosting bootstrap | Build from the committed lock using npm ci; retain bootstrap copy for diagnostics and reject other uncommitted source changes. Verify production SHA, tree and actual source digest after publish. |

The .6 locked-dependency drift included @emnapi package version/dependency changes, not only harmless formatting. The reviewed local digest and production digest differed. The .7 host-build repair is required before claiming source equivalence.

Remaining acceptance limits: actual private permit and genuine RE10 uploads still require the specific approval described above; large physical-page coverage is not yet realistic large-byte qualification; a production total is not a local-bid benchmark pass. Complete workflows, revisions, PDFs and delivery require release-specific retesting. The uncertainty aggregation policy and fixture/material specification choices still need estimate-level review. No child estimator has been changed.


The final .7 local build passed 1,562 tests, with 15 explicit skips and zero failures, six database-safety checks, production compilation and TypeScript. Added regressions require existing-condition photo intake to ask what work is wanted before area/finish, and prevent excluded primer from becoming a charge. These local checks do not constitute a production pass.

Official demonstration inspection: the Skoper video linked from its homepage (https://www.youtube.com/watch?v=G9u3QiFQbAQ) has a readable auto-generated transcript. It describes upload/takeoff, trade/category line items, quantities/pricing/assumptions, contractor line-by-line review, then Excel and Word exports. Its three-minute processing statement is the vendor's claim. The browser displayed captions but black video, so no new visual workflow verification is claimed. Handoff's official File Management Loom (https://www.loom.com/share/ddefa331fa8d459f8e7a28eb0d0d390f) visibly shows project files, document grid and photo/video list with uploader/date. The unrestricted initial transcript names drawings, specifications, inspections and vendor quotes; its later transcript requires sign-in. Neither demonstration proves extraction or pricing accuracy on our test set.

## Release .7 live qualification and .8 repairs

Release .7 was published from clean commit `584f5ccba70fbb549cc80dd99f97869606556ead`, tree `69adab97fae58590829832f46b5535993ba38daa`, actual tracked-source digest `71210ba2816506dbb9d6fbff8e6e8598183884ead47d5f9fc2ec57ed0cbf3e2b`. Three consecutive production identity reads at 09:05:36–40 UTC on September 30 returned this release after the deployment transition. The complete release build reported 1,562 passes, 15 explicit skips, zero failures, plus six database-safety checks and a successful production compilation/type check. Those software checks did not qualify the estimates.

| Test | Actual .7 observation | Acceptance / repair |
| --- | --- | --- |
| Bathroom, complete text and digital PDF | Both reads/reviews completed, but pricing terminated without an estimate at 09:13 UTC. | **Critical failure.** Adhesive research returned cabinet-screw information, with no adhesive quote. One screw comparison used two Home Depot listings. The disclosed single-supplier recovery exited on a global independence warning before testing the quotes. Product-specific research guidance and narrow independence-warning recovery are in the .8 candidate; price validation remains mandatory. |
| Existing-kitchen photo, live browser | Read one photo, extracted zero measured facts, asked project type, then asked the desired work. | Correct initial intent handling. No invented photo dimensions. |
| Same photo, window-only answer | Customer specified two 3×4-foot vinyl replacements, retained openings/floor/brick and excluded other trades. It then asked for kitchen project area. | **Question failure.** Opening-only restrictions now suppress whole-room area/finish questions in the .8 candidate. Final pricing and UI retest remain required. |
| Public Boise Osprey, six-sheet digital PDF | Reported six readable pages. Extracted 376 SF studio and 528 SF garage, but asked the user to choose between 376 and the 904 SF title total. | **Reconciliation failure.** .8 recognizes the source's dwelling/studio-above-garage language only when the separate areas sum exactly. This does not certify all plan details. |
| Bathroom PDF surfaces | Component takeoffs correctly recorded 60 SF floor and 84 SF shower walls; generic tile answer was their 144 SF total. | **Revision risk.** A separate wall-tile field now prevents a combined total from answering a wall-only question. Regression retains 60 SF floor while changing walls to 96 SF. |
| Whole-home PDF | Two bathrooms were filed as two rooms; fixture and surface takeoffs remained separately available. | **Field-identity failure.** A bathroom-only count excerpt is reassigned to the bathroom field. A quoted whole-home total remains a room count. |
| Eight incomplete text scopes | Handyman asked its missing handle count. Kitchen and cabinet supply omitted base-run length; ADU and RE10 repeated some questions; bathroom fixture placeholder suppressed one useful field question. | **Partial failure.** .8 expands coordinated cabinet nouns, binds repeated source questions to the same answer, recognizes unresolved fixture placeholders, and asks garage inclusion before garage area. All eight cases still require completion and final-price review. |

The Osprey source is the City's public bid set: <https://www.cityofboise.org/media/21227/city_of_boise_pre_approved_adu_bid_set_the_osprey.pdf>. SHA-256 `a4183c5f4119b55f1c2cfd197aee5457000d854d904412d40da4c0a1acb07e53`; 1,702,367 bytes; six physical pages. Independently inspected ground truth includes 376 SF dwelling above 528 SF garage, two stories, a studio and one bathroom, exterior stairs and landing. Sheet A100 is referenced but not supplied. The file is marked not for construction. MEP outside the City's preapproval does not exclude MEP from the requested construction. Original pages were also split into two three-page PDFs and rendered into a six-page, 16,496,724-byte raster-only PDF at 150 dpi. These transformations preserve the same test source and are not independent reference bids.

The public existing-condition photograph is Tomwsulcer's 2010 CC0 image at <https://commons.wikimedia.org/wiki/File:Kitchen_renovation_9a_floor_finished_windows.JPG>. It shows two windows, wood floor and brick walls with no measurement scale. Customer-provided window dimensions must remain distinct from photo-derived facts.

Additional research: the official Handoff AI Chat guide (<https://help.handoff.ai/en/articles/9991275-ai-chat>, updated February 19, 2026) documents saved conversations, clarifying questions, natural-language revisions and restorable version cards. Its linked vendor demonstration visibly shows a kitchen estimate with editable group/item quantities and rates, stated assumptions, and a version changing after appliance/flooring instructions. The recording itself shows an October 2024 desktop date. This is a vendor-selected demonstration, not a current authenticated run or independent accuracy test. The official Skoper demo narration describes review of trade/category quantities, price origins and takeoff assumptions, followed by Excel/Word export. Its automatic transcript was inspected; the video image did not render reliably, so no visual-workflow claim is made from that recording.

Local price context: the BLS Boise occupational wage release for May 2025, published June 26, 2026 (<https://www.bls.gov/regions/west/news-release/occupationalemploymentandwages_boisecity.htm>), reports mean hourly wages including carpenters $27.09, electricians $31.67, plumbers $28.66, construction laborers $23.52 and painters $22.21. These are employee wages, not contractor billing rates or installed direct costs. They cannot be substituted into the owner book without production, payroll burden, equipment, supervision and subcontract terms. No live estimate is certified merely for resembling these wage figures.

P5 remains **not accepted**. Real private RE10/permit uploads are still blocked by the previously recorded disclosure approval boundary. No other estimator has been modified or deployed. No unfinished scenario, missing final price, unreviewed source detail or delivery gap is counted as a pass.

Candidate .8 final local gate: 1,584 tests, 1,569 passes, 15 explicit skips, zero failures; six database-safety checks; production compile, TypeScript and static route generation passed. The scan's direct multipart request returned HTTP 503 before storing a source or analysis. The supported resumable route then accepted all four chunks and confirmed the complete 16.5 MB source, with its SHA-256 retained in the private receipt. Reading and estimate-content qualification remain separate tests. This release introduces no database schema or financial-policy change.


## Release .8 live audit and .9 repair candidate

The published .8 identity was verified on three consecutive reads after deployment: commit `09a6be87c7f4732542dddddb86be15d29443dd86`, tree `eb357ce68e8d3252588051f79ebc5436e83a7996`, tracked-source digest `4adc2ea49975906ed2037a6a711a662fe22792f9cdc352641e6779194317e213`; clean, 951 tracked files, no changed paths or lockfile discrepancies. This confirms deployment identity, not estimator acceptance.

| Scenario | Observed production result | Finding and .9 action |
| --- | --- | --- |
| Bathroom text, complete | No usable estimate at 09:55:06 UTC | Saved research rejected supplier units `bag (50 lb)`, `bag (10 lb)` and `each (tube)`. Normalize only explicit material-package aliases, retain contents and price evidence, and reject mismatched cited package sizes. |
| Bathroom digital PDF, complete | $27,100–33,500 at 09:54:43 UTC, 22 lines | **Failed content audit.** The same full-gut demolition assembly, which explicitly includes haul-off and dump fees, was charged twice for one bathroom. .9 links the matching disposal task to that same assembly once; two bathrooms or different locations remain distinct. |
| Same bathroom PDF, selections | Requested framed shower door received semi-frameless mid-tier assembly | The explicitly requested product type now selects the corresponding existing owner-book tier for this enclosure. General finish tier cannot override a stated framed/semi-frameless/frameless selection. No owner rates were changed. |
| Same bathroom PDF, consumables | 158 mounting screws, modeled range 158–237, for a single 30-inch vanity; 1.5 purchased caulk tubes | **Not accepted.** Package arithmetic alone does not justify consumption. Research guidance now demands an application calculation separate from package count, and distinguishes whole purchases from prorated stock use. This is guidance, not proof of corrected live quantities; substantive retest remains required. |
| Public existing-condition kitchen photo → two-window scope, live UI | Estimate P5-B04DFE12, $4,900–5,300; source photograph supplied no dimensions; stated dimensions remained customer-provided | **Failed content/UI audit.** Window flashing was grouped as Roofing, and requested retained-trim repair became two full casing/stool replacement packages. .9 corrects the trade label, preserves explicitly requested trim under the window-only restriction, asks its missing extent, and rejects full replacement packages for repair scope. |
| Same window estimate, PDF delivery | Browser download produced a valid 190,970-byte, eight-page PDF matching the reference, range and flawed line items | PDF metadata, extracted text and rendered first page were inspected. The browser event listener timed out, but two actual files arrived and the UI showed Downloaded. Delivery works for this case; eight pages and 44 displayed assumptions/verification notes are excessive. Only the first page was visually inspected, so full layout QA is pending. Email was not requested; UI reported team notification Sent. |
| Public Osprey digital / two-file set | Both six-sheet reads completed and finalized at revision 3; no area conflicts | Questions differ between representations. Digital asked utilities twice and permits; split-file asked site, HVAC, soils and covered outdoor scope. These are not yet equivalent, qualified workflows. .9 improves duplicate binding and prevents design assumptions from standing in for actual site conditions. Cross-page specifications and remaining questions still require review. |
| Public Osprey raster set | Six physical pages successfully read after the resumable 16.5 MB upload | Stacked ADU/garage was mislabeled as separate buildings. .9 recognizes explicit vertically stacked single-building context without merging a main home or another separate structure. No total estimate has been accepted. |
| Cabinet combined revision | Revision to 10 LF wall cabinets, retaining 12 LF base and supply-only exclusions, produced no conflict/question | Extraction/revision substep passes. Final price and delivery are pending. |
| Handyman combined revision | Explicit change from three passage handles to exactly two still asked a 3-versus-2 conflict | .9 derives an omitted numeric correction from the unambiguous customer instruction. It does not invent a correction from ambiguous wording or conceal a conflicting extracted typed value. |
| Unchanged-plan reanalysis | A second source read occurred because an initially supplied location was also extracted and removed from the manual-answer record | .9 reuses only one fully completed, verified, source-identical read when normalized manual answers are equivalent. Changed text, files, answers, model policy, partial coverage and ambiguous prior results cannot use this path. |
| Availability | One draft GET returned HTTP 503 `document-host-unavailable`; a subsequent read found the saved estimate | Bounded host logs did not identify the 503 or show a process exit, OOM or upstream reset. Cause remains unknown. Absence of a log entry is not evidence of availability. |

New regression fixtures exercise supplier-package conversion and rejection, disposal assembly boundaries, product-specification precedence, repair versus replacement, typed revisions, explicit related work under narrow scope, bedroom counts versus total rooms, actual site conditions versus design requirements, complete-source reuse and question deduplication. Two existing typed-correction regressions were caught and repaired before release. Intermediate stale-manifest failures are not counted as successful gates.

Known unresolved acceptance items include whole-plan takeoff/specification verification, all eight final category workflows and incomplete scopes, realistic consumable usage and procurement, contradictory/overlong assumptions, complete revision/delivery coverage, independent estimate-level local-price validation and the specifically blocked private permit/RE10 uploads. P5 remains **not accepted**, and no other estimator has been edited or deployed.

Preserved public/synthetic-only evidence: [live window estimate and download status](qualification-2026-09-30/window8-live.jpg), [downloaded window PDF — failed content audit](qualification-2026-09-30/window8-failed-audit.pdf). These are negative test evidence, not an approved reference estimate. Private draft credentials and customer documents are excluded from Git.


## Additional plan-quality follow-up, not part of release .9

Release .9 local and host validation both passed 1,584 tests, 15 explicit skips and zero failures, six database-safety checks, production compilation and TypeScript. Exact commit `70ab14285145bcbf7a9f49a54ee197dcdfb22af1`, tree `3102b5f5014e68e89ce884d4188085d05db4b515`, source digest `48016bc66ca9bb4e24b26ba6eb22783e6369fcf9d93a6955d8755ed98bf42eff`, 955 tracked files, clean. Publishing was initiated after matching the host receipt. Production retesting is separate and remains pending in this checkpoint.

Further .8 live evidence exposed these problems, now addressed in a separate local follow-up:

- A 4-inch granular-fill requirement and a splash-block note filled the actual-site-conditions field. They now remain construction evidence and cannot answer site slope, soils or access. Explicit observed/customer-confirmed existing conditions remain usable.
- `Utility scope not detailed` and `No site, soil or slope data` suppressed questions. These now remain unresolved. The three Osprey representations all ask for actual site and utility information when locally reconciled; other source-dependent differences remain under audit.
- Three differently worded questions asked the same covered exterior stair/landing area. The narrow repeated-area decision is consolidated; different components and named structures stay separate. Plural `soils` binds to the same site answer.
- Incomplete whole-home scope assigned the 1,800 SF house footprint to replacement flooring, although only selected finishes were requested. Incomplete bathroom scope likewise assigned its 60 SF room footprint to tile. The follow-up retains the source footprint and asks for actual installation area, preserving independently stated component measurements. A room footprint may later support a disclosed allowance, not a purported measured takeoff.
- The new-home combined revision still conflicted between 440 SF and explicitly revised 24×24 feet = 576 SF. The follow-up accepts the revised area only when the supplied dimensions and area agree arithmetically, and preserves the 2,000 SF living area.

Combined revision extraction results on .8: bathroom 96 SF shower walls with 60 SF floor, kitchen backsplash excluded, whole-home LVP 1,500 SF while retaining 80 SF bathroom tile, ADU sewer 35 LF with separate water 20 LF, and cabinet upper 10 LF/base 12 LF all finalized without conflicts. New-home garage and handyman handle revisions failed and have focused repairs. These are extraction substeps, not final estimate passes.

An automatic approval review paused the synthetic RE10 combined test because the payload was not visible and could have been confused with the blocked private documents. Local inspection verified the exact generated PDF: SHA-256 `4300b64e3632fb79d51cc2855124e07f4ec7bcfd2ae96932fcfb95b0579086a3`, marked synthetic/not a real transaction, with two GFCIs, one PVC trap and one drywall patch; no real customer or transaction data. A test-script guard now accepts only that hash and refuses any other existing attachment. The verified synthetic upload then started successfully. This does not authorize or qualify the previously blocked genuine RE10 or permit documents.

Follow-up local gate: 1,603 tests, 1,588 passes, 15 explicit skips, zero failures, and TypeScript passed. This follow-up has not received a production build or deployment gate. No other website has changed.

Release .9 production identity matched in three consecutive reads at 10:35:29–41 UTC. Live browser reload of an old submitted estimate exposed a new trim question alongside its completed result and no answer box. The follow-up hides intake questions while a submitted result is displayed; reopening a revision restores the question flow. The live window revision was opened and submitted for analysis, changing two windows to one and specifying 6 LF of retained trim repair. Both bathroom pricing retests and combined cabinet/handyman pricing remain pending at this checkpoint.

Live .9 window revision failed two question checks: it presented the superseded two-window answer as a conflict, then requested the 6 LF trim quantity already supplied. The tester explicitly answered one window and 6 LF to continue end-to-end validation. The follow-up reader now explicitly prioritizes an unambiguous current revision over historical answers and distinguishes retained-trim repair quantities from exclusion of new trim. This instruction change is not a proven production repair until the same flow is retested.
