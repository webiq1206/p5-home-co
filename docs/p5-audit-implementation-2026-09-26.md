# P5 audit implementation status, 2026-09-26

## Release status

Draft implementation only. Do not merge or deploy until staging review and live integration gates below pass. This is a partial implementation of the 48-finding audit, not a claim that every page or recommendation is complete. Existing live sites and main branches have not been changed by this work.

## Implemented changes

Shared light estimator styling, clearer controls, evidence-aware finish provenance, a durable authenticated review-request endpoint and UI, and lazy embedded estimator loading. Child sites also receive focused accessibility and homepage copy changes, schema-hour normalization and removal of unsupported instant-result claims. Construction, remodeling and cabinet receive targeted permit-language corrections. Cabinet receives on-demand scroll-first catalog loading, clearer concept labels and selected answer improvements. Remodeling receives selected answer improvements. Brand identities and pricing engines are preserved.

## Required release gates

1. Render desktop and mobile previews, including keyboard, uploads, validation, loading, failure, review, results, sticky controls and navigation.
2. Test the new review endpoint against staging database permissions and configured brand email recipients. Confirm durable request retrieval by staff. The new table is created on first request. Do not deploy without this test.
3. Resolve the existing live construction/remodeling pricing failures using server logs. Recovery UI is not a root-cause fix.
4. Repeat builds and repository prebuild checks on the exact merge commit. Check generated content and existing CI.
5. Run live-estimator smoke tests only with explicit test data and no accidental customer submissions. Validate notifications before enabling the new handoff.
6. Remeasure mobile performance and accessibility. No improved Lighthouse or field scores are asserted.
7. Keep existing routes, canonical rules and indexability until traffic/backlink and business evidence supports changes.

## Validation performed

- Production Next builds passed for all five sites. Parent and remodeling builds preceded the last minor shared-test/handler and marketing-copy edits; subsequent type checks or shared tests do not replace an exact-commit rebuild.
- Independent TypeScript checks passed for all five sites.
- Canonical shared suite: 741 passed, 6 skipped before the new review-request tests.
- New review-request tests: 3 passed using isolated PGlite and fake email, with no live notifications.
- Parent targeted regressions: 24 passed.
- Cabinet content check: 94/94 passed.
- Final cabinet shared suite: 748 passed, 0 failed, 7 skipped. An earlier provider fixture allotted exactly 1000ms against a 1000ms dispatch guard and intermittently failed before dispatch. The fixture now permits 5000ms; production timing and behavior were not changed.
- Handyman generated llms-file consistency check passed.
- Browser could not reach the isolated local preview server. No post-change desktop/mobile screenshots, visual sign-off, real email delivery or live performance measurements were obtained.
- Full package prebuild pipelines were not run. Cabinet has no verify:llms script.
- No dependency versions, pricing rules, business facts, external business listings, main branches or production deployments were deliberately changed.

## Finding-by-finding register

### E01

Original finding: Both detailed sample scopes reached review but ended with an automatic-pricing failure. The alert asks the visitor to contact the team without an adjacent contact action.

Status: Partial: adjacent manual review flow added. Production pricing failure root cause remains unresolved; server logs and a live test are required.

### E02

Original finding: The embedded remodeling calculator is a dark panel inside a light section. All four standalone child estimators also use a dark application surface.

Status: Implemented in source: all brand estimator themes use light surfaces. Desktop, mobile and every interaction state still require visual approval.

### E03

Original finding: Text-only test produced the statement that the material basis came from uploaded documents. No document was uploaded.

Status: Implemented with regression tests: typed finish descriptions are no longer attributed to uploads. Document attribution requires matching uploaded evidence.

### E04

Original finding: Several pages promise an instant or 60-second result, while tested parsing states advertised 1 to 5 minutes and two runs failed.

Status: Partial: misleading instant/60-second marketing claims replaced across 41 files. Actual production latency is not improved or remeasured.

### E05

Original finding: Successful cabinet and handyman estimates use mailto links for project review. A visitor without an email app has no integrated handoff.

Status: Implemented in source with isolated database and fake-email tests: authenticated on-site review requests persist and deduplicate. Production database permissions, notification delivery and administration access must be verified.

### E06

Original finding: Child mobile initial screens have a large empty gap between examples and the composer. Continue is visually an arrow.

Status: Implemented in source: compact initial standalone layout and visible Send/Continue labels. Mobile keyboard, zoom and focus behavior remain unverified.

### E07

Original finding: Review and results contain many collapsed groups, allowances and assumptions. The tested handyman result included 14 items to verify and 19 planning assumptions.

Status: Open: prioritize cost drivers and assumptions and provide a tested expand-all experience.

