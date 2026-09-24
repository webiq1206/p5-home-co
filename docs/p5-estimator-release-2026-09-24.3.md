# Estimator verification and repair release 2026-09-24.3

Status: source repair release. Production qualification remains incomplete. This continues the acceptance matrix in `p5-estimator-repair-plan-2026-09-24.md` and the findings in `p5-estimator-live-verification-2026-09-24.md`.

## Production state verified

All five public sites were verified on release 2026-09-24.2, including the newly republished Handyman deployment. Publication commit IDs can differ from GitHub main; the endpoint reports the HEAD tree and dirty-workspace status, not a fingerprint of every effective workspace file. No new source fixes in this report are claimed live until a 2026-09-24.3 deployment is verified.

## Live cases and retained diagnostics

| Site | Evidence on release 24.2 | Qualification result |
| --- | --- | --- |
| P5 Home Co | A 200 SF LVP bedroom scope issued P5-F8F3F903 at $2,725-$2,950 under Home repairs, with Flooring and Demolition categories. Name-only submission saved; customer email not requested; internal delivery reported sent. | Flooring routing improved. This single case does not complete the document, delivery and large-project matrix. |
| Handyman | Revised P5-48371777 issued $495-$575, preserved the earlier $430-$465 revision, and made the earlier PDF available. Current customer email correctly showed not requested. | Failed full-scope acceptance: a priced consumables allowance was removed by the final labor-only filter while notes still said it was included. A private material-cost amount and its bounds appeared in customer prose. Both reproduced and repaired below. |
| Cabinet | Revised the existing 10 LF base / 10 LF upper installation request. It unnecessarily asked the customer to choose between equivalent consumables responsibilities. Pricing finished needs-review after 127.532 seconds; no range issued. | Production saved diagnostics identified shared 20 LF consumables compared against individual 10 LF runs, erroneous owner-supply flags, and removal of the consumables line by the final filter. No provider failure was recorded for this run. |
| Remodeling | Read-only saved production diagnostics for the earlier two-bathroom failure. | Confirmed 90 SF wall backer and membrane rejected because an unqualified "install one" pan count was applied as one SF. Verification had output-limit failures; repair time was already exhausted by first-pass work. New code is covered by deterministic regression, not yet a successful live rerun. |
| Construction | Read-only saved production diagnostics for the earlier 600 SF ADU failure. | Owner-provided vacant land was mistaken for owner-supplied construction materials. Audit also found a complete ADU assembly overlapping component costs and omitted discrete debris pricing. Repair had been skipped. New source fixes address the false restriction and recovery; the ADU still requires a clean live rerun. |

Replit was used only to inspect existing production records. All source edits were made directly by Codex. No Replit code-generation or update prompt was used. Model inference was not rerun to obtain diagnostics.

## Source changes

1. **Quantity units:** a count without a unit cannot assert SF, LF or HR. Explicit conflicting measurements still block. Both 90 SF shower-wall assemblies now survive the exact reproduced pan-count wording.
2. **Land responsibility:** a standalone owner-provided lot/land/parcel/property does not imply the owner supplies excavation or construction materials. Combined land-and-material supply and explicit owner material responsibilities remain protected.
3. **Shared material quantities:** referenced material quantities may reconcile against separate explicit component quantities, excluding a repeated aggregate claim. Installation-labor quantity mismatches do not receive this exception.
4. **Installation consumables:** descriptions such as nails/caulk "for owner-supplied baseboard" retain their contractor responsibility. A generic cabinet-and-vanity hardware label can be used when explicitly mapped to a requested mounting-consumables task; decorative-product labels and unqualified generic hardware do not gain an exception. The final total must still contain positive material coverage for requested consumables, even if the model audit claims completion.
5. **Dedicated repair window:** the existing 210-second corrective-work allowance starts when repair is needed and is persisted once. Initial inventory, mapping and verification cannot consume it; resume cannot renew it. Provider backoff during repair is accounted for. Existing pass and job lifetime limits remain.
6. **Output-limit recovery:** truncated verification divides task coverage into smaller audits with complete original scope and all priced-line context retained. Completed subsets and the oversized-call marker persist across resumes. A single-task audit that still cannot complete remains held instead of repeating indefinitely. Authentication, schema and billing failures do not receive this fallback.
7. **Customer privacy:** direct-material/direct-labor amounts and later bounds in the same note are removed at the shared customer presentation boundary, including saved estimates, PDF and email. Numeric customer selling totals and scope quantities remain unchanged.
8. **Instructions:** clarify that equivalent revision wording is not a conflict; prohibit using a whole-building assembly to patch a component gap alongside component pricing; distinguish decorative cabinet hardware from mounting consumables.
9. **Cache/release identity:** advance the shared estimator version to 2026-09-24.3. Synchronize the shared engine and hash manifests while preserving all brand-owned adapters, rate books and financial policy.

## Validation

Regression fixtures use synthetic rates and simulated model replies. They do not establish production model reliability or approve new rate amounts. The SQL recovery test uses isolated PGlite and has no live provider or delivery traffic.

Final local shared suite: 695 passed, 6 skipped, 0 failed (701 total). Each of the four child repositories passed all 104 focused pricing, recovery and synchronization checks. Canonical TypeScript and isolated SQL recovery/persistence checks passed. Child TypeScript passed for Construction, Handyman and Cabinet; the local P5 check used shared dependencies and lacked its nodemailer declarations, so its clean dependency installation and production build are delegated to the exact-commit GitHub workflow. GitHub build/browser outcomes must be checked on each new commit; they are not claimed complete at this commit. Required checks include the complete shared suite, TypeScript, actual PDF/email projection, persisted audit subset recovery, unchanged-scope reuse, three-attempt timeout exhaustion, unsplittable-output holds, revision race/archive parity and submission recovery. Existing explicit quantity, duplicate-pricing, ownership and omitted-material assertions remain in force.

## Deployment and remaining acceptance gates

1. Pull the new main commit into each Replit workspace, then publish. The exposed Replit publication action deploys the current workspace; it does not offer a direct Git pull. The Replit editor was blocked by a browser verification page in the prior attempt. Do not republish stale workspace source or claim these fixes are deployed merely because GitHub was updated.
2. Verify release 2026-09-24.3 on all five public endpoints, then rerun the five exact live cases. Confirm positive consumable lines survive final output, category/item totals reconcile, and saved customer views no longer disclose the private material-cost note.
3. Complete live two-bathroom and ADU pricing with supported quantities and no overlapping complete-building package. A held or partially scoped estimate is not a pass for the full-scope case.
4. Finish the original matrix's real document/OCR, large original plan set, upload/recovery, closed-browser return and customer delivery tests. The supplied internal bid-review PDF is not a substitute for the original plans.
5. The earlier specific personal-Gmail notification test was rejected by automatic approval review. Do not retry that transmission through another route. Fresh explicit authorization is required for that test; other authorized name-only checks can proceed.

This report does not certify 100% correctness or completed production qualification.
