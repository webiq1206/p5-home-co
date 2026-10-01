# P5 estimator: forensic diagnosis of the Haiku production failures

Investigated October 1, 2026 UTC against GitHub `9352c54` and the deployed `2026-10-01.1` runtime. This is an investigation record, not a claim that the estimator is repaired or production-qualified. No new paid provider requests or customer deliveries were initiated in this investigation.

## Evidence and limits

Production cases: RE-10 draft `07bb2fe3-29a6-47fd-bf75-6527ffce81d9`, Goeckner draft `f1b23916-67d2-45b3-afe2-c9f14362595c`, cabinet draft `24e81e7a-1248-4c86-88c7-7fe69fb42c75`.

Evidence combines retained production state, read-only deployment-log inspection, local execution of the actual functions, and reconstruction of rejected drawing crops from the original uploaded permit PDF. Local synthetic responses prove application behavior; they do not establish an unseen historical model response. Reconstructed crops use the checked-in rendering algorithm, but have not been byte-compared with production storage.

Original attachment SHA-256 values for reproducing the investigation:

* Goeckner permit plans: `8fb95035e8d449bea200a2c0542a3ab4b0065d073b2838548384d1a8808f97a4`.
* Marcliffe RE-10: `01e461bcc00f28cac2d2f5198123b00189111233599768ff3929ce5487bb5d42`.

## Confirmed failures and their mechanisms

### 1. A pipe location was accepted as a repair quantity

The RE-10 retained 32 `feet from entry` as a repair quantity and 40 as an excavation/inspection quantity. The source does not establish those as work extents. `DOCUMENT_POLICY` already forbids this interpretation. Repeating that instruction cannot constitute a complete repair.

`readTakeoffs` validates object shape, positive numeric quantities, basis, and citation shape. It does not validate the measurement's role. A local reconstructed takeoff with evidence `Damage at 32 feet from entry`, quantity 32, and unit `feet from entry` passes the real validator.

Required correction: separate observed measurements from quantities authorized for pricing. A location/station, inspected extent, existing area, and installed work quantity require distinct roles. Unsupported repair length must remain unknown and enter an explicit allowance process. Validate the role and evidence before the pricing ledger consumes it.

Acceptance: original RE-10 retains the 32-foot observation as location evidence without treating it as 32 feet of repair; the 40-foot observation does not become 40 feet of excavation. Verify several paraphrases and unrelated documents as well.

### 2. Even a correct clarification can be discarded

`resolveInstructionAnswer` calls `analyzeBatch` with no attached files. `sanitizeRecord` unconditionally empties `takeoffs` when there are no files. `reconcileClarificationTakeoffs` then receives no returned corrections and falls back to selected field-specific quantity mappings, which do not resolve this sewer extent.

Local execution supplied a synthetic model response explicitly correcting the same takeoff to null/uncertain. After the real extraction and reconciliation functions, the result was:

* Model correction quantity: null.
* Corrections surviving extraction: zero.
* Active quantity after reconciliation: 32.

This proves a correction can fail even when the model provides the right answer. It does not prove the historical model returned this particular correction.

Required correction: a dedicated clarification-update contract addressing stable existing takeoff IDs, with validated changes and retained original evidence. Text-only answers must be able to invalidate an old quantity without claiming a new document measurement.

Acceptance: unknown extent, changed scope, exclusions, owner-supply changes, and numeric corrections update every affected active item; original observations remain in history, not as competing billable quantities.

### 3. Citation repair can assign evidence to the wrong page

Ordinary PDF units receive neighboring-page text as context. Instructions prohibit extracting takeoffs from that context, but this is not enforced by evidence verification. In a single-page unit, `analyzeBatch` rewrites an out-of-unit takeoff source to the current source/page and retains its quantity. Detail units are also rebound to the original page without validating the sheet label.

A local injected response cited page 1 while processing page 2. The actual code changed the citation to page 2, kept quantity 32, and merely added a review issue. Production contained duplicated repair evidence attributed to both RE-10 pages. The reproduction establishes a mechanism capable of producing that symptom; the retained evidence does not identify whether the model or the rebinding step first supplied the wrong page in each historical item.

