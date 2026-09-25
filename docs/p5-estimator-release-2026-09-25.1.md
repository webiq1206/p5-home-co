# Estimator release 2026-09-25.1: live acceptance on 24.3 and deterministic pricing corrections

Status: source release, committed to all five repositories. Not live until each Replit workspace pulls main and republishes; production verification of this release is recorded in the follow-up section at the end, which is empty until that happens.

## Starting point (verified 2026-09-25, morning)

- All five public sites reported release `2026-09-24.3` at `/api/p5-estimator/release` (Replit publish status: success on all five apps). Shared-file drift from boise-remodeling-co to the other four: 0 files.
- Local baseline on current main: TypeScript 0 errors in all five repositories; P5 full suite 1,322 tests / 0 failures; shared suites 709 (Remodeling), 715 (Construction), 717 (Handyman), 714 (Cabinet) / 0 failures; the eight isolated persistence, delivery, upload and PDF scripts exit 0.
- The previously reported Remodeling failure of `Anthropic-only configuration supports JSON and real tool-source extraction` does not reproduce on current main: it passes in every repository (P5 test 1029, Remodeling test 586). No test was changed or skipped to obtain that result.
- The Cabinet repository's main was red on commit 05ef845 (conversation-regression and document-adapter workflows): the tracked `public/pdf.worker.min.mjs` no longer matched the worker that `scripts/sync-pdf-worker.mjs` copies from the locked pdfjs-dist 6.3.289 during prebuild, so the test-time mutation gate failed. The regenerated worker is committed in this release.
- Two stray editor temp files (`lib/p5/*.ts.tmp.*`) were tracked in Remodeling and are removed.
- The scheduled GitHub "Recover unfinished estimator work" workflow is skipped in all five repositories because `P5_ESTIMATOR_RECOVERY_ENABLED` and `P5_ESTIMATOR_CRON_SECRET` are not set. Background completion does not depend on it (see the closed-browser case below); it is a second wake path for a deployment whose in-process driver was stopped.

## Live acceptance on release 24.3 (real sites, real providers, real delivery)

QA contact `[QA] ...` with the owner-connected inbox address `jb+p5qa@timberandlove.com`. Every customer email below was received in that inbox from the issuing brand's own address and carried the signed return link and the PDF.

| Site | Case | Outcome on 24.3 | Time (details / pricing) |
| --- | --- | --- | --- |
| Handyman | 100 LF owner-supplied MDF baseboard, contractor nails and caulk, no painting | P5-5FE1DBBB, $455 to $565. Labor line plus a positive $26 to $78 consumables allowance; owner-supplied baseboard excluded; no private cost note in customer text. Asked the project-type question (Home repairs / RE-10 / Change order / Rush). | 13.6 s / 39 s |
| P5 Home Co | Supply and install 200 SF LVP in one bedroom, remove carpet, exclude other trades | DEFECT. Issued as an "RE-10 repair estimate" at one firm price, $4,800. The reader returned service `re10` as a "stated" fact with the flooring sentence as evidence. Also a $1,474 "Dust / floor protection" package and a $737 substrate-grind line on a one-bedroom carpet-to-LVP job. | 14.1 s / 72 s |
| Cabinet | Install 10 LF owner-supplied base and 10 LF upper cabinets, contractor consumables | P5-05A682F4, $4,525 to $5,600. Consumables allowance present ($171 to $443). DEFECTS: asked which finish level to budget "for the unspecified selections" although the cabinets are owner-supplied; a $1,430 to $1,601 whole-house protection package on a 20 LF install. | 14.2 s / 61 s |
| Remodeling | Two 50 SF bathrooms, two 90 SF tiled showers with 15 SF floors, waterproofing, reconnect existing plumbing, nothing else | P5-221353F7, $32,100 to $34,900, both showers retained as separate assemblies. DEFECTS: "Boise home" and "Main home" invented as two buildings with separate totals; "reconnect the existing plumbing" priced as "Plumbing per fixture, rough + finish" at $3,148 per shower; a $866 to $1,619 junk-removal truckload on top of removal lines that already include haul-off. | 12.8 s / 182 s |
| Construction | Complete 600 SF detached ADU, slab, mini-split, utilities 20 ft away, owner's land | DEFECT. P5-74B5F055, $1,502,000 to $1,663,000, shown as partial with 16 items unpriced. The "ADU, new detached (600 SF)" complete assembly ($226k) was charged six times, once per component task (foundation, framing, HVAC, finishes, debris), plus a complete kitchen assembly ($72k) and whole-house plumbing and electrical inside it. | 9.8 s / 403 s |
| Handyman | Faucet and two shutoff valves; chose "Email me when it's ready" 6 s into pricing, then closed the browser | The wait choice appeared with the live ETA ("About 1 to 4 minutes left", stage "Building the scope of work"); the email request was confirmed ("You can close this page."); the estimate finished 46 s after the browser closed (P5-0D5434F8, $700 to $760) and the customer email arrived in the inbox. | 15.9 s / 46 s after close |

