---
name: Pricing spend admission
description: Fail-closed rules for paid estimator pricing calls and restart-safe charge accounting.
---

Live estimator pricing must have a valid positive monetary cap and per-request reservation before any provider call. Admission must be serialized across concurrent work, and each separately billable HTTP request must have a durable identity and receipt state. Missing configuration, exhausted budget, an existing reservation, or an ambiguous acknowledgement blocks retry.

**Why:** A work checkpoint alone cannot distinguish a free retry from a crash after provider acceptance. Implicit no-budget operation, concurrent aggregate checks, and one reservation covering several requests can all duplicate charges or exceed the intended cap.

**How to apply:** Keep offline provider mocks behind an explicit test-only injected ledger. In live paths, reserve before network I/O, record every request, settle only after a known response, and require manual reconciliation for unknown or orphaned states.