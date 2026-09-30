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
