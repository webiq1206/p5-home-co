# Production acceptance: 2026-10-01.5

Run date: October 1, 2026. P5 only. Child-site qualification remains paused.

Follow-up: explicit document-processing approval was received and GitHub authentication restored. The original report was published unchanged as `a75260c`. See [approved document follow-up](production-document-follow-up-2026-10-01.md) for the resumed run. Historical approval blockers below describe the earlier run, not the current authorization state.

## Outcome

**Not accepted. All eight synthetic text scenarios completed scope analysis, but all eight public pricing submissions returned HTTP 422 and no customer estimate.** No PDF or delivery acceptance can be claimed for those scenarios.

The saved Goeckner browser retry passed the previous coverage barrier and reached clarification. It did not reach pricing. A newly uploaded RE-10 reached questions but was not priced. Further private-document testing was blocked by automatic approval review pending explicit authorization to process the supplied documents through P5 production.

## Environment and method

- Deployed release 2026-10-01.5; Haiku 4.5 selected.
- Production tree and recovered Git checkout tree: `72299cee7066a2dd0ee10d7a6376885c0d3caaf4`.
- Synthetic cases used the same public draft, scope, review and submit routes as the customer form, with independent generated draft credentials. No authentication or validation bypasses.
- Original synthetic inputs were retained unchanged through analysis. ADU and new-build questions received explicit customer answers. Other nonblocking questions were retained as uncertainties through the public review route.
- Multiple cases overlapped, so timings are observed under concurrent QA load, not single-customer performance measurements.
- Browser operation became unavailable again after successful Goeckner reading. API results do not qualify mobile, scrolling, keyboard, upload UI, download UI or cross-tab behavior.
- Blank customer email and phone were used with clearly marked synthetic QA names. No customer email-delivery pass is claimed.
- Failed cases were not automatically resubmitted after their terminal result.

## Results

| Case | Scope/question result | Pricing |
| --- | --- | --- |
| cabinet | 12 LF base and 8 LF uppers captured; no questions. | HTTP 422; no estimate |
| handyman | Three owner-supplied levers captured; no questions. | HTTP 422; no estimate |
| kitchen | 180 SF and requested scope summarized; no questions. Upper-cabinet length appears in narrative, not the corresponding answer field. | HTTP 422; no estimate |
| bathroom | 80 SF floor and 90 SF surround captured; no questions. | HTTP 422; no estimate |
| adu | 676 SF conversion captured; asked new-home garage questions despite conversion scope. Answered no additional garage and midrange finishes. | HTTP 422; no estimate |
| new-build | 1800 SF conditioned area and 400 SF garage kept separate; asked customer to supply material allowances. Answered estimator to provide midrange allowances. | HTTP 422; no estimate |
| whole-home | 1600 SF retained and 160 SF wall tile calculated; still asked for tile area and demolition area. Public review accepted these as unresolved/nonblocking. | HTTP 422; no estimate |
| addition-text | 500 SF addition retained separately from existing home; generated two vanity-width questions. Public review accepted uncertainties. | HTTP 422; no estimate |

## Confirmed deeper findings

### Handyman consumables blocked the estimate

Read-only inspection of linked production records showed labor mapped to PB-08-71-01 at quantity three. The unresolved item was contractor-supplied consumables. Initial mapping used a door-hinge-set proxy; repair replaced it with CONSUMABLES-DOOR-LEVER, three packages. Research demanded manufacturer/model/SKU, fastener quantities and shim specifications. All normalized rate responses were empty. Three saved search reports had sources; nine successful research events represented transport/format stages, not accepted prices. Bounded evidence recovery exhausted and blocked the estimate. This is not proof of a search-tool outage.

### New-build corrective request exceeded context

Linked provider record: HTTP 400 invalid_request_error, "prompt is too long: 201756 tokens > 200000 maximum". The failed request was a format-repair mapping batch with IDs DESIGN-PERMIT, DWL-GAR-400SF, DWL-NEW-1800SF and SITE-PREP. It was classified non-retryable and the job ended needs-review. The public error was generic; the exact provider message was recovered from retained records.

### Goeckner source interpretation remains unqualified

The browser reached 21 captured details and 13 questions after coverage completed. Its first question requested fixture confirmation while explaining that the apparent bathroom-count/fixture-count values were not conflicting. The explanation listed vanity, shower and tub as three fixtures. Independent visual review of source PDF page 4, sheet A201, shows two sinks, one toilet, one shower and one tub. The area schedule reads existing 2262 SF, main-floor addition 26 SF and upper-floor addition 471 SF, totaling 497 SF addition. A browser input timeout prevented verification that the attempted correction was submitted; do not assume it persisted.

### RE-10 fresh question result

