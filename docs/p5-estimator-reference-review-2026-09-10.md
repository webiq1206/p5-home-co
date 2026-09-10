# Pricing reference review update

The review estimator now groups customer ranges under simple trade names such as Demolition, Framing, Drywall, Painting, Cabinets and Plumbing. Both displayed range endpoints reconcile to the overall range. Allowances remain included once; customer PDFs do not reveal internal cost or allocation figures.

Administrators can import private historical price references under `/admin/p5-estimators`. The reference API requires administrator authentication, retains immutable import versions and records comparisons against a saved project review. Customer selling prices and unknown price bases cannot be used as verified direct costs. Reference checks require compatible scope, dates, locations, quantities and units. Optional scope, zero prices, unclear units and arithmetic warnings block automatic comparisons. No private source documents or customer data are stored in this public repository.

PDF extraction now accounts for each page with bounded provider concurrency, preserves additive scope and conflicting measurements, and marks failed pages for review. Text that exceeds automatic review capacity is rejected explicitly rather than truncated. Previously supplied answers are available for editing without repeating the same questions. Draft saves do not resend provider-owned extraction records.

Validation adds trade-range reconciliation and privacy tests, selling-price safeguards, historical comparison checks, multi-page extraction failures, authenticated reference import/version tests, and comparison quantity validation. Browser checks exercise the actual production UI at seven viewport widths, with simulated speech and external API responses. They do not certify physical keyboards, microphones or production integrations.

## Activation dependencies

This remains a review branch. The production public estimators have not been migrated or deployed. Current net costs, burdened labor, written subcontractor quotes and a documented conservative revenue forecast remain necessary for calibrated automatic prices. The full annual overhead budget overlaps owner salary and social allocations; its reconciliation with the separate revenue allocations needs a documented decision. Historical customer-facing examples do not establish net costs or resolve that accounting question.

Real document-provider trials, durable CRM update/attachment contracts and partial-draft CRM synchronization, live email/CRM failure checks, legacy route migration and physical-device checks remain outstanding. A successful CI run certifies only the explicitly tested review workflow. Keep the existing production and completed visual changes intact until those dependencies are resolved.
