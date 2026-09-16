# Estimator completion record, September 16, 2026

Release marker: `2026-09-16.2-final-acceptance`.

## Completed changes

- Use the same compact review accordions, contact readiness control and service handoff behavior across all five sites, preserving branding and existing conversion reporting.
- Remove remodel refresh choices from new builds, additions, ADUs and new cabinet packages, including restored answers and manual edits.
- Keep labor-only scopes and specified cabinet packages free of generic finish-tier questions, controls and assumptions.
- Do not ask for room area merely because measured trim or cabinet painting is included. Wall painting can still require area.
- Retain verified cabinet-width conversions, including a stated 48-inch vanity and two pantry cabinets each 24 inches wide. Reject wrong arithmetic, different assemblies, unlabeled heights and counts without widths.
- Keep explicitly completed cabinet removal excluded while retaining other requested demolition. Future and conditional removal statements remain unchanged.
- Pass original source context into server follow-up selection, matching browser filtering.
- Describe text-only progress accurately and show one expandable estimate PDF card.

## Validation

All five recovered source trees passed all 329 estimator regression tests. All five production builds completed with their existing prebuild gates. P5's broader suite passed 937 tests with one existing database-dependent test skipped, and its production TypeScript check passed.

Construction and Remodeling initially encountered a temporary export-directory cleanup error after compilation. Their final builds passed from isolated worktrees using the same committed source. No application workaround was added. The uploaded GitHub source trees were compared with the locally verified Git trees and matched exactly before this documentation-only commit.

P5's earlier full lint run reported 296 pre-existing errors. The modified files introduced no additional lint errors, and the new files were clean. The specialist repositories retain their existing build-time type/lint settings. This release does not claim to resolve that unrelated lint backlog.

## Live checks performed before publication

These checks used the public `2026-09-16.1-question-context` version during the preceding review. They identify the defects repaired here and are not a certification of the new release on the public domains.

| Site | Observation |
| --- | --- |
| Construction | A 2,400 sq ft new home and separate 600 sq ft garage reached review after a permit-responsibility answer. |
| Remodeling | The labor-only bathroom scenario exposed a repeated 48-inch vanity measurement and irrelevant finish controls. Project classification stayed correct after replies. |
| Handyman | A 200 LF painted-baseboard scenario exposed the irrelevant room-area question. |
| Cabinet | Specified plywood/painted Shaker cabinets exposed the generic finish question and incorrectly included completed removal. |
| P5 | Two RE-10 text documents reached review with seven saved details and no additional question. Only inspection item 7 was included. Reload and Continue retained both files, exclusions and the review step. |

## Git and publication

The September 10 historical handoff PRs were reviewed separately. Cabinet's conflicting handoff was reconciled against current main, preserving current application changes, historical verification records and both Git parents. No force push or branch deletion was used.

The owner authorized pushing and merging the prepared changes into all five existing webiq1206 repositories. Publishing remains the owner's Replit pull and republish step. No Replit agent prompt or deployment action was used.

After publication, confirm the release marker on each public estimator and repeat the affected scenarios. Live checks stopped at review without submitting customer contact details or sending email/CRM notifications. Automated tests cover provider, pricing, delivery, document coverage and recovery logic; they do not certify a new live delivery or physical-device behavior.
