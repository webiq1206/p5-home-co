# Claude Code Project Instructions

This repository contains the approved P5 Home Co website. Treat the current visual design and responsive behavior as the source of truth.

## Project goals

P5 Home Co must read as the operating parent company behind Boise Construction Co, Boise Remodeling Co, Boise Cabinet Co, and Boise Handyman Co. Boise ADU Co projects currently run through Boise Construction Co; its site is coming. Each company needs a distinct identity while remaining part of one cohesive home-service family.

## Copy voice rules (family fix plan)

* Sentence case headings. No "near me" in body copy or headings.
* Search phrases stay in the title tag and at most one subheading.
* No phone number, city list or caveat in any hero paragraph (phone may sit under the CTA).
* No em dashes anywhere on the site.
* Numbers only where the owner can defend them. Leave square-bracket fact gaps unfilled.
* The instant estimate is the primary public CTA on every family site (owner decision, 13 November 2026, replacing the earlier "Request a quote first, never say instant" rule). Buttons read "Get an instant estimate"; the header, menu and sticky bar use the short "Instant estimate". "Request a quote" stays as the second path to a person. Wording must stay accurate: it is an instant PRELIMINARY estimate, a price range shown on screen. Never call it a quote, a bid or a final price, never give a number of minutes, never promise how fast a person replies, and never say no contact details are needed (name, email and phone are asked before the range is shown). `tests/response-language.test.ts` still bans "instant quote".
* Accents never carry small body text. Primary buttons are charcoal with paper text and a tan accent bar.
* Imagery (owner, 13 November 2026). Photos must look like real, natural photographs of real work: daylight, true color, nothing staged. No stock-photo props (fruit bowls, bread, flowers, vases, plants, candles, baskets) and no golden glow. Never show a Craftsman-style house (tapered columns, stone column bases, rafter tails, gable brackets) for a remodel, new build or anything else; homes are plain contemporary. The estimator option images in `public/estimator/img` follow this.

## Preserve unless the user requests a change

* Page hierarchy and section order
* P5 Home Co wordmark and visual identity
* Company brand logos and color treatments
* Typography, spacing, imagery, and section transitions
* Desktop, tablet, and mobile layouts
* Sticky navigation and mobile menu
* Company matcher
* External company links and telephone links
* Accessibility labels and keyboard controls

## Development workflow

Use `npm run dev` for local development. Run `npm run lint` and `npm run build` before considering any change complete.

Keep the existing Next.js App Router structure. Avoid adding dependencies unless a requested feature requires them.

## Guided estimator (`/estimator`)

One customer estimator for every brand, built on the scope platform. Code: `app/lib/estimator`, `components/estimator`, `app/estimator`, `app/api/estimator`. Guard: `tests/guided-estimator.test.ts`.