The fresh read retained repair scope but generated two sewer-method questions, one as an instruction and one bound to Utilities. It also asked the homeowner to select radon system type. No pricing or successful quantity correction was accepted in this run. Subsequent private-document execution was blocked by automatic approval review; do not retry without required approval.

### Bathroom substrate coverage

Linked records identify SUBSTRATE-PREP-WATERPROOF, 170 SF combining 80 SF floor and 90 SF walls, as unresolved. Research sources priced membrane installation but excluded leveling/grinding and structural substrate preparation. Reports retained 33, 39 and 40 URL references. The exact final rate-candidate rejection was not retained beyond the fatal message. This was not a documented search outage.

### ADU assembly overlap and stale blockers

The complete ADU assembly PB-90-50-09 overlapped separate plumbing, utility, design, permitting and engineering items. Water and sewer appeared twice as 30 LF runs. Audit findings disagreed about which interior/MEP components the assembly included. Countertops and laundry coverage remained unresolved. A 60 LF finding remained blocking even after verification described its resolution as 30 LF water plus 30 LF sewer. Final status was scope-pricing-incomplete, not a transport failure.

### Whole-home scope expansion and empty-source response

Blocking research included 1600 SF self-leveling, 4000 SF wall skim coating, and interior finish/drywall demolition. Those full-area repair tasks were not explicitly requested in the synthetic scope and require scope reconciliation. Earlier reports had 48 and 47 source references but normalized to empty rates while asserting work was already included. The final failed research response had HTTP 200, stop reason end_turn, only a text block, 3920 text characters, zero search/fetch results and zero collected sources. Tool-error list was empty. The retained additional cause was pricing-charge-unknown. This establishes no usable search result on that response, not a provider search outage.

### Cabinet evidence completeness

The retained consumables rates covered finish nails while explicitly excluding shims, caulk and adhesives. A shim placeholder had zero quantity and no sources. The model assumed 20 handles and three cleanup hours while retaining verification issues for both. Five search reports retained 36 to 44 URL references each, but complete supported pricing was not accepted. No failed provider traces were retained. The exact final candidate-rejection reason remains unavailable beyond the fatal message.

### Kitchen repeated research deadlines

The same research checkpoint reached three deadlines at 18:37:53.010, 18:39:25.545 and 18:40:58.009 UTC. Retained attempts were 1 through 3 and timeouts equaled 3. No provider body or request ID was retained for these timeouts. Earlier research had 47 URL references. Unresolved work included countertop substrate preparation, sink material pricing and upper cabinet quantity confirmation. A saved countertop-demolition conversion described 13.3 LF as the midpoint of 19.2 to 20 LF, which is mathematically inconsistent. The evidence establishes deadline exhaustion and unresolved pricing, not an identified provider search outage.

### Addition malformed corrective mapping

Initial mapping repeated addition-500sf-2nd-story IDs. The corrective output retained duplicate rows and empty evidence for roof-demolition-selective, structural-engineering-allowance and hvac-extension. Validation stopped at tasks[4].evidence, tasks[5].evidence and tasks[6].evidence with ZodError/too_small, minimum one character. There were no failed provider traces or research reports. The stop was a schema/duplicate-output failure rather than transport failure.

## Regression suite

`npm test` completed successfully against the recovered source tree: 1,712 main-suite tests passed, 16 skipped, and all 18 selected-Haiku checks passed. Database-safety verification also passed. This is deliberately reported separately from the eight failed production pricing cases.

## Required next gates

1. Compact and budget model inputs before both initial and corrective requests. Preserve scope/evidence while excluding irrelevant catalog context and oversized previous output; reject oversize input locally with a targeted recovery path.
2. Resolve consumables and assembly boundaries using supported rate components or a reviewed consumables allowance policy, rather than blocking simple jobs on unnecessary product-level research. Do not invent a price to force completion.
3. Retrieve each remaining failure's linked record before choosing its repair. Preserve no-source, empty-rate, audit rejection, transport rejection and deadline as distinct outcomes.
4. Fix redundant and context-inappropriate questions using the actual cases above.
5. Repeat these same saved cases after corrections, then verify saved totals, quantities, exclusions, assumptions, PDFs and delivery.
6. Complete the private-file and browser acceptance set after the respective approval/access blockers are resolved.

## Synthetic scenarios and reproducible identifiers

### cabinet

Draft ID: `052bf679-f3b3-4384-99e8-f4a8b1d6395a`. Access key intentionally excluded.

Install only 12 linear feet of owner-supplied base cabinets and 8 linear feet of owner-supplied wall cabinets in a vacant Nampa kitchen. Cabinets are assembled stock cabinets in good condition. Include leveling, shimming, fastening, fillers, scribe, toe kick and standard handles. No demolition, countertops, sink, plumbing, electrical, flooring or painting. Standard access. Contractor supplies installation consumables. Preliminary estimate; use reasonable disclosed allowances for minor unknowns.

### handyman

