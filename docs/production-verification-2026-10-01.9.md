# P5 production verification: 2026-10-01.9

Release .9 was published successfully through the Replit connector. Production reports a clean working tree and source tree `4bc7d427037f6e895571c7a20adc7a0dd66ce585`, matching approved GitHub commit `050c93c2aca2275828c8e0a92c3e3d06c08b6b89`. No Replit code-generation request was made.

## Verified

- An older synthetic owner-parts estimate now restores removal and installation wording in its saved result and newly generated PDF. Its issued range and line items are unchanged. Already sent messages were not resent.
- The synthetic contractor-consumables handyman case completes scope analysis, pricing and PDF generation. Scope extraction keeps generic consumables without inventing named materials. This is functional completion, not pricing acceptance; see the defects below.
- The driveway regression reads both source pages and retains the stated area. It no longer classifies the work as a new home or asks for a garage. The remaining question asks for project type.
- The six-page addition reference reads all pages, returns 99 takeoffs rather than 209 in the previous run, and resolves the flooring component/total conflict. This does not establish accuracy of every takeoff.
- The desktop browser reloads the published estimator, resumes the saved project, and moves keyboard focus from the composer to the attachment control. Mobile keyboard behavior remains unverified.

## Remaining defects and follow-up

The handyman estimate incorrectly used a whole-door removal rate for lever removal and assumed consumables were included in an explicitly labor-only replacement rate. Release .10 adds deterministic checks for those observed failures. A wrong whole-door mapping is removed for focused remapping, and both catalog additions and existing-price references reject that mismatch. Explicit labor-only/materials-separate language now preserves a contractor-consumables gap. The correction does not itself certify the next generated estimate.

The addition reference generates a false fixture-count conflict by comparing different item types. Release .10 retains distinctly named EA schedule rows as separate task quantities without inventing a combined fixture total. Replaying the saved extraction locally removes that false conflict and preserves all takeoffs; same-item discrepancies, totals and different-source conflicts remain protected by regression tests. This correction still requires live verification. The driveway still requires service selection. Full service/source pricing acceptance and live mobile verification remain open. Customer/admin email send-pipeline acknowledgment was verified on .8; independent inbox arrival was not verified.

The .10 main automated suite passed 1,729 tests with 16 skipped and no failures. The provider suite passed 19 tests. The production build, including TypeScript, succeeded. Focused pricing tests passed 207 checks, and six quantity-reconciliation tests passed.

The full acceptance decision remains open. Do not use HTTP success or PDF generation as evidence of correct prices. Child-site rollout remains paused.

Original documents, raw extraction, screenshots, recipient details and draft access keys are excluded from this report.