* It has no pricing of its own. Selections become a scope document and `priceScope()` prices it from the cost book. Never put a dollar figure in `recipes.ts`; a test fails if one appears.
* The customer view is built by `customerEstimate()` and must never gain a cost, margin or cost code field.
* Brand sites frame `/estimator/embed?brand=<id>&project=<id>` from their `/instant-estimate` page with `components/estimator/EstimatorFrame.tsx`, a file kept identical on every site; they do not copy estimator code. The frame tells the estimator how much screen there is (`p5-estimator-viewport`), the estimator reports its content height and its events back, and each site maps those events to its own analytics. Which projects a site offers is its `projects` list in `brands.ts`: change one brand's list and no other site moves.
* The customer sees a preliminary range, never one fixed price. The width is the owner's band rule in `lib/p5/pricing.ts` applied to the project's real risks (`narrative.ts`); the internal division ranges always add up to the total.
* Scope and one total (owner decision, 16 November 2026). Customers see the full scope of work organized by division and ONE price range for the whole project: no line item, unit or division price anywhere a customer can see it (results page, saved link `/estimator/e/<token>`, customer email). `CustomerDivision` has no price field; `publicEstimate()` in `types.ts` re-projects every stored view on read, so estimates saved before the change lose their division prices too. The team keeps everything: `internalReport()`, the team email, the scope platform and QuickBooks stay fully itemized. Guard: `tests/guided-estimator.test.ts`.
* After the estimate (owner request, 16 November 2026): the results screen, the saved link and the confirmation email all invite the customer to adjust the estimate, ask one question ("Anything else on your list?", which fits every project type) with the family note for that brand, and offer "Schedule now" to the HubSpot booking calendar. The words live in `app/lib/estimator/family.ts` and the link in `app/lib/leads/scheduleLink.ts`; every QuickBooks estimate the platform builds prints the same link in its memo. The cross-sell is always a question, never a pitch. Guard: `tests/lead-confirmation-email.test.ts`.
* One team email per estimate (owner request, 16 November 2026). `teamReport()` in `emails.ts` is the lead alert and the internal report in a single message, built for a phone: one filled Call button with Text and Email beside each other, then the records grouped by system so they never read as a wall of buttons (HubSpot deal and contact; QuickBooks estimate and customer record, with a line saying it is unsent and whether the customer was created or matched; P5 scope and lead, plus a link to what the customer sees), then every cost, price and margin in tables of three columns at most. `deliver.ts` sends the estimator's lead through the intake with `skipLeadAlert: true`, so the separate "New lead" email is not sent for estimates, and neither is the "Request added" note a repeat estimate from the same person would send; every other form keeps both. The subject must not start with "New lead": the inbox sync mirrors that mail into HubSpot, and costs and margins stay out of HubSpot. Guard: `tests/guided-estimator.test.ts`.
* One layout for every team email, from every site (owner, 17 November 2026). The estimate email has no per-brand branch, and a test renders it for every brand and project. The "New lead" email that request forms and ad leads produce (`renderLeadAlert()` in `app/lib/notifications/lead-created.ts`) uses the same pieces: one filled Call, Text and Email side by side, records grouped under HubSpot and P5. Change one and change the other; `tests/lead-alert-email.test.ts` fails if they drift.
* One team email per request from a brand site (owner, 17 November 2026). A brand site's request form posts to `/api/leads/intake` with `team_alert: "confirm"`: the "New lead" (or "Details added") email is sent before the answer and the answer carries `alert` (`sent`, `failed`, `none`). The site sends its own team email only when the answer is not `sent`, so a lead never ends with no email. `team_notes` are the site's team-only lines (planning range, parcel, dashboard link): printed in the email under "From the website" and not stored on the lead. The email is copied into HubSpot by the inbox sync, so `readTeamNotes()` withholds any line naming a cost, margin, markup, profit, contingency or overhead, whichever site sent it. Internal figures travel in `team_internal_notes` instead (owner, 17 November 2026: cost and margin stay in the one email): they print under "Internal pricing" and switch the subject to "Lead and pricing: ...", which the inbox sync does not copy (it copies only a subject starting "New lead"; the test runs the real `classify()`). `team_alert: "site"` is the document estimator's own value (it has already emailed the team; see "The document estimator's leads"). Contract: `docs/lead-intake-contract.md`. Guard: `tests/lead-intake-confirm-alert.test.ts`.
* Everything under "Understanding your estimate" is generated in `narrative.ts` from the priced scope and checked against it (`narrativeProblems`). Do not add freehand paragraphs. Work nobody has looked at yet is "not yet determined", not "excluded".
* Address suggestions use the Google key when one is set. Property lookup: county parcel record through boiseremodeling.co's lookup (parcel, jurisdiction, zoning, lot). Building facts in Ada County come from the Assessor's free published file, copied into `county_residence` and looked up by parcel (`county-records.ts`; it refreshes itself when over 16 days old, `POST /api/cron/county-records` forces it). The county forbids redistributing the file or using it as a mailing list. Canyon County has no such file, so those customers are asked. Never infer a building fact: two homes on one parcel report nothing, and a split-level with no basement area does not say "no basement". Outside Ada, `RENTCAST_API_KEY` (free plan: 50 requests a month, billed beyond) fills building facts: one request per address, remembered in `property_lookup`, and capped at 45 a month so it cannot produce a charge (`RENTCAST_MONTHLY_LIMIT` raises it on a paid plan). Verified live on 13 November 2026 (Canyon and Valley addresses); its bathroom counts looked wrong, so bathrooms are not read from it. Do not scrape listing sites for this: they forbid it and block servers. `ESTIMATOR_PROPERTY_LOOKUP=off` disables all of it.
* Every estimate a customer was shown a range for becomes a customer and an UNSENT, fully itemized estimate in QuickBooks (owner decision, 13 November 2026), budgetary ones included; withheld prices are not written. `ESTIMATOR_QBO=off` stops it. `send` is retired (16 November 2026) and behaves as `create`: a QuickBooks estimate prints every line amount, so the estimator never emails it to a customer. To share from QuickBooks, use an estimate form style with the Rate and Amount columns turned off, or send the estimator link. Only an estimate is created, never an invoice or project. QuickBooks needs one figure, so it gets the base price; the range goes on the estimate message and private note (`rangeNote`).
* Budgetary projects are priced from one whole-project cost book rate, and that rate is the price. `shares.ts` only spreads it across divisions in proportion to cost book component lines (owner left the method to us, 13 November 2026); it cannot change a total. The shares are internal; the customer sees the divisions of work and the one total, with a note that the divisions are not priced separately. The per-square-foot ratios in the profiles await owner review.
* Recipes (typical dimensions and inclusions) are estimating rules awaiting owner sign-off. Bump `ESTIMATOR_RULES_VERSION` when one changes.
* Boise ADU Co stays `live: false` in `brands.ts` until its site exists.
* Meta pixel (owner decision, 13 November 2026): browser pixel only, no Conversions API. The id comes from `NEXT_PUBLIC_META_PIXEL_ID` with no default (read at build time; unset means nothing loads and every helper is a no-op). `app/MetaPixel.tsx` loads it in production, on public paths only (`metaPixelAllowedOn` in `app/lib/metaPixel.ts`: never admin, portal, a private path or `/estimator/embed`) and never before the first interaction. The Meta `Lead` is sent only from `trackAcceptedInquiry` in `app/analytics.ts`, with a category and no contact details; brand sites count leads from the framed estimator themselves. Keep automatic advanced matching off in Meta Events Manager, or `app/legal/privacy/page.tsx` stops being true. Guard: `tests/meta-pixel.test.ts`.

