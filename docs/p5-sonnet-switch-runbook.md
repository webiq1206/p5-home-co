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

## Bounded paid document test

Upload the separately supplied private p5-sonnet-fixtures.json to P5's workspace
root and run this command in the existing Replit Shell:

```sh
node services/document-service/scripts/check-sonnet-documents.mjs p5-sonnet-fixtures.json
```

It runs the original four-page redacted scope first, then the real 23-page plans
if targeted short-file checks pass. It forces Sonnet for reading and verification
only inside the test process. It does not change production settings, use the
production database, price a project, send an email or republish the app.

Estimated guards: $1 / 12 generation requests / 180 seconds for the short file;
$3 / 64 requests / 600 seconds for the plans. These are estimates, not guaranteed
provider billing caps. Do not raise guards or erase checkpoints to retry blindly.
Review private reports under .p5-model-qa before another paid attempt. Successful
cached work is not a fresh performance sample. Never commit the bundle or reports.

Changing models does not prove an old completed cached review used the new model.
Use fresh isolated QA work and inspect the actual provider/model metrics. The
document service currently keys document/job identities by pipeline version,
tenant, project and content/input, not the model name alone.

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

The previous small-job customer PDF contained repeated exclusions and repeated
verification/assumption notes. Its chat download remains unverified. This
checkpoint records the issue; no PDF presentation or download fix was made.

Do not approve Replit-generated migrations that drop p5ds_* tables or copy the
development database over production. A prior publish proposed those destructive
drops because the development schema did not contain the service tables.

References: [Replit Secrets](https://docs.replit.com/core-concepts/project-editor/app-setup/secrets),
[Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing),
docs/p5-sonnet-unit-rate-qualification.md and
docs/p5-shared-document-service-progress.md. Variable behavior above was checked
against core.mjs, cohost.mjs, extraction.ts and scopePricing.ts, not inferred from
the provider documentation.
