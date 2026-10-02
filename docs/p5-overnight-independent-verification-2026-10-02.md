# P5 independent overnight verification — 2026-10-02 UTC

## Source and ownership

Started from GitHub `main` at `bbf1870c454e2ee86edfa609f11209585d23beae`. Existing checkout instructions and `.agents/memory` were read. Historical local checkouts were stale and were not modified. Main remained at this commit at the 04:26 UTC fetch.

Production initially reported `2026-10-02.6`, clean tree `e04f5a87aac00f1d5fc69f12921ccaa349bb8b24`. Another active estimator conversation published `.7` during this investigation. The subsequent public release receipt reports `.7`, clean tree `7b84cc6711b40f8756a03037c7046574597fccc1`, Replit SHA `6ce37cfd5780df67233c772898dfea8921a114d4`, built at `2026-10-02T04:13:45.586Z`. The tree equals GitHub main's tree. This investigation did not publish or mutate Replit source.

A new Replit read-only diagnostic from the other conversation became visible around 04:23 UTC. It concerns synthetic draft `d05c6c74-33a2-4f8a-ba85-9df3565cf8b0` and a fresh `.7` HTTP 422. Its visible diagnostic reports retained $210 installation labor plus $75 shared allowance, no retained hinge-material line, but final audit findings still discussing a discarded hinge charge and removal-only labor. All task IDs were covered while blocking issues remained. This is a second-hand saved-record diagnostic, not an independent database replay or evidence of a corrected result. No request was sent to Replit Agent by this investigation. The other diagnosis remains the owner of that failure.

## Independent corrections

1. Numeric `0 tall cabinets` was reproducibly discarded by `validateExtraction`, producing `Confirm tall cabinet run in linear feet from an explicit measurement before pricing.` Spelled `zero tall cabinets` survived. A shared, family-specific absence check now accepts numeric and written absence through validation and pricing protection. Tests cover saved replay and question selection; unknown, speculative, and another cabinet family's absence remain unusable. This reproduces a plausible mechanism for the previously recorded repeated tall-cabinet question; the exact historical raw cabinet extraction was not available for replay.
2. CI legacy provider fixtures lacked `P5_ESTIMATOR_PROVIDER=openai`, unlike the existing `npm test` command. The new production Haiku default therefore broke their intercepted OpenAI transport/model assertions. Pinning the legacy fixture jobs aligns them with the established test contract. Their later `npm run build` still invokes the separate Haiku suite through prebuild; production provider configuration is unchanged.
3. The real document readiness response now includes the configured model. Its exact-object integration assertion was stale. It now requires that model value rather than weakening the response assertion.

The numeric-zero change needs a fresh estimator release identifier when integrated for publication. This branch intentionally retains main's `.7` identifier to avoid claiming the next release number while another conversation is preparing fixes. No child-site rollout occurred.

## Verification

| Check | Result | Boundary |
| --- | --- | --- |
| `npm test` | 1,772 passed, 16 skipped; separate provider suite 19 passed | Offline/intercepted transports; skips remain explicit |
| `npm run build` | Passed prebuild database safety, same suites, TypeScript and production build | Candidate temporarily had `.8`; identifier restored to `.7` before preservation; no executable logic changed after build |
| CI-style `P5_ESTIMATOR_PROVIDER=openai node --import tsx --test --test-concurrency=1 tests/p5-*.test.ts` | 1,156 passed, 15 skipped | Matches conversation job's runner and selection |
| Complete document service `node --test test/*.test.mjs` | 380 passed, 0 skipped | New loopback-only PostgreSQL cluster, synthetic providers, real HTTP/PDF/parser/SQL; test database dropped and server stopped |
| Document integration alone | 13 passed | Includes exact readiness model and real PDF parsing |
| Saved-file adapter | Passed | Real isolated SQL, signed request integrity, source reuse, no delivery |
| Pricing recovery | Passed | Saved results reused; bounded retries; incomplete prices withheld; no live provider calls |
| Captured delivery workflow | Passed | Simulated email/CRM failure and acknowledgement loss, generated PDF workflow; not inbox arrival |
| Receipt persistence | Passed | SQL receipts and optimistic revision checks |
| Upload adversarial matrix | 31 passed, 0 failed | Synthetic uploads only |
| Document adversarial matrix | Passed all 17 listed cases | Wrong/missing/duplicate/out-of-order pages, wrong sources, oversized counts, 401/429/503 |
| Final extraction/shared-manifest checks | Passed | After restoring the release identifier and refreshing manifest |
| Git diff whitespace checks | Passed | No credentials or customer documents added |

