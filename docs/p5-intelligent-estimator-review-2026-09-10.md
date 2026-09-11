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
The focused repair passed all five full CI pipelines and was merged into main in every repository. Production deployment is needed to verify the repair against the live system.

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

## Additional live upload findings

A synthetic PDF upload on Cabinet completed against the real production analyzer.
It correctly extracted the specified 20 LF base and 15 LF upper cabinet quantities.
P5 Home accepted the draft but scope analysis returned 503 with the specific
unconfigured-analysis error. Construction, Remodeling and Handyman were blocked
by their deployed invalid draft receipt. No estimate submission or customer delivery
was requested in these live checks. This is one real PDF trial, not a full model
accuracy or full file-format acceptance benchmark.

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

## Direct implementation follow-up, September 11

The user requires Codex to implement and test directly, with no further Replit
update prompts. Direct repository changes remove the image-caption overlays and
add extraction evidence categories. Inferred assumptions cannot auto-populate
pricing fields, and unscaled visual guesses cannot populate measurements or create
conflicts against explicitly stated dimensions. Extraction uses its own model
configuration rather than inheriting an unrelated assistant model setting.

Direct live synthetic PDF checks still show P5 Home analysis unavailable (the PDF
is confirmed retained on reload), invalid draft receipts on Construction,
Remodeling and Handyman, and a successful Cabinet PDF read of 20 LF base and 15 LF
upper cabinets. These are deployed-code findings, not passes of the draft changes.
The local workspace has neither analysis credentials nor a production database
connection. Real-provider validation of the new source is therefore still pending.
The whole estimator migration remains incomplete until remaining designer/legacy
pricing integration, approved cost books, and live acceptance are completed.

## Reconciled implementation and real document check, September 11

All five stopped Replit main branches were merged into the direct implementation
branch. No DROP, TRUNCATE, production overwrite, or destructive migration was
added or executed. The existing development schema parity fixes are preserved.

The OpenAI fallback requested 24,000 output tokens from gpt-4o-mini, whose
published maximum is 16,384. The request now uses 12,000. Replit/OpenAI and
Anthropic transports retain bounded fallback, safe error messages and stored files.

The supplied four-page, number-redacted construction scope was uploaded directly
to every live site. P5 stored the file but analysis returned 503. Construction,
Remodeling and Handyman returned invalid null draft receipts before upload.
Cabinet retained the file and returned only partial analysis: page one failed,
and the separate page readers falsely reported sibling pages as missing. This
is a failed acceptance check, not a production pass. The new implementation
keeps short PDFs whole and chunks longer sets into at most eight-page sections,
with an explicit instruction that sibling sections are processed separately.
The regression covers all four pages together and a failed middle section of
a seventeen-page document. Provider responses are simulated in local tests.

Living area, garage area and covered outdoor areas are distinct pricing fields.
The wizard skips optional location/scheduling follow-ups and finish-level questions
when material specifications are already available. Cabinet designer selections,
actual placed base/wall module quantities, notes and photos now feed the shared
estimator in a separate persisted project. Designer changes preserve corrections
and produce a targeted conflict instead of silently replacing visitor answers.
The Cabinet chat carries user descriptions and reference photos to the same
estimator; its retired calculation endpoint returns 410 and no competing price.
Its human handoff still carries the conversation, without unreviewed price data.

Release gates still require current approved cost books, real provider validation
of the new source, real delivery verification and deployment. The local preview
has no database connection or provider credentials; its real submit failure is
recorded and cannot be called an end-to-end pass. Physical microphone/OS permission
tests and automatic legacy DOC/XLS/ODS/HEIC conversion remain unverified or absent.

### Final interaction refinements

Project examples now match each brand. Imported designer details appear before
additional input; optional AR/layout tools follow the estimate instead of burying
it. Appliance openings are excluded from cabinet-run takeoffs. Cabinet's designer
is intentionally disabled by its existing public feature flag. CI explicitly
enables it for coverage; production availability is not changed. A direct local
walkthrough reached the shared input with all six design details retained. The
cloud browser cannot render its WebGL scene, so AR/3D is not a verified pass.

The reconciled P5 main lockfile failed clean installation due to missing/inconsistent
transitive @emnapi entries; it was regenerated without lifecycle scripts. P5's
native full suite subsequently passed 664 tests with one database-dependent skip.
