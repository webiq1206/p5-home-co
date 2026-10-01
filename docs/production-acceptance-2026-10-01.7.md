# P5 live verification: 2026-10-01.7

## Deployment

Replit publication completed successfully. The public release endpoint reported version 2026-10-01.7, clean build SHA `6394aec7c8f30effdb8e65882edbddc50cbeb005`, and tree `687ff55b4676aa6d9702720eba876be35bccc552`. This tree matches the correction published as `542a62a`.

The extraction HTTP 400 regression from .6 did not recur in the fresh text-only test. This is not acceptance of the estimator as a whole.

## Fresh tests

- Synthetic three-lever handyman scope: extraction completed with HTTP 200, no warning and no clarification questions. The extraction nevertheless expanded generic contractor consumables into named shims, caulk and other supplies absent from the submitted description. Pricing performed new research steps, encountered a research deadline, and ultimately returned HTTP 422 without an estimate. No PDF or delivery pass.
- Source 01, six-page reference estimate: upload accepted and all six pages eventually reported read, without a terminal warning. A page response hit `max_tokens` and recovery delayed completion. Scope quality failed: a flooring component and its combined total became a conflict; exterior and interior trim quantities became a conflict; questions retained page-local claims that other sections had not yet been seen. Complete page coverage does not establish accurate interpretation.
- Source 07, two-page driveway estimate: upload accepted and both pages reported read. Source quantities including the 1,200 SF driveway were captured. Scope quality failed: the flow asked whether the new home includes a garage, and concrete-finish wording was paired with generic remodel finish choices. No pricing submission was made for this unqualified scope.
- Separate diagnostic control with the owner explicitly supplying all lever-installation parts: extraction and pricing completed, producing a $300 to $325 planning range for three units. The PDF endpoint returned HTTP 200 with a four-page PDF. This is not a pass for the original contractor-consumables scope. PDF text inspection exposed a responsibility error: the privacy filter removed a contractor's labor-only clause, leaving installation incorrectly attached to the owner-supplied list. The PDF layout rendered, but content acceptance failed. Customer delivery was not tested.

These used new QA drafts, original document bytes and blank customer email/phone fields. Original files, credentials, screenshots and contact details are not included in this report. The PDF comparison checked the source text and rendered layout; it did not treat HTTP 200 or a complete page ledger as an accuracy pass.

## Remaining work

Fix source-grounded consumable interpretation, distinguish component quantities from aggregate quantities, reconcile page-local questions against the complete document, and make classification and answer choices follow the actual work. Investigate research completion and document output budgets. The full 27-source matrix, multi-file, mobile, PDF and delivery acceptance remain incomplete. Child-site rollout remains paused.

## .8 customer-copy correction

The customer projection no longer treats labor-only, labor-with-consumables or material-only scope wording as private pricing data. Private rates, margin and cost figures remain filtered. Regression tests preserve the contractor's removal and installation responsibility, the owner-supplied-parts clause, and repeated projection behavior. This correction does not alter pricing math or claim to fix the other live failures above. It requires deployment before live verification.

Local verification: 1,715 main tests passed, 16 skipped; 19 provider tests passed; six database-safety tests passed. A corrupted local Turbopack cache prevented the first build after tests. The generated cache was moved aside and a clean production build, including TypeScript, completed successfully. No production configuration was changed for that recovery.
