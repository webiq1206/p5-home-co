---
name: Live accounting audits
description: Why production QuickBooks verification must be separated from ordinary build validation.
---

Live QuickBooks audits must require a deliberate, exact opt-in even when the app has a stored production connection. Ordinary tests and publish builds should skip them.

**Why:** Live accounting configuration changes independently of application correctness. Allowing stored credentials to auto-enable these audits made a valid application publish fail because bookkeeping preferences and account numbering did not satisfy operational assertions.

**How to apply:** Keep deterministic unit and integration tests in the normal build. Run live-company audits separately and only when an operator explicitly opts in to verifying the current accounting configuration.