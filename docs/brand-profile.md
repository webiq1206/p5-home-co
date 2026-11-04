# P5 Home Co brand profile

Profile version: 1.1, source adoption recorded 2026-11-04. Last approved: no separate profile approval date is recorded. Current explicit owner directions govern the changes they cover; this profile records existing source and those directions, without granting a new exception or certifying the implementation. Source of truth: this file for P5 rules, the complete Website Design Quality Version 2.3 master and implementation rules, Organic and AI Search Visibility Version 1.0.2, and the concrete source/assets below.

## Identity, audience and purpose

P5 Home Co is the parent company for the specialist home-service brands serving Boise and the Treasure Valley. Public origin: `https://p5homeco.com`; legal name: P5 Home Co LLC. Homeowners should understand which team fits their project, get an immediate company recommendation, and reach the appropriate quote or contact path. The source homepage headline is “Boise’s home specialists.” The primary action is “Request a quote” at `/quote`.

The four linked child websites are Boise Construction Co, Boise Remodeling Co, Boise Cabinet Co and Boise Handyman Co. Boise ADU Co is a project-routing identity whose public destination is Boise Construction Co. A logo and `/quote/adu` do not establish a separate launched ADU website. Construction handles detached ADU work; conversion routing must preserve the actual P5 intake/specialist rules rather than imply that every ADU-related project has the same destination.

Sources: `app/site.ts`, `app/publicIdentity.ts`, `lib/familyBrand.ts`, `app/HomePageClient.tsx`, `app/quote/services.ts` and `app/quote/options.ts`. Historical integration documents are dated and contain conflicting status statements; they do not authenticate current live accounts or delivery.

## Visual character and ownership

Warm, architectural and editorial: generous paper surfaces, deep neutral bands, serif display headings, restrained sans-serif body text and purposeful architectural photography. Compose adjacent sections together. The owner requested imagery or an effective image/text split to interrupt long text-heavy sequences; a background-color change alone does not satisfy that direction. Retain useful service-area links and the surrounding reading order.

The related brands share typography roles, component behavior, responsive mechanics and the root-owned family chrome. P5 owns its name, logo, tan/bronze accents, photographs, content, service routing and `lib/familyBrand.ts`. Current family source is guarded by `lib/family/manifest.json` and `scripts/verify-family-chrome.mjs`; transport the exact approved file list, preserve ownership/provenance, and do not copy unrelated engine files. P5-owned presentation is in `app/globals.css`, `app/family-adoption.css`, `app/quote/quote.css` and `app/legal/legal.css`.

## Logos and source assets

- Dark artwork on light backgrounds: `public/brands/p5-home-co-lockup-dark.svg`; light artwork on dark backgrounds: `public/brands/p5-home-co-lockup-light.svg`.
- Corresponding icon artwork: `public/brands/p5-home-co-icon-dark.svg` and `public/brands/p5-home-co-icon-light.svg`. Use the supplied favicon, touch-icon and pinned-tab assets rather than redrawing the mark.
- The lockup source/configuration is approximately 251.24 by 50 (configured 251 by 50). Preserve its proportions, complete artwork and appropriate background variant. Header/footer sizing is controlled by family chrome; the configuration dimensions are not a minimum-size or clear-space approval.
- Provenance receipt: `docs/branding-20261028.json` records the Library archive identity, original archive path and SHA256 for each supplied asset. The receipt's filename is not an inferred approval date. No separate numeric logo clear-space/minimum-size specification was found; obtain the authoritative asset guideline before inventing one.

## Color roles

These values come from `app/globals.css`, `styles/family-tokens.css` and `lib/familyBrand.ts`. P5 globals load after shared tokens; family chrome loads afterward, with site reconciliation in `app/family-adoption.css`. Respect that cascade instead of treating a shared fallback as P5's accent.

| Role | Current P5 value and use |
|---|---|
| Background / surface / paper | `#fbfaf6` |
| Alternate background / bone | `#f1ede4` |
| Primary text / ink | `#20231f` |
| Muted text / ink-2 | `#343934` |
| Border | `rgba(32, 35, 31, 0.15)` |
| Primary page accent / bronze | `#a58c72` |
| Brand accent / tan | `#ceb391`; existing parent control details |
| Heading accent | `#a58c72`; exact approved logo/icon bronze, through `--color-heading-accent` |
| Accent ink / secondary accent | `#705a45`; readable bronze ink |
| Standard header/menu/footer chrome | `#383837`, selected by the later explicit charcoal PR instruction |
| Content charcoal / moss / forest fallback | `#383837` / `#233029` / `#383837`; moss retains its existing role |
| On-dark foreground | `#fbfaf6`; muted `rgba(251, 250, 246, 0.8)`; border `rgba(251, 250, 246, 0.18)` |
| Success / warning / error | `#2f5d45` / `#8a6a2f` / `#8a3b2f` from P5 globals |

