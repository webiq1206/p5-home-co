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
* "Request a quote" is the primary public CTA. The guided estimator at `/estimator` (owner brief, 13 November 2026) does give an online estimate; describe it as it is (preliminary, budgetary or fixed price) and do not use "instant" or promise a time.
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
* Brand sites frame `/estimator/embed?brand=<id>`; they do not copy the code.
* The customer sees a preliminary range, never one fixed price. The width is the owner's band rule in `lib/p5/pricing.ts` applied to the project's real risks (`narrative.ts`); division ranges always add up to the total.
* Everything under "Understanding your estimate" is generated in `narrative.ts` from the priced scope and checked against it (`narrativeProblems`). Do not add freehand paragraphs. Work nobody has looked at yet is "not yet determined", not "excluded".
* Address suggestions use the Google key when one is set. Property lookup: county parcel record through boiseremodeling.co's lookup (parcel, jurisdiction, zoning, lot). Building facts in Ada County come from the Assessor's free published file, copied into `county_residence` and looked up by parcel (`county-records.ts`; it refreshes itself when over 16 days old, `POST /api/cron/county-records` forces it). The county forbids redistributing the file or using it as a mailing list. Canyon County has no such file, so those customers are asked. Never infer a building fact: two homes on one parcel report nothing, and a split-level with no basement area does not say "no basement". `RENTCAST_API_KEY` is an optional paid fallback (adapter not yet run against the live service). `ESTIMATOR_PROPERTY_LOOKUP=off` disables all of it.
* Every estimate a customer was shown a range for becomes a customer and an UNSENT estimate in QuickBooks (owner decision, 13 November 2026), budgetary ones included; withheld prices are not written. `ESTIMATOR_QBO=off` stops it, `send` also emails line-by-line estimates that need no review. Only an estimate is created, never an invoice or project. QuickBooks needs one figure, so it gets the base price; the range goes on the estimate message and private note (`rangeNote`).
* Budgetary projects are priced from one whole-project cost book rate, and that rate is the price. `shares.ts` only spreads it across divisions in proportion to cost book component lines (owner left the method to us, 13 November 2026); it cannot change a total, and the estimate says the amounts are indicative shares. The per-square-foot ratios in the profiles await owner review.
* Recipes (typical dimensions and inclusions) are estimating rules awaiting owner sign-off. Bump `ESTIMATOR_RULES_VERSION` when one changes.
* Boise ADU Co stays `live: false` in `brands.ts` until its site exists.
