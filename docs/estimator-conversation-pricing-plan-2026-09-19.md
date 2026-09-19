# P5 estimator final implementation, recovery, and qualification plan

Date: September 19, 2026

Status: Reviewed consolidated plan. The conversation and pricing direction is owner-approved; new engineering criteria below are proposed implementation specifications, not achieved results. This document does not certify that features are implemented, tested, or deployed. Existing repair reports must be independently checked against current source and configuration.

## Executive decision

Retain the working applications, shared document service, and reusable cost data. Repair the boundaries between them rather than rebuild everything or replace pricing rules with unverified AI totals. Implement one canonical scope and estimate contract, input-specific preparation, durable bounded processing, concise questions, and deterministic pricing and delivery.

The critical release path is: reproduce failures offline, repair transport and state handling, prove text-only scope to delivered estimate, prove the four-page upload through that same downstream path, qualify the larger fixture, then verify each brand's deployed integration. Independent offline work may proceed while an access blocker remains; paid qualification and release may not bypass their prerequisites.

Sections 1 through 11 preserve the product requirements. Section 12 specifies the engineering sequence. Sections 14 through 19 define the reviewed evidence, latency and accuracy criteria, newly identified risks, execution controls, and final sign-off. The later sections refine earlier guidance; they do not relax source validation, financial rules, privacy, or spending limits.

## 1. Goal and scope

Build a conversational preliminary estimator that understands the customer's scope, asks concise and relevant questions, develops explainable pricing, and delivers consistent estimates. Preserve the existing application foundations where they work; do not rebuild solely to replace a cost table with unconstrained AI pricing.

Apply the requirements to p5homeco.com, boiseconstruction.co, boiseremodeling.co, boisehandyman.co, and boisecabinet.co. Include existing RE-10 estimators where present; do not introduce a new RE-10 product where none exists. Preserve each brand's services and approved business rules.

The person answering the questions is the customer using the estimator, including Jared when testing. Answer choices must reflect that person's perspective. Never confuse the customer, the contractor, and the AI assistant.

## 2. One continuous conversation

- Support typed or pasted scope, quick-select answers, custom typed answers, uploads, and existing speech-to-text within the same estimate session.
- Do not create a disconnected upload workflow or require customers to repeat information already extracted.
- Maintain structured scope alongside the conversation: work items, quantities, units, specifications, location, responsibilities, inclusions, exclusions, source evidence, unresolved questions, and explicit assumptions.
- Distinguish customer-confirmed facts, document-stated facts, AI inferences, and provisional pricing assumptions.
- Preserve context across steps, reloads, follow-up uploads, and safe retries. Keep drafts and personal data scoped to the correct session and tenant.
- Provide a concise summary of what was understood, changed, assumed, or still needed. Keep detailed evidence available without filling the main conversation with technical output.
- Treat document content as scope data, not instructions that can override application policy, tenant boundaries, or pricing safeguards.

## 3. Question selection and wording

- Ask only when the answer materially affects scope, quantity, cost, supply responsibility, feasibility, or uncertainty.
- Check documents, previous answers, and current assumptions before asking. Do not repeatedly ask answered questions or ask about explicitly excluded work.
- Prioritize high-impact unknowns and dependencies. Avoid a long generic questionnaire or questions that merely populate optional fields.
- Default to one to three related questions at a time. Adapt later questions to the answers.
- Use one short, plain-language sentence per question. Explain unfamiliar terms in a short optional helper, rather than a long question.
- Avoid jargon-only choices. For example, explain a slab as a door only and a prehung door as a door with its frame.
- Do not claim the AI can infer concealed conditions, missing dimensions, or unspecified quantities with certainty.
- Separate missing selections that can reasonably use an allowance from missing quantities or scope boundaries that prevent meaningful pricing.

## 4. Answer controls and customer perspective

Every question must allow both quick selection, where suitable, and optional custom typing. Typing must not require selecting an inaccurate preset first. Preserve additional details even when a preset is selected.

Use clear, mutually understandable choices. Avoid ambiguous standalone labels such as "You" or "We" for supply responsibility. Prefer explicit first-person customer wording or a request to the contractor.

Example: **Who will supply the doors?**

- I'll supply all the doors.
- Please include the doors in my estimate.
- I'll supply some of the doors.
- I'm not sure yet.

Optional typed detail: "I have three doors. Please include one more."

Required interpretation: four doors are installed, the customer supplies three, and the estimate includes supplying one. Do not charge for supplying all four or reduce installation to one door.

Example: **What type of doors do you need?**

- Door only, using the existing frame.
- Door and frame together.
- I'm not sure yet.

Example: **Should we remove the existing doors?**

- Yes, include removal.
- No, removal isn't needed.
- I'm not sure yet.

Do not conflate removal with disposal if disposal materially changes the scope. Clarify that distinction when needed.

