# P5 allowance audit follow-up

Release `2026-10-02.2` was published. Its public source tree was `2781495f54093a79b62941f00c43f0f3b6805a95`, matching GitHub commit `b29c83d70d1a4c2756bfde262c11e2ddd889d465`.

The synthetic 9 LF base plus 12 LF wall cabinet installation case completed without scope questions, produced a $2,075 to $2,550 range, and generated a PDF. The two labor quantities are retained separately. One minor-work allowance covers supporting supplies. Customer line items reconcile exactly to the range and do not expose the internal allowance policy amounts or mapper instructions.

A fresh synthetic three-lever handyman run reached the final audit but returned HTTP 422. A read-only diagnostic found both a resolved finding and a blocking finding for the same disposal task. The blocking text retained an earlier invalid-price-reference warning even though a positive shared allowance was present. This inconsistent result remains a live acceptance failure, despite the prior release producing an estimate for the same scope.

Release `2026-10-02.3` handles an explicit mapper reference to the shared allowance before that line exists. Such a reference requests policy coverage only if the described work passes the normal minor-work eligibility check and the project already has positive priced work. The allowance is created, coverage is recorded, and its invalid-placeholder finding is removed before the first audit. Primary work and quantity errors remain protected. Regression tests cover the complete first-audit path and refusal to cover primary products.

Validation for the follow-up: 1,740 main tests passed, 16 were skipped, and all 19 provider tests passed. The production build including TypeScript succeeded. Publication and a fresh handyman regression are still required.

The first cabinet scope request immediately after deployment returned a gateway 503; its saved draft succeeded on retry. Mobile behavior, comprehensive document accuracy, independent email arrival and full service acceptance remain open. No private documents, raw extractions, access keys, contacts or screenshots are included. No Replit code-edit request was made. Child-estimator rollout remains paused.