`--terracotta` is a legacy P5 variable name whose value is tan `#ceb391`; it does not authorize a terracotta parent palette. Child accent colors identify their own company panels only: Construction `#c48d3f`, Remodeling `#7d9479`, Cabinet `#659b9a`, Handyman `#c56b4a`, ADU `#c97c99`. Do not substitute a child accent for the parent CTA or general P5 identity. Final contrast and all open/focus/menu states require rendered checks.

## Typography, spacing and layout

`app/layout.tsx` loads Cormorant Garamond (400/500/600/700) and Manrope with `next/font/google`. `--font-display` is Cormorant Garamond with serif fallbacks; `--font-sans` is Manrope with sans-serif fallbacks. Shared display weight is400. Use actual loaded-font evidence during review, not the declared family name alone.

The current family role decision uses phone below640px, tablet640–1023px, desktop1024px and up; wide layout begins1280px. Existing marketing hero size stays shared and fluid. Equivalent marketing/interior roles use the following source tokens; protected task geometry needs its own fit evidence.

| Role | Phone / tablet / desktop | Line height; tracking |
|---|---|---|
| Hero | `clamp(42px, 11.5vw, 56px)` / `clamp(56px, 8.5vw, 80px)` / `clamp(68px, 7vw, 116px)` | 1.02, desktop0.98; `-0.03em` |
| Editorial display | 36 / 52 / 64px | 1.05; `-0.02em` |
| Ordinary H1 / feature title | 32 / 44 / 52px | 1.1; `-0.02em` |
| Ordinary H2 | 28 / 36 / 40px | 1.15; `-0.01em` |
| Content/card H3 | 22 / 26 / 28px | 1.2; `-0.01em` |
| H4 | 18 / 20 / 20px | 1.3; zero |
| Body | 17 / 18 / 18px | 1.6; zero |
| Caption | 14 / 15 / 15px | 1.5; zero |
| Eyebrow | 13px | 1.3; `0.06em` |
| Navigation / button | 15 / 16px at each tier | 1; zero |

Use `--fs-*`, `--lh-*`, tracking and stack tokens. An editorial section headline may use the display role while remaining semantically H2. Preserve the approved hero scale and intentional task hierarchy; do not apply a universal descendant `!important` text floor.

The spacing scale is4,8,12,16,20,24,32,40,48,64,80,96,128px. Content max is1280px; ordinary reading measure is65ch. Phone/tablet/desktop gutters are20/32/48px, with the narrow-phone16px gutter below360px defined in shared tokens. Section padding is64/80/96px; compact32/48/48px; feature80/96/128px. Card padding is24px on phone/tablet and32px desktop; grid gaps20/24/32px. Heading stack16px, desktop20px; CTA stack24px, desktop32px. Use deliberate full-bleed photographs with aligned text containers and balanced actual item counts.

Family controls/cards are square; input/choice radius is4px. P5's existing site-owned page controls/cards use4px radii and retain legacy48px choice minimums in protected forms, while family adoption scopes56px choice tiles to family components. This is an observed source difference, not a newly approved waiver of Version2.3's56px choice-card minimum; record any remaining input fit/corrective work explicitly. Current page shadows are `0 1px 2px rgba(0,0,0,.06)` and `0 4px 12px rgba(0,0,0,.08)`; borders remain restrained. Do not change protected input geometry as part of unrelated marketing work.

## Photography, illustration and writing

Use relevant architectural scenes, materials, rooms, landscapes and craft detail. Source image variants and descriptive alts are centralized in `app/imageVariants.ts`; the homepage hero uses `FEATURED_BOISE_EXTERIOR`, and the dining/kitchen/bath sequence uses `DRIVE_DINING_ROOM`, `DRIVE_KITCHEN` and `DRIVE_PRIMARY_BATH`. Preserve supplied dimensions, responsive variants and meaningful crops. Keep every visible person's complete head in every crop; inspect the actual image bytes and all responsive masks. An asset's filename, “featured” identifier or presence in the repository does not prove a completed P5 customer project, identity, rights or result.

The owner expressly removed generic-scene presentation caveats, new-brand/first-project announcements and requests for references. Describe what the viewer can see without replacing those caveats with invented completed-work claims. Preserve substantive design/concept services and necessary scope, safety, pricing and legal explanations. Fake staff images and unproven project totals, founding-year, rating, warranty, fabrication and satisfaction claims remain disabled through `app/publicClaims.ts`. `app/quote/proof.ts` has an empty testimonial list; do not seed it with examples.