## Shared document estimator (`lib/p5`, `/estimate/scope`)

The conversational scope and document estimator is published from here to every brand site with `scripts/p5-sync.mjs` (hash-checked; edit shared files here only). Its project requests and published estimates become P5 leads: see "The document estimator's leads". Scope and one total applies to it too (owner decision, 16 November 2026): `customerPresentation()` in `lib/p5/customerProjection.ts` is the one customer boundary, and it carries the scope, quantities and ONE price (the range, or a firm total) for the whole project. No line, unit, category, building or allowance price reaches the customer page, email, PDF or saved link, including estimates saved before the change, which are re-projected on every read. The internal record, the team email, the administrative PDF and the CRM payload keep every price (`record.internal`).

## HubSpot sync (`app/lib/integrations/hubspot*.ts`)

Every lead reaches HubSpot, and a deletion in HubSpot is never a failure (owner decision, 17 November 2026). The team deletes spam and junk in HubSpot as a matter of routine.

* A deal deleted in HubSpot is mirrored: the P5 lead is closed as "Removed in HubSpot" (a deal already won stays won), its alerts and tasks are settled, and nothing is recreated. `mirrorRemovedDeal()` in `hubspot-removed.ts` is the one place this happens; the lead sync, the stage read-back and the task sync all call it.
* The one time a deleted deal comes back: the customer writes in again after the deletion (`shouldRecreateDeal()` compares the latest submission with HubSpot's `archivedAt`). A new request from a closed lead already makes a new P5 lead, because the intake only matches open ones.
* A task deleted in HubSpot is dismissed (`dismissRemovedTask()`), never made again. A contact deleted in HubSpot is made again when its lead is still being sent.
* No lead is held back. An email address HubSpot rejects goes in without that field, with the address as typed at the top of the deal description. The old "review" holds (`hubspot_lead_review`, `hubspot_archive_review`) are released or settled on the next pass and no new ones are written.
* A HubSpot stage P5 has no name for (one the team added there, such as "Job Complete") is left alone in both directions: reading it changes nothing here, and a push never drags the deal back to a P5 stage.
* `integration_health` says `failed` only for a real failure (a request HubSpot refused or could not answer). Do not make a deleted or unknown record a failure again.
* A deal the team merged in HubSpot is archived too, and is not a deletion: `mergedInto()` finds the surviving deal (`hs_merged_object_ids`) and the lead follows it, or closes as a duplicate when another lead already has it.
* Guards, which need `TEST_DATABASE_URL` (a throwaway Postgres with `tools/migrate.ts` applied): `tests/hubspot-removed.integration.test.ts` and `tests/hubspot-tasks.integration.test.ts`.

## Deletions carry across HubSpot and QuickBooks (`app/lib/leads/removed-everywhere.ts`)

Owner decision, 17 November 2026: junk deleted in one system is removed from the other. `CROSS_SYSTEM_DELETE=off` turns it off. QuickBooks is the accounting record, so the rules are narrow; do not widen them without the owner.

* HubSpot deal deleted: `mirrorRemovedDeal()` closes the lead, then `removeLeadFromQuickBooks()` deletes the QuickBooks estimates the website estimator made for it, through `deleteProjectEverywhere()`. Only a proposal is deleted (unsent, sent and unanswered, declined or closed). Accepted, invoiced or paid work is kept and noted once on the project.
* A QuickBooks customer is only made inactive when nothing else is on it in QuickBooks (checked live: estimates, invoices, sales receipts, payments, credit memos, refunds, active sub-customers) and no other project here uses it. QuickBooks has no customer delete.
* QuickBooks estimate deleted by a person (`onEstimateDeleted` from the webhook, or a refresh that finds it gone): the HubSpot deal is deleted, and a contact with no other deal, only when it was the lead's last live estimate, the lead is not won, and either nobody has worked the lead (still "New Lead", no contact attempt, no appointment) or the QuickBooks customer was removed too. An estimate deleted to be redone on a live lead leaves HubSpot alone, and says why on the project's event log.
* A deletion this platform made itself never comes back round: it marks the estimate deleted before QuickBooks reports it.
* Only estimates from the websites are linked to a lead, so only those carry: the guided estimator's (`guided_estimate.lead_deal_id`) and site estimates (`scope_project.lead_deal_id`). Both links are read in one place, `app/lib/leads/estimate-links.ts`; do not query either table for this anywhere else. Deletions from before 17 November 2026 are mirrored but never reach into QuickBooks (`carry: false`).
* QuickBooks unavailable: the cleanup is remembered on the lead's audit trail (`quickbooks_cleanup_pending`) and `settleRemovedLeads()` retries it from the watchdog, six hours apart, for a fortnight.
* Guard: `tests/removed-everywhere.integration.test.ts` (needs `TEST_DATABASE_URL`). Its fake QuickBooks refuses a filter on a field the real one does not index (`ParentRef` on a customer, found live on 17 November 2026); keep it that strict, and check a new QuickBooks query against the real API before trusting it.

## Stage alignment across QuickBooks, the lead and HubSpot (`app/lib/leads/stage-alignment.ts`)

Owner decision, 17 November 2026: the QuickBooks estimate, the P5 lead and the HubSpot deal move together, in both directions. The lead is the hinge: an estimate's status moves the lead and the existing HubSpot sync carries it on; a lead closed in HubSpot or in the P5 admin sets its estimate in QuickBooks. `STAGE_ALIGNMENT=off` turns all of it off; `STAGE_ALIGNMENT_QUICKBOOKS_WRITE=off` turns off only the writes to QuickBooks. Only estimates from the websites are linked to a lead (the guided estimator's and site estimates, both read through `app/lib/leads/estimate-links.ts`); anything else is left alone. QuickBooks is the accounting record, so the rules are narrow; do not widen them without the owner.

