# HubSpot review changes: release gates

This is a local repair candidate only. It has not been deployed, has not modified production records, and does not establish that the live failures are fixed.

## Current acceptance and publication blockers

- Authenticated local browser QA was subsequently completed on the Mac as documented below. Physical-device mobile keyboard testing, production-build acceptance and live QA remain NOT RUN. The final underlined-link retest passed with the exact code revision and coverage below.
- Remote CI has not run on the final candidate head. Local focused checks are recorded below, not as a claim that the full application suite passed.
- Git push, CI execution that may incur costs, import and publication require the applicable owner/release approval. No push is authorized by this document. Jared owns Git import and publication.
- Migrations 030 and 031 must be applied and verified before the approved import/publication uses this code. No production migration has been performed.

## Local acceptance evidence

The independent reviewer reported the following on November 14, 2026. The canonical source baseline was `3ceb615aa6e45fefa26c72dabe5735e1033b3604`; the two link-affordance files from `5b986342b2ea8350f0bffe0d8e6e88d93a70565e` were subsequently mirrored with exact file hashes. These results do not establish a deployment or live repair.

- Environment: Mac PostgreSQL 16.14, Node 25.8.1, Next 16.4.3, verified source archive and offline `npm ci` from the exact lockfile. The private test database used a Unix socket. External-network guard and browser routing allowed only `127.0.0.1`; no production database or provider calls were used.
- Actual authenticated correction routes, initial and invalid states, were captured at 320×568, 390×844, 768×1024 and 1440×900. No horizontal overflow was observed. The email input was 54 px high and submit button 50 px high, both above the fold. Manrope and Cormorant loaded.
- Actual server-action valid save produced one audit record, preserved remote IDs and the open hold, and made no immediate provider call. Manager access returned 404 without the form; anonymous access redirected to login. Keyboard Tab focused email. Missing-review state was checked.
- Populated health review with archived references, invalid email and archived contact rendered at all four widths. Review links were initially visually indistinguishable from body text; the narrow underline refinement is committed in `5b98634`. Final visual/click retest PASS on code `5b98634` after HMR settled at 320×568, 390×844, 768×1024 and 1440×900: all five rendered links had computed underline, no horizontal overflow was observed, and Correct email navigated to the actual correction route. The independent reviewer viewed section screenshots of 320 px delivery review and 1440 px archive review.
- Independent PostgreSQL connections passed eight scenarios, including 80 race iterations covering correction versus old-event replay, simultaneous corrections, corrected-equivalent inquiry and same new event with different identity. Shared-contact lease, ambiguity rollback, and a QA-only three-second lock-timeout rollback with explicit retry were also checked. No orphan or duplicate was observed in these tests. The test timeout is not a production setting change; these checks are not exhaustive.

Cloud checks on source revision `5b986342b2ea8350f0bffe0d8e6e88d93a70565e` passed: the three isolated database suites (`hubspot-tasks.integration`, `hubspot-email-correction.integration`, `intake.integration`) ran 61 tests with zero failures or skips; TypeScript `--noEmit --incremental false` and focused ESLint also passed. These are local focused checks, not remote CI or the full application suite. The following commit changes documentation only.

## Remaining intake verification limits

- Independent PostgreSQL connection tests passed the eight bounded scenarios described below. These are not exhaustive concurrency or production-worker proofs. Mismatched concurrent identity results and ambiguous corrected opportunities roll back and return the existing rejected-input contract; do not describe every possible concurrent replay as accepted.
- Rejected ambiguous or mismatched submissions are not persisted as new intake evidence by that rolled-back transaction. The caller must retain the request and arrange review or resubmission. Do not claim these rejected payloads were saved.
- Ordinary duplicate contact-detail refresh must remain covered separately from protection of audited email corrections. The existing open-opportunity deduplication contract has no 30-minute cutoff; this change does not introduce one.

## Approved-release checklist

1. Review the complete branch, including the protected correction UI, audit service, and acceptance evidence. Run typecheck, focused lint, offline lifecycle and database safety tests. Complete authenticated UI/mobile acceptance separately.
2. Apply additive migrations 030 and 031 using the repository's approved migration workflow before deploying code. Verify both tables, constraints and existing business-row counts. Migration 031 is required before CRM pushes can proceed; absence fails closed before provider requests. Do not erase or prepopulate business records as part of migration.
3. Jared performs or explicitly authorizes import/publication through the approved release process after the outstanding gates above are cleared. Do not submit real fixtures or manually retry the production backlog for validation.
4. Observe ordinary scheduled runs. Verify exact source records, preserved remote IDs and explicit open-review counts. Invalid-email holds require a structured contact API rejection; archived-contact holds require exact archived=true evidence after 404. Historical text is not parsed to populate holds.
5. Correct rejected email only through the authenticated, audited correction workflow. Do not retry unchanged/invalid input or clear provider IDs. The scheduled sweep releases a hold only after changed valid input. If the provider rejects that correction, the new rejected input receives a new hold.
6. Archived references are never restored or recreated by this patch. Read-only checks can release an archive hold after an exact active response explicitly reports archived=false. Existing business records, stages and source IDs remain intact.
7. If verification fails, stop release progression. Preserve review evidence and IDs. Do not roll back by dropping review tables or automatically replaying held records; older code would not honor holds and may resume retries.