- Support numerical answers with explicit units where relevant.
- Use multi-select only when choices can coexist. Clearly distinguish selecting several items from selecting one alternative.
- If typed detail refines a selection, combine them. If it contradicts the selection materially, ask a short confirmation instead of silently choosing one.
- A later explicit correction supersedes the prior answer for that item. Preserve an audit trail and recalculate affected lines without duplicating them.
- "I'm not sure" must not silently mean yes, no, zero, or acceptance of a hidden assumption.
- When reasonable, offer a clearly stated standard allowance. Otherwise ask one focused follow-up or show an explicitly unpriced item with the reason.

## 5. AI-led scope and controlled pricing

Use AI to identify the work, assemble the estimate, match relevant rates, identify gaps, and explain assumptions. Use deterministic application code for arithmetic and approved financial rules.

The cost table is a reusable pricing resource, not a list of the only work the estimator can recognize. Unfamiliar work must not be omitted, assigned a silent zero, or cause an otherwise valid estimate to fail.

Pricing selection order:

1. Use a relevant approved saved rate when its location, specification, unit, and scope match.
2. Adapt an appropriate rate only with explicit, traceable adjustments and compatible units.
3. For unmatched work, develop a supported cost using appropriate current evidence or a defensible cost breakdown when available.
4. If evidence is insufficient, use a clearly labeled provisional allowance when reasonable. Do not describe a model guess as a verified local average.
5. If neither a supported price nor a meaningful allowance is possible, identify the unpriced scope rather than inventing a number.

- Separate material, installation, removal, disposal, and supply responsibilities when they affect pricing.
- Distinguish direct cost from customer selling price. Avoid applying overhead or margin twice to an already loaded rate.
- Preserve approved overhead, profit, minimum-charge, tax, rounding, and other business rules. Verify their current source of truth before changing them. This plan does not authorize a new numeric business rule.
- Preserve exclusions throughout extraction, pricing, follow-up questions, and delivery.
- Do not multiply quantities because a scope appears in multiple messages, sheets, or revisions.
- If only part of the scope is priced, clearly label the priced subtotal and incomplete coverage. Do not present it as a complete project total.

## 6. Reusable UOM pricing memory

Save eligible new rates so future estimates can reuse them without repeating unnecessary research. Store at least:

- Work-item description and normalized category.
- Unit of measure and the quantity basis for that rate.
- Material and installation specifications, inclusions, exclusions, and responsibilities.
- Geographic applicability, currency, effective date, and freshness information.
- Direct-cost versus selling-price basis and any included financial adjustments.
- Source or derivation, confidence, and approval status.
- Provisional allowance status and the assumptions behind it.
- Appropriate brand or tenant ownership and allowed sharing scope.

Do not automatically promote an AI-generated allowance to an approved rate. Provisional rates may remain available for clearly disclosed provisional reuse, subject to relevance and freshness checks.

Do not average incompatible scopes or units, contaminate approved rates with unsupported guesses, or allow one customer's selections to silently rewrite shared defaults. Make reviewed corrections traceable and prevent duplicate records from retries.

## 7. Example acceptance scope

Given a scope containing 120 linear feet of painted baseboard, four interior doors with dimensions not supplied, and plumbing/electrical exclusions:

- Preserve exactly 120 lf of baseboard and four door installations.
- Preserve plumbing and electrical as exclusions, not active priced work.
- Ask concise questions about door type and relevant supply responsibilities when unknown.
- Flag missing door dimensions without inventing them as document facts.
- Address baseboard specification and painting responsibility through a relevant question or a disclosed allowance.
- Do not infer field painting solely from the word "painted" without disclosing the assumption.
- Allow the customer to proceed with reasonable preliminary assumptions without implying a firm quote or complete specification.
- Handle "I have three doors; include one more" as mixed supply while retaining four installations.
- Carry confirmed answers and allowances consistently into the estimate, PDF, and email.

## 8. Shared processing, models, and reliability

- Reconcile existing repairs against current GitHub and Replit source before adding overlapping changes.
- Diagnose the actual saved-state recovery checks. Preserve valid completed pages, source evidence, and prior cost reservations. Do not weaken citation validation or mark unread pages as read to pass a test.
- Complete secure shared-service configuration for each site and verify actual adapter use, not merely HTTP availability.
- Verify supported Sonnet configuration in every relevant stage. Do not silently substitute Opus or another provider. Record the actual model used; resolve current cross-site configuration differences before qualification.
- Use bounded requests, safe streaming handling, explicit terminal states, and durable progress. Do not present failed or incomplete processing as successful extraction.
- Retry only appropriate failures, reuse completed work, and prevent duplicate customer submissions and delivery.
- Maintain authorized paid-test reservations and unknown-charge safeguards. Do not erase ledgers or treat estimates as guaranteed billing caps.
- Treat large-plan performance as a measured target, not a guarantee. Distinguish cold runs, resumed runs, parallel stage time, and customer wall-clock time.