QuickBooks to the lead (`onEstimateStatusApplied()`, called at the end of `applyEstimateStatus()` in `scopes/store.ts`, the one place every estimate status passes through):

| Estimate status | Lead stage |
|---|---|
| created_unsent | Estimate in Progress, only once a person has worked the estimate |
| sent | Estimate Sent |
| accepted, converted, paid | Closed Won |
| declined | Closed Lost, reason "Estimate declined in QuickBooks", only when the lead has no other live website estimate that is unsent, sent, accepted, converted or paid |
| closed, deleted, not_created, unavailable | no change |

* The estimate the website creates by itself moves nothing. It is made the moment a visitor finishes, before anyone has contacted them, and the lead must stay "New Lead": that is the column the team works from in HubSpot, and the "untouched" test in `removed-everywhere.ts` (a deleted spam estimate still removes its HubSpot deal) depends on it. Do not change that test. An unsent estimate counts as worked (`estimateWorked()`) when a staff member created it from the scope platform (`scope_estimate.created_by`) or when QuickBooks has saved it again since it was created: its SyncToken is above "0", which a staff revision here and an edit in QuickBooks both cause. One save is not a person's: a site estimate revised by the website itself because the visitor sent new figures (`savedByWebsiteOnly()` in `site-estimate.ts`, which knows the SyncToken that write left). The lead stays where it is for that one, and the next save by anyone counts.
* Open stages only move forward (by position in `DEAL_STAGES`). A lead at Closed Won is never moved. A lead at Closed Lost is won by an acceptance and by nothing else, and not when it was closed as removed or merged (`REMOVED_IN_HUBSPOT`, `MERGED_IN_HUBSPOT`, `REMOVED_IN_QUICKBOOKS`): those stay closed.
* The stage is written in one UPDATE with an audit row `stage_aligned_with_quickbooks`, and the lead goes `pending` so the HubSpot sync sends it. Nothing is written, and nothing audited, when the stage would not change.
* Paid in full (`onQuickBooksTxn()`, called from `upsertTxn()` for invoices and payments, because a payment does not touch the estimate): the lead is Closed Won and the HubSpot deal moves to the pipeline stage labelled "Job Complete", looked up by label. P5 has no such stage and must not gain one; the read-back leaves it alone and a push never drags the deal back. It is done once (`hubspot_deal_job_complete`), not at all when the pipeline has no such stage or the team has put the deal in another stage of their own, and it waits while another accepted estimate on the lead is unpaid.