Security checks on the live Handyman estimate: the emailed link page loads (200); `POST /api/p5-estimator/open` with a tampered token returns 403; the same token against another estimate id returns 403; `GET /api/p5-estimator/draft` and `/pdf` without device credentials return 401.

## Source changes in 2026-09-25.1 (shared engine, edited in boise-remodeling-co and synced)

1. `lib/p5/serviceSignals.ts` (new): an RE-10, rush or change-order project type is accepted from the reader only when the customer's words carry the matching signal (inspection, RE-10, buyer, closing, urgent, ASAP, change order, under contract, and so on). `adaptive.ts` rejects an unsupported service fact and never offers it back as a "we found re10" confirmation; the type is asked instead. On a site whose whole menu is repair work (Handyman), a plain repair request defaults to home repairs (`scopeEndpoint.ts`) instead of asking the customer to pick "Home repairs" from four repair types; any signal keeps the question, and the type stays editable on the review screen.
2. `dynamicQuestions.ts`: no finish-level question for a cabinet installation whose cabinets are owner-supplied.
3. `lib/p5/pricingCorrections.ts` (new), applied in `scopePricing.ts` after the model's mapping and audit and before the integrity checks, each correction disclosed as an item to confirm:
   - a Project Assemblies (90-) line is priced once per building; a whole-unit assembly (new home, ADU, addition, suite, conversion) covers its own component lines and room assemblies, which are removed, and unpriced component tasks (roofing, insulation, envelope) count as covered by it instead of being carried out as "not priced"; site work, utility connections, permits, fees and design stay separate;
   - building labels the pricing step invented are removed when the customer described one building (`presentation.ts` also treats "Boise home" and "Main home" as one house);
   - a separate debris, junk-removal or dumpster line is removed when every removal line already includes haul-off and dump fees;
   - a "rough + finish" or "rough-in only" per-fixture package becomes a licensed-plumber-hour allowance (about 2 hours per fixture, disclosed) when the request reconnects to existing plumbing without relocating anything;
   - protection and cleanup added as supporting work are capped at about 15% of the priced work they support, as a disclosed allowance, when the catalog package they matched is sized for a whole house.
4. Prompt guidance for the inventory, mapping and audit stages: whole-unit requests are one task plus the work outside the unit; assemblies are added from exactly one task and never alongside their components; buildings only when the customer described several; reconnections are trim-out, not rough-in; supporting work is sized to the job; the audit names these as duplicated or oversized charges.
5. `ESTIMATOR_VERSION` advanced to `2026-09-25.1` so saved pricing results from earlier rules are not replayed. Shared manifest refreshed; 287 shared files synced to the four sibling repositories with brand-owned adapters untouched.

## Regression coverage added

`tests/p5-pricing-corrections.test.ts` (assembly once and component coverage against real book lines, kitchen assembly with a separate appliance allowance left alone, invented building labels dropped versus two named buildings kept, debris line removed only when removal includes haul-off, reconnection versus relocation, protection cap versus a proportionate cleanup line, and an ordinary estimate left byte-identical) and `tests/p5-service-signals.test.ts` (signal detection, the live P5 flooring-as-RE-10 case, the repair-only default). Cases added to the dynamic-question and presentation suites.

Local results after the change: TypeScript 0 errors in all five repositories; P5 full suite 1,334 tests / 0 failures; shared suites 715 (Remodeling), 720 (Construction), 722 (Handyman), 719 (Cabinet) / 0 failures; the isolated persistence, pricing-work, background, workflow and receipt scripts exit 0; house-style em-dash guard clean. Regression fixtures use synthetic replies; they do not establish production model behavior.

## Not changed on purpose

No rate, margin, contingency, policy setting, price-book amount or production schema was changed. No Replit Agent prompt was used. No secrets were read or written.

## Production verification of this release

Recorded after each Replit workspace has pulled main and republished; until then nothing in this release is live.
