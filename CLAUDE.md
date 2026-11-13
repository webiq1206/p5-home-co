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
* Owner switches, all off by default: `ESTIMATOR_QBO` (`create` or `send`) writes customers and estimates to QuickBooks; `ESTIMATOR_ADDRESS_AUTOCOMPLETE=on` enables public address suggestions (paid Google quota); `RENTCAST_API_KEY` enables property records (adapter not yet run against the live service).
* Recipes (typical dimensions and inclusions) are estimating rules awaiting owner sign-off. Bump `ESTIMATOR_RULES_VERSION` when one changes.
* Boise ADU Co stays `live: false` in `brands.ts` until its site exists.
