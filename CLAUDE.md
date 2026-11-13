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
* The customer sees a preliminary range, never one fixed price. The width is the owner's band rule in `lib/p5/pricing.ts` applied to the project's real risks (`narrative.ts`); division ranges always add up to the total.
* Everything under "Understanding your estimate" is generated in `narrative.ts` from the priced scope and checked against it (`narrativeProblems`). Do not add freehand paragraphs. Work nobody has looked at yet is "not yet determined", not "excluded".
* Address suggestions use the Google key when one is set. Property lookup: county parcel record through boiseremodeling.co's lookup (parcel, jurisdiction, zoning, lot). Building facts in Ada County come from the Assessor's free published file, copied into `county_residence` and looked up by parcel (`county-records.ts`; it refreshes itself when over 16 days old, `POST /api/cron/county-records` forces it). The county forbids redistributing the file or using it as a mailing list. Canyon County has no such file, so those customers are asked. Never infer a building fact: two homes on one parcel report nothing, and a split-level with no basement area does not say "no basement". Outside Ada, `RENTCAST_API_KEY` (free plan: 50 requests a month, billed beyond) fills building facts: one request per address, remembered in `property_lookup`, and capped at 45 a month so it cannot produce a charge (`RENTCAST_MONTHLY_LIMIT` raises it on a paid plan). Verified live on 13 November 2026 (Canyon and Valley addresses); its bathroom counts looked wrong, so bathrooms are not read from it. Do not scrape listing sites for this: they forbid it and block servers. `ESTIMATOR_PROPERTY_LOOKUP=off` disables all of it.
* Every estimate a customer was shown a range for becomes a customer and an UNSENT estimate in QuickBooks (owner decision, 13 November 2026), budgetary ones included; withheld prices are not written. `ESTIMATOR_QBO=off` stops it, `send` also emails line-by-line estimates that need no review. Only an estimate is created, never an invoice or project. QuickBooks needs one figure, so it gets the base price; the range goes on the estimate message and private note (`rangeNote`).
* Budgetary projects are priced from one whole-project cost book rate, and that rate is the price. `shares.ts` only spreads it across divisions in proportion to cost book component lines (owner left the method to us, 13 November 2026); it cannot change a total, and the estimate says the amounts are indicative shares. The per-square-foot ratios in the profiles await owner review.
* Recipes (typical dimensions and inclusions) are estimating rules awaiting owner sign-off. Bump `ESTIMATOR_RULES_VERSION` when one changes.
* Boise ADU Co stays `live: false` in `brands.ts` until its site exists.

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
