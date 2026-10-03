# Original-plan completion evidence

Rendering passing is not estimator completion. A complete case needs authentic
reader/review results with original page coverage, the selected production model,
actual approved pricing, a publishable priced result, persisted reviewed scope and
uploads, and consistent customer/admin PDFs. CRM remains off.

## Offline replay

`node --import tsx scripts/check-p5-original-plan-replay.mts PRIVATE_BUNDLE_JSON VERIFIED_CANONICAL_SHA256 NEW_OUTPUT_DIRECTORY`

The bundle is private evidence from an actual run, not a hand-authored oracle.
Its canonical SHA256 must be verified independently by the recovery controller.
The command never calls a model. Every pricing request must match the next saved
receipt exactly; changed/missing/extra requests fail without a paid fallback.
Source identity includes the runtime, application source, lockfile, scripts, and
brand assets through `pricingSourceIdentity()`.

Bundle fields:

- `version: 1`, `sourceSha256`, `pricedAt` (original pricing timestamp).
- `pricingResultSha256`: canonical hash of the original `{internal,customer}`
  pricing result before submission stamps its issue record. Recomputed pricing
  must match this exactly; matching model replies alone is insufficient.
- `documents`: `{path, name, type: "application/pdf", sha256}`; paths are relative
  to the private bundle. The PDF bytes independently determine the page inventory.
- `scope`: the actual production-normalized `ReviewedScope`, including extraction,
  complete page records, original upload names/hashes/sizes, answers, corrections.
- `expectedPages`: `{source, page}[]`; must equal the original byte-derived inventory.
- `modelEvidence`: the actual document service's verified model evidence.
- `configuration` and its canonical `configurationSha256`: authentic approved
  pricing snapshot, with no test catalog substitution.
- `pricingTranscript` and its canonical `pricingTranscriptSha256`: `{version:1,
  model, stages:[{requestSha256, replySha256, reply}]}`. Each request hash uses
  `pricingReplayRequestHash(instructions,input,search)`. `reply` is the actual
  `{value,sourceUrls}` returned by `PricingRequest`, not an invented result.
- `pricingTranscript.shortlists`: ordered `{requestSha256,replySha256,entries}`
  receipts from the actual `selectBook(tasks,rates)` call. Hash its inputs with
  `shortlistReplayRequestHash(tasks,rates)` and persist `[...resultMap]` as `entries`.
  This separately billable path has no credential-based or empty-map fallback in
  the replay; a missing or changed shortlist receipt fails closed.

The replay runs the actual `priceCompleteScope`, source coverage validators,
draft/upload persistence and outbox/PDF code against a private local PGlite DB.
It reopens the database after save and submission, checks exact scope/file/pricing
round trips, stale-save rejection, duplicate submission prevention, two captured
emails, zero CRM jobs, customer price consistency and administrative cost detail.
It writes `saved-estimate.json`, `delivery.json`, `customer.pdf` and
`administrative.pdf`. Render both PDFs and visually inspect every page before
reporting document acceptance. These private artifacts must not enter Git.

Duplicate-name original uploads currently require preserved source identities;
the isolated re-upload will fail closed if newly assigned IDs change their names.
This is a harness limitation, never grounds to drop or rename source evidence.

Digests prove identity, not truthful provenance. A successful replay cannot prove
that a model read a plan accurately, that a rate source is valid, or that a
synthetic transcript is an original run. The controller must verify the authentic
reader/ledger receipts and inspect source-critical quantities and PDF output.

## Recovery budget prerequisite

`scripts/lib/recoveryEpoch.mjs` is an offline ledger primitive, not a paid runner.
No production path imports it. It has no credentials or network transport and does
not automatically provision an allowance. Provision only after the controller
verifies authentic historical liability plus a finite bound on old workers under
the existing $12 umbrella. No historical ledger is reconstructed here.

The pinned attestation contains immutable source/dependency/runtime/document/model
digests, individual case caps, historical case spend, finite old-worker exposure,
expiry, exact endpoints/models/request-policy digests and billing-bound evidence.
Integer micro-USD stage envelopes reserve completion funding for review/pricing.
Every separately billable request must be durably reserved before network I/O.
Unknown or crashed calls hold their full reservation and stop new admission.
Only the original owner can settle a late receipt; an overrun is retained and
freezes admission. A missing ledger is never recreated by opening it. The permanent
provisioning marker blocks accidental reset; it is not protection against a
privileged actor rolling back trusted storage.

The caller must derive each request's proven upper bound from the pinned billing
policy and actual request bytes, including images/tools/retries. Supplying an
estimate or a self-asserted receipt does not make a hard spending guarantee. No
live transport is wired until that bound, credential route and old-worker exposure
are genuinely verified. Missing authentic evidence remains a live-run blocker.

## Offline regressions

`node --test scripts/test-p5-recovery-epoch.mjs scripts/test-p5-pricing-replay.mjs`

`node --import tsx scripts/test-p5-pricing-qualification.mts`

These tests use synthetic inputs only and authorize no real spending. Set
`P5_CAPTURE_ARTIFACT_DIR` to a private workspace directory to retain synthetic PDFs
for visual regression review. Passing them is wiring evidence, not original-plan
semantic or price acceptance.