## 9. Customer experience and delivery

- Keep questions and controls readable, accessible, keyboard operable, and usable on mobile, tablet, and desktop.
- Provide visible progress and understandable recovery messages. Preserve customer input after failures.
- Keep optional explanations secondary, with minimal scrolling and clear step positioning.
- Preserve previously approved layout and CTA requirements unless a concrete conflict is documented.
- Let customers review and edit their answers and assumptions before submission.
- Generate screen totals, branded PDFs, and emails from the same validated estimate snapshot.
- Separate inclusions, exclusions, assumptions, allowances, and unresolved scope in every delivery format.
- Keep confidential internal costs and profit information out of customer-facing output.
- Distinguish estimate creation from email delivery. A delivery failure must not discard the estimate or imply that no estimate exists.
- Support clearly labeled partial estimates where appropriate, and safe delivery retry without duplicates.

## 10. Verification and release gates

No individual model response, local test count, health check, or Agent report is sufficient to certify completion.

Verify one complete customer journey before expanding the same acceptance matrix across all five sites. Cover existing RE-10 flows where applicable.

Required cases:

- Typed scope, uploaded scope, manual Q&A, and mixed input in one session.
- Concise relevant questions, no repeated answered questions, and no questions that reintroduce exclusions.
- Quick answers, text-only answers, selected answers plus detail, mixed supply, contradictions, corrections, and "not sure" handling.
- Unknown work, supported allowances, missing quantities, stale rates, incompatible UOM, and provisional-rate reuse.
- Exact source quantities, duplicate references, and responsibility-sensitive pricing.
- Deterministic totals and unchanged approved profitability rules.
- PDF and captured-email agreement, appropriate confidential-data separation, partial estimates, and duplicate-safe retry.
- Reload, failed upload, interrupted processing, delayed response, and delivery failure without loss of customer answers.
- Actual deployed adapter activation and authenticated tenant routing.

Run offline and isolated checks before paid calls. Reuse existing document checkpoints; complete the short fixture before the larger plans fixture. Retain existing $1 short-file and $3 plans estimated limits unless separately changed by the owner. Avoid repeating shared document qualification independently for every child site.

Use synthetic contacts and captured delivery by default. Do not send messages to real customers or trigger real CRM workflows as incidental tests. Any actual delivery verification requires an explicitly designated test destination.

The current owner instruction prohibits browser use. Do not claim fresh visual or interactive browser verification under that restriction. Report any remaining visual, device, or microphone coverage gap explicitly.

Review the exact source changes, verify the relevant checks, synchronize approved changes to main, complete secure configuration, and publish only the verified release. Preserve uncommitted work and production data. Stop if publication proposes destructive database changes.

After publication, verify the deployed release and actual customer-path behavior through authorized available mechanisms. Keep mocked, local, live-provider, and deployed checks separate in the completion report. Never claim all-site readiness from entry-page HTTP 200 responses alone.

## 11. Execution ownership and honest status

Code edits are to be made directly through the authorized development and GitHub workflow, not delegated to Replit Agent to author further code. Do not use the browser or add a remote-command backdoor. Existing authorization does not create missing connector capabilities.

Handle technical verification without asking Jared to repeat diagnostic scripts. If a credential reconnection or secure setting genuinely requires his action, request only that specific action and explain the blocker briefly. Never request secrets in chat or commit them to a repository.

Maintain a per-site completion record containing source revision, model/configuration verification, actual adapter activation, acceptance results, delivery evidence, deployment revision, and unresolved limitations. A feature is complete only when its relevant acceptance checks pass. This document records the plan, not completion of that work.

## 12. Root-cause repair sequence

This section turns the requirements into ordered engineering work. The objective is to eliminate known application defects and recover safely from external failures, not promise that providers, networks, or source documents can never fail. Do not implement later phases as substitutes for unresolved earlier gates.

### Phase A: establish one authoritative baseline

Inspect current GitHub revisions, unmerged or unpublished Replit changes, active deployment revisions, and configuration presence for all five sites. Preserve unrelated edits. Record the actual processing route and model per input type. Review existing repair claims rather than treating local test counts as acceptance evidence.

Read the saved failed review and its durable event history without paid requests. Identify the exact recovery predicate that fails, including whether any page is partial, a job remains queued or running, or a reservation acknowledgement differs. The prior reports do not establish which predicate is responsible. Do not guess or remove all recovery checks.

Gate: a source/configuration inventory and an exact saved-state diagnosis exist. If inspection is blocked, record the blocker and continue independent offline work without spending money on speculative reruns.

### Phase B: make provider communication reliable and diagnosable

Separate transport, streaming, response structure, domain validation, and billing-accounting failures. Preserve the original error when a spending guard pauses execution so the guard does not hide the root cause.

