# Approved document testing follow-up

October 1, 2026. P5 only. Production release remains 2026-10-01.5.

## Result

Not accepted. GitHub access was restored and the earlier approved report was published on main as `a75260c`. A fresh browser tab successfully resumed the saved project and accepted a fixture correction. Document reading and pricing still failed. The full 27-document acceptance suite is incomplete.

Explicit approval covered processing the supplied files through P5 and its configured providers. Customer contact fields remained blank except for QA names. No client files or draft access keys are included in this repository.

## Browser test

- Fresh tab resumed the saved addition with 21 captured details and 13 questions.
- A complete answer specifying two sinks, one toilet, one shower and one tub was submitted successfully. The next question appeared, confirming that interaction and answer submission worked in this session.
- The next question requested project area despite the A201 area schedule. Its explanation referred to a reviewed detail segment without floor-plan dimensions, rather than reconciling the full set.
- The test answered existing home 2262 SF, main-floor addition 26 SF, upper-floor addition 471 SF, total new addition 497 SF.
- This answer was appended to the project text and triggered document rereading. Progress reached 3 of 13 original pages before the UI reported it could not finish the step.
- The uploaded plan and corrected text remained visible and saved. This is preservation evidence, not successful scope or estimate acceptance.
- Browser recovery is verified only for this desktop session. Mobile keyboard, responsive layout, PDF download and delivery remain unqualified.

## Public API document tests

The matrix used separate QA drafts, original file bytes, SHA-256 receipts, and at most two matrix cases concurrently. The browser and RE-10 pricing test also overlapped, so this is not a single-user latency benchmark. Processing was stopped after repeated failures. Uploads 05 and 06 had already been accepted when the local runner was stopped; their analysis was not qualified.

| Source number | Type | Observed result |
| --- | --- | --- |
| 01 | Six-page reference estimate | Partial reading, then HTTP 503 `document-host-unavailable` |
| 02 | Thirteen-page addition plans | Partial reading, then HTTP 503 `document-host-unavailable` |
| 03 | Three-sheet reference workbook | HTTP 200 with explicit automatic-reading failure warning; not a successful extraction |
| 04 | Five-page addition reference estimate | HTTP 503 with preserved-work retry message |
| 05 | Remodel reference estimate | Upload accepted; analysis not qualified |
| 06 | Whole-home reference estimate | Upload accepted; analysis not qualified |
| 20 | Existing RE-10 draft | Scope review accepted; pricing ended HTTP 422 with no customer estimate |
| 07 through 19, 21 through 27 | Remaining references, plans and inspections | Not submitted in this resumed batch |

No estimate, PDF or customer-delivery pass is claimed for this run. No terminal pricing failure was automatically retried. Earlier source inspections do not count as production acceptance.

## Retained diagnostic evidence

The gateway uses `document-host-unavailable` for upstream connection errors. Public estimator scope requests route to the web process, while the document-service prefix routes to the worker. The error string alone therefore does not establish that the document worker crashed.

Read-only production inspection found no matching retained restart, memory-stop, OOM or socket-error record during 19:20 to 19:24 UTC. This absence does not prove uninterrupted availability. The gateway does not retain the precise upstream error, so timeout, reset and connection refusal remain unresolved.

- Source 01: provider HTTP 200 responses rejected for schema/type failures and output truncation (`max_tokens`), plus repeated deadlines. One rejected response returned instructions and takeoffs as strings where structured values were expected.
- Source 02: deadlines, a provider fetch failure without a retained HTTP status, and successful reading after that failure. Another response had conflicts as a string. These establish intermittent reading and malformed output, not a confirmed process exit.
- Source 03: a provider connection timeout and subsequent page fetch failure. At inspection its database job still said running with an unexpired lease; that state alone does not prove a live process or eventual completion.
- Source 04: saved upload/draft existed, but no extraction or linked processing evidence was retained at inspection.
- RE-10: final retained pricing event at 19:23:29 UTC had provider HTTP 200 with `pricing-search-unavailable`, followed by exhausted supported-source recovery and `needs-review`. This is not proof of a search-provider outage.

## Continuation

Resolve the gateway's missing upstream error evidence and the extraction schema, output-budget and deadline failures before rerunning the same saved sources. Then finish the remaining document, multi-file, pricing, PDF, delivery and mobile checks. Keep the child-site rollout paused. Successful local unit tests do not override these production failures.
