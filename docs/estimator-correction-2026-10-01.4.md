# Estimator correction checkpoint 2026-10-01.4

This is a P5-only repair and diagnostic checkpoint. It does not certify the full estimator or close the entire correction plan. Original uploaded files remain unchanged. No database schema or child-site changes are included.

## Implemented

* Anthropic missing-source failures retain safe response structure, tool error codes, stop reason, text length, HTTP status and request identity in the existing draft-linked cause trace. Full prompts, response prose and credentials are excluded.
* Documented transient search errors (`too_many_requests`, `unavailable`) use the existing bounded backoff even when the API response is HTTP 200. Permanent tool/input errors do not enter that branch. Reference: https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool (checked October 1, 2026).
* Saved empty-source markers retain their failure category. A broad search and its bounded corrective search that both lack sources end for review rather than replaying a 30-second pending state throughout the 15-minute cooldown.
* Failed provider dispatches are bounded across saved checkpoint identities. The existing financial cap and unknown-charge protections remain in effect. This is a failure limit, not a guarantee of zero duplicate charges after an uncertain provider acknowledgement.
* Labor-hours applicability reads customer instructions without generated question text. It requires hourly/time-and-materials intent rather than the phrase labor hours in a model explanation.
* Extraction requests a typed measurement role. Non-work measurements retain their evidence/observation but lose their numeric pricing quantity. Deterministic guards also recognize location units and explicit camera-station/uninspected-length wording in legacy records.
* Numeric clarification claims are checked against the actual answer before measurement normalization. Server-owned identities and units remain protected.
* Cross-page citation mismatches no longer acquire an invented current-page label and retain a measured quantity. Their original citation remains; the quantity becomes unresolved. Detail-crop origin alone no longer rewrites takeoff attribution.
* Page-review output now distinguishes readable, blank, source-unspecified, illegible and outside-view states. Merging keeps a failed detail unresolved. Legacy records keep their conservative checks. Complete typed coverage can retire only its own matching contradictory prose note, not unrelated preparation failures.
* Scope instructions support stable subject/aspect decision IDs. Server-owned answers and deferred-to-specialist outcomes survive same-ID rewording; conflicting subject/aspect identities are rejected. Provider responses cannot assert that a customer answered a decision. Legacy records without decision IDs still require migration/retest; this does not claim every historical wording is now resolved.
* Both initial and repaired pricing audits receive the customer assumptions accumulated before that audit, with explicit responsibility-consistency instructions. This closes an audit-input omission. It does not repair historical saved PDFs or prove that every new audit note is semantically correct.

## Evidence used

The live findings are recorded in estimator-live-retest-2026-10-01.md. The original RE10 text was checked again locally: 32 feet is the damage location from the camera entry; approximately 40 remaining feet could not be evaluated; the request calls for a downstream cleanout. These statements do not establish repair or excavation lengths.

## Verification scope

Targeted tests cover original failure mechanisms, typed coverage merging, customer decision persistence, clarification compatibility, audit input, and actual production ledger SQL with controlled provider transport. These tests do not qualify real provider interpretation, concurrency, supplier evidence, customer delivery, or production performance.

Verified locally: database safety 6 passed; retained-provider suite 1,724 total, 1,708 passed and 16 skipped; selected-Haiku suite 18 passed; zero test failures. Production compilation and TypeScript passed after moving the stale local Turbopack cache aside and rebuilding. Lint remains at 908 errors and 105 warnings, the existing repository baseline. No production database was used for these checks.

## Production gate and remaining work

1. Deploy this exact tested tree to P5 and verify its release identity.
2. Retry the preserved cabinet case once. If research still fails, inspect the new directly linked tool diagnostics and implement the actual provider-specific correction. Do not assert the historical error was an outage or skipped search without evidence.
3. Confirm the saved RE10 correction remains intact. Verify that it does not ask for contractor labor hours. Resolve duplicate cleanouts and other repeated physical work using source-grounded identities; do not merge different items merely because wording matches.
4. Reread only failed Goeckner regions using the typed coverage contract. Verify original sheet title-block identities, addition areas and region attribution against the uploaded PDF. The new coverage field alone does not verify title blocks or overlapping geometry.
5. Validate complete final customer outputs, including audit-generated notes, against owner/contractor responsibilities. Regenerate and inspect the historical handyman case only through an explicit revision, preserving history.
6. Complete source-derived expected results for new construction, additions, ADU, kitchen, bathroom, whole-home remodel, cabinet, handyman and inspection scopes. Include text, uploads, mixed inputs, revisions and interruption recovery. Competitor estimates are comparisons, not approved ground truth.
7. Qualify cost-book learning, customer PDF/email delivery, mobile flow and repeatability through the actual public route. Passing an administrator-only workflow does not satisfy this gate.
8. Automatic code-patch generation, isolated patch evaluation and deployment rollback remain unimplemented. This checkpoint improves runtime recovery; it does not enable a production system to rewrite itself.

The complete correction plan stays open until these gates pass. User republishing is needed for the next production evidence; no live qualification of 1.4 is claimed here.