- Keep separate connection, stream-idle, and total request deadlines. Coordinate them with worker execution limits and job leases. Do not simply increase every timeout.
- Consume final usage and stop reason when a provider finishes a response with invalid or truncated tool output. Never accept partial JSON as a valid estimate.
- Handle split network chunks, tool JSON deltas, supported event variants, cancellation, early disconnects, and final stop events with regression fixtures.
- Reduce schema complexity and output repetition where necessary. Give extraction, reconciliation, and pricing bounded contracts instead of repeatedly requesting an oversized all-purpose response.
- For each failure, record sanitized stage, attempt, request ID, model, elapsed time, actual limits, stop reason, usage completeness, and retry decision. Do not log private source text or secrets.
- Retry transient failures with bounded backoff. For unchanged invalid schemas or domain-invalid output, correct the cause or perform a bounded targeted repair, not repeated identical calls.
- If completion or billing is uncertain, retain the reservation and pause under the existing policy. Partial observed usage is not a final invoice.

Gate: deterministic fixtures reproduce each known failure and demonstrate correct final state, accounting, and error classification without provider calls. Add slow-but-active and abruptly disconnected streams, not only successful short examples.

### Phase C: replace fragile recovery with durable stage ownership

Use explicit per-stage job states and transactional transitions. Separate source preparation, evidence extraction, validation, scope reconciliation, questions, pricing, and delivery. Do not equate "document complete", "pages checked", "all pages readable", and "estimate complete".

- Bind jobs and checkpoints to tenant, source digest, source revision, contract version, and processing configuration as appropriate.
- Persist each validated result before advancing dependent work. A completed-page checkpoint must survive a worker restart or browser disconnect.
- Renew or expire leases predictably; prevent two workers from committing conflicting results. Resume unfinished work after a crash without rerunning completed stages.
- Wait for dependencies without consuming provider retry attempts or repeatedly scheduling expensive review calls.
- On a customer correction, retain unchanged source evidence and invalidate only affected downstream work.
- Preserve failed-run reports and ledger history. Store a new recovery attempt separately instead of overwriting the original evidence.
- Replace incident-specific recovery assumptions with versioned, invariant-based recovery after the historical state is understood. A migration must preserve existing evidence and accounting and have an offline rehearsal.

Gate: restart, duplicate polling, expired lease, partial page, stale revision, and interrupted write tests preserve evidence, prevent duplicate work, and converge to an honest terminal or resumable state.

### Phase D: unify input handling and truthful progress

Use input-specific preparation feeding a common normalized scope and downstream workflow. A single customer experience does not require forcing typed text through a PDF parser.

- Text-only input must bypass file upload and document-reading stages.
- PDFs, images, spreadsheets, and supported text documents must have explicit preparation adapters and capability checks.
- Mixed attachments must not silently switch the whole estimate to an unrelated legacy behavior because one file is not a PDF. Route supported sources intentionally and combine their evidence using the same contract.
- Do not silently fall back to a different processing engine when the configured shared service is unavailable. Preserve the session and explain a resumable failure or an explicit supported alternate path.
- Validate required remote configuration before advertising that integration as ready. Keep health checks separate from actual authenticated adapter checks.
- Generate all progress, retry, error, and completion messages from actual input and stage state, including initial messages before the first poll returns.

Required progress examples:

| Situation | Message |
| --- | --- |
| Typed scope, no attachments | Understanding your project |
| Actual file transfer | Saving your files |
| Document evidence extraction | Reading your documents |
| Scope reconciliation | Checking your scope and quantities |
| Relevant rate lookup | Pricing your scope |
| Estimate creation | Preparing your estimate |
| Email delivery attempt | Sending your estimate |

Gate: the same canonical scope expressed as text, PDF, or mixed input preserves quantities, exclusions, and responsibilities. Text-only tests reject document-reading messages and page counters across initial, pending, retry, error, and completion states.

### Phase E: scale document work without hiding coverage gaps

Reconcile the known 200-page and 50 MB default limits with the requested 250-page capability. Define a tested support envelope covering page count, file size, total attachments, document complexity, and concurrent jobs. Do not merely raise a constant or advertise unlimited uploads.

- Enumerate source pages before claiming coverage. Account for every page as pending, read, partial, unreadable, or unsupported, with an actionable reason.
- Size extraction work by content and image complexity, not page count alone. Split oversized work adaptively, with bounded concurrency and backpressure.
- Use suitable native text and visual evidence together where required. Avoid unnecessary images for reliable text-only content without discarding layout or drawing information that matters.
- Reconcile in bounded batches while retaining page references, repeated-item identity, revisions, exclusions, and cross-page dependencies. Do not create one ever-growing review request.
- Retain completed work when the customer leaves or a request window ends. Verify the hosting setup actually continues durable jobs instead of assuming in-process execution persists.
- Reject unsupported or oversized inputs clearly before paid analysis where possible, retain supported inputs, and offer splitting or an explicit review path. Never silently sample pages and label the whole document read.

