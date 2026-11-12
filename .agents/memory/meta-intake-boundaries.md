---
name: Meta intake boundaries
description: Owner intent for shared child-brand intake and Meta Testing Tool side effects.
---

P5 Home Co is the single Meta Lead Ads intake for the P5 family, using one P5 Co Meta app and system user, not separate child-brand intake queues or CRMs.

Meta Lead Ads Testing Tool leads intentionally follow ordinary intake, including HubSpot deal creation and the alert email. Do not apply the estimator's synthetic-QA delivery suppression to these Meta leads.

**Why:** The owner explicitly requested unified Page intake and new-lead alerts including Testing Tool submissions.

**How to apply:** Use mocked Meta, HubSpot and SMTP calls for development verification. Treat a real Testing Tool submission or Page subscription as a live external action, not a harmless local test; obtain the relevant authorization before executing it.

Successful system-user account discovery does not prove that credential can perform Page-scoped operations. Use each Page's own credential for subscriptions, forms and lead retrieval; explicit Page overrides take precedence. Never silently substitute the system-user credential when Page resolution fails.

**Why:** The owner observed successful account discovery in production while Page calls failed with HTTP 400, and identified the credential-type mismatch.

**How to apply:** Preserve the distinction between discovery and Page credentials in future client changes and mocked authorization-header tests. Credential caches must remain server-only, encrypted at rest and scoped to the configured app/system credential.

Meta Lead Ads must not be discarded for malformed or placeholder contact values. Accept any nonempty email or phone, preserve original answers, flag invalid values for review, and reject only when both are empty. Testing Tool leads must be visibly labelled TEST LEAD while retaining normal CRM and owner-alert delivery.

**Why:** The owner explicitly required tolerant Meta intake after a genuine Testing Tool delivery was rejected despite having an email.

**How to apply:** Keep other intake validation strict, never use malformed values to merge people, and do not automatically replay rejected production receipts without the owner's action.
