# P5 intelligent estimator review, September 10, 2026

## Release status

This is a draft migration. The focused upload repair is separate. Do not interpret
these code changes or simulated tests as a completed production rollout.

## Confirmed upload failure

Live synthetic draft writes returned HTTP 200 with a null draft on Construction,
Remodeling and Handyman. A subsequent fresh HTTP GET also returned no draft.
P5 Home and Cabinet returned valid revision-one drafts. The failing brands use
Neon over HTTP under Next.js 14; P5 and Cabinet use socket database drivers.
The repair disables fetch caching for the HTTP database driver, returns the
acknowledged INSERT/UPDATE row, and validates browser receipts before using
revision or clearing pending files. Isolated SQL reproduces the stale-read failure;
an intercepted actual Neon driver verifies `cache: no-store` reaches fetch.
Production deployment is needed to verify this diagnosis against the live system.

## Draft behavior

One shared component accepts descriptions, native speech, files and later answers.
It merges supported document facts with provenance and confidence, calculates
explicit dimension products, skips known fields, and presents one material missing
or conflicting field at a time. Cost-book quantity conditions contribute questions.
Answers, contacts, files, confirmations and explicit unknowns persist across steps.
Unread files remain saved, create visible warnings and block unsupported prices;
the visitor can continue providing information after a failed provider attempt.

Primary calculator wrappers, inline homepage estimators, estimate pages, scope
aliases, RE-10, Remodeling plans intake and P5 quote service pages use the draft
component. Cabinet's design studio and legacy assistant/quote pricing APIs still
need deliberate integration and parity verification before claiming every estimator
has migrated. Their data must not be discarded or priced with an incompatible model.

## Verification performed

All five repositories passed the 37 shared financial tests, 9 adaptive tests,
real isolated SQL workflow tests and the upload endpoint suite. Upload checks use
real two-page PDF, XLSX, CSV and DOCX parsers plus PNG vision transport, file hashes,
ownership, failed-provider recovery and retries. AI responses and delivery transports
are simulated. Focused receipt tests also pass on all five repair branches.

A browser walkthrough on the shared P5 component exercised typed scope plus a PDF,
no repeated questions for a detailed bathroom scope, back navigation, contact/file
retention, result restoration and responsive mobile/tablet/desktop presentation.
The isolated browser transport does not establish actual AI extraction accuracy.

CI is configured to run the normal builds, existing financial gates, seven-width
workflow tests, missing/conflicting input cases and brand entry-route checks.
Only completed passing CI runs on the published commit are evidence of a pass.
A physical microphone, OS keyboard, real model interpretation, production email,
CRM attachments and deployment have not been verified by these tests.

## Remaining release requirements

- Configure and calibrate approved direct-cost books for every offered service,
  including real scope coverage, quantities, allowances and current evidence.
  The checked-in configuration has no cost books; it correctly withholds prices.
  Old market-derived selling bands cannot establish the approved operating profit.
- Validate typical and complex projects against actual P5 takeoffs and costs.
- Finish Cabinet design and legacy assistant/API integration with parity checks.
- Exercise actual documents, photographs, drawings, mixed inputs and failure/retry
  behavior against the configured production model and storage.
- Verify actual customer/admin PDF delivery and CRM linkage without duplicates.
- Deploy the focused repair, then verify draft reads and uploads on all five sites.
- Run physical mobile microphone and permission tests and complete live desktop,
  tablet and mobile acceptance before activating the full migration.

Legacy DOC/XLS/ODS/HEIC/HEIF files are retained for manual review. Automatic
conversion is not implemented for those formats; PDF/DOCX/XLSX/JPEG/PNG export
provides the supported automatic route. Exact image dimensions are never invented.
