# P5 pricing cutover: implementation and acceptance record

Status: reviewed foundation candidate only. Do not activate or publish from the synthetic results.

## Input and authority

The canonical P5 workbook supplies rates, class rules and approved cost inputs, not its historic unit sell references. Read the precise live worksheet ranges with unformatted values via an authorized private connection, pin a source revision/hash, preview without publishing, and write a new immutable version only when validation and the authenticated release approval succeed. A malformed draft must not move the active pointer. Historical releases and the already-issued estimate receipt stay immutable. Rollback adds a new activation record for an already approved snapshot.

The workbook reader is a pure compiler only. The credentialed read, draft queue/administrator controls, proof-bound promotion, Quote Calculator replacement, and server/client adapters are not included. New catalog codes or changed measurement, division, trade, or policy shape require a validated metadata path; do not silently carry forward unrelated flags or invent rates. Internal costs, validated role hours and the separate $125 customer price each need their own evidence. Never count payroll or allocated overhead twice. Compare the new all-project services direction against the old all-in Handyman rule with approved hours and no duplicate coordination recovery, before switching the Handyman route.

## Route inventory and unresolved wiring

| Surface | Current pricing route or implementation | Required acceptance |
| --- | --- | --- |
| Quote Calculator / Quote Items | Workbook-side formulas; historic book references in Cost Book | Same approved quote receipt, live rates, stable input IDs, no emailed draft pricing |
| P5 guided / embedded | `app/lib/estimator/price.ts` → `app/lib/scopes/pricing.ts` | Resolve one release per request; receipts include line items and hashes internally |
| Scope Creator and Estimate Creator | `app/lib/scopes/engine.ts` → `app/lib/scopes/pricing.ts` → `app/api/scopes/[id]/estimate` | Frozen scope and release, no auto-reprice before export; only allowed actors |
| Family documents, manual, planning | `lib/p5/submitEndpoint.ts`, `scopePricing.ts`, `projectPricing.ts`, `pricing.ts`, per-brand planning and admin tools | Retain scope/quantity extraction, submit to shared pricing; include receipt in async jobs and caches |
| RE-10 | Handyman guided frame plus document `P5Estimator defaultService="re10"`; local repair recipes and floor helper; legacy `/api/re10/estimate` is retired | Central prices for both supported paths without reactivating retired API; preserve visit rules and line evidence |
| Boise Construction | Guided, plan-job finalize millwork and measured-cost calculators, consult/assistant/admin rate paths | Trace each active price output and remove local sell calculations |
| Boise Remodeling | Guided, takeoff classify and bid, plan ranges, consult/assistant/admin rate paths | Pin one version for each; line parity on mixed remodeling scope |
| Boise Cabinet | Guided, design wizard, quote or consultation, assistant, room/plan tools; old calculate API is retired | Separate supply/install eligibility. Apply correct class and public range redaction. Do not reactivate retired API |
| Boise Handyman | Guided, RE-10 and local service/takeoff paths | Central quantities and visit/small-work controls, repaired exact-head browser CI |
| ADU | P5/Construction shared route, separate Boise ADU not verified live | Attached/conversion and detached scenarios; no standalone launch |
| QBO | Guided and website automatic paths plus manual Scope Creator QBO handoff | Approved revision only; proof of correct sandbox realm, project, items, tax, line amounts, total and idempotent retry; no customer send |
| Customer/private exports | Guided and document pages/confirmation email/PDF; internal admin/QBO | Customer scope by division + one total range only; internal full quantities, costs, rates, fees, version and total |
| Wonderly | Separate workbook Pilot and Draw Check | Keep outside direct estimates and QBO; no fee activation |

## Controlled proof before cutover

