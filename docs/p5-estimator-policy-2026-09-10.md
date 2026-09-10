# P5 estimator policy implementation and audit

## Release status

This branch is a review build, not a completed rollout. The new workflow is at
`/estimate/p5-preview`, with administrator controls at `/admin/p5-estimators`.
Existing public estimators and assistant pricing paths have not been migrated.
Do not represent this branch as completing the master estimator requirements.

No production forecast or cost book has been invented. With configuration absent,
the new workflow saves a project for review and withholds a customer price.
The existing legacy estimators still use their previous pricing until migration.

## Source authority and financial finding

Reviewed the supplied **P5 Pricing Model - Full**, **P5 Salaries**, and
**P5 Marketing Budget**. The user's September 10 instructions resolve differences
between older planning examples and the current service-specific policy.
The salary and marketing documents' $200,000 monthly/$2.4 million annual sales
goal is not evidence of a conservative 12-month revenue forecast.

Official overhead is $420,000 annually. The 8% overhead allocation covers that
amount only at revenue of at least $5.25 million. A hypothetical $2.4 million
conservative forecast would require 17.5% overhead and 29.5% total company
allocation. At a 20% operating-profit target the divisor would then be 0.505.
That hypothetical value is not configured as production policy.

The current salary plan does not supply verified employee production burdens or
current market replacement costs for owners' physical field work. Existing
modeled selling prices cannot be relabeled as current supplier or subcontractor
costs. Current written cost evidence is required before activating automatic
prices.

## Existing estimator inventory

| Brand | Existing entry points and engines | Finding |
| --- | --- | --- |
| P5 Home Co | `/quote`, lead intake and consultation routing | Lead request; no complete direct-cost estimator |
| Construction | `/estimate`, `/api/estimate-lead`, quote calculate/update, assistant, RE-10 analyze/estimate | Gross-margin/market-guide logic differs from the required allocation-plus-operating-profit formula; address was unnecessarily required |
| Remodeling | `/estimate`, estimate lead, quote calculate/update, assistant chat, plans estimate, RE-10 analyze/estimate | Same margin issue; several independent estimate paths need one authoritative implementation |
| Handyman | `/estimate`, estimate lead, quote calculate/update, assistant, RE-10 analyze/estimate | Modeled customer hourly/menu rates and urgency adjustments are not a verified direct-cost build-up |
| Cabinet | `/estimate`, `/api/estimate/calculate`, consultation and assistant chat | Installed-price bands and product multipliers; product-only needs a distinct cost and profit treatment; consultation accepts client estimate data |

The Construction address requirement was committed separately to main as
`a897b820a16189c48a9795c687bc9d67ab270f5b` after its 14 browser cases passed. City, ZIP,
county, general area or no location can continue, with site/jurisdiction caveats.

## Implemented on the review route

- One pure, server-used financial policy with the full service matrix, quarterly
  overhead review, contingency before division, full internal precision, signed
  allowance adjustments, cost evidence checks, direct-cost coverage and warnings.
- Both-owner approval records tied to an exact estimate revision; owner identity
  comes from administrator authentication and configured owner email addresses.
- Typed and native browser speech input, files plus manual answers, conditional
  questions, extracted evidence/confidence, conflict review and optional location.
- PDF/photo/text/CSV/JSON extraction, XLSX and DOCX text conversion. Legacy Office,
  ODS and HEIC/HEIF files are retained for manual review; automatic conversion of
  those formats is not implemented.
- Browser text recovery and IndexedDB file recovery; authenticated server drafts,
  optimistic revisions, private upload storage and content-hash deduplication.
- Atomic durable submission/outbox insertion, separate customer/admin projections,
  email retries with provider idempotency, delivery alerts, CRM ambiguity review
  and an administrator queue. SMTP does not claim idempotency it cannot guarantee.
- Separate PDFs using each site's original logo, colors, Manrope and Cormorant
  Garamond. Static fonts were instantiated from the existing site font assets for
  reliable PDF embedding; no substitute logos or external image calls are used.

## Setup required before production activation

1. Supply the conservative next-12-month revenue forecast, its basis and current
   overhead review. Enter it in the administrator policy, not a browser constant.
2. Supply current net supplier prices and landed components, current written trade
   quotes, payroll/insurance burdens, owner production replacement rates and
   service-specific scope coverage. Populate reviewed cost books with expiry dates.
3. Use the administrator cost-review editor to supply complete project-specific
   lines, allowance treatment, evidence, adjustments and review notes. Reviewed
   publication saves revision history and queues separate PDFs. Both-owner
   approvals bind to the project, costs, review notes and financial snapshot;
   changed scope or policy invalidates approval. An existing CRM record must be
   updated and reconciled, rather than creating a duplicate lead.
4. Verify each existing estimator, RE-10, plans and assistant route against the
   new cost book, then migrate those entry points together. The preview is not a
   silent replacement for any existing form.
5. Configure the site's existing database and email transport. Set
   `ANTHROPIC_API_KEY` and a supported `P5_SCOPE_MODEL` for automatic extraction.
   Service brands use their existing Resend transport and `LEAD_DASHBOARD_KEY`;
   P5 uses its existing SMTP transport and internal lead manager.
6. Set `P5_OWNER_NICK_EMAIL` and `P5_OWNER_JARED_EMAIL` to the actual authenticated
   owner accounts. No arbitrary administrator may impersonate an owner approval.
7. Schedule an authenticated POST to `/api/cron/p5-estimator-delivery` using
   `CRON_SECRET`. Reconcile ambiguous CRM/SMTP acknowledgments before retrying;
   durable upstream CRM idempotency is not yet verified.
8. Verify actual delivery, record IDs, full upload/scope linkage, partial-draft CRM
   behavior and reconciliation against each configured production integration.

## Verification commands and limits

`node --import tsx --test tests/p5-pricing.test.ts` checks the financial matrix,
divisors, allocation reconciliation, contingency, overhead escalation, floors,
allowances, evidence and customer confidentiality.

`node --import tsx scripts/test-p5-workflow.mts` uses a real isolated PGlite
database and simulated transports to verify draft ownership, concurrent saves,
duplicate uploads/submissions, durable delivery failures, retries and alerts. It
also generates both PDF types with synthetic data. No real email or CRM request
is made by that test.

`node scripts/p5-estimator-browser.mjs` exercises rendered pages at 320, 390, 430,
768, 1024, 1440 and 1920 pixels. Browser speech and external APIs are simulated.
This does not certify physical iPhone/Android microphone permissions, operating
system keyboard behavior, real AI extraction quality, or live delivery.

GitHub Actions runs those checks and the normal production build, retaining
screenshots, PDFs and machine-readable results. Only completed successful runs
and inspected artifacts count as verification; merely adding a workflow does not.

Remaining requirements include current-cost calibration and benchmark evidence,
all legacy path migration, live administrator publication checks,
complete CRM attachment linkage, live integration failure drills, actual voice
and document-model trials, and physical device checks. The work must remain open
until these are verified.

## Verified review-build results

All five normal production builds and seven-width customer preview runs passed
before the final administrator handoff changes. The isolated SQL workflow also
verifies saved manual cost reviews, both-owner approval enforcement, stale
financial snapshot rejection, changed-scope approval invalidation, concurrent
publication, revision history and audited delivery reconciliation. CI rechecks
the final branch commits. These are synthetic financial and transport tests,
not confirmation of actual P5 rates or live integration credentials.