Gate: offline 250-page manifest and recovery checks pass; the authorized four-page and 23-page live fixtures pass their targeted checks. A representative 250-page live benchmark and broader load runs require a separate documented budget before execution. Until then, 250-page live accuracy and performance remain unqualified. Report measured latency separately from completeness and accuracy.

### Phase F: validate meaning, questions, and pricing

Enforce the requirements in sections 3 through 7 in application logic and regression tests, not only prompts. Preserve unfamiliar legitimate scope in flexible work items rather than forcing it into a closed choice list. Normalize known aliases only when their meaning is equivalent; ask about ambiguous categories rather than inventing a mapping.

For citation validation, distinguish a true unsupported quote from safe text normalization differences. Test whitespace, Unicode, punctuation, and PDF line-break cases. Keep a traceable source span for normalized matches. Never permit a paraphrase or invented quantity to masquerade as a verbatim source quote.

Gate: the baseboard/door fixture, mixed-supply answers, concise adaptive questions, unknown items, missing quantities, disclosed allowances, and saved-rate reuse all pass. Every included work item must be priced, explicitly allowed for, or visibly unpriced. Totals must reconcile exactly under the approved financial rules.

### Phase G: establish a single estimate snapshot and safe delivery

Version the accepted scope, answers, assumptions, selected rates, calculation rules, and totals as an immutable estimate snapshot. Screen output, customer PDF, and customer email must consume that same snapshot. Changed answers create a new revision, not a partially updated old estimate.

Use durable, duplicate-resistant delivery records. Separate estimate completion, PDF creation, email queued, provider accepted, and delivery confirmed where confirmation is available. Do not claim inbox delivery from an API acceptance alone. Reconcile ambiguous delivery attempts before retrying them.

Gate: snapshot identity and totals match across outputs; failures and retries do not create duplicate estimates, rate records, CRM submissions, or messages. Captured delivery tests are identified as captured tests, not proof of live inbox delivery.

### Phase H: qualify, release, and prevent regressions

Release in stages: verify the shared workflow in one site, then apply the same acceptance matrix to the remaining brands and existing RE-10 flows. Use the exact tested source revision and verified deployment configuration. Preserve a recoverable prior release and use non-destructive, compatible migrations.

Require regression checks in the release workflow for the reproduced failures, input routing, state transitions, semantic validation, pricing arithmetic, rate persistence, truthful messaging, and snapshot delivery. Model, prompt, contract, and configuration changes must trigger their relevant checks.

Track failures and latency by stage and input type, unread-page coverage, schema/citation rejection, repeated attempts, unknown-charge pauses, duplicate delivery, and adapter readiness. Distinguish customer wall time from summed parallel work. Diagnose regressions from sanitized evidence before requesting another paid run.

Gate: a per-site release record demonstrates actual adapter activation and end-to-end behavior, with remaining unverified items named. Roll back or disable only the affected feature if a release regresses, without destroying drafts, checkpoints, or rate history. Browser/device checks remain explicitly blocked under the current no-browser instruction; a full visual qualification claim must wait for permitted evidence.

## 13. Definition of a durable fix

A known defect is closed only when its cause is identified, an automated test reproduces it before the fix, that test passes afterward, relevant adjacent cases pass, and the corrected behavior is verified in the applicable release. An external outage is handled correctly when the application preserves valid work, avoids misleading completion or unsupported prices, communicates the failure accurately, and offers a controlled recovery path.

The operational objective is not "nothing can ever fail". It is "known bugs cannot silently return, and unavoidable failures do not lose customer work, invent scope, hide uncertainty, or cause uncontrolled retries and charges."

## 14. Evidence review and what remains unproved

The following findings are from the supplied run results and inspected repository snapshot, not fresh deployed benchmarks. Recheck source revision and effective configuration before implementation.

