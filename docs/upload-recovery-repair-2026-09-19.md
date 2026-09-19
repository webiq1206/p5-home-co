# Upload recovery repair and qualification

This release repairs the five failure cases reproduced in the additional upload testing. It does not certify live AI accuracy, large-plan timing or deployment readiness.

## Repairs

- Retry checks the stored bytes behind a chunk receipt. Missing or corrupt chunks can be replaced; healthy chunks are not uploaded again.
- Failed finalization removes the failed chunk from the saved resume manifest, retaining all other chunks.
- PDF/image signatures and bounded Office archive metadata are validated before final object creation. Damaged, encrypted and oversized Office archives are rejected.
- Malformed JSON, null and array start requests return client errors instead of transient service errors.
- Final objects use lease-specific keys. Cleanup targets only an unreferenced object from that attempt, including after a lost storage acknowledgement.
- Source-stream errors are explicitly observed rather than relying solely on the storage SDK's destination promise. Finalization has a bounded timeout.
- File receipt insertion checks and locks the current draft and transfer lease. A submitted draft or expired lease cannot receive a late file.
- A saved file receipt recovers a lost transfer-completion checkpoint, even after temporary chunks have been removed.
- Office metadata reads use a bounded three-chunk cache so central-directory and local-header checks do not repeatedly download entire segments.

## Permanent regression coverage

`scripts/test-p5-upload-adversarial.mts` records 31 cases and exits unsuccessfully if any assertion fails. It covers limits, concurrent admissions/finalization, authorization, storage outages, missing/corrupt segments, byte identity, invalid and multi-chunk valid Office archives, stream failures, lease expiry, submission races and receipt recovery.

`scripts/test-p5-document-adversarial.mts` adds 15 hostile-response cases to the existing isolated adapter fixture. Missing, duplicate, partial, foreign and misnumbered pages must remain rejected. Authentication failures cannot become completed extraction; capacity failures remain pending.

Both scripts run in the non-browser conversation-verification workflow. They use isolated SQL and controlled transport/storage boundaries. No customer messages or paid AI requests are sent. Results are written under `node_modules/.cache`.

Release verification also runs each site's estimator regressions, mixed-file upload integration, captured-delivery workflow, TypeScript and production build, plus the shared document-service suite and 256-page resumable fixture. The shared suite retains nine PostgreSQL-dependent skips when its dedicated test database is unavailable. Passing local fixtures is not proof of actual provider interpretation, live storage or production resources.

## Remaining gates

The earlier default 200-page shared-reader cap, 50-MiB adapter threshold and mixed-format routing remain configuration/qualification concerns. This repair does not raise limits or claim those paths are equivalent. The saved live short-document recovery rejection, real-plan accuracy, processing-time target, deployed model/routing configuration and full customer journeys remain open until direct runtime access is available. Browser/device/microphone checks remain excluded by the current instruction.

No production configuration, infrastructure size, provider budget, cost ledger, database schema or financial rule changes are included. Source must be synchronized and its revision verified in Replit before publication. Release commits retain the CI skip directive to avoid triggering the existing browser workflows; local verification is reported separately from CI.