The lead to QuickBooks (`onLeadStageChanged()`, called by `pullHubSpotLeadActions()` and by `logOutcomeAction()` after their transactions, only when a lead moves INTO a closed stage):

* Closed Won: exactly one live estimate that is unsent or sent is set to Accepted, and `settleAccepted()` creates its QuickBooks project as it does for an acceptance made in QuickBooks. More than one open estimate writes nothing and asks a person to choose (`quickbooks_estimate_choice_needed`, and an event on each project). An estimate already accepted or invoiced means nothing is written.
* Closed Lost: every live estimate that is unsent or sent is set to Rejected. Not when the lead was closed as removed or merged (the deletion rules own those) or as "Estimate declined in QuickBooks" (it came from QuickBooks). An accepted, invoiced, paid or closed estimate is never touched.
* A lead that is reopened never changes QuickBooks.
* Every estimate is read live from QuickBooks before anything is decided, and written with the SyncToken of that reading. A stale token means someone saved it in between: it is read once more and written only if it is still open. Each write is audited (`quickbooks_estimate_status_set`) and stored through `applyEstimateStatus()`.
* QuickBooks unavailable, or HubSpot not taking "Job Complete": remembered on the lead's audit trail (`quickbooks_stage_pending`, `hubspot_job_complete_pending`) and `settleStageAlignment()` retries from the watchdog, six hours apart, for a fortnight.
* It does not loop: a stage set from QuickBooks is `pending` until pushed, and the read-back only reads `synced` leads; a status this platform wrote comes back through rule A as a no-op; a lead lost by a QuickBooks decline or won by a QuickBooks acceptance finds nothing open to write.
* Guards: `tests/stage-alignment.integration.test.ts` (needs `TEST_DATABASE_URL`) and `tests/stage-alignment.test.ts` (the rules as pure functions, and the hooks). The fake QuickBooks refuses an update with a stale SyncToken and a query on a field the real one does not index; keep it that strict. The sparse status update (`Id`, `SyncToken`, `sparse`, `TxnStatus`, `CustomerRef`) was run against the real QuickBooks on 17 November 2026: a labelled test deal moved to Closed Lost in HubSpot set its estimate to Rejected in under four minutes, lines and total unchanged, and the deal did not bounce. The stale-token answer and the Accepted write have only met the strict fake; `tests/qbo-sandbox.integration.test.ts` has the check (it needs sandbox credentials).

## Site estimates into QuickBooks (`app/lib/leads/site-estimate.ts`)

Owner decision, 13 and 17 November 2026: every estimate a website gives a visitor becomes a customer and an UNSENT estimate in QuickBooks, not only the guided estimator's. `SITE_ESTIMATE_QBO=off` turns it off. QuickBooks is the accounting record, so the rules are narrow; do not widen them without the owner.