| Finding | Evidence | Engineering conclusion |
| --- | --- | --- |
| Simple extraction and reconciliation can work | The synthetic one-page review completed with 120 lf baseboard, four doors, and plumbing/electrical exclusions | Preserve this as a golden fixture; it is not complex-plan accuracy proof |
| PDF preparation was not the dominant four-page delay | One reported preparation pipeline took 3,692 ms, while failed provider work totalled 249,231 ms across concurrent jobs | Optimize and repair provider work before blaming upload or native parsing; parallel work is not wall time |
| Earlier read deadlines repeatedly terminated work | Multiple failures occurred around 40,000 ms | Model output workload and deadlines must be designed together; merely increasing budgets is insufficient |
| Small synthetic Sonnet reconciliation succeeded | Provider wait was 11,541 ms in one test | This does not establish time to a full customer estimate or large-document behavior |
| Page work progressed beyond the original failures | A later run reached four of four checked before review failed | Distinguish page evidence state from reconciliation and final estimate success |
| The review stream failed after substantial output | HTTP 200, 24,214 tool characters, 79,480 ms, no final complete response | Diagnose protocol/output completion using fixtures and final usage; do not infer the exact lost stop reason from partial usage |
| Spending guards stopped subsequent attempts | Unknown-charge pauses and estimated spending-limit errors | Preserve accounting protections while eliminating wasteful retries upstream |
| Recovery rejected saved state | The reported generic mismatch did not identify its failing invariant | Free inspection is required; the exact historical predicate remains unresolved |
| Aggregate review is still a scaling risk | Inspected review code includes every page's evidence plus native text in one request, with a character-count capacity check | Bound provider tokens and output, remove redundant transfers, and introduce traceable reconciliation batches |
| Input routing and presentation differ | Shared route requires eligible PDF-only input; initial UI message mentions documents unconditionally | Unify scope contracts and derive messages from actual work, not a generic analysis label |
| Large-document defaults conflict with the requested target | Shared processor defaults to 200 pages and 50 MB | A 250-page promise requires configuration, architecture, and measured qualification, not just a larger constant |
| Pricing and delivery were not established by document QA | The failed fixtures stopped before a full priced customer journey | Measure and test these stages separately and then together |

Do not attribute a failed citation to hallucination or normalization without comparing the rejected evidence to the source. Do not infer a billing charge from a reservation. Do not infer a current deployment defect solely from a historical run after source changes.

## 15. Time to an estimate: explicit measurements and fast paths

Define these clocks before optimization:

- Customer active journey: first submit through displayed estimate, including upload and processing but reporting customer answering time separately.
- First useful response: submit through a saved scope summary or a relevant question. A spinner or generic acknowledgement does not count.
- Source processing: confirmed server receipt through validated source evidence and reconciled scope.
- Pricing: sufficient confirmed scope or disclosed assumptions through the displayed priced snapshot.
- Full estimate: all requested included work accounted for, totals valid, exclusions and assumptions visible, and PDF ready. Missing material scope or a priced subtotal is not a full estimate.
- Delivery: snapshot creation through provider acceptance, and confirmed receipt separately where measurable.

Proposed engineering targets, not current claims:

| Scenario | Target under controlled healthy-provider conditions | Qualification rule |
| --- | --- | --- |
| Local selection, typing, or navigation | Visible feedback within 200 ms | No provider dependency for accepting input |
| Text-only, ordinary saved-rate scope | First useful response within 15 seconds; displayed complete preliminary estimate within 60 seconds of sufficient input | Report initial interpretation and post-answer pricing separately; exclude customer thinking time, not application work |
| Four-page representative scope | Reconciled scope within 60 seconds after server receipt; priced snapshot within another 30 seconds when sufficient input and relevant rates exist | Keep upload and any question time separately visible; this is not a claim that full completion already meets 60 seconds |
| Short answer correction with unchanged evidence and usable rates | Updated snapshot within 10 seconds | No PDF reread or unaffected-item research |
| 23-page and 250-page complex plans | Retain the owner's roughly 60-second processing aspiration, but establish feasibility through measured qualification | Do not advertise that target as supported until demonstrated on representative complexity and concurrency |

Unknown-item research must have its own measured time and spending allowance. Do not hide it outside the reported full-estimate clock. If research cannot finish, provide a supported disclosed allowance or an honest unresolved item, not an invented price to hit the target.

Report individual observations first, then median and p95 only when an adequate repeat sample is available. A proposed performance qualification sample is at least 20 independent representative observations per claimed class, with sample size and cache state reported. This is not authorization for 20 paid tests: establish a separate costed benchmark plan before exceeding existing budgets. An isolated or resumed pass establishes function, not a reliable latency percentile.

Critical-path simplification:

1. Extract canonical scope once. Do not repeatedly generate a new narrative inventory from information already validated.
2. Store evidence separately and reference compact item/evidence IDs. Retrieve original spans only for ambiguity or targeted validation. Never discard source coverage merely to shorten a prompt.
3. Build a page and section inventory, retain cross-sheet links, and reconcile groups with an explicit global pass for revisions, repeated items, exclusions, and dependencies. A summary-only merge is not sufficient.
4. Reuse approved exact-match rates without an AI call. Batch only unmatched or ambiguous work, with bounded research and no speculative background spending outside authorization.
5. Ask consequential questions while independent validated work can proceed. Do not start expensive work whose scope is likely to change before a pending answer.
6. Avoid automatically racing models or hedging calls. Any later concurrency optimization must demonstrate latency benefit, respect provider capacity, and account for all possible charges.
7. Do not add a verification model pass to every easy item merely because the mechanism exists. Use deterministic checks everywhere and targeted additional review for material ambiguity or conflicting evidence. Qualify any removed model pass against the golden corpus before release.
8. Display the validated estimate without waiting for email delivery. Prepare the PDF from its saved snapshot without regenerating scope or pricing.

