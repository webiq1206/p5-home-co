# P5 estimator follow-up: 2026-10-01.9

## Changes prepared for deployment

- Isolate PDF page inputs. Neighboring page excerpts no longer enter the page reader as duplicate scope evidence.
- Preserve declared page counts when combining partial receipts. Available pages alone cannot establish complete document coverage.
- Reconcile a stated flooring component against a matching, arithmetically supported total from the same document. Keep genuine source disagreements. Combine separately identified interior and exterior trim quantities, retaining their takeoff detail.
- Remove obsolete automatically generated conflicts after reconciliation and retire completed-reader workflow questions. Keep unresolved project questions.
- Do not expand generic consumables into unsupported parenthetical shopping lists.
- Require building evidence before accepting a new-construction classification. Concrete surface-finish questions use material selections rather than budget tiers.
- Evaluate an already validated single-source material allowance before allowing a failed comparison search to stop pricing. Product, quantity, locality, source and disclosure checks remain mandatory.
- Rebuild affected historical customer wording from the same estimate's retained original scope for results, PDFs, administrative previews, archived versions and pending delivery. Preserve issued prices, identity and dates. Do not reprice, rewrite historical database records or resend already sent messages. Records without retained source scope remain unchanged.

## Verification

The main automated suite passed 1,725 tests with 16 skipped and no failures. The provider suite passed 19 tests. Six database-safety checks passed. The production build, including TypeScript, succeeded. Targeted tests cover resumed quantity reconciliation, incomplete page coverage, research comparison timeouts and historical-copy privacy.

All 27 supplied files passed local preparation checks: 26 PDFs retained all 374 original pages across 589 reading sections, and the spreadsheet converted to readable input without a manual-review flag. The fixture checker now uses the production PDF-opening path and recognizes supplemental form-control views. These were transport/preparation checks with zero AI calls; they do not certify interpreted scope or pricing accuracy.

Production remains on version 2026-10-01.8 until these changes are pulled into the Replit workspace and published. A fresh synthetic delivery control on .8 produced a customer estimate and PDF. The production outbox reported both administrator and customer email as sent. This confirms send-pipeline acknowledgment, not independent inbox arrival. No client recipient or original client document was used for that delivery test.

## Acceptance boundary

This is a tested correction release, not full production acceptance. Fresh .9 tests must verify the original contractor-consumables case, the addition and driveway documents, historical-copy recovery, and the complete source/service matrix. Mobile keyboard and viewport behavior still needs live verification. The current cloud browser exposes no mobile viewport emulation capability. A Replit read-only diagnostic request timed out and supplied no additional production research evidence.

The Replit connector can publish the current workspace but has no Git pull operation. No Replit code-generation request was made. Child-site rollout remains paused.

Private documents, raw extracted content, credentials and screenshots are excluded from this report and from the commit.
