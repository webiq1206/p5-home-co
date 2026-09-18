# Sonnet configuration and remaining qualification

Checkpoint: 2026-09-18. These are owner setup instructions, not a claim that
production settings have been changed or every website has passed live tests.

## Change the document models on P5 Home Co

Open the existing P5 Replit app, then Secrets. Edit the existing entry instead
of creating a second entry with the same name. For a Configuration, update the
published value and the testing value. Confirm production app secrets while
republishing.

| Variable | Value |
| --- | --- |
| DOCUMENT_PROVIDER | anthropic |
| DOCUMENT_MODEL | claude-sonnet-5 |
| DOCUMENT_VERIFY_MODEL | claude-sonnet-5 |

The shared document service runs on P5's existing server and database. The four
satellite sites do not need their own document worker or these host variables.
Preserve the current host flag, tenant secrets, database connection, ports,
resource limits and deployment type.

## Replace Anthropic model overrides on all five sites

| Variable | Value |
| --- | --- |
| P5_SCOPE_MODEL | claude-sonnet-5 |
| P5_SCOPE_FAST_MODEL | claude-sonnet-5 |
| P5_PRICING_MODEL | claude-sonnet-5 |
| P5_PRICING_RESEARCH_MODEL | claude-sonnet-5 |

P5_SCOPE_FAST_MODEL takes precedence over P5_SCOPE_MODEL. The two pricing names
configure Anthropic pricing calls. They do not choose the preferred provider.
Scope defaults to Anthropic unless P5_SCOPE_PROVIDER=openai. Pricing currently
prefers the configured OpenAI route unless P5_PRICING_PROVIDER=anthropic.
Retain that existing pricing routing during the initial Opus replacement.
Qualify a pricing-provider switch separately before changing it across all sites.
OpenAI fallback may still run; none of these values means Sonnet-only operation
for every website request. Do not remove working keys to force provider routing.

Use existing server-side credentials, never NEXT_PUBLIC_ names. Do not add a
second paid service or change machine size. Pull reviewed main before publishing
while preserving local commits. A Shell environment does not prove published
environment values. Check deployed request metrics to verify the actual model.

## Finish the existing saved qualification

The private bundle and original checkpoints are already in the owner's P5
workspace. After pulling this reviewed release, run one command:

```sh
node services/document-service/scripts/finish-sonnet-qualification.mjs
```

It revalidates the successful saved page-1 evidence and the paid page-2 response
against the exact saved source. Ordered excerpt quotes are checked without a
new AI call. It processes only unfinished short-file pages, then reconciliation.
The 23-page plans start only if the short-file coverage and targeted checks pass.
No file upload or fixture replacement is required.

The new qualification profile reserves additional estimates of at most $1 for
unfinished short-file work and $3 for the plans. Previous reported estimates
remain separately visible and their ledgers are unchanged. These are not invoice
amounts or guaranteed billing caps. Provider settings and account limits are not
raised. One request runs at a time, with a persistent stop on unknown charges.
The fixed profile reuses completed work across restarts and code changes; it
never resets its budget based on a changed source-code fingerprint. A concurrent
or crashed run retains an exclusive lock for inspection. Do not delete locks,
ledgers or checkpoints to force another run.

The consolidated private report includes document checks and passive site/host
availability. These do not establish live adapter activation, pricing, email or
customer journey success. Existing cached results are not cold performance tests.
The original full-file and one-page probe commands are historical diagnostics;
do not run them again instead of this completion command.

## Recovery after the reported 40-second interruption

The reported fixed-profile ledger now has two requests: one known estimate of
$0.050426 and one unconfirmed reserved estimate of $0.12375. Its total remains
$0.174176 against the same $1 short-file limit. Do not delete or reset it.

The default command still honors this pause. After pulling the streaming fix,
the owner can explicitly accept keeping that full unconfirmed reservation as
spent within the existing budget and continue with:

```sh
node services/document-service/scripts/finish-sonnet-qualification.mjs resume-reserved
```

This is a one-time recovery of the exact reported page-3 interruption. It archives
the prior report, jobs and ledger, preserves pages 1 and 2, and changes neither
prior charges nor the $1/$3 estimated limits. Any new unknown charge pauses again.
It does not assert that Anthropic actually billed the reserved amount. Repeating
this recovery mode refuses a second restart; a successful completed run is read
with the ordinary command above. No upload, environment edits or republish is
needed for this isolated qualification command.

Anthropic calls now request SSE streaming. The existing 40-second default becomes
an idle-response deadline, with a separate 120-second total deadline. Provider
leases cover that full bound, and parent cancellation remains effective. The
sequential QA windows are 10 minutes for the short file and 20 minutes for plans;
production job-age limits, concurrency and token/spend limits are unchanged.
This extends allowed response time and does not establish a 60-second performance
pass. Complete responses require the final stream marker and final usage. Partial
usage is retained only as diagnostic information with the full reservation.

## Verified versus open

All five latest unit-rate source PR checks were reconfirmed successful on
2026-09-18. Current source/build evidence remains in the main progress ledger.
An additional 25 local tests passed: 10 document QA/cohost tests and 15 unit-rate,
document-adapter and provider-routing tests. Their provider responses are mocked;
they made no paid AI calls and are not live model qualification.

Direct Replit Shell/configuration access is not exposed in the current session.
The connector reports P5 is published successfully but cannot establish the
deployed Git SHA. No production model settings were edited here.

Still required: real Sonnet source review; P5-only deployed remote-path test;
then all five adapters and RE-10; complete numeric pricing; reusable unit rates
with fresh project quantities; branded chat PDF downloads and actual QA email;
reload/resume and responsive browser journeys; failures/recovery/rollback;
real 25- and 100-page fixtures and bounded concurrency tests. Do not claim 99.9%
accuracy or p95 performance from a single synthetic or isolated run.

This release consolidates duplicate exclusions and exact duplicate assumption
text, uses compact customer PDF spacing without dropping details, and hardens
PDF downloads. Chromium/WebKit release tests exercise the actual browser download
event, file contents and retry without resubmission. The live deployment still
needs to receive this release before those changes can be verified on its domains.

Do not approve Replit-generated migrations that drop p5ds_* tables or copy the
development database over production. A prior publish proposed those destructive
drops because the development schema did not contain the service tables.

References: [Replit Secrets](https://docs.replit.com/core-concepts/project-editor/app-setup/secrets),
[Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing),
docs/p5-sonnet-unit-rate-qualification.md and
docs/p5-shared-document-service-progress.md. Variable behavior above was checked
against core.mjs, cohost.mjs, extraction.ts and scopePricing.ts, not inferred from
the provider documentation.