Required correction: distinguish current-page evidence from context, verify attribution before accepting work quantities, and distinguish internal crop numbering from a genuine cross-page citation. Never repair provenance solely by changing its label. Bind sheet IDs to independently verified title-block metadata; detail-reference bubbles are not sheet identities.

### 4. Rephrased questions bypass the answered-decision check

The actual first question was `Radon mitigation scope: interior ductwork, system type, materials?`. The later question was `Does radon mitigation include interior ductwork and penetrations, or is it limited to sub-slab depressurization work?`.

`sameDecision` returned false for these exact strings. It compares five-letter word stems, requiring at least three shared stems and 55% overlap with the smaller set. The questions have no mapped structured field. Answer handling removes the exact asked prompt but preserves other existing prompts; the later wording survives the heuristic and is asked again.

Required correction: persist the identity and resolution of the underlying scope decision, including an explicit allowance/deferred-to-specialist outcome. Wording cannot be the decision identity. Distinct decisions, such as base versus wall cabinet quantities, must remain separate.

### 5. All plan responses existed, but coverage rejected them

The Goeckner read saved 52/52 unit responses across 13/13 pages. Finalization failed with HTTP 422 `incomplete-source` at approximately 03:48:05 UTC. Three units were incomplete. `analysisWork` validates each unit before combining the results; `pageCovered` searches natural-language notes for blocking words.

Local source reconstruction and visual inspection:

| Rejected unit | What the reconstructed crops show | Diagnosis |
| --- | --- | --- |
| Page 3, regions 19-24 | Bottom-of-sheet labels, lines, and readable A101 title block; detailed layouts are elsewhere | The note complains about layouts outside this crop group. This is a scope-of-review error, not evidence that those layouts are illegible in the original. |
| Page 6, regions 13-18 | Readable elevation details and title-block text | The saved note says `Blank tiles (unreadable regions) were individually inspected and found to be exactly opaque white; no content hidden.` The real `pageCovered` returns false because of `unreadable`. The reconstructed manifest has no omitted blank tiles in this group, so the note's blank-tile narrative is also unsupported by that manifest. |
| Page 8, regions 1-6 | Readable section, dimensions, and literal question marks above/below some room names | The original PDF text layer also contains those question marks. Unspecified room attributes must be distinguished from a failed image read. The missing attribute values cannot be invented. |

Required correction: typed regional coverage results distinguishing readable, blank, outside this view, unspecified source value, and actual illegibility. Reconcile overlapping evidence using explicit region identities. Do not simply ignore all partial/unreadable flags or remove the coverage gate.

Progress currently counts saved responses separately from accepted coverage. This explains why apparent reading completion can precede a coverage failure. Customer progress should expose the distinction and identify the particular unresolved source issue.

### 6. Cabinet pricing expired; its first underlying error was obscured

Read-only production inspection at 04:03:29 UTC found:

* 13 saved pricing checks, no final internal/customer estimate or amount.
* 04:01:08.835: background finish, `needs-review`.
* 04:01:19.575: job pass deadline.
* 04:01:19.750: job expired before completion.

A narrowly filtered deployment-log search recovered one line at 03:43:59.972, 87 ms after the draft's saved `researchFailedAt`:

> [p5-pricing] research failed after 6.3s: Pricing provider acknowledgement is unknown; retry is blocked until it is reconciled.

This is strong time/stage correlation, not a verified request link: the console line contains no draft ID, request fingerprint, checkpoint key, or provider request ID. The message identifies the `PricingChargeUnknownError` wrapper, not its underlying cause.

`pricingWork` stores non-retryable research errors as `timedOut:true` and `researchFailedAt`, discarding their messages. This branch does not write the draft-scoped failure event that other branches write. The console prints only the outer error message. The saved checkpoint key and billing-ledger fingerprint hash different data; neither can be inverted into the other.

