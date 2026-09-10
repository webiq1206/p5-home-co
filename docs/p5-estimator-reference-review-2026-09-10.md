# Pricing reference review update

The review estimator now groups customer ranges under simple trade names such as Demolition, Framing, Drywall, Painting, Cabinets and Plumbing. Both displayed range endpoints reconcile to the overall range. Allowances remain included once; customer PDFs do not reveal internal cost or allocation figures.

Administrators can import private historical price references under `/admin/p5-estimators`. The reference API requires administrator authentication, retains immutable import versions and records comparisons against a saved project review. Customer selling prices and unknown price bases cannot be used as verified direct costs. Reference checks require compatible scope, dates, locations, quantities and units. Optional scope, zero prices, unclear units and arithmetic warnings block automatic comparisons. No private source documents or customer data are stored in this public repository.

PDF extraction now accounts for each page with bounded provider concurrency, preserves additive scope and conflicting measurements, and marks failed pages for review. Text that exceeds automatic review capacity is rejected explicitly rather than truncated. Previously supplied answers are available for editing without repeating the same questions. Draft saves do not resend provider-owned extraction records.

Validation adds trade-range reconciliation and privacy tests, selling-price safeguards, historical comparison checks, multi-page extraction failures, authenticated reference import/version tests, and comparison quantity validation. Browser checks exercise the actual production UI at seven viewport widths, with simulated speech and external API responses. They do not certify physical keyboards, microphones or production integrations.

## Activation dependencies

This remains a review branch. The production public estimators have not been migrated or deployed. The owner has resolved the overhead treatment: use one 20% recovery rate covering the complete $420,000 annual budget, with owner salaries and advertising counted once. No initial revenue forecast or further overhead clarification is required. See [the current financial policy](p5-unified-overhead-policy-2026-09-10.md). Historical selling-price references provide scope comparisons and formula-derived unit-cost ceilings. Actual current net costs, burdened field labor and written subcontractor prices remain necessary when approving direct-cost rules.

Real document-provider trials, durable CRM update/attachment contracts and partial-draft CRM synchronization, live email/CRM failure checks, legacy route migration and physical-device checks remain outstanding. A successful CI run certifies only the explicitly tested review workflow. Keep the existing production and completed visual changes intact until those dependencies are resolved.
