# P5 live verification checkpoint, 2026-09-18

## Release verified

PR 66 merged as `15a6ce78559759c0491d6e78c3030ef470ce596d`.
The merged tree `486e5748c4536b75052c25e3f666f9cd7eb0c164` matches
the tested head `69b3e70f3e22cf6ea6837df00965d843ab2bd746`.

Release workflow 35378879382 succeeded:
https://github.com/webiq1206/p5-home-co/actions/runs/35378879382

Recorded final job results: 140 service tests passed; 372 estimator regressions
passed; prebuild had 980 passes, one existing database-dependent skip and no
failures. SQL/HMAC adapter, pricing timeout recovery, persisted unit rates and
site isolation, production Next build, cohost smoke and Docker worker readiness
against disposable PostgreSQL passed. These are automated release checks, not
live Sonnet accuracy or customer performance results.

## Free live browser checks

Desktop viewport: 1363 x 936. No fresh estimate, paid model request, email,
file upload or production configuration change was initiated in this pass.

| Site | Observed entry result |
| --- | --- |
| p5homeco.com/quote | Previously submitted synthetic QA result restored after reload; PDF bytes downloaded |
| boiseremodeling.co/#calculator | Suggestion populated the project text; Continue enabled; keyboard clearing restored disabled Continue |
| boiseconstruction.co/#calculator | Same entry-control checks passed |
| boisehandyman.co/#calculator | Same entry-control checks passed |
| boisecabinet.co/estimate | Same entry-control checks passed |
| boisehandyman.co/re-10-repairs-boise#re10-estimator | RE-10 navigation and repair suggestion worked; keyboard clearing restored disabled Continue |

The four child-site upload controls advertise the expected PDF, image, text,
spreadsheet and document extensions. Their browser error logs were empty during
observation. No child-site Continue button was submitted. Mobile, tablet,
authenticated document adapters and complete customer journeys were not tested
by this pass.

## Saved PDF observation, not a new pricing pass

The P5 browser retained the earlier synthetic estimate
`95d669b3-6e05-44f5-b7dd-258fe9e9f99e`, with the previously reported range of
$6,825 to $8,925. This was already marked invalid for pricing qualification
because baseboard material and fastener costs were missing.

The result survived a reload and reopening. Downloaded PDF:
186,583 bytes, 16 pages, SHA-256
`251fd7fc03cdf73b2ad3e4e6bb7f0aa7a93749b90fd25621888f13d925451b55`.
The browser download-event monitor timed out, but actual nonempty PDF files
arrived; that monitor timeout is not an application download failure.
Text was inspected throughout; first and last pages were rendered and viewed.

The served PDF still uses the earlier 16-page layout and repeated exclusions.
The saved result therefore does not verify the merged compact presentation or
missing-price fixes. No deployed Git SHA was available from these observations.
A fresh valid estimate after publishing current source is still required.

## Paid qualification remains pending

No new owner output was received after providing the one-time recovery command:

```bash
git -c pull.ff=only pull && node services/document-service/scripts/finish-sonnet-qualification.mjs resume-reserved
```

The command is for the exact reported historical interruption. Run it once if it
has not already been run. If it has run, inspect its output before choosing any
next command; do not repeatedly invoke the one-time recovery mode.

The prior reservation remains $0.174176 within the original $1 short-file
guard. Pages 1 and 2 are retained. Plans are gated on short-file checks and keep
their original $3 guard. No budget reset or new paid request was performed here.

Direct Replit Shell, provider keys and tenant keys are unavailable in this
session. The owner-run result is needed to continue paid qualification.
All-site pricing, PDF/email delivery from a fresh valid estimate, live adapter
activation, large-plan accuracy and production performance remain unqualified.