GitHub failures inspected: document run `36963135249`, conversation run `36963135226`, estimator run `36963135257`. Conversation had 44 failures consistent with provider selection; estimator financial stage had 3; document service had one outdated readiness expectation. These exact remote jobs are not claimed rerun or green. Later CI stages may expose additional failures after the initial blockers are repaired.

## Service acceptance matrix

| Case | Current evidence | Remaining gate |
| --- | --- | --- |
| New construction | Local scope, quantity, exclusion and pricing tests pass; approved synthetic fixtures are present | Fresh production extraction, pricing, PDF and delivery acceptance |
| Addition | Historical six-page reads completed; local component/total and conflict tests pass | Historical combined-flooring accuracy remains unaccepted; exact saved raw extraction needed before a targeted correction |
| ADU | Local scope ownership, separate garage/living area and clarification tests pass | Production complete-scope acceptance |
| Kitchen | Local scope replacement, exclusion and retained-appliance tests pass | Production text/upload end-to-end acceptance |
| Bathroom / whole-home | Local tile surface and quantity-preservation tests pass | Production text/upload end-to-end acceptance |
| Cabinet-only | Historical `.5` $2,075–$2,550 result with separate 9/12 LF runs; numeric-zero bug reproduced and locally fixed | Integrate fix, then verify question-free current production result and exclusions |
| Handyman | Historical `.6` $450–$555, two charges, no separate contingency; fresh `.7` 422 visible in other diagnostic | Active stale-audit repair and fresh production acceptance; prior pass is insufficient |
| RE10 | Local source-boundary, fixture quantities and clarification tests pass | Current production extraction, pricing and delivery acceptance |

The contingency policy already implemented in main is 10% of direct project cost, with the reserve incorporated in small-job line prices and no separate small-job contingency line. This investigation did not change arithmetic or invent prices. Historical emails can reflect older saved estimates; they do not establish current regenerated presentation.

## Browser and deployment limits

Live homepage-to-quote navigation and desktop initial estimator rendering worked. Reload reached the normal loading shell; a complete persisted-project recovery journey was not performed in this fresh browser session. A requested 390×844 viewport override did not change the observed 1920×1080 page viewport and was reset; mobile and keyboard acceptance is therefore unverified. No file chooser was used.

No new paid estimator runs, customer messages, mailbox tests, CRM writes, credential changes or Replit Agent prompts were initiated. Independent inbox arrival and broad production uploads remain open. The existing synthetic text/PDF/scan fixtures are available for the authorized next acceptance run, but repository tests are not a substitute for live model accuracy.

Changes are preserved separately because another conversation is actively diagnosing and publishing P5. Before integration: fetch current main, compare overlapping changes, reconcile release identifier and shared manifest, run relevant regressions, and verify exact Replit source tree before a single necessary publication.

## Subsequent CI stage recovery

PR #84's first estimator run passed its financial-policy stage and then failed at `scripts/test-p5-pricing-work.mts`: the isolated `scopePricing` replacement exported `PRICING_STAGE_MAX_MS` but omitted the newly required `RESEARCH_STAGE_MS`. The real orchestration consequently calculated a `NaN` research deadline. Both isolated pricing mocks now export the research-stage bound. This changes test harnesses only, without changing production timeout or pricing behavior.

The identity, pricing-work, background-worker, repair-persistence, resumable upload, scanned-plan rendering, upload and unit-rate-store scripts subsequently passed locally. The rendering case covers a synthetic 36×24-inch scan with 24 overlapping detail views in four requests, not live AI interpretation. Local runtime was macOS / Node 22.22.1; GitHub's Linux / Node 24 run remains a separate acceptance gate.