The marker has a 15-minute cooldown, while research continuation asks for another poll after 30 seconds. The job eventually expires. A marker called `timedOut` therefore does not prove an actual provider timeout, and continued polling does not prove useful work is advancing.

Required correction: persist structured failure category, cause chain, stage/checkpoint ID, ledger fingerprint, attempt, timestamps, returned request ID/status when available, and explicit acknowledgement/charge state. Do not equate unknown acknowledgement, provider rejection, validation failure, and deadline expiry. Recovery must act on those distinct states and retain completed responses.

An additional offline recovery attempt tried to rebuild request inputs from the saved draft, job configuration, responses, pricing timestamp, and shortlist cache. The first attempt was blocked by a native-binding import before execution. A corrected attempt imported only the pricing functions, blocked HTTP, disabled writes and live fallbacks, and loaded successfully. It stopped at the first request because its computed key, `content-v1:76e4d27d7bb2e82748f890677b62cd0e0eb4cb40733312a15bd0c3e4c3276fb3`, had no exact saved response. No checkpoint matched and no ledger row was queried. This does not identify why the reconstructed input differed, and it does not prove the historical request was a 429. The original underlying cabinet error remains unverified because exact historical request inputs and a direct ledger link were not retained.

## Why passing tests missed production behavior

The model-contract tests inject predefined successful responses. They establish routing/shape/identity behavior, not interpretation of the original documents.

The public and qualification routes are also different. Public `/api/p5-estimator/submit` calls `postSubmission`, which uses the saved-scope pricing path directly or through `backgroundJobs` and `priceSavedScope`. The newer `projectWorkflow` is reached through `projectRecordWork` and the administrator-only `/api/admin/p5-estimators/project-record` endpoint. Passing tests for that newer workflow do not establish that it runs for public customers. Integration into the public flow remains a separate, unfinished acceptance requirement.

There is also a specific control-flow difference. In `requestPricingWith`, memory-ledger test mode rethrows the original error before production wrapping. In real-ledger mode, errors such as 429/5xx can be wrapped as `PricingChargeUnknownError`. `retryablePricingProviderError` recognizes only the unwrapped message. Local execution confirmed:

* Plain `pricing-provider-unavailable:429`: retryable true.
* The same error nested in `PricingChargeUnknownError`: retryable false.

Existing backoff tests use the plain error. Thus a passing test of that helper does not establish real-ledger recovery. This is a confirmed integration gap and a possible contributor to the cabinet case, not proof that its original error was 429 or 5xx.

A second local reproduction exercised `requestPricingWith` itself, using an isolated in-memory PostgreSQL implementation and an injected HTTP 429 response. It ran the production wrapper, reservation, and error-persistence SQL rather than merely constructing an error. The result was `pricing-charge-unknown`, its cause retained the synthetic 429, the ledger row became `unknown`, and the backoff classifier returned false. The identical controlled response through the existing memory-test path returned the original 429 and backoff true. No external provider or production database was contacted. Advisory locks were bypassed in this isolated single-request diagnostic, so this is not a concurrency qualification.

Required verification includes real database-ledger behavior with controlled transport failures, persisted checkpoint recovery, process interruption, and source-checked acceptance on the actual documents. Expected results must be derived independently from source evidence, not copied from the model's current output. A full-suite pass remains necessary but is insufficient for production acceptance.

## Repair order

1. Preserve and link failures at every provider/ledger/work boundary so a new error is diagnosable without reconstructing hashes.
2. Correct error-state recovery and bounded completion, testing the actual production wrapper/ledger path.
3. Separate source observations, measurement roles, approved work quantities, and customer clarification updates.
4. Correct provenance, stable decision identity, and typed regional coverage.
5. Re-run the failed original cases end to end, inspect quantities and totals against source evidence, then verify PDF content and authorized delivery. Preserve each failed case as an acceptance fixture.

No blanket promise that every future provider/document error is impossible is supportable. The engineering target is that errors cannot silently become wrong quantities, invented provenance, repeated questions, misleading progress, or untraceable failures.