## 16. Accuracy: independent ground truth, not model self-approval

Create a versioned golden corpus from authorized fixtures. The automatically attached Camp Orchard bid-review document is not an estimator fixture and must not be read or used without relevance and authorization. Preserve the existing four-page and plans fixtures and their known expected checks.

Expected results must be checked against original evidence independently of the output being evaluated. Where construction interpretation or a drawing measurement cannot be verified competently from the source, mark it unqualified and route that ambiguity for review rather than certify it automatically.

Include these cases:

- Plain typed scope; equivalent text in a PDF; scanned text; image-only drawings; and mixed files.
- Tables and schedules spanning pages, repeated notes, revised sheets, alternatives, multiple buildings, and scope narrowed by customer instructions.
- Explicit zero values versus missing values; mixed units; item-specific owner supply; labor-only or materials-only requests.
- Illegible or redacted dimensions, scale uncertainty, encrypted/corrupt files, unsupported formats, and out-of-limit submissions.
- Multiple material questions attached to the same broad field, contradictory answers, and a correction after pricing.

Release criteria for the regression corpus:

- Every source page has an accurate accounted status, with zero falsely completed or silently dropped pages.
- Zero invented stated quantities, missing explicit exclusions, reversed responsibilities, or duplicate takeoff quantities in the required fixtures.
- Numeric values and units match the source when stated; a derived quantity has a reproducible calculation and supported inputs. Uncertain scale or visual inference is not a stated measurement.
- Each price-driving fact resolves to a valid source reference, a confirmed customer answer, or an explicitly identified assumption.
- Every required included item is priced, disclosed as an allowance, or clearly unpriced. A complete-estimate badge requires no unresolved material coverage gap.
- Deterministic financial checks match to the configured rounding precision; correct rates, quantities, margin basis, overhead, and exclusions are used.
- Both missing-item rate and unsupported-item rate are evaluated. Perfectly formatted JSON and source references alone do not prove semantic completeness.

Passing the corpus does not justify a universal percentage accuracy claim. Track important omissions by severity and affected value; a single missed high-cost item is not hidden by many correctly extracted minor facts. AI-reported confidence is not an independently measured probability.

For visual takeoff, prefer explicit dimensions and schedules. Any scaled measurement needs a verified scale, page/region reference, and reproducible derivation. Never infer dimensions from pixel size alone. Make consequential ambiguous measurements visible before treating them as firm quantities.

## 17. Additional code-review risks and simple UX specifications

The following are source-review risks requiring regression reproduction, not confirmed explanations for every historical failure:

### Item-specific question identity

The inspected clarification merge deduplicates by broad field. Multiple legitimate questions can belong to the same field, such as door dimensions and removal details. Use stable identity based on work item, property, source revision, and question intent. Deduplicate semantically identical questions only. An answer resolves its own uncertainty, not every question sharing a field.

### Pricing checkpoint identity

The inspected pricing stage reuse includes positional keys for some stages and item-ID keys for mapping. Audit whether changed quantities, specifications, research evidence, or repair instructions can reuse an incompatible result within a resumed job. Bind reuse to canonical stage inputs, relevant upstream output fingerprints, and contract/model/prompt versions where they affect compatibility. Preserve compatible historical replies through explicit migration rather than invalidating all completed work.

### Evidence size and output budgets

The current aggregate review can resend both native text and extracted evidence. Measure actual input/output tokens by stage and remove duplication while retaining retrievable evidence. Character counts alone are insufficient capacity admission checks. Define bounded output contracts and a deliberate response to output limits. Do not force short outputs by dropping included work.

### Conversation design

- Use a single familiar composer for describing the project, attaching files, and adding details. Suggested starters should be broad, not demand exact location or square footage before the customer explains the project.
- Default to one active question; group up to three only when they are short and closely related.
- Target question prompts of 15 words or fewer and answer labels of eight words or fewer where meaning permits. Clarity overrides word count. Use optional examples and definitions for unfamiliar choices.
- Show a visible custom-answer option and allow text-only submission. Selecting a chip must not discard a typed draft. Support adding detail before committing, or an obvious immediate edit without forcing the user to restart.
- Show the assumption proposed after "I'm not sure" before presenting it as an accepted selection. Allow correction; record unconfirmed assumptions as assumptions.
- Provide a compact editable scope summary with included work, exclusions, and allowances. Use expandable details instead of long repeated paragraphs or excessive scrolling.
- Start a new step at its heading, keep focus predictable, announce real progress accessibly, and avoid scroll jumps while the user types.
- Preserve the approved bottom CTA behavior: show the final Get Estimate action with the contact step, not a premature sticky Continue control across the whole conversation. Keep contact information for delivery, not as a prerequisite for understanding the initial scope.
- No false countdowns, invented percentages, technical error dumps, or claim that a stalled job is actively reading. Explain the paused step and what is saved.
- Present the final preliminary estimate immediately when ready, with clear range/allowance meaning and an available PDF action. Email status is separate. Do not promise a response time for human review unless a staffed process exists.

