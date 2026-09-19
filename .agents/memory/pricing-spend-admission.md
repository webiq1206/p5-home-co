---
name: Pricing spend admission
description: Fail-closed rules for paid estimator pricing calls and restart-safe charge accounting.
---

Live estimator pricing must durably record each separately billable request by draft, customer, and revision before network I/O. A monetary cap is optional; when configured it requires a matching positive reservation and serialized active-window admission. Unknown, in-flight, or settled-without-saved-result attempts block only their exact durable identity, while known rejected attempts remain retryable.

**Why:** A work checkpoint alone cannot distinguish a free retry from a crash after provider acceptance, but ordinary customer pricing must not depend on QA allowance settings or accumulate against a permanent lifetime cap. Global request fingerprints also let unrelated customers lock each other out.

**How to apply:** With no cap settings, write zero-dollar ledger reservations and preserve the same ambiguity rules. With both cap settings, count only active reservations/settlements plus unreconciled unknowns. Fail closed on partial cap configuration, and replay saved stage replies before reserving.

Release qualification must resolve the effective provider and model from the production environment before selecting a paid QA guard. Do not qualify a convenient or previously tested model when production defaults, inherited selectors, or provider preference choose another route.

**Why:** P5 had an existing Anthropic-only guard, while its production selectors resolved to OpenAI and a production-specific model. Running the existing guard would have produced valid evidence for the wrong route.

**How to apply:** Inspect only selector values and credential presence, never credential contents. Pin the resolved provider/model inside the isolated qualification process, forbid fallback, and require the response to report that same model and its actual service tier.