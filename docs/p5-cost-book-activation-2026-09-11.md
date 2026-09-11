# Preliminary cost-book activation

The previous release left every service cost book empty. Supplied unit-cost workbooks and historical estimates had only been retained as reference material. This release adds a private source catalog and service-specific estimating assemblies for all twelve supported services.

The owner schedule is an estimating input, not an independently verified supplier quote. Historical selling rates are converted to explicit modeled cost budgets before the current pricing formula is applied. Source references and the conversion remain in the private catalog. No customer selling rate is inserted as observed direct cost, and no private rate or source document is committed to this public repository.

The preliminary model retains the approved 20% overhead recovery and service-specific profit targets. The source schedule's separate contingency and owner management rows are excluded to prevent duplicate allocations. Procurement and mobilization reserves are labeled assumptions. Additional project labor remains a separate estimated project cost. Firm proposals still require current procurement, subcontractor and labor confirmation.

The assemblies distinguish cabinet supply from installation, separate living area from garage and covered outdoor areas, preserve explicit zero quantities, omit customer-supplied products, and ask for relevant task quantities. Missing rates, missing quantities, unresolved documents, stale catalog reviews and specialist work outside the small-job assembly block unsupported ranges. Modeled geometry and quantities appear as customer assumptions.

The import utility validates every offered service before storing the catalog, preserves existing verified service books and financial configuration, uses optimistic concurrency, and records an immutable previous-policy recovery snapshot. Repeating an identical import does not change the saved version. The catalog has a 92-day review interval.

The verified-cost path retains its existing strict gates. Only an explicitly configured owner-planning book can use the dated estimating schedule for a preliminary range. These ranges do not certify actual profit or constitute firm bids.

The related database compatibility repair normalizes successful, confirmed zero-row responses from the deployment SQL proxy. It preserves nonempty results and real database errors.
