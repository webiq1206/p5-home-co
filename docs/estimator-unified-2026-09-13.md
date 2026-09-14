# Unified estimator: redesign, performance and reliability release

One implementation of the P5 project estimator now ships in all five sites
(P5 Home Co, Boise Remodeling Co, Boise Construction Co, Boise Handyman Co and
Boise Cabinet Co). Before this release each repository carried a parallel
variant of `lib/p5` and `components/P5Estimator.tsx` that had drifted by
several hundred lines, so a fix landed in one brand did not reach the others.
`boise-remodeling-co` is the source of truth; the other repositories keep only
their own integration modules (`brand.ts`, `deliveryAdapter.ts`, `database.ts`,
`adminAuth.ts`, `progress.ts`, and Boise Cabinet Co keeps `projectIntent.ts`
with `typedAlternatives.ts`).

## Interface

- The estimator is one app-like card that follows its site: a raised dark
  surface with the brand accent on the four Boise sites and a white card on
  paper for P5 Home Co (`lib/p5/theme.ts`). Headings use each site's serif.
- Three focused steps with a step rail and counter. Every step change scrolls
  the card to the top and moves focus to its heading.
- Project entry has one textbox, a talk-to-text control where the browser
  supports speech recognition, one upload drop zone that accepts plans,
  photos, estimates, proposals and blueprints, and a file list.
- Questions are asked one at a time with selectable answers, a plain-language
  prompt and an optional "Why we ask" note.
- The review step places **Get my estimate** beside a concise project summary,
  above the contact fields and the detailed scope. Details are grouped in
  category accordions (Project at a glance, Demolition, Plumbing, and so on)
  with an Edit control per detail. There is no sticky or fixed bottom bar on
  any screen size; nothing covers content or the keyboard.
- When pricing needs more information, the reply lists the missing details as
  buttons that open exactly that question, and every other answer, upload and
  contact detail is preserved.
- Results show the planning range, then category accordions with subtotals and
  itemized lines (quantity, unit, unit price range, line range, and a badge for
  verified cost, planning rate or allowance), followed by labeled Exclusions,
  Allowances and Planning assumptions accordions.
- Progress is an inline card with the stage, pages checked out of the total,
  the file being read and elapsed time. When one browser wait reaches its
  limit, a card explains that processing continues in the background and
  offers **Keep going**; nothing is recomputed.

### Composer (2026-09-13, second pass)

- Project entry is one chat-style composer, modelled on the Claude and ChatGPT
  message boxes: a compact rounded box that grows with the text (scrolling past
  about ten lines), file chips inside the box, and a toolbar with attach
  (paperclip), talk (microphone, where the browser supports speech) and a
  round send control. Files can also be dropped anywhere on the box.
- The hidden file input keeps the accessible name "Upload project files" and
  the textbox keeps "Tell us about your project", so the verification scripts
  and assistive technology see the same controls as before.
- The send control is the only "Continue" on the project step and is disabled
  until there is text, a file, or an attached design.

## Processing and pricing

- Background analysis and pricing jobs are no longer failed when they cross
  the 54-second server budget. Each worker pass is bounded and checkpointed;
  the job continues until it completes or reaches a 20-minute lifetime
  (`BACKGROUND_JOB_LIMIT_MS`). A pass that runs out of time is resumed, not
  counted as a failure.
- Document reading runs up to 12 sections in parallel by default (cap 24,
  `P5_ANALYSIS_CONCURRENCY`) with a 45-second pass window. Ordinary pages stay
  grouped four per request; large drawings keep the detail-view path.
- A retry after a partially read set keeps the same work key: only visitor
  answers, not facts derived from the previous read, shape the request.
- Pricing replies are saved by stage content instead of sequence position, so
  research batches and audit sections run in parallel and a resumed request
  reuses exactly the stages that finished.
- Missing rates: published cost research runs first with a bounded time
  allowance (`P5_RESEARCH_STAGE_MS`, default 22 seconds). If it is slow,
  unavailable or its evidence is rejected, a clearly labeled regional planning
  average is used instead (`regional-planning-average` evidence basis). It is
  presented as an allowance with a review warning, never as verified local
  pricing, and it keeps the same quantity defenses as sourced rates.
- The submission reply for incomplete pricing now includes `missingFields`
  (scope-field vocabulary) so the interface can link to each missing detail.

### Request-driven jobs (2026-09-13, second pass)

- Live testing on the autoscale host showed pricing never finishing: work
  started after a reply gets no CPU between requests, so a 240-second pricing
  pass that ran "in the background" starved. Jobs are now driven by the
  requests that ask about them (`lib/p5/backgroundJobs.ts`): a poll joins the
  in-process run and stays open for up to `JOB_HOLD_MS` (25 s,
  `P5_JOB_HOLD_MS`), replying as soon as the job finishes or saves progress.
  The client keeps polling, so the instance keeps its CPU until the job ends.
- A pass holds a renewable 150-second lease. If an instance is paused or
  replaced the lease lapses and the next poll resumes from the saved stages.
- Typed scopes have no document pages. Provider replies that invent page
  records or takeoffs for a text-only read are now trimmed to facts instead of
  failing the read (both providers were rejecting every typed-scope read with
  "Invalid takeoff evidence" and the job looped).
- The text-only provider race is opt-in from the first typed read only;
  clarification reads cost one provider call, as P5 Home Co's clarification
  test requires.

### Pricing providers and honest failure (2026-09-13, third pass)

- Live pricing stages call Anthropic first (`P5_PRICING_MODEL`, default
  claude-sonnet-5). A refusal Anthropic will repeat, such as an exhausted
  credit balance, an invalid request, or a reply that hit the output limit,
  falls back to OpenAI (`P5_PRICING_OPENAI_MODEL`, default gpt-4.1) for
  that stage; a billing block parks Anthropic for ten minutes so later stages
  go straight to OpenAI. On 2026-09-13 the Anthropic account reported
  "credit balance is too low", which had every pricing stage failing on all
  five sites until this fallback shipped.
- When every configured provider refuses, the job ends at once with a plain
  message (`PRICING_UNAVAILABLE`) instead of retrying for minutes; the
  project and contact details stay saved for follow-up.
- Output limits for pricing replies were raised from 14,000 to 24,000 tokens
  after a mapping stage hit the limit on an ordinary bathroom scope.
- Deadline, pending and stage-timeout errors are matched by name as well as
  class. On the live host the deadline error crossed a dynamically imported
  chunk and instanceof failed, so every pass that ended at its deadline was
  counted as a failure and jobs were marked failed after three passes.
- Each pricing stage logs its duration and outcome to stderr
  (`[p5-pricing] mapping finished in 41.2s`), readable in the Replit
  deployment log viewer.

## Verification

- `tests/p5-estimator-flow.test.ts` covers missing-field links, category
  breakdown, field questions, theme resolution, budgets, planning averages and
  the research fallback path.
- `scripts/p5-estimator-browser.mjs` drives the real page with mocked APIs at
  320 to 1920 px: talk to text, mixed typed and uploaded input, interrupted
  save and upload recovery, question flow, clarification retry, missing-field
  recovery, live progress, contact gate, category accordions, no pinned
  controls, single submission and result restoration.
- `scripts/p5-mobile-navigation.mjs` checks every estimator route for a single
  input, no pinned action and no horizontal overflow.
- Isolated SQL scripts (`scripts/test-p5-*.mts`) were updated to the grouped
  page reading and content-keyed pricing cache.

Live provider timing is recorded separately in the deployment report; the
synthetic checks above are not latency evidence.
