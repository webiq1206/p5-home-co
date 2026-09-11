# Estimator finalization, September 11, 2026

## Completed source changes

All five brands now share the complete resumable upload and checkpointed document analysis implementation. The limits are 50 files per project, 250 MB per file and 1 GB per project. Large-file segments use SHA-256 checksums, authenticated draft ownership, saved receipts and retries that reuse confirmed segments. Files remain in the assigned brand bucket.

Document preparation supports HEIC/HEIF, TIFF and AVIF conversion and reduces oversized ordinary photos before vision analysis while retaining the original. Production tracing includes the worker dependencies. Office archive limits are checked again before parsing large uploads.

Document sections that exhaust their automatic attempts now show a visible warning and a retry action. Retrying reuses successful sections. A multipart request that uploads files and requests checkpointed analysis reads the newly saved draft before preparing sections. Handyman's managed schema preserves the resumable-work table.

Existing mobile Continue controls remain in document flow. Existing customer privacy, profit, overhead and cost-evidence safeguards remain in place.

## Verification

The local regression exercises a real isolated PostgreSQL-compatible database, 25 MB PDF upload, corrupted segment rejection, duplicate retry, full file byte comparison, temporary segment cleanup, 17-page analysis, partial failure warnings, retry of only failed sections and retained answers. Object storage and AI transports are simulated in this regression. It sends no email or CRM request.

GitHub Actions performs clean dependency installation, financial and persistence tests, TypeScript, the normal production build and the existing Chromium/WebKit responsive browser checks.

## Production state verified before release

All five public large-upload endpoints returned 404. Read-only inspection of each Replit app confirmed its current checkout lacks the new upload route and analysis worker. All five have storage enabled and an extraction credential configured. All five production policy tables have zero configured service cost books.

The new Git main must be synchronized into each existing Replit app and published before these fixes can be tested live. Replit's security verification currently blocks this browser's editor controls. Publishing the unchanged old checkout would not deploy these fixes.

Automatic pricing still requires current service cost books. Historical customer sale amounts are available for comparison and direct-cost budget ceilings; they must not be mislabeled as verified supplier, subcontractor or field-labor costs. No fabricated cost books or owner approvals were inserted.

Live acceptance still includes the new large-upload path, real provider accuracy, customer/admin PDF delivery and CRM linkage. Physical device microphone permission behavior cannot be established by simulated browser speech tests.