### Human review without a dead end

Only offer contractor review when there is a real receiving queue, access control, notification route, and owner. Save the exact unresolved items and customer consent/contact details as applicable. If that operating path is not configured, say the estimate needs additional information and allow an edit or saved return; do not falsely claim somebody is reviewing it.

## 18. Engineering work packages and verification controls

Use independently reviewable changes, each containing a reproduced failure, a fix, regression coverage, and a rollback or compatibility note. Preserve one downstream contract across brands instead of manually drifting five implementations. Use a versioned shared module where practical; otherwise enforce conformance tests and an explicit synchronization manifest.

| Package | Concrete output | Required evidence before advancing |
| --- | --- | --- |
| Baseline and diagnostic record | Exact per-site source, effective config presence, active route, historical recovery diagnosis | Read-only evidence; no credential disclosure |
| Provider and state recovery | Bounded stream parser, classified failures, compatible checkpoints, leases and guarded retries | Offline transport and crash/recovery reproductions pass |
| Common scope and progress | Explicit input adapters, canonical evidence contract, accurate text-only messages | Equivalent-input, mixed-format, and stale-state tests pass |
| Conversation and pricing | Item-specific questions, custom responses, relevant rates and disclosed allowances | Golden scope and financial checks pass |
| Delivery and first-site vertical slice | Same snapshot on screen/PDF/email, safe delivery retry | Text-only then four-page customer-path evidence |
| Larger sources and brand rollout | Bounded reconciliation and per-brand conformance | Authorized plans test and actual deployed integration evidence |
| Release protection | Required checks, compatibility inventory, alarms and recovery instructions | Tested source equals released source; remaining gaps are explicit |

Record access blockers separately from code defects. Missing Replit terminal access does not justify introducing a command endpoint or circumventing permissions. Use authorized code and connector workflows. Current owner restrictions against browser use and new Replit-authored code remain in force.

Before every paid qualification run, record: the defect it tests, the changed revision, expected assertions, saved work reused, maximum calls, estimated reservation, unknown-charge handling, and stopping condition. A failed run must produce a useful sanitized diagnostic before any rerun. Do not rerun unchanged code hoping for a different outcome, unless evidence supports a transient-provider retry under the defined policy.

Existing $1 short-file and $3 plans limits are reserved for their stated fixture work. They are not blanket authorization for all-site pricing research, twenty-run benchmarks, real-customer delivery, or load tests. Offline replay and isolated mocks may validate most fault paths without additional AI cost. New paid work outside those limits needs a costed scope decision, not a quiet expansion.

If the first customer-path check fails, stop expansion to other brands and fix that failure. Independent offline compatibility checks may continue. Do not use the owner as the integration-test runner.

## 19. Final release scorecard and handoff

Maintain this record for each site and each existing estimator type:

| Dimension | Evidence required |
| --- | --- |
| Source and integration | Tested commit, deployed revision, adapter version, tenant route and actual model |
| Inputs | Typed, manual, file, and mixed-input acceptance; supported format/size/page envelope |
| Questions | Concise relevant prompts, customer-perspective choices, custom detail, corrections and no repeated resolved questions |
| Extraction | Golden-corpus comparisons, full page accounting, exclusions, quantities, revisions and source references |
| Pricing | All included work accounted for, correct deterministic totals, approved business rules and scoped rate reuse |
| Speed | First useful response and full-estimate wall time, input class, cache state, samples, plus upload/answer/delivery timing |
| Reliability | Disconnect, restart, stale revision, invalid output, unavailable provider, bounded retry and cost-accounting outcomes |
| Delivery | Identical snapshot and totals across screen/PDF/email, provider acceptance versus receipt distinguished |
| UX | Automated component checks plus separately identified visual, keyboard, screen-size and microphone evidence where permitted |
| Operations | Safe rollback, configuration checks, monitored errors, real review destination if offered, and unresolved limitations |

Status values must be explicit: not started, failed, passed offline, passed with live provider, verified deployed, or blocked. Do not combine them into one generic PASS. Functional and performance qualification are separate.

Final handoff must state what now works, on which deployed sites, the exact supported limits, measured timing, verified extraction scope, any outstanding visual/device or delivery checks, and operational fallbacks. Do not label the whole project complete while a required path is blocked or while only health endpoints have been checked.

This is the final reviewed implementation specification for the current requirements. It is not a promise of flawless AI behavior or a statement that the engineering work has already been performed.