### E08

Original finding: Exit promises saved progress, but persistence across devices, blocked storage, expiration and edits was not verified.

Status: Open: verify saved-draft restoration, expiry, blocked storage and device boundaries before making new persistence claims.

### D01

Original finding: Expressive homepage H1s omit the service and city. The visual identity is strong but purpose can take extra reading.

Status: Implemented in source: four child homepage H1s identify service and Boise while retaining brand styling.

### D02

Original finding: Nampa accent text is rgb(141,185,185) on rgb(241,237,228), about 1.84:1 contrast. Other child Lighthouse reports flag contrast too.

Status: Partial: darker brand text accents, estimator text and focus treatment added. Full rendered contrast audit remains open.

### D03

Original finding: Repeated promise, process, budget and CTA sections make long pages feel similar. Oversized editorial heroes delay direct answers.

Status: Open: page-by-page editorial and layout refinement requires rendered review.

### D04

Original finding: The captured calculator anchor placed the section heading partly behind the sticky header. Mobile lab screenshots show a fixed bottom CTA over the page.

Status: Partial: sticky-header scroll offsets and focused-field mobile CTA suppression added. Device testing remains open.

### D05

Original finding: The remodeling form requires project type, full name, phone, email and address before consultation. Similar form patterns appear across the family.

Status: Open: simplify existing contact forms only after checking lead requirements and integrations.

### D06

Original finding: The two hero CTAs route to the same /estimate destination.

Status: Implemented in source: handyman secondary hero CTA now links to contact/photos instead of duplicating estimate.

### D07

Original finding: Brands share layout and typography but can drift in CTA routes, guarantee terms and helper copy.

Status: Partial: shared estimator changes synchronized across all five repositories; broader brand content governance remains open.

### I01

Original finding: The sites rely heavily on repeated service images and representative concepts. Remodeling explicitly labels its gallery as inspiration.

Status: Blocked on authentic supplied project photography and permission to publish case details.

### I02

Original finding: The page says Proof of work and Projects & homeowner reviews while the project examples are labeled concepts and describe typical outcomes.

Status: Partial: cabinet concept-gallery claims and metadata clarified. Testimonial provenance still needs owner verification.

### I03

Original finding: Navigation says Design Ideas, while the URL is /testimonials and the page is explicitly inspiration.

Status: Deferred: preserve existing URLs until traffic, backlink and redirect decisions are supported.

### I04

Original finding: Additional imagery can help, but generated project or staff imagery can imply evidence the business cannot substantiate.

Status: No generated evidence imagery introduced. Any future concept imagery must be labeled and must not stand in for completed projects.

### S01

Original finding: Three brands publish closely aligned pages targeting the same repair transaction.

Status: Deferred: RE-10 ownership and redirects require Search Console, backlink and business-routing evidence.

### S02

Original finding: Both brands pursue additions with overlapping geographic landing pages.

Status: Deferred: additions ownership requires business and search data before consolidation.

### S03

Original finding: Many pages reuse service and process copy with city substitutions. Several also contain blanket county permit claims.

Status: Open: no mass deletion or redirects of city pages without URL-level evidence.

### S04

Original finding: Boise and Nampa examples incorrectly attribute city permit processes to county agencies. The same county wording recurs across many pages.

Status: Partial: shared construction/remodeling/cabinet permit templates now use address-dependent guidance and official Boise/Nampa links. Remaining bespoke county/trade claims need individual review.

### S05

Original finding: Displayed planning floors and detailed ranges use different scopes without always making the distinction prominent. Kitchen service shows $15k from-price; its detailed copy uses $37k to $47k mid-range; the guide lists $37k to $110k+ full kitchens.

Status: Open: pricing-scope examples and minimums require business-approved model evidence.

### S06

Original finding: Some Quick answers repeat a generic sentence that does not answer the actual title.

Status: Implemented in source: 13 generic quick-answer entries replaced with topic-specific cabinet/remodeling answers.

### S07

Original finding: Titles and descriptions exist, but targeting and duplication need editorial coordination across the family.

Status: Open: original keyword map remains a research brief, not a verified volume study or a blindly applied title rewrite.

### S08

Original finding: Many hub and city links exist. Additional links must clarify the journey instead of repeating every service-city combination.

Status: Partial: cabinet catalog adds useful HTML service links; comprehensive family linking remains open.

### S09

Original finding: All crawled img elements have an alt attribute, but many are empty. Some are intentionally decorative. Reused image alts sometimes claim service/location evidence.

Status: Partial: cabinet concept hero alt text clarified. Every content image still needs contextual review.

### S10