* Two sources, one function. A brand site's request form with a planning range sends it as `estimate` on `/api/leads/intake` (`readSiteEstimate()` in `intakeContract.ts`; contract and example bodies in `docs/lead-intake-contract.md`). The document estimator calls in from `syncCrm()` in `lib/p5/deliveryAdapter.ts`, after its lead is saved (`documentSiteEstimate()` maps the record; nothing is sent for a QA record, and `P5_CRM_DELIVERY` still decides whether that lead exists at all). A brand site's document estimator posts the same figures as `estimate` of kind `document` (see "The document estimator's leads"). Both end in `createSiteEstimate()`. The guided estimator keeps its own path (`estimator/deliver.ts`) and never comes through here: the intake queues nothing for a caller with `skipLeadAlert`.
* Customer prices only. No cost, margin, markup, profit, contingency or overhead figure is read, stored or sent: the lines have `cost: null`, and the test's fake QuickBooks fails on any write that names one. Only an estimate is created, never an invoice, a payment or a project, and it is never sent.
* The estimate is the lines. With lines, the total is their sum, and a `base` that disagrees by more than a cent is replaced and noted. Without lines it is one line at `base` (default: the midpoint), titled from `label`. QuickBooks refuses a line whose amount is not quantity times rate, so a quantity is kept only when it divides the amount to the cent. After creation the QuickBooks total is checked against `base`; a difference is recorded as a failed `site_estimate_created` and never hidden.
* Ceilings a hostile post cannot pass: nothing above $5,000,000, nothing above $500,000 unless the site says `verified: true`, and nothing whose total does not belong to its range. The intake has no caller authentication, so `verified` is the site's word, not proof.
* Never a duplicate. One scope project and one QuickBooks estimate per lead and `kind`, found or made under the lead's row lock, with the QuickBooks writes keyed by project (`qboWrite`). A repeat, a merged Step 2 or a retry changes nothing and does not call QuickBooks. A lead that already has a guided estimate gets its site estimate as a separate project. The customer follows the guided rule, in one shared function (`linkOrCreateCustomer()` in `scopes/qbo.ts`): linked on the same email or phone, otherwise created.
* Different figures of the same kind revise that estimate, only while it is exactly as the website left it: unsent, saved by nobody but the website, unchanged in QuickBooks, and the project's version still the website's. Otherwise nothing is changed and the new figures go on the lead's audit trail. What a person deleted is not made again from the same figures; new figures from the customer make a new estimate. Nothing is made for a closed lead.
* The scope project is a record, not a scope: its version is built by hand from the customer lines (`siteEstimatePricing()`, basis `site-estimate`, no tasks). The scope platform prices from tasks, so its Pricing tab is empty for these and "Create estimate" stays blocked until someone builds a real scope there; `reprice()` in `scopes/engine.ts` leaves such a version alone, so saving Pricing setup does not replace it with an empty one. Do not add tasks to make it price: there is no cost behind these lines.
* QuickBooks item per line: `SITE_ESTIMATE_ITEMS`, by brand, and by division only when it is named exactly (Permits, Design, Freight and the like). Awaiting owner review; change the table, not the callers.
* Deletion and stage rules apply unchanged through `estimate-links.ts`. The estimate the website creates moves nothing, and neither does its own revision (see stage alignment).
* It runs after the response, last, never on the visitor's path and never before the team email. Nothing throws into a caller. Audit rows on the lead: `site_estimate_created`, `site_estimate_revised`, `site_estimate_skipped` (with the reason, said once), and `site_estimate_pending` when QuickBooks was unavailable, which `settleSiteEstimates()` retries from the watchdog, six hours apart, for a fortnight. The retry reads the estimate from that row and the person from the lead.
* The lead page (`/admin/lead/<id>`) lists the lead's website estimates under "QuickBooks estimates", each linking to its scope project and to QuickBooks. The team email is sent before the estimate exists, so it does not link to it.
* `scope_project.lead_deal_id` is migration 032. Until a database has it, `estimate-links.ts` reads the guided link alone, so the deletion and stage rules keep working.
* Guards: `tests/site-estimate.integration.test.ts` (needs `TEST_DATABASE_URL`) and `tests/site-estimate-contract.test.ts`. The fake QuickBooks returns the first record for a repeated request id, allows a display name once, checks every line's item and arithmetic, and applies an update only with the current SyncToken; keep it that strict. None of this has run against the real QuickBooks yet: check it in the sandbox before the brand sites start sending `estimate`.

## The document estimator's leads (`lib/p5/p5LeadIntake.ts`)

Owner decisions, 13, 17 and 18 November 2026: what the document estimator (`/estimate/scope`, all five sites) takes from a visitor reaches the P5 lead system. The public flow is a project REQUEST with no price (`PUBLIC_PROJECT_MODES` is `review` everywhere); the team prices it later and publishes the estimate. Both become ONE lead.