1. Capture the current served build and line total baselines on all five domains. Do not mistake Replit serving status or the compiled version endpoint for the active database release.
2. Run routine, complex, retail and installed cabinets, qualifying and nonqualifying builder, mixed remodel, both RE-10 routes, ADU and controlled fixed/passthrough/minimum/allowance cases. Compare each item, scope identity, unit, quantity, direct/fixed fees and costs, shared costs once, rounding, displayed range and release receipt; preserve mutually exclusive scopes.
3. Test trusted eligible 15% concession, below-floor rejection, denial for unapproved internal and public actors, and unchanged accepted estimates. Do not derive trust from a browser form.
4. Check actual public/browser journeys with isolated test delivery and appropriate authentication. Use real business rates for the production comparison; never send a test email, create a live lead, or create a production invoice by exercising a quote path.
5. Verify the isolated authenticated QBO draft, provider GET readback and idempotent retry. Follow qbo-release-handoff-acceptance.md. No production QBO mutation is part of a source review.
6. Change one controlled workbook rate in a test copy, preview invalid and valid drafts, promote, verify every tool switches, retry with old pin, restore previous release, then compare receipts.
7. Exact-head CI, independent rendered verification, reviewed migration in isolated database, and owner-controlled import/publication. Report verified work by tool and version. Handoff email only when all requested artifacts, real live links, and audited unsent QBO draft actually exist.

## Status, 28 November 2026

Done in source and covered by tests (no deployment, no workbook publish, no QuickBooks or email action was taken):

* One release prices everything the shared engines price. The guided and embedded estimator, the scope platform (Scope Creator, Estimate Creator) and the shared document estimator on all five sites read the catalog, class targets, rush floors and fixed selling prices from the approved release in scope. Until a release is published that is the catalog compiled into the build (`P5-BID-2026-11-25`), so no figure moved with this change.
* Each request resolves one release; each priced result records its version and digest; a saved version priced under another release is locked.
* `/admin/pricing`: preview the workbook (live sheet through a service account, or an uploaded .xlsx), see every rate and rule change, stage, publish, roll back, with an append-only audit log. An invalid workbook yields no candidate and the release in force stays live.
* The family sites fetch the release from p5homeco.com with a shared token and verify its digest, schema and catalog compatibility before using it.
* The compiler was corrected against the live workbook: item wording may change, project services stay the fixed $125 rate, fixed handyman charges travel in the release.

Needs the owner or a live environment before it can be called complete:

1. Settings. `P5_PRICING_RELEASE_TOKEN` (one long random value, the same on all five sites). For the live sheet: a Google service account with the workbook shared to it as viewer, its key in `P5_WORKBOOK_SERVICE_ACCOUNT` on p5homeco.com. Without the second, upload the .xlsx on the release screen.
2. Migration 900 on the development database, then the publish checklist in CLAUDE.md ("never approve a DROP").
3. First live preview. The compiler has been run against values shaped like the workbook and against a sample of its real rows, not against the whole live sheet. The first preview is that check, and a preview changes nothing.
4. Handyman reconciliation (owner decision): the workbook's $95 all-in hour, $135 visit minimum and $50 pickup against the direction that every project carries the three $125 services, and against the $120 an hour in Boise Handyman's published copy rules. The engine still prices handyman at the workbook's figures and adds no project services to an all-in handyman job.
5. Local planning engines that still compute a range of their own and take only their floor from the shared policy: Boise Cabinet's `/estimate` wizard and room page "typical range" (live to customers), the consultation routes on all four brand sites (accept a posted planning range; no live page on Construction, Remodeling or Handyman writes one), Remodeling's admin takeoff bid, Construction's millwork finalize route (no caller). Each needs its scope mapped to cost book codes, or to be retired the way the homepage sliders and the assistants' price tools were. No crosswalk was invented.
6. Mixed-class jobs. `priceApprovedScope()` prices a remodel with cabinets by class and reconciles to the cent in tests; `priceScope()` still applies one class to a scope. Wiring it changes saved-scope data (a class per task) and needs review.
7. Quote Calculator. The workbook tab still has its own formulas.
8. Authenticated checks only a live environment can give: a QuickBooks sandbox draft read back line by line and retried, browser estimates on the five live sites, captured customer and team emails, HubSpot one-deal linkage. See `docs/qbo-release-handoff-acceptance.md`.
