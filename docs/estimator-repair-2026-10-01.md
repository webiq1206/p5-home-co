# Estimator repair candidate 2026-10-01.2

This follows the forensic record in `estimator-root-cause-2026-10-01.md`. The changes target confirmed public-path defects. They do not establish that all document interpretation, source coverage, clarification decisions, or final estimate pricing is accurate.

## Additional findings

1. The clarification request not only discarded returned takeoffs: it omitted the retained takeoffs from the model input and explicitly instructed the model not to recreate them. A general instruction update therefore could not reliably correct the active quantity ledger.
2. The Anthropic research implementation performed a second formatting request inside the first saved pricing stage. A complete, cited research report could be lost if this second request failed before the stage checkpoint. The separate outer formatting/reconciliation stage already exists and can use a retained prose report.
3. The memory-ledger test shortcut rethrew errors before production wrapping. This shortcut concealed the different production recovery behavior. It has been removed; tests now encounter the wrapper and its cause.

## Implemented changes

### Retain research and diagnose failures

Completed Anthropic research now returns its report, URLs, verified model metadata and request IDs to the checkpoint before any separate formatting request. The existing saved formatting/reconciliation stage handles conversion and validation. This matches the existing OpenAI prose-retention approach. Formatting failure no longer requires throwing away the already completed search report.

Each dispatched public pricing stage records its exact ledger fingerprint, checkpoint key, provider/model, stage, attempt and timestamp in saved work. Failures retain a history of machine-readable causes, HTTP status and provider request ID when available. They also emit a draft-linked event, including paths that previously stored only a generic timeout marker. A later attempt does not overwrite the previous failure history. Raw provider bodies and prompts are excluded from this diagnostic trace. Unknown/unclassified errors remain explicitly classified as request failures; the trace is not a claim to know an upstream service's internal cause.

HTTP errors now retain provider response-header request IDs. Settled replies retain the returned provider message/request ID on the existing ledger row.

### Recover according to the existing charge policy

For uncapped runs, the underlying cause of an unknown-acknowledgement wrapper now drives recovery classification. A 429/5xx can take the bounded provider-busy backoff path instead of being misclassified as an unavailable search. The ledger still records acknowledgement uncertainty. This preserves the existing uncapped retry policy; it does not assert an ambiguous attempt was free or change a spending cap.

For capped runs, unknown charge acknowledgement stays a stop. An unresolved reservation without a recoverable cause also stops for review instead of entering a research cooldown that cannot reconcile it. Completed saved replies still take precedence over a raced deadline/accounting failure.

### Apply clarification corrections to retained work

Clarification requests now include prior takeoffs and permit quantity changes to their stable IDs. The server accepts only known IDs, rejects duplicates and unit changes, and requires a numeric correction to appear in the customer's answer. An unknown extent can replace an old numeric quantity with null/uncertain.

The server retains physical work identity and attributes changes to the actual customer answer as typed evidence, page zero. Original source evidence remains in history. No document is reopened and no new document page is claimed. Unrelated structured fact corrections still apply alongside explicit takeoff corrections; they cannot override an explicit correction to the same item.

This is deliberately narrower than general source interpretation. The model still has to identify the affected existing item. The application has not acquired a complete independent understanding of every answer, arithmetic expression or measurement role.

## Verification approach

New regression checks run through the actual clarification resolver and provider extraction pipeline with controlled responses. They verify that a correction to unknown sewer extent survives processing, that source coverage and old evidence remain, and that fabricated IDs, duplicate IDs, changed units and unsupported numeric amounts are rejected.

New pricing checks exercise real reservation/persistence SQL in an isolated PostgreSQL-compatible database with controlled HTTP responses. They cover the real error wrapper, cause classification, request-ID retention, capped unknown-charge rejection, parity with memory test mode, and a completed research checkpoint surviving a formatter failure. Advisory locking is bypassed only in this single-request test database, so these tests do not qualify concurrent admission.

The new checks run under both the retained OpenAI setting and the selected Haiku setting. They make no paid model calls and do not write to production. Live source accuracy and production completion must be checked separately after synchronization/publication.

Final local verification:

* Database-safety checks: six passed.
* Retained-provider suite: 1,711 tests, 1,695 passed, 16 explicitly skipped, zero failures.
* Selected-Haiku suite: 16 passed, zero failures, including the new SQL and clarification regressions.
* Final ambiguous-ID safeguard plus integrity checks: five passed. Numeric corrections also use the existing parser's spoken-number forms.
* Production compilation and TypeScript passed. A repeated local compilation encountered a compiler persistence-cache error; preserving and isolating only the generated Turbopack cache allowed a clean compilation to pass. No application database was changed.
* Repository lint remains failing at 908 errors and 105 warnings, compared with the prior recorded baseline of 909 errors and 105 warnings. Both new runtime modules and both new test files lint cleanly.

The first full gate exposed two old tests that expected unwrapped provider errors. Their assertions now require the production wrapper's actual cause and correct recovery classification. An integrity-manifest mismatch caused by an intervening edit was refreshed and verified. No test, lint rule, or database-safety gate was disabled.

## Still unresolved

* Measurement-role validation at initial extraction, including pipe location versus repair length.
* Source-page and sheet-label verification, and duplicate work reconciliation.
* Stable identities for underlying clarification decisions, including the repeated radon question.
* Typed regional coverage and reconciliation of the Goeckner crop failures.
* The exact original provider cause of the historical cabinet failure. New tracing does not retroactively recover missing records.
* Broader completion behavior for exhausted/unavailable research and accurate wait estimates.
* Integration/qualification of the newer project-record workflow in the public estimator.
* End-to-end live qualification of the original documents, customer estimate contents, PDFs and authorized delivery.

The current default remains Claude Haiku 4.5. OpenAI selection remains available. Child-site rollout remains paused. No production deployment or customer delivery was performed for this candidate.