Write direct, natural customer-facing language about the work, fit, scope and next action. Nick Perkins may appear naturally in his founder biography. Do not publish representative/storefront administrative labels or registration-lookup instructions. Keep the registration itself useful and neutrally labelled.

## Navigation, controls and interaction

The header links to companies, the P5 standard, About and service area. Current P5 desktop navigation starts1024px. Keep the real primary `/quote` destination and the existing company-specific links. Header and footer use the same unboxed Call/Text/Chat icon vocabulary, standard charcoal and accessible contrast/focus; verify actual availability rather than drawing a nonworking chat icon.

Contact identity is owned by `app/publicIdentity.ts`: `(208) 477-1169`, `tel:+12084771169`, `sms:+12084771169`, `hello@p5homeco.com`, and Idaho Registered Contractor #8381215. Public hours from `lib/businessHours.ts` are Monday–Friday9am–6pm, Saturday9am–4pm Mountain, Sunday closed. Service area is Ada and Canyon counties, including Boise, Meridian, Eagle, Nampa, Kuna, Star, Middleton, Caldwell and Garden City. The source Facebook and Google Business Profile links belong to P5; do not assign them to child brands without evidence.

Chat opens with the `p5:chat-open` event in `components/SiteChat.tsx`; it is unavailable on `/admin*` and `/portal*`. Opening the panel is distinct from sending a note or creating an inquiry. The mobile action bar is hidden over the homepage hero, yields to estimator/chat/matcher body flags and is suppressed on configured task/private routes. Preserve route-specific chrome/estimator exceptions and actual header/bar/footer clearance.

Shared minimum targets are44px, primary controls48px and family choices56px; permit growth for enlarged text. Nominal header heights are64px on phones and76px from640px, with actual safe-area geometry measured once. Motion uses200/300ms shared durations and the existing easing tokens; respect reduced motion. Some older page transitions remain180ms; this source observation is not a blanket override approval. Verify hover, focus, pressed, selected, validation, disabled, open/closed and restoration states.

## Proof inventory and current flows

| Input or artifact | Source and qualification |
|---|---|
| Five company identities | `app/site.ts` and homepage cards; includes ADU routed through Construction. This is a taxonomy count, not five authenticated live websites or completed-work evidence. |
| Nine cities served | Exact `citiesServed` array in `app/site.ts`; service-area scope, not a count of customers/jobs. |
| One-business-day reply | Existing homepage/intake promise; no measured response-time dataset was inspected for this profile. |
| Registration8381215, bonded/insured, written scope, permits where required | Source-stated identity/process in `app/publicIdentity.ts`, homepage and `app/quote/proof.ts`. Fresh official registration/certificate/operational evidence was not independently obtained in this documentation task. |
| Company finder | `components/CompanyFinder.tsx`; a deterministic project-to-company recommendation with no email gate, no financial calculation and no claim of a project outcome. |
| Reviews/completed-project artifacts | Testimonials are empty and unproven flags remain off. No new authenticated customer case study, outcome dataset or job-photo provenance is supplied by this adoption. |

| Flow | Purpose, source steps and result/destination |
|---|---|
| Homepage company finder | Choose one of five goals, immediately show the company/reason, offer the actual child destination or matching P5 quote path, and allow reset. ADU's external destination is Construction. `components/CompanyFinder.tsx`. |
| Homepage project matcher | Goal/company → project type → recommended company with links and a Back path. `ProjectMatcher` in `app/HomePageClient.tsx` manages dialog focus/Escape/restoration and the mobile-bar yield flag. Recommendation precedes contact; persistence and every fit/state require actual review. |
| Quote/request and callback | `components/ShortRequestForm.tsx`: request mode takes a note, name, phone, conditional email/contact preference and optional files; callback mode takes name/phone and optional time. It saves the request first, then attaches files. Optional preparation details on the saved-request screen add project, address, timing, files/email to the same request and can be skipped. Draft state uses session storage. API paths under `/api/leads/short-request`, including `/files` and `/details`, are protected writes; no submission is authorized by this profile. |
| Service quote pages | Seven distinct `/quote/{service}` routes preselect valid project routing from `app/quote/services.ts`/`options.ts`. They are noindex/follow and canonicalize to `/quote`; retain their service content and context. `/quote/thanks` is a separate noindex/follow page. |
| Dedicated estimator tools | `/estimate/p5-preview` and `/estimate/scope` are distinct noindex/nofollow screens using `components/P5Estimator.tsx` with their own contact/exit chrome. Source supports scope/files, adaptive clarification, result/revision, recovery/handoff and document/delivery states. Exact active branch/steps and generated results depend on runtime inputs/provider state; no fixed-step, accuracy, delivery or current fit claim is established here. Preserve the engine, saved drafts, signed links, outputs, pricing and integrations. |
| Chat | Note → contact → sent presentation in `components/SiteChat.tsx`; a real submission creates an inquiry. Preserve routing, validation, consent and analytics; safe panel inspection is not delivery verification. |