## Current-main integration check

Main advanced to `9d50aa3` (`2026-10-02.8`, superseded-material audit repair). Its runtime edits are in `minorWorkAudit.ts` and `scopePricing.ts`; independent cabinet changes are in `cabinetMeasurements.ts` and `scope.ts`. No runtime or CI file conflict occurred. Only `shared-manifest.json` conflicted and was regenerated from the combined tree. This preserves the other conversation's repair rather than duplicating it.

The combined source passed `npm run build`: 1,778 main tests passed, 16 skipped; 19 provider tests passed; six database-safety tests passed; TypeScript and production compilation passed. The branch now inherits `.8` from main; publication of the independent cabinet change still requires coordinating a fresh release identity with the active owner. At the subsequent public-release check, live remained `.7`.

Additional live desktop evidence: a clearly labeled, unsent synthetic cabinet scope survived page reload with its exact text. Tab from the textarea focused Attach files. Only that unsent QA text was then cleared; Send was never pressed. This establishes initial local draft recovery, not persisted server-analysis recovery, mobile keyboard behavior, or live extraction accuracy.

## Downstream browser and cohosting gate repairs

Remote run `36965132255` passed financial policy, isolated persistence/PDF/delivery failure, TypeScript, and the production build, then exposed the browser harness's obsolete `Continue` selector. The current composer uses `Send message`; review details are now nested under `Edit project details`, and conflict-choice accessible names include source explanations. The harness follows those controls without dropping its recovery, conflict, exclusion, PDF retry, or single-submission assertions. Local navigation passed 10 route/viewport combinations and pricing-review components passed seven widths. Initial updated Chromium run passed 46/47 scenarios; its sole remaining conflict selector was corrected and is being rerun.

Remote document run `36965132908` passed the 380 service tests and build, then failed cohosting readiness because the job's legacy OpenAI fixture setting overrode the smoke's synthetic Anthropic configuration. The smoke now explicitly sets `P5_ESTIMATOR_PROVIDER=anthropic` alongside its existing synthetic Anthropic credential and model. No provider calls occur in this infrastructure smoke; its real gateway/database/website assertions remain intact. Linux CI is required for the `/proc` worker-monitor portion.

## Independent addition-flooring investigation

At parent request after the first fully green PR run (`686eb5e`), an offline seven-case replay inspected the addition flooring boundary. The existing explicit `380 SF carpet + 120 SF LVP = 500 SF` case passes. A reply containing only the 380 SF carpet fact stays 380 SF; without the historical saved raw extraction, that does not identify where the production total was lost. No private reference document or live provider was accessed.

The replay separately reproduced three deterministic defects: comma-formatted arithmetic totals (`1,200 + 380 = 1,580 SF`), `sq ft`/`sq. ft.` unit spellings, and a saved page merge that calculated 500 SF from two distinct rooms but retained its obsolete automatic 380-versus-120 conflict. Regression cases failed before the correction and passed after. Arithmetic totals now parse common area notation with the appropriate area/linear units; distinct-room aggregation requires the same source document and retires only the two system-generated conflict messages. Manual disagreements, incompatible units, incorrect arithmetic and different-source measurements remain unresolved. These are not claimed to reproduce the exact historical production defect.

Coverage-gap audit: the committed qualification pack has eight cases (new home, ADU, kitchen, bathroom, whole-home, cabinet supply, handyman and RE10), but **no addition case**. Its cabinet case is supply-only; installation relies on separate tests/historical live evidence. All 16 existing native/raster synthetic PDFs passed original-page preparation/segmentation without model calls. The focused quantity/question/exclusion suite passed 84 checks after the new regressions. This validates transport and deterministic processing, not live extraction or pricing accuracy. A production addition acceptance still needs its authorized saved source/extraction and expected per-material takeoff ledger; the generic scalar must not substitute for component pricing.

The quantity follow-up passed the full build: 1,781 main checks passed, 16 skipped; 19 provider checks and six database-safety checks passed; TypeScript and production compilation passed. Main was still `9d50aa3` before preservation. The previous `686eb5e` seven-check green receipt remains valid for that head; the new head requires its own CI receipt.