* The request. Its `crm` delivery channel saves a lead and, through the existing sync, a HubSpot deal in the first stage: brand is the PRIMARY TEAM it was routed to, form `p5-project-request`, id the request's lead key (`envelope.leadKey`, one per project across revisions). No price, so nothing goes to QuickBooks. On p5homeco.com that is `ingestLead()` in process (`lib/p5/intakeDeliveryRuntime.ts`, `intakeInboundLead()` in `lib/p5/intakeCrmValidation.ts`); a brand site posts to `/api/leads/intake` with the shared `p5LeadIntakeTransport()`. On while `P5_CRM_DELIVERY` is `on`.
* Only requests saved since `PROJECT_REQUEST_LEADS_SINCE` (18 November 2026) are sent. Older requests were still waiting on the CRM channel and would all have arrived in HubSpot at once as new leads. `P5_REQUEST_LEADS_SINCE` (an ISO moment) brings older ones in on purpose; do not move the constant back.
* The published estimate. p5homeco.com keeps `syncCrm()` in process (`lib/p5/deliveryAdapter.ts`); a brand site's `syncCrm()` calls the shared `forwardEstimateToP5()`, which posts `estimate` (kind `document`). The figures come from ONE function for both, `documentEstimate()` in `lib/p5/documentEstimateFigures.ts` (`documentSiteEstimate()` only reshapes it): customer amounts only, the lines add up to the contract price to the cent. Change the figures there and nowhere else.
* One lead per project. The estimate carries the request's lead key (`request_external_id` on the intake, `requestExternalId` on `ingestLead()`), and `findExistingDeal()` attaches it to the lead that holds that key under any brand, because the request's brand (primary team) need not be the publishing site's. Only a key in the `p5-intake-<sha256>` format is looked up this way. The key comes from the record's `projectId`, stamped at publication (`manualReview.ts`, `submitEndpoint.ts`). A different project has a different key and is never swallowed by a closed lead.
* One team email. The document estimator emails the team itself (the request's `team` channel, the estimate's internal record), so both posts say `team_alert: "site"` and the intake sends none and answers `alert: "none"`. It is believed only for form `p5-project-request`, or form `p5-estimator` beside a readable `estimate` of kind `document` (`siteSentTeamEmail()`); anything else is emailed as usual. The intake has no caller authentication: `"site"` can only withhold an email. Saving a lead in process sends no email either.
* A synthetic QA record never becomes a live lead on either path. A repeat is a duplicate (one lead, no email, nothing new for HubSpot), which is why a failed request post may be retried for two hours (`P5_LEAD_RETRY_WINDOW_MS`).
* The canonical review receiver (`canonicalReview*.ts`, `/api/external/project-reviews`) is NOT used for this and stays gated (`INTAKE_RUNTIME_PROOF.crm`, `CANONICAL_RECEIVER_PROOF`). Its deals have no P5 lead, so none of the lead rules would reach them. Do not activate it.
* Nothing `lib/p5/intakeDeliveryRuntime.ts` imports at load time may reach outside `lib/p5`. The isolated harnesses (`scripts/test-p5-*.mts`) copy `lib/p5` to a cache directory and replace the adapter, so a static import chain into `app/` breaks them (it failed CI on 18 November 2026). The lead system is loaded on demand: `runtimeIntakeTransports()` loads `intakeCrmValidation.ts` with `import()` before it builds the channel, which keeps `validate` synchronous; where it cannot be loaded the channel reports `configuration-missing`. A brand adapter loads the forwarder the same way (`await import('./p5LeadIntake.ts')` inside `syncCrm`), because the shared reply-to test runs the adapter in a VM with a fixed dependency list. Guard: the import walk in `tests/project-request-lead.test.ts`.
* The keyed CRM contract of the old lead dashboard (`lib/p5/keyedCrm.ts`: one POST with an idempotency key, one authenticated reconciliation, never a replay) is tested directly in `tests/p5-crm-delivery.test.ts`, on every site, and no longer through a brand's `syncCrm()`.
* `lib/p5/p5LeadIntake.ts` and `lib/p5/documentEstimateFigures.ts` are shared files: they import nothing outside `lib/p5`, and are published with `scripts/p5-sync.mjs`. Contract: `docs/lead-intake-contract.md`. Guards: `tests/p5-lead-intake.test.ts` (shared, fake fetch), `tests/lead-intake-confirm-alert.test.ts`, `tests/project-request-lead.test.ts`, `tests/site-estimate-contract.test.ts` and `tests/site-estimate.integration.test.ts` (needs `TEST_DATABASE_URL`). Tests use a fake fetch; never post a test to a live intake.