The normal public inventory is17 direct UI paths plus the `/estimate`301 alias to `/quote`, not18 distinct rendered pages. Preserve the two noindex estimator tools, seven service variants, two known `/quote?project=...` states, error triggers and public discovery/vCard/manifest/license resources in separate route/state ledgers. The old207-route sister-site visual fixture is not P5's inventory.

## Public information, preservation and review gates

Do not expose a street address or precise home coordinates through page copy, footer, map, schema, vCard or discovery resource. Hidden text and JSON-LD remain public. Preserve accurate private Google verification records and verified service-area setup; do not modify account access or GBP records from a website copy task. The actual owner-only hidden-address setting and service areas still require their own verification.

Protect quote/callback/chat routing and optional detail/upload behavior, inquiry deduplication and accepted-conversion semantics, GA/Ads attribution and hostname guards, HubSpot/script boundaries, lead storage/notifications, estimator/provider/document interfaces and private admin/portal functions. Their source presence does not establish live connection or delivery. No real leads, provider calls, messages, credentials/access changes or paid expansion are authorized as tests.

Accepted design screenshots: no final accepted screenshot set for the current expanded family scope is recorded in this profile. Earlier narrow-route or homepage baselines establish their own versions only. Current role/charcoal/contact/service-area work requires exact-head before/after evidence, complete affected route/state coverage, actual loaded type and crops, independent F4 review in all ten dimensions, F5 refinement, functional gates and exact-head CI before merge. Viewports include320x568,360x640,390x844,430x900,768x1024,1024x768,1280x720,1440x900,1920x1080 and changed intermediate breakpoints; record stress, keyboard, menu, focus and sticky states separately.

Rejected patterns: the owner rejected imagery/status caveats, administrative contact/address blocks, boxed Call controls, inconsistent family type and header/menu/footer colors, and long adjacent text-only sections without purposeful visual interest. The source review also rejects generic/generated scenes presented as completed customer work, fabricated proof, blanket `!important` text floors and stale route fixtures. These are instructions/findings, not invented dated screenshot approvals.

Page-specific exceptions: existing quote pages lead with the request form; dedicated estimator screens own their contact/exit/task geometry and suppress competing chrome. These existing implementations do not grant a new C3/C10/D2 fit waiver. Record the exact applicable owner instruction or permitted standard exception, required correction attempts and measured result; no new blanket exception is created by this document.

Missing validation remains explicit: final independent rendered review and role equality; all route/query/error/resource and stress states; protected input no-regression and actual OS keyboard/physical-device evidence; authenticated completed-work/review/certificate artifacts; measured response outcomes; exact live integration/delivery and deployment identity; private GBP service-area configuration; separate ADU project/source binding. Mark unperformed or blocked checks honestly rather than infer an aggregate pass.

Jared owns Git import and publication. Source work, commit, review, CI, merge, import/publication and live verification are separate records. No profile adoption, local screenshot or successful merge establishes a public release. Keep the established release owner and recovery path; verify the exact live revision only after the authorized owner acts.


### November4 narrow-header and menu implementation record

Canonical source `boise-remodeling-co` revision `fa720a579b696af92861fb571fa0aff043e734b0` restores the complete approved SVG below360px in a logo row above the unboxed contact/menu controls. Normal320px prototype height is89px including the border; use the actual measured header/safe-area height, not a fixed clearance. Enlarged text may grow it. Normal360px-and-up header geometry is unchanged. Mobile-menu Call/Text/Chat contact controls are transparent and borderless at rest, retain visible focus and existing destinations/capability, and use the same icons as header/footer. This records the owner-requested consistency repair, not a new identity or approval exception. The independently reviewed prototype is narrower evidence than each final built site; retain exact-head rendering and functional gates.

### November 4 heading accent alignment

The latest explicit owner direction requires heading pop colors to match each site’s supplied logo/icon. P5’s four approved SVG lockups/icons use `#A58C72`, verified against `docs/branding-20261028.json`; heading emphasis therefore uses `--color-heading-accent: var(--bronze)`. The former tan `#CEB391` hero treatment and paper-mixed hero tint are superseded for headings. Existing CTA and normal-text/focus ink roles remain separate. Exact bronze gives 3.049:1 on paper and 3.686:1 on the approved `#383837` charcoal, suitable for large heading text, but 2.726:1 on bone and less than 4.5:1 for ordinary text. Use a qualifying existing neutral context for any affected smaller or bone-ground accent; do not alter the hue or typography to manufacture a pass. Canonical shared hero transport, exact-revision rendering and independent visual/contrast review remain required; source edits are not a rendered acceptance record.