Original finding: All 654 candidate indexable pages are in XML sitemaps. Thirty noindex routes are absent. Four discovered legacy URLs redirect successfully.

Status: Preserved: no canonical, sitemap, indexability or route migrations introduced.

### S11

Original finding: Search is both robots-disallowed and has a noindex tag in fetched HTML. A blocked crawler may not see that tag.

Status: Deferred: robots/noindex decision needs index-status evidence.

### S12

Original finding: Several editorial titles and city-guide topics overlap within the family. Equivalent titles do not establish a ranking problem, but the editorial purpose needs coordination.

Status: Open: full cross-site editorial differentiation not completed.

### A01

Original finding: P5 parent schema uses Boise while child pages emphasize Meridian. Parent exposes a registration number; child footers say details available on request.

Status: Blocked on verified legal entity, address, registration, service-area and credential information.

### A02

Original finding: Structured data is already extensive and parsed successfully. Repeated FAQ, Speakable and business nodes should not be mistaken for proven AI visibility tactics.

Status: Partial: child business opening-hours schema normalized to HH:mm. Comprehensive entity consistency remains open.

### A03

Original finding: FAQPage and Speakable occur widely. Google ended FAQ rich results in May 2026, so this is not an available rich-result growth lever.

Status: No speculative rich-result expansion introduced. FAQ content should remain useful regardless of search presentation.

### A04

Original finding: The five robots files already allow major search and AI search agents on public content. No evidence supports adding an AI-only keyword layer.

Status: Preserved public crawler policy; no unsupported AI-only keyword or schema layer added.

### A05

Original finding: Representative imagery and organization-only bylines provide limited first-hand proof compared with documented jobs and named expertise.

Status: Blocked on genuine named expertise and documented project evidence.

### T01

Original finding: Mobile Lighthouse performance scores range from 47 to 61 and LCP from 8.0 to 13.3 seconds. Desktop scores are 76 to 99. No field CrUX data was returned.

Status: Open: no post-change Lighthouse/Core Web Vitals measurements available; no performance improvement claimed.

### T02

Original finding: Homepage diagnostics report unused JavaScript, legacy JavaScript, render-blocking resources and image savings. Catalog mobile score is 43 with 12.5 s LCP.

Status: Partial: embedded estimator loads near viewport; cabinet PDF viewer loads on request and flip library loads only in flip mode. Measure actual impact before release claims.

### T03

Original finding: Many source img tags omit explicit dimensions or srcset; counts include SVG logos and CSS-sized images, so they are not all defects. Lighthouse specifically flags P5 dimensions and image delivery.

Status: Partial: new catalog preview has dimensions; existing image inventory still needs rendered review.

### T04

Original finding: Cabinet homepage Lighthouse accessibility is 94 and flags prohibited ARIA; other children score 97 with contrast flags. High scores are not full accessibility conformance.

Status: Partial: cabinet star-summary ARIA and shared focus styling corrected. Full keyboard and assistive-technology testing remains open.

### T05

Original finding: No Search Console, analytics, CRM outcomes or field performance access was available.

Status: Blocked on analytics, Search Console, CRM and field-measurement access.

### C01

Original finding: The 45-page catalog is a PDF-style viewer with tiny controls on the mobile lab render. Its contents are largely absent from the initial accessible page text.

Status: Partial: on-demand catalog, scroll-first viewing and crawlable service links added. Mobile control sizing and full visual QA remain open.

### C02

Original finding: The product depth is useful but the homepage superlative Idaho's premier needs support. Specs and lifetime shorthand need clear evidence and qualification.

Status: Blocked on manufacturer-approved specifications, warranties and substantiation of superlatives.

### P501

Original finding: P5 has a clear family-routing role. The fifth specialist, Boise ADU Co, appears as launching soon and is outside the five audited domains.

Status: Open: confirm ADU launch status and destination before changing family routing.

### H01

Original finding: The service page describes small-patch planning prices while a broader test scope produced $2,700 to $3,325 and nearly $1,000 in Other Project Work. Scope differs, so this is not proof of overpricing.

Status: Open: scope/minimum pricing explanation requires approved estimate-model examples.

### H02

Original finding: Trade-specific pages need a clear boundary between handyman tasks and work performed by appropriately qualified trades.

Status: Open: verify trade qualifications and permitted-work boundaries with the business.

### B01

Original finding: The construction journey has useful scope detail but needs stronger evidence of completed builds and parcel-specific expertise.

Status: Blocked on real construction case studies, parcel evidence and publication approval.

### R01

Original finding: Strong visual service pages need clearer practical answers about disruption, living at home, owner-supplied items and phased work.

Status: Partial: practical guidance added to selected editorial quick answers; full service-page decision panels remain open.