Draft ID: `dcf0813c-06e3-4080-9fc7-ef5642b475ce`. Access key intentionally excluded.

Install three owner-supplied interior passage door levers in existing compatible predrilled doors in Nampa. Remove and dispose of old levers. Contractor provides labor and consumables. No doors, painting, frame repairs or new drilling. Standard weekday access. This is fixed-scope work, not an hourly labor request.

### kitchen

Draft ID: `3ac940bd-f161-4b3f-8066-29d268be7e85`. Access key intentionally excluded.

Nampa kitchen remodel, existing 12 by 15 foot kitchen, 180 SF. Keep walls and layout. Remove 20 LF base cabinets, 12 LF uppers and 40 SF countertop. Supply and install stock painted shaker cabinets matching those lengths, 40 SF midrange quartz, 30 SF ceramic backsplash, 180 SF LVP floor. Reconnect sink and dishwasher in same locations, replace sink and faucet. Owner supplies appliances. Paint 300 SF walls and 180 SF ceiling. No structural work, panel upgrade or whole-house plumbing. Include demo/disposal, labor, materials and necessary permit allowances. Use disclosed midrange allowances where selections are undecided.

### bathroom

Draft ID: `d341c3a6-02d9-4987-9514-f28d33f0d4ad`. Access key intentionally excluded.

Nampa bathroom remodel 8 by 10 feet, 80 SF. Same layout. One toilet, one 36-inch single-sink vanity, one 60 by 32 inch tub/shower. Remove and replace those fixtures, install 80 SF porcelain floor tile and 90 SF shower surround tile with waterproofing, replace one exhaust fan, paint 120 SF walls and 80 SF ceiling. Midrange finishes, contractor labor and materials, demo and disposal. No structural changes. Disclosed allowances for concealed damage, no assumed confirmed damage.

### adu

Draft ID: `ce542f7e-b014-45da-86c2-a69d0b04e6c9`. Access key intentionally excluded.

Convert an existing attached 26 by 26 foot garage (676 SF) in Nampa into one-bedroom one-bathroom ADU. Existing slab, walls and roof remain subject to inspection. Include insulated infill garage door wall, two egress windows, interior partitions, full kitchen with 12 LF base and 8 LF wall cabinets, one bathroom with toilet, single-sink vanity and shower, laundry hookup, mini-split, plumbing and electrical, insulation/drywall, 676 SF LVP and paint. Sewer and water connections are assumed 30 feet away for this preliminary test. Include design/permit allowances. No new detached building or second floor. Use disclosed allowances for engineering and utility capacities.

### new-build

Draft ID: `42ed54a0-09a7-44e6-9526-1a46442a81ee`. Access key intentionally excluded.

New detached single-story 1800 SF conditioned home in Nampa plus separate 400 SF attached garage area (2200 SF combined), three bedrooms and two bathrooms. Simple rectangular footprint, slab foundation, wood framing, gable asphalt roof, midrange stock finishes. Include sitework on level accessible lot, foundations, structure, roof, siding, windows/doors, plumbing, electrical, HVAC, insulation, drywall, kitchen, bathrooms, flooring, painting, labor and materials, design and permits. Utility tie-ins assumed 50 feet from home. Exclude land purchase, financing, landscaping and furniture. Keep garage separate from conditioned living area. Disclose preliminary allowances.

### whole-home

Draft ID: `e3832210-a0bd-4e49-a4a0-f4588de85bda`. Access key intentionally excluded.

Whole-home interior remodel of existing 1600 SF single-story Nampa house, three bedrooms, two bathrooms. Keep exterior shell and layout. Replace 1600 SF LVP, paint 4000 SF walls and 1600 SF ceilings, replace 400 LF baseboard and 10 interior doors. Kitchen: 20 LF base and 12 LF wall cabinets, 40 SF quartz, sink/faucet. Two bathrooms each 50 SF, each one toilet, one single-sink vanity and one tub/shower with 80 SF surround. Include fixture replacement, waterproofing, demo/disposal, labor/materials and permit allowances. No addition, reroof, new windows, full rewiring or whole-house repipe. Midrange finishes; disclose concealed-condition allowances.

### addition-text

Draft ID: `dfa565fa-9862-49f7-bdaa-3617773e0a98`. Access key intentionally excluded.

Build a 500 SF second-story bedroom and bathroom addition over an existing 500 SF footprint in Nampa. Existing home is 2000 SF and is not new construction scope. Include engineering allowance, structural reinforcement allowance, selective roof demolition, new floor/wall/roof structure, stairs, windows, insulation, drywall, siding/roof tie-ins, HVAC/electrical/plumbing extensions, one bathroom with toilet, single-sink vanity and shower, midrange finishes, permits, labor/materials and disposal. Existing foundation adequacy unknown; do not assume 2000 SF of new work. Disclose allowances and required verification.
