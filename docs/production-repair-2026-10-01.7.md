# P5 extraction request correction

## Live findings on .6

Production release 2026-10-01.6 was verified at commit `699034e284ffe08569c4ead7df041ddd7dcbb3c1`, tree `b5f9c9fcfc58d8b03c6f3f8c1311f1c43347b094`, with a clean build.

A new synthetic handyman text-only draft received three provider HTTP 400 extraction failures between 21:12:46 and 21:13:17 UTC. It produced no estimate. The retained event includes status but deliberately excludes the provider response body, so the specific provider validation message is unavailable. Strict extraction output was the new request change in .6 and is removed in this correction. Live verification is still required.

The first document smoke test received HTTP 503 while creating its draft, before any file upload. Read-only production inspection reported website-upstream ECONNREFUSED during startup before Next readiness, followed by website-upstream ECONNRESET records. No retained process-exit, restart, worker-memory-stop or OOM record was found. Those logs cannot uniquely identify the QA request. They do not establish a document-worker crash.

## Correction

Restore the extraction transport and schema from .5, including the original local constraints and validators. Remove the unused strict-schema adapter. Retain catalog compression, required initial research search, and safe gateway diagnostics from .6. Bump the release to .7 so saved estimates cannot be confused with this candidate.

This corrects the newly introduced request change. It does not claim to solve the earlier malformed extraction responses, output truncation, pricing coverage or upstream resets. The 27-source matrix, multi-file, PDF, delivery and mobile acceptance remain incomplete. Child-site rollout stays paused.

## Verification

The .7 production build completed successfully. Main tests: 1,714 passed, 16 skipped, zero failures. Provider tests: 19 passed. Database safety tests: 6 passed. These are local checks; provider acceptance requires deployment.

The saved addition project resumed in the desktop browser after the .6 deployment, retaining the plan and the corrected area text. No new document reading pass is claimed.

A separate .6 pricing retry used the existing reviewed synthetic three-lever handyman scope. It ended HTTP 422 with `needs-review` at 21:16:07 UTC and no customer estimate. Pricing therefore remains unresolved independently of the new extraction HTTP 400.
