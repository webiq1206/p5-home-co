# Live acceptance and repair release 2026-09-24.2

Status: additional defects repaired in source; live acceptance is NOT complete. The earlier repair plan remains in `p5-estimator-repair-plan-2026-09-24.md`. This report records the production checks after the owner pulled release 2026-09-24.1 into Replit and republished all five sites.

## Deployment verified

All five public release endpoints reported `2026-09-24.1`, with the expected tracked Git tree. Replit's publication-marker commits differed from GitHub main. Each endpoint also reported `dirty: true`; the HEAD tree does not fingerprint uncommitted changes, so this is not proof of exact effective-workspace equality. All five reported the same master price-book fingerprint `aafe22e09883` (1,484 rows, 1,473 rateable and 11 percentage rows), 185 owner planning rates, and the configured Claude Sonnet 5 reader. No rates, margins, policy settings or production schema were changed during this verification.

## Actual live cases

| Site | Test | Observed outcome |
| --- | --- | --- |
| P5 Home Co | Supply/install 200 SF LVP in one bedroom; explicitly exclude cabinets and other trades | Extracted flooring quantity correctly but overrode service with Cabinet installation. Stopped at review; no price accepted. |
| Boise Cabinet Co | Install 10 LF owner-supplied base cabinets and 10 LF uppers; contractor supplies normal fastening/leveling consumables | Issued P5-6C94410E, $3,475-$4,025. Installation labor was categorized as Painting. Audit identified unpriced requested consumables but the result still appeared complete. Name-only flow saved successfully; customer email was correctly not requested. |
| Boise Handyman Co | Install 100 LF owner-supplied 3.25-inch primed MDF baseboard; contractor supplies nails and caulk | Issued P5-48371777, $430-$465, explicitly partial. Nails and caulk were rejected because the baseboard was owner supplied. Asked an unnecessary project-type question despite measured trim scope. UI reported customer email Sent; internal receipt was independently found. |
| Boise Construction Co | Complete 600 SF detached one-bedroom ADU, one bath, midrange, slab, mini-split, utilities 20 ft away | Scope review captured 18 facts, 10 included and 8 excluded items. Pricing showed queued/recovery messages and ultimately failed with no estimate. Root cause is not yet established from production diagnostics. |
| Boise Remodeling Co | Two 50 SF bathrooms; two separate 90 SF shower walls plus 15 SF shower floors, waterproofing and reconnections; no other remodel work | Review captured two bathrooms and 210 SF tile, with separate assemblies. Pricing showed queued/recovery messages and ultimately failed with no estimate. Root cause is not yet established from production diagnostics. |

The Cabinet customer PDF was downloaded and checked against its on-screen reference and total. Its six pages reproduced the incorrect Painting category. A text scan found no internal profit, margin, overhead or confidential labels. This limited check is not a complete confidentiality certification. Cabinet and Handyman internal estimate emails were independently found in the connected company Gmail account. That account is not the owner's personal inbox; personal inbox placement remains unverified.

The Construction administrator page requires sign-in. The available Replit connector exposes publication status, not runtime logs. No credentials or access controls were bypassed. The failed ADU and two-shower cases remain open and must not be described as repaired by the progress-display change alone.

## Source repairs in 2026-09-24.2

1. Restrict Cabinet-specific intent overrides to Cabinet-only service menus. An excluded cabinet mention can no longer replace a flooring or broader multi-trade service on P5. Cabinet's own intent adapter distinguishes excluding cabinet purchase from excluding cabinet installation.
2. Categorize the priced catalog item before its parenthesized section metadata. PB-12-39-06 now categorizes as Cabinets; actual cabinet repainting remains Painting. Finish-carpenter labor categorizes as Trim & Finish Carpentry.
3. Honor explicit contractor installation consumables independently of owner-supplied products. Catalog, published-source and planning-average material validation and the final labor-only filter preserve eligible consumables. Combined installed packages and owner-supplied products do not gain this exception. No price is invented by the new responsibility helper.
4. Prevent a concrete audit finding that no positive material/component line covers requested work from being downgraded merely because parent-task labor is priced. Duplicate removal cannot dismiss an omission in the same finding.
5. Read progress from the persisted job input used by the worker. An isolated PostgreSQL jsonb roundtrip reproduced the key-order mismatch between request objects and stored worker objects. Existing work keys, completed replies and accounting are preserved; only progress lookup changes.
6. Recognize explicitly measured baseboard installation despite dimensions and common material adjectives, avoiding the redundant service question.
7. Remove the unsupported promise that a person will automatically finish and email a failed estimate. The failed-pricing branch creates no delivery record. Waiting copy asks the visitor to choose email instead of promising email before an address has been supplied.
8. Advance the estimator version to invalidate incompatible cached release results. Synchronize 277 shared files and preserve brand-owned adapters.

## Validation evidence before publication

- Remodeling shared suite: 683 passed, 6 skipped, 0 failed (689 total).
- P5 complete suite during its production build: 1,287 passed, 15 skipped, 0 failed (1,302 total).
- Final focused tests after the last test-typing cleanup: 97 passed, 0 failed. A separate 24-check run covered progress, responsibility and live regressions.
- Remodeling and P5 production builds passed; Remodeling TypeScript passed.
- Actual owner-book PB-12-39-06 was read locally and resolved to Cabinets.
- Repository-wide P5 lint remains non-clean. The run reported 670 errors and 94 warnings before cleanup of newly added test typings; this is not a clean lint result. Existing broad lint debt is not treated as estimator verification.
- GitHub main-triggered workflows provide full child-brand tests, TypeScript/build, persistence/recovery and browser verification on the published commits. Consult the exact commit's Actions runs for final CI status.

All model replies in regression fixtures are synthetic; their prices are test data. Local tests do not prove deployed model performance. Build-generated marketing PDFs were restored and excluded from this repair.

## Remaining acceptance work

1. Pull `2026-09-24.2` into each Replit project and republish. Verify the new release endpoint before repeating affected cases.
2. Confirm flooring service, Cabinet category, contractor consumables, and actual progress stages in production. Preserve complete scope and reconciled totals; a partial range does not pass a full-scope case.
3. Obtain authenticated production diagnostics for the failed Construction ADU and Remodeling two-shower jobs. Preserve saved work; do not blindly repeat paid inference or claim the status fix repairs the calculation failures.
4. Complete customer email/return-link, closed-browser, revision, real document/OCR and large-plan cases in the original acceptance matrix. The available Camp Orchard bid-review PDF is an internal review, not the original plan/addendum set; it cannot substitute for source-drawing accuracy tests.
5. Automatic approval review rejected the Construction notification-email test to the owner's personal Gmail address twice, stating that the retained user messages did not authorize that specific external transmission. Earlier authorization was retrieved but the second review still rejected the action. No alternate route was used. Fresh, explicit approval is needed for that specific notification test. Existing automatic delivery reported by the Handyman submission is recorded separately above.

No claim of 100% correctness, completed live qualification, or successful remediation of the two failed pricing cases is made.
