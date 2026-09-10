# P5 Home Co: P5 family visual audit, September 10, 2026

Site: https://p5homeco.com. Recorded routes for this repository: 13.

## Scope and review method

This work covers the public P5 marketing family, its shared page templates, imagery, forms, navigation, mobile actions, comparison components, and the Cabinet catalog. The recorded inventory contains 687 routes. Browser verification uses 320, 390, 430, 600, 768, 1024, 1366, 1440, and 1920 CSS pixels, representing small phones through large desktops. Browser viewports are 900 pixels high, with touch input enabled for the applicable small layouts.

The live production sites were inspected in a working browser. Candidate production builds were exercised in Chromium and captured across the recorded route inventory. Manual screenshot review covered the shared home, About, contact, service, city/service, article, guide, gallery, catalog, comparison, builder, warranty, form, menu, and footer layouts at multiple widths. The captures and automated checks cover more route/viewport combinations than the manual review. A captured screenshot is not a claim that every pixel of that route was independently approved by a human reviewer.

## Changes

- Restored the intended heading hierarchy while allowing explicit utility classes to control spacing, size, and color. Increased the shared default body size to 16 pixels.
- Replaced oversized stacked hero statistic panels with a compact, semantic facts group. Improved hero text contrast, image visibility, and heading measure without changing each business's palette or logo.
- Kept navigation on one line at larger widths and used the compact menu below 1440 pixels. Enlarged menu controls to at least 44 pixels, protected narrow logo/close-button layouts, and released mobile menu focus and scroll locks when moving to desktop.
- Kept mobile sticky actions opaque, high contrast, and aware of safe areas and forms. Added footer clearance and hid the assistant near mobile hero actions. Reduced narrow contact form padding and simplified the secondary estimator label.
- Kept balanced four-card layouts, widened narrow service introductions, and removed repetitive city-link thumbnails.
- Removed repeated hero images from article bodies and replaced unsupported completed-project captions with representative-image descriptions.
- Replaced Construction images that duplicated other brands or showed incorrect clothing branding. Varied the About-page supporting image.
- Corrected Handyman painting and door imagery, worker branding, image descriptions, and remaining references to an older door-repair image.
- Corrected 17 Cabinet article images plus related topic hubs that used unrelated rooms, empty spaces, or outdoor scenes without cabinetry. Existing cabinet, drawer, planning, and outdoor kitchen imagery now supports those topics. The exact mappings are recorded in the Cabinet repository.
- Updated the Cabinet build-time image generator so reviewed mappings persist through production builds, and synchronized Handyman’s generator with the reviewed images. Related representative image reuse is reported for review instead of forcing unrelated substitutes.
- Versioned the edited Handyman image URLs to refresh existing caches, and adjusted the painting photo’s focal point to retain sleeve branding.
- Served two already compressed WebP photos directly after their runtime optimizer requests stalled; checked the corresponding source files and rendering.
- Retained P5's individual company presentation while clarifying representative-image captions and improving their contrast.

## Before-and-after comparisons

One reviewed Remodeling kitchen comparison now uses the same source room and camera. The finish-refresh image retains the window, entry framing, rear door, ceiling lines, room dimensions, and appliance positions. Its 3:2 frame matches the paired assets. Short labels remain separate at 320 pixels. Mouse drag, touch drag, Home, End, and arrow keys are included in browser verification; handle edge positions and clipping are checked.

The comparison is explicitly identified as generated design imagery, not a completed customer project. The 20 mismatched legacy Remodeling pairs and six Cabinet concept pairs remain single representative images. They were not re-enabled as misleading transformations. Shared comparison code is also exercised through temporary CI fixtures on sites that do not currently publish a comparison. Those fixtures are created only inside verification jobs and are not public repository routes.

## Image provenance

Three image edits were generated and reviewed at full size during this work:

| Repository | Asset | Purpose |
| --- | --- | --- |
| boise-remodeling-co | `public/images/gallery/kitchen-refresh-design-after.webp` | Same-camera illustrative finish refresh, paired with `gallery-kitchen-before.webp` |
| Boise-Handyman-Co | `public/images/handyman/service-painting-p5-reviewed-20260910.webp` | Correct Handyman clothing branding and practical floor protection |
| Boise-Handyman-Co | `public/images/handyman/front-door-repaint-p5-reviewed-20260910.webp` | Finished painted door without an unbranded worker fragment |

The WebP files were decoded locally and their Git blob hashes were verified after transfer. Other substitutions use assets already present in the relevant repository. No new image is presented as a verified customer project or as evidence of a specific completed property. Related topic pages may share an appropriate representative image; unrelated projects are not grouped into a single property narrative.

## Integration and verification boundaries

The separate estimator-policy changes merged to main during the audit were incorporated before final delivery. Verification includes the combined production build and the existing estimator browser regression script. The visual work does not replace that policy or alter pricing logic.

API writes are intercepted in the browser audit so it cannot create real inquiries or send messages. Expected errors from those deliberately blocked writes are recorded separately from genuine browser errors. A test-only session key configures the isolated CI server; it is not a production credential.

Authenticated customer and staff records, real email/SMS delivery, production CRM persistence, real-device browser chrome, and physical-device safe-area behavior were not certified by this visual review. Device coverage uses browser viewport and touch emulation. Production domains will continue to show their previously published versions until the repository changes are pulled and republished.

## Final verification evidence

Verified production source: `ade01cf088d73087d1d93e459137e079fd1d800f`. [Production build and browser results](https://github.com/webiq1206/p5-home-co/actions/runs/34512633625).

- Production build and lint passed.
- All 13 recorded public routes passed at nine widths: 117 of 117 route checks.
- All 14 collected internal link checks passed.
- The merged estimator browser scenarios passed at all seven configured widths, including typed and simulated spoken scope, upload failure recovery, back navigation, contact preservation, restoration, and a single mocked submission.
- No document overflow, broken visible images, page exceptions, or unexpected console errors were reported in the completed route sweep.

`p5-route-verification-2026-09-10.csv` preserves the per-route results. `p5-interaction-verification-2026-09-10.json` records interaction checks and the mocked external-service boundary. Later changes in this delivery commit are these review records only.

The final P5 merge also preserves the separately merged notification, tracked-phone-link, and structured-data updates. No database migration or live CRM operation was executed by this visual audit.

The repository's `scripts/p5-visual-routes.json` records the route inventory. `p5-visual-review.mjs` captures routes, checks image loading, document overflow, browser errors, and internal link status. `p5-component-review.mjs` checks the shared interactive layouts. Cabinet additionally runs its catalog and product search scripts. GitHub Actions captures are retained for 14 days; this document and the route verification table preserve the durable summary.