## QuickBooks line wording and division tracking (owner, 17 and 18 November 2026)

Two rules for every estimate and invoice in QuickBooks, whoever creates it: this platform, a person, or an assistant session working through an API.

* No division in front of a scope line. A description never opens with "Div 05 |", "Div 00 Plan |", "Division 12:" or anything like it. The division already shows on the line as its product or service (hand-built project estimates use the "Div NN ..." items) or on the platform's division heading row, so a prefix prints it twice. `withoutDivisionPrefix()` in `app/lib/scopes/divisions.ts` removes one leading label from everything the platform writes: `lineText()` in `scopes/estimate.ts` (every estimate line) and the sales lines in `finance/qbo/map.ts`. It needs a number and a separator, so ordinary wording is never cut. Guard: `tests/scope-platform.test.ts`.
* Per-division tracking is never lost, on any project, now or later. QuickBooks tracks a division by the line's item and class, so a fix to wording changes `Description` only: keep `ItemRef`, `ClassRef`, quantity, rate and amount. Never merge division lines into fewer lines, never swap a division item for a generic one, and never rebuild an estimate into contract categories, even when a contract prices the job in fewer groups. Show the reconciliation in a note instead.
* Project invoices are progress invoices. QuickBooks links an invoice to its estimate only when the invoice is created from the estimate on screen; the API cannot create that link. Once the link exists the API can correct an invoice: send every line back with its `Id` and its `LinkedTxn` and the link survives (verified live on 17 November 2026). Bill a percentage of every line when the contract defines a payment as a share of the whole price, and fix the cents on one line so the invoice equals the contract figure.
* No connected tool can edit an estimate: there is no estimate update action, and the batch action answers 500 for an Estimate. Estimate wording is corrected by a person in QuickBooks, or on each invoice after it is created.
* Open, owner's call: an estimate this platform creates carries its division as a heading row and uses cost-type items (`P5_ITEMS`), so QuickBooks cannot report those jobs by division. The cost book divisions (00 to 33 and 90, `divisions.ts`) and the QuickBooks "Div 00" to "Div 23" items are different lists. Mapping one to the other needs the owner's crosswalk; do not invent it.

## Image alt text is local (owner, 19 November 2026)

Every content image on a public page carries an alt in the form
"<work> in <city>, Idaho: <what the picture shows>", built by `localAlt()` in
`app/localAlt.ts`. The served photographs get it in `app/imageVariants.ts`
(each with its own work: custom home building, kitchen remodeling, home
repairs, ADU construction and so on), the quote pages read those, and the
homepage tiles, brand panels and hero pass their own. Boise is the default
place; an alt that already names its place ("in Meridian, Idaho") is left as
written.

* No qualifier word (idea, concept, representative, inspiration, possibilities,
  rendering) in an alt or in a label beside a photograph. The homepage rooms row
  is labelled "Kitchens, living spaces and baths". Never claim a photograph is a
  completed customer job either: labels name the subject and nothing more.
* New content images go through `localAlt()`, never a bare string.
* Brand marks keep an empty alt where their written name sits beside them.
* The guided estimator's option photographs take "<option>, home project
  estimate in Boise, Idaho". That is an alt only: no estimator logic changed.
* Guard: `tests/local-alt.test.ts`. `tests/image-variants.test.ts` pins one alt
  in the new form.

## Publishing to Replit: never approve a DROP

Replit's Republish compares the development database with production and
proposes a migration for the difference. A development database that is behind
makes Replit offer to `DROP TABLE` live tables. On 13 November 2026 this nearly
deleted a real customer estimate on p5homeco.com: the code was pulled and
published without the step below.

Every time, in this order, in the Replit workspace:

1. Pull the latest `main` into the workspace. Redeploy ships the workspace, not GitHub.
2. Run `npm run db:migrate` against the DEVELOPMENT database, so it matches the schema in migrations/*.sql.
3. Republish, and read the database step before approving. Approve only "no
   changes" or `CREATE` and `ADD COLUMN` lines you expect.
4. If it shows `DROP` or anything destructive, cancel and stop. Do not publish.

This applies whoever does the pull: a person, Replit's assistant or Claude.
Never run a schema command against the live database. The same checklist is in
`replit.md`, which Replit's assistant reads.
