# P5 shared document service

A separate, always-running source-document service for P5 Home Co's five estimators. Its source cache is independent of conversational answers. It does not generate prices, change margins or send customer emails.

## What is implemented

The service stores original PDF bytes, native text, positioned text spans, page geometry, overview images and model evidence in a dedicated PostgreSQL database. Each document is scoped to both website and project. A content digest and pipeline version identify it; changing finish selections or contact information does not reparse it. Different projects do not share readable cache entries.

A durable SQL queue with atomic claims, fencing tokens and renewable leases drives processing independently of the browser. PDF parsing runs in bounded worker threads. Small documents have queue priority. Ordinary text pages are grouped up to four pages or a content budget; drawings are handled individually rather than universally expanded to dozens of crops. Every page has an overview. A source reader can request normalized crops of specific unclear regions; these are rendered from the original and checked before a page can be treated as read. Unresolved disagreements remain partial, never silently promoted to complete.

The reader supports Anthropic, Gemini and OpenAI through explicit provider/model configuration. Structured output is validated locally. Exact native-text quotations are checked against the source. Output truncation and missing page records are failures, not permission to discard content. Oversized multipage output is split into individual page jobs. Successful page jobs remain saved after retries.

Global PostgreSQL admission controls coordinate provider slots, request budgets, approximate token reservations and rate-limit cooldown across service replicas. Timing events record native parsing, queue wait and provider work. Original files are never logged. Data and successful work survive service restarts.

Scope reconciliation is a separate cached job using the current request, all supplied answers, source evidence and full native text. It produces the existing estimator's structured scope contract. Its page coverage cannot exceed the source reader's verified coverage. It does not invent quantities to avoid asking a necessary question.

## Deployment

This folder is an independent Node 24 app. It must run on an always-on worker/API host, such as a separate Replit Reserved VM, not a background timer in an Autoscale website. Keep all five websites where they are.

1. Import the reviewed GitHub source into the separate worker workspace. Set its working directory to `services/document-service`.
2. Install with `npm ci`; start with `npm start`. A Dockerfile is also provided, with this folder as its build context.
3. Provision the service's own PostgreSQL database. Populate `DOCUMENT_DATABASE_URL`, unique server-side tenant secrets, provider key and explicit model names using the host's secret manager. `.env.example` intentionally contains no usable credentials.
4. Use HTTPS at the service ingress. Health checks use `/healthz`; a signed `/readyz` request checks database connectivity and configuration. Configuration readiness is not a live provider benchmark.
5. Run the real benchmark and validate its source output before switching a website to the remote reader.

The service creates only tables prefixed `p5ds_`. It does not migrate, delete or change website databases. Original bytes are initially stored as BYTEA to avoid depending on a specific storage vendor and to preserve restart durability. At larger scale, an object-store backend should replace this storage adapter; it is not currently implemented. Budget for document storage plus rendered previews, and enforce retention. The initial default per-tenant original-file budget is 2 GiB, with a 30-day retention period. Database/host backups have their own retention policy and must be configured separately.

## Website activation

Each website adapter accepts these SERVER-ONLY variables:

```
P5_DOCUMENT_SERVICE_MODE=remote
P5_DOCUMENT_SERVICE_URL=https://your-worker-host
P5_DOCUMENT_SERVICE_KEY=the-secret-for-this-website-only
P5_DOCUMENT_SERVICE_MAX_BYTES=52428800
```

Do not put any key in a `NEXT_PUBLIC_` variable. The mode is disabled by default. Build-time and local mock tests are not reasons to enable it in production. Deploy and qualify the worker first, then turn on one site, run real upload/reload/question/PDF/email checks, and expand to the remaining sites. Setting the mode back to `legacy` rolls back new analysis jobs without deleting source data. Existing successful legacy estimates are untouched.

Version 1 routes saved PDF-only submissions within the configured byte limit to this service. Non-PDF, mixed-format and larger submissions keep the existing application path. It does not silently lower the sites' existing upload limits. The service's page limit defaults to 200 and can be configured to 2,000. Unsupported or encrypted PDFs produce explicit errors. Standalone OCR-provider integration, CAD/BIM ingestion, semantic retrieval and model distillation are future work, not hidden dependencies of this release. Scanned PDFs use the configured vision model; no OCR is performed on already-readable native text.

## API and isolation

All `/v1` and `/readyz` requests require a per-website HMAC signature covering method, exact path/query, tenant, timestamp, nonce and SHA-256 of the body. Nonces are stored to prevent replay. The timestamp window is 90 seconds. An authenticated website can access only its own projects. Project IDs must originate from the websites' authorized draft flow; the worker API must never be called directly from a browser.

- `POST /v1/projects/{project}/documents?name={filename}` with raw PDF bytes creates or reuses a document.
- `GET /v1/projects/{project}/documents/{id}` reports parsing/reading progress and explicit page coverage.
- `POST /v1/projects/{project}/reviews` with `{documents:[{id,source}],text,answers}` creates or reuses scope reconciliation.
- `GET /v1/projects/{project}/reviews/{id}` reports the review and returns its result only when complete.
- A signed POST to a document or review's `/retry` endpoint retries failed work without deleting successful evidence.

`state=complete` means the processing jobs finished. For documents, `coverage.complete` separately indicates that every page was marked read. Partial or unreadable pages remain visible. No field claims 99.9% accuracy. The elapsed-time target is 60 seconds; crossing it does not make the remaining work disappear.

## Verification and release criteria

Run `npm test` with a disposable PostgreSQL instance supplied as `DOCUMENT_TEST_DATABASE_URL`. Tests cover authenticated HTTP ingestion, signed-body integrity, replay rejection, tenant/project isolation, immutable document reuse after scope changes, lease fencing, worker-driven processing, provider admission, 100 unique synthetic large-format pages, unreadable inputs and output validation.

These tests use a clearly identified fake semantic reader. The real PDF parser and SQL/HTTP/queue are exercised, but the tests do NOT certify live AI accuracy or latency. The 100-sheet native benchmark measures only native extraction/layout/overview rendering and uses generated fixtures, not customer blueprints.

Use `npm run benchmark` with `DOCUMENT_BENCHMARK_URL`, `DOCUMENT_BENCHMARK_KEY`, `DOCUMENT_BENCHMARK_TENANT`, `DOCUMENT_BENCHMARK_PDF`, and optionally `DOCUMENT_BENCHMARK_TRUTH`. The truth file is independently reviewed JSON: `{facts:[{field,value,source}]}`. It must include all expected facts to make precision meaningful. This command calls the actual deployed service and provider, records upload time, document time and scope-reconciliation time separately, and fails on unresolved processing errors.

Before enabling remote mode, run representative real 4-, 25- and 100-page scopes/blueprints, scanned and digital inputs, redacted quantities, revisions and narrow trade requests. Measure precision and recall, scope exclusions, quantity units, and per-document completeness. Repeat at one, five and ten simultaneous projects to measure median/p95/p99, provider errors and cost. No passing live benchmark or 99.9% accuracy result is asserted in this repository. Conservative default request limits will not meet a 100-drawing/60-second objective if more than 60 calls are required; quota and model selection must be provisioned and measured, not guessed.

## Source references

Provider API shapes were checked against official documentation on 2026-09-17:
- https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- https://ai.google.dev/gemini-api/docs/structured-output
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://docs.replit.com/features/publishing/reserved-vm-deployments
