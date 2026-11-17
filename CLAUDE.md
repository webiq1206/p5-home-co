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
* Everything under "Understanding your estimate" is generated in `narrative.ts` from the priced scope and checked against it (`narrativeProblems`). Do not add freehand paragraphs. Work nobody has looked at yet is "not yet determined", not "excluded".
* Address suggestions use the Google key when one is set. Property lookup: county parcel record through boiseremodeling.co's lookup (parcel, jurisdiction, zoning, lot). Building facts in Ada County come from the Assessor's free published file, copied into `county_residence` and looked up by parcel (`county-records.ts`; it refreshes itself when over 16 days old, `POST /api/cron/county-records` forces it). The county forbids redistributing the file or using it as a mailing list. Canyon County has no such file, so those customers are asked. Never infer a building fact: two homes on one parcel report nothing, and a split-level with no basement area does not say "no basement". Outside Ada, `RENTCAST_API_KEY` (free plan: 50 requests a month, billed beyond) fills building facts: one request per address, remembered in `property_lookup`, and capped at 45 a month so it cannot produce a charge (`RENTCAST_MONTHLY_LIMIT` raises it on a paid plan). Verified live on 13 November 2026 (Canyon and Valley addresses); its bathroom counts looked wrong, so bathrooms are not read from it. Do not scrape listing sites for this: they forbid it and block servers. `ESTIMATOR_PROPERTY_LOOKUP=off` disables all of it.
* Every estimate a customer was shown a range for becomes a customer and an UNSENT, fully itemized estimate in QuickBooks (owner decision, 13 November 2026), budgetary ones included; withheld prices are not written. `ESTIMATOR_QBO=off` stops it. `send` is retired (16 November 2026) and behaves as `create`: a QuickBooks estimate prints every line amount, so the estimator never emails it to a customer. To share from QuickBooks, use an estimate form style with the Rate and Amount columns turned off, or send the estimator link. Only an estimate is created, never an invoice or project. QuickBooks needs one figure, so it gets the base price; the range goes on the estimate message and private note (`rangeNote`).
* Budgetary projects are priced from one whole-project cost book rate, and that rate is the price. `shares.ts` only spreads it across divisions in proportion to cost book component lines (owner left the method to us, 13 November 2026); it cannot change a total. The shares are internal; the customer sees the divisions of work and the one total, with a note that the divisions are not priced separately. The per-square-foot ratios in the profiles await owner review.
* Recipes (typical dimensions and inclusions) are estimating rules awaiting owner sign-off. Bump `ESTIMATOR_RULES_VERSION` when one changes.
* Boise ADU Co stays `live: false` in `brands.ts` until its site exists.
* Meta pixel (owner decision, 13 November 2026): browser pixel only, no Conversions API. The id comes from `NEXT_PUBLIC_META_PIXEL_ID` with no default (read at build time; unset means nothing loads and every helper is a no-op). `app/MetaPixel.tsx` loads it in production, on public paths only (`metaPixelAllowedOn` in `app/lib/metaPixel.ts`: never admin, portal, a private path or `/estimator/embed`) and never before the first interaction. The Meta `Lead` is sent only from `trackAcceptedInquiry` in `app/analytics.ts`, with a category and no contact details; brand sites count leads from the framed estimator themselves. Keep automatic advanced matching off in Meta Events Manager, or `app/legal/privacy/page.tsx` stops being true. Guard: `tests/meta-pixel.test.ts`.

## Shared document estimator (`lib/p5`, `/estimate/scope`)

The conversational scope and document estimator is published from here to every brand site with `scripts/p5-sync.mjs` (hash-checked; edit shared files here only). Scope and one total applies to it too (owner decision, 16 November 2026): `customerPresentation()` in `lib/p5/customerProjection.ts` is the one customer boundary, and it carries the scope, quantities and ONE price (the range, or a firm total) for the whole project. No line, unit, category, building or allowance price reaches the customer page, email, PDF or saved link, including estimates saved before the change, which are re-projected on every read. The internal record, the team email, the administrative PDF and the CRM payload keep every price (`record.internal`).

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
* Only estimates from the websites are linked to a lead (`guided_estimate.lead_deal_id`), so only those carry. Deletions from before 17 November 2026 are mirrored but never reach into QuickBooks (`carry: false`).
* QuickBooks unavailable: the cleanup is remembered on the lead's audit trail (`quickbooks_cleanup_pending`) and `settleRemovedLeads()` retries it from the watchdog, six hours apart, for a fortnight.
* Guard: `tests/removed-everywhere.integration.test.ts` (needs `TEST_DATABASE_URL`). Its fake QuickBooks refuses a filter on a field the real one does not index (`ParentRef` on a customer, found live on 17 November 2026); keep it that strict, and check a new QuickBooks query against the real API before trusting it.

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
