# P5 controlled pricing handoff acceptance

Status: source-only candidate. Focused synthetic comparison tests passed. Full application build, authenticated scope journey, QuickBooks sandbox readback and production readback are not verified. There is no unsent test-estimate link to report at this stage.

## Prerequisites

- Deploy the exact candidate revision to a separate test runtime and disposable test database.
- Confirm the QuickBooks OAuth sandbox client and sandbox company realm on the connected side; setting `QBO_ENV=sandbox` is not a substitute for checking the account. Keep production tokens and data out of this test deployment.
- Keep real mail and CRM delivery off. Use the test mail capture and a synthetic contact. Prevent automatic QBO create by setting `ESTIMATOR_QBO=off` and `SITE_ESTIMATE_QBO=off` when testing intake paths. Use only the separate administrator Create Estimate action for the deliberate sandbox write. Do not click Send.
- Verify every sandbox Product/Service Id and tax code by readback. Production IDs 48, 49 and 47 map to project management, administration and accounting respectively. They are not assumed to mean the same thing in sandbox. The current fixed mapping must match sandbox configuration, or the isolated test path must have a verified realm-specific mapping. Never change production IDs to make a test pass.

## Recorded scenario

1. Build a synthetic scope with fixed exact quantities, a reviewed labor-cost basis, applicable taxes, one allowance and approved hours for all three project services. Store the approved release identifier and immutable pricing receipt, including line-level quantities, units, unit costs, customer rates, amounts, allowances and policy decisions.
2. Using an authenticated administrator, confirm the controlled contact, active QuickBooks Project, customer-parent relationship and exact scope version. Use Create Estimate once.
3. Read the saved QuickBooks estimate back and record the exact URL, realm, estimate Id, project Id, scope/pricing version and `EmailStatus=NotSet`. Compare every priced row by stable scope identity/mapping, SKU, quantity, rate, line amount and tax code. Compare the authoritative total and applicable tax to the approved receipt. Fail if there is an unexplained lump sum or total difference.
4. Retry from the same saved scope version. Confirm the estimate ID and corresponding record count do not change. Verify no Send intent and no recipient mail delivery. Confirm a wrong project, issued estimate, altered QBO amounts and unprivileged/scopes-only users are rejected, and check that the authorized draft reprice action never alters older versions.
5. Compare customer web, captured confirmation email and generated PDF: division scope, one total range, no prices by division/line and no internal costs, margins or provider notes. Compare the administrative scope view and QBO receipt against the full priced breakdown.

## Known boundaries

The manual handoff source candidate does not migrate public guided/site delivery; they call shared QBO functions separately. The guided retry currently follows the latest scope pointer; capture the originally saved version when moving it to the new release. The site-estimate adapter currently accepts site-calculated prices and may express inexact quantities as lump sums. That legacy adapter is not evidence of versioned pricing parity. Existing confirmed approvals and signed work are never used as test fixtures.

Exact-quantity and provider tax normalization must be exercised in QuickBooks Sandbox before making these protections enforcement gates in production. Treat the old provider tax/finance settings as unchanged until an approved release spells out how to reconcile their outputs.
