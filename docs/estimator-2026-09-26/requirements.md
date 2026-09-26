# Estimator requirements verification, 2026-09-26

Candidate: 2026-09-26.1. This is a code verification record, not production acceptance. No publishing, provider QA calls, emails, new credits or paid services were used in this work. Camp Orchard is excluded at the owner's direction.

## Requirement-to-test checklist

The following checklist applies separately to this site's checked-out code. PASS means the named offline checks passed on this site; it does not attest its deployed credentials or provider replies.

| Requirement | Evidence | Status and remaining verification |
| --- | --- | --- |
| Full GPT-4.1 and returned identity | p5-required-model, p5-entry-point-model, p5-provider, p5-reader-routing | PASS offline: requests fixed to gpt-4.1; exact alias or documented 2025-04-14 response snapshot required; missing/wrong models fail. Live requests and responses pending. |
| Complete inputs and provenance | p5-document-reading, p5-document-ledger, p5-document-service, p5-mixed-source-routing, p5-upload-transfer, p5-page-limit, p5-pdf-access | PASS available synthetic fixtures, including 250-page limits. Exact private Marcliffe and largest private plans remain unavailable. |
| Construction scope, exclusions, quantities | p5-accuracy-integration, p5-scope-pricing, p5-acceptance-calculation, p5-source-specifications, p5-duplicate-charges, p5-live-quantity-units | PASS deterministic/reference fixtures. Business-reviewed live GPT-4.1 scope and row selections pending. |
| Full price table and authoritative rates | p5-required-model, p5-book-shortlist, p5-unit-rates, p5-price-book-import, p5-catalog-acceptance | PASS all 1,473 dollar-rate rows retrievable across services; 11 percentage rows separately classified; unit/material/assembly guards covered. Original 1,484-row workbook reconciliation BLOCKED on source file. |
| Durable jobs, caching, idempotence | p5-retained-clarification, p5-analysis-reuse, p5-endpoint-concurrency, p5-pricing-ledger, p5-repair-budget, p5-object-storage | PASS available offline checks. Policy-bound caches reject historical unverified analysis; retry preserves the queue ledger. Real host restart/browser-close completion pending. Live PostgreSQL-only checks skipped without TEST_DATABASE_URL. |
| ETA and truthful progress | p5-input-progress, p5-latency, p5-processing-budget, p5-browser-upload-recovery | PASS status/workload contracts; typed-only queue no longer claims documents. Calibrating ETA through validated pricing requires live timings. |
| Email and secure return | p5-outbox, p5-estimate-document, p5-presentation, p5-customer-privacy, p5-crm-delivery; verify-estimator-recovery | PASS captured delivery, durable retry, private cost redaction and signed-link contracts. Actual inbox receipt and delivered link opening NOT VERIFIED. |
| Revisions, historical PDFs, conflicts | p5-save-return, p5-pricing-source-history, p5-file-snapshot, p5-estimate-document, p5-presentation | PASS available saved-version/PDF/privacy/concurrency fixtures. Live plain-language revisions, secure historical access and mobile completion pending. |
| Production and browser verification | Site production build, tsc, /estimate live browser entry check | Production build and TypeScript pass. Live branded entry form loads; changed workflow browser testing awaits candidate deployment. |

## Changes

- Required full GPT-4.1 in shared reading, inventory, semantic retrieval, pricing, audit, retained assistant and legacy reader entry points. No estimator downgrade or provider failover.
- Validate returned model identity before accepting output. Persist document-service evidence from successful request metrics; /readyz now identifies read and verification models. Remote protocol cache version changes, so the document host and websites must be released together.
- Version analysis and pricing caches by model policy. Historical issued estimates and PDFs retain their original saved prices.
- Retain all relevant price-book descriptions and mandatory semantic candidates. Failed or empty semantic retrieval supplies the complete book to mapping. Unsupported unit/cost-type rows cannot masquerade as percentages.
- Import audit counts source rows, inventories worksheets, records source row references, preserves notes and rejects missing/duplicate codes, unknown additional-sheet codes, missing prices and ambiguous flags. It has been tested on generated workbooks; the real workbook has not been reimported.
- Do not log provider error bodies that may contain customer input.

## Price source audit

All five existing generated books identify `P5 Cost Database 2026.xlsx (Master sheet)`, version `aafe22e09883`: 1,484 rows total, 1,473 dollar rates and 11 percentage rows. The generated data and stored rates were preserved. Searches of connected file sources and available local folders did not locate the original workbook. Supply that exact workbook to reconcile source counts, all worksheet meanings, region/finish fields and percentage policies. Do not interpret the generated-row tests as proof of complete source import.

## Timing and acceptance limits

Offline suite durations are test execution times, not customer time to a usable estimate. No new before/after customer latency, median, slow-case figure or model selection accuracy percentage is claimed. Use the same reviewed simple text, typical upload and largest available plan fixtures for at least five baseline and candidate runs per site. Report end-to-end p50/p95, queue/read/reconcile/map/validate/delivery stages, exact request/response models, processed coverage and actual spend. Provisional improvement target: at least 20% lower p50 and p95 than the matched baseline, with no lost scope or weakened release validation. Unresolved essential scope must remain awaiting clarification or review-required.

## Consolidated release gate

1. Obtain the original workbook and private regression sources; reconcile and run reviewed expected scope, row and total fixtures.
2. Replit cloud-browser access is blocked by a security challenge. Inspect/export each workspace diff and configuration without exposing secrets. Preserve changes before syncing GitHub main. Live `dirty: true` may include build-generated changes and is not proof that GitHub contains every workspace change.
3. Confirm each host has a working direct OpenAI connection or its existing managed OpenAI connection. Old Anthropic-only configurations must be corrected before release. Configure the P5 document host to the same policy; authenticated /readyz must report the full model for reading and verification.
4. Obtain approval for one consolidated paid publication round. Drain active work and preserve uploads/checkpoints. Release the P5 document host and all affected sites in one coordinated window because the document cache/readiness contract changed. Do not deploy just the website adapter against an older document host.
5. Verify deployed SHA/tree/version on each domain and actual response-model evidence from a QA request. Verify no unexpected ratebook changes.
6. Through an authorized QA inbox, verify browser-close completion, real received branded email, secure return/PDF, revisions, unauthorized access rejection and email-only retry. Verify mobile and desktop workflow and record timings/spend. Stop if a model, page, price source or validation check fails.

No paid deployment has been requested or executed yet. The candidate is not declared fully accepted.

## This site

Repository: webiq1206/p5-home-co; deployment branch: main. Domain: p5homeco.com.

Automated suite: 1342 passed, 0 failed, 15 skipped, 67.99 seconds. TypeScript passed. Production build passed, including the existing prebuild gates. Construction and Remodeling compilation were run with a 2 GiB Node heap after unconstrained concurrent builds were terminated by the local runtime; no hosting change was made.

Observed live version: 2026-09-25.1, SHA `ed48b09f5b98fa1fafcad415eb1597acfd53f253`, dirty `true`. This work has not changed the live deployment.

Separate document service: 367 passed, 0 failed, 10 skipped. Three added model-policy checks use offline transport and real local SQL. Historical Sonnet diagnostic scripts remain explicitly labelled diagnostics and are not estimator worker routes.
