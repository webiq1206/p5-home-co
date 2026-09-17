# P5 shared document service completion ledger

Updated: 2026-09-17 UTC. Status: in progress, not production-qualified.

## Current source and access

- Repository: webiq1206/p5-home-co.
- Working branch: feat/shared-document-service-20260917.
- Recovered head: eee403aac10cfb4eeec7e8874fd8c2fa654e0977; main: 66f0c808b134b286e317a2caa81a31517e1b9f22. Branch was 27 commits ahead and zero behind when checked.
- This document is the first scoped, non-production write proof for the resumed session. The resulting commit is recorded in Git history; production files are unchanged by this commit.
- GitHub connector advertises contents, Git data, PR and merge actions; repository metadata reports push permission. Actual connector write is demonstrated only if this commit exists remotely.
- Local Git can read the public remote. No gh executable or credential helper is configured; do not equate public fetch with authenticated push.
- All five named Replit apps were resolved through the connected app. No Replit Agent use is authorized for this task.

## Verified evidence

- Historical run 35285444100 failed its website production build and skipped the worker container check.
- Newer run 35286129315 at eee403aac10cfb4eeec7e8874fd8c2fa654e0977 completed its verify job successfully, including database/HTTP/PDF tests, saved-file adapter tests, estimator regressions, production website build and worker Docker build.
- CI still applies guarded source refinements before tests. Review and commit maintained readable source so the repository matches the tested implementation.
- These are infrastructure/parser/mock-provider checks, not live provider or customer journey qualification.

## Open release gates

- Inspect all service modules, configuration, transport/refinement scripts, adapter, benchmark, tests and current workflows.
- Resolve correctness, recovery, isolation, capacity and benchmark-measurement gaps with regression evidence.
- Check latest main and other UI/SEO branches across all five repositories before applying changes.
- Provision or locate a separate always-on worker and PostgreSQL; configure tenant secrets, providers, explicit models, HTTPS, monitoring and retention. Obtain approval for new recurring charges.
- Retrieve Neilsen_Preliminary_Budget_No_Numbers.pdf and real 25/100-page native/scanned fixtures. Missing numbers must remain missing; never use unredacted sources to fill the test.
- Qualify real providers using independently reviewed ground truth, 1/5/10 concurrent uploads, separate upload/queue/parse/AI/reconciliation timings and precision/recall/quantity/exclusion/revision/page metrics.
- Enable one site only after worker qualification; test reload, answers, edits, numeric estimate, branded PDF, verified hello@p5homeco.com QA email, rollback and RE-10 entry points. Extend to other four sites after that passes.
- Verify UI, responsive layouts, handoffs, sticky actions and public SEO against deployed source. Emulation is not physical-device testing.
- Review PR, required checks, merge, synchronize matching Replit apps, deploy and verify each release separately.

## Deployment and limitations

No worker deployment, remote adapter activation, live-provider benchmark, 99.9% accuracy result, 60-second p95, customer email receipt or complete journey is asserted. Remote PDF-only and byte-limit boundaries must remain explicit. Mixed formats and larger files retain the legacy path. Pricing policy must remain unchanged.

Next action: inspect current readable service and adapters, reproduce targeted tests, and remove any gap between checked-in source and CI-tested source before implementation changes.

## Resumed-session changes and current boundary

User steering: GitHub main only. Do not configure, synchronize or publish anything in Replit; owner will pull and republish. The first actual write proof is d8415ff88d0173c9b8e7bd047e0334a408cf2104.

The original source/adapters were merged by newer work during this session. Recovered that work before continuing. P5 main was 0d79da2 and child mains were f3012d68 (Remodeling), f55ddc6e (Construction), 9862d7d6 (Handyman), 2b5867d6 (Cabinet). New scoped hardening branch: fix/shared-document-service-hardening-20260917. Preserved newer parser callback-ordering tests and real-container startup/readiness checks.

Implemented in this continuation:
- Atomic last-page/document completion, fenced parser manifests, and recovery of saved terminal work.
- Reconciliation queued during source reading rather than waiting for a subsequent browser request.
- Strict adapter coverage and source-reference checks, duplicate-upload deduplication and verified retry responses.
- Local provider schema validation, bounded network-error retries, failed-call metrics and unique tenant-key validation.
- Signed, isolated stage timing endpoints; benchmark concurrency/repeats, sample p95/p99 and separate quality dimensions using reviewed, digest-matched ground truth.
- Immutable CI verification of committed source with read-only credentials; no CI source rewriting.

Local evidence: 357 P5 estimator regressions pass; adapter SQL/HMAC/pending/reuse/partial/foreign-coverage/retry/duplicate checks pass; P5 production build passes. Standalone local tests passed with database cases explicitly skipped because no PostgreSQL server is installed locally. GitHub CI runs those against real disposable PostgreSQL and also builds/boots the actual container. Final CI results and merge commits must be recorded below.

Private fixture retrieved: exact Neilsen_Preliminary_Budget_No_Numbers.pdf, 4 pages, 240892 bytes. Native extraction plus page rendering took 1192 ms; zero digits were present in extracted text on all four pages. This is parser-only, not live AI timing or accuracy. No unredacted copy was opened. Also retrieved real 23-page and 15-page construction sets, not substitutes for requested 25/100-page fixtures. Customer sources stay outside the repositories. hello@p5homeco.com was verified as the connected inbox; no email test submitted yet.

Replit browser access encountered a persistent security challenge before the user stopped all Replit work. No worker host, database, provider secrets or paid infrastructure was configured. No live-provider latency/accuracy, customer journey, PDF delivery or customer email pass is asserted. Remote PDF mode must remain off until qualified. Exact 25/100-page real fixtures and independent exhaustive truth remain needed for that workload; do not inflate 15/23-page results or duplicate pages to claim them.

UI/SEO branches were compared against newer main. They are not ancestor commits because newer main has superseding work; blindly replaying them would revert newer pricing and page changes. Preserve contextual mobile CTA, scrolling and metadata behavior; remaining browser/SEO acceptance is tracked separately from service CI.
