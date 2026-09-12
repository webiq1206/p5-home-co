---
name: Estimator worker diagnostics
description: Privacy rule and retry policy for durable estimator background-job failures.
---

Estimator background jobs must persist and log only static, allowlisted failure categories. Never store or emit raw exception messages from provider, storage, database, or document-processing paths.

**Why:** Raw exception text can contain customer scope, filenames, personal information, provider response content, or credentials. A past text-only failure also became impossible to diagnose because the worker discarded all failure classification before marking the job terminal.

**How to apply:** Map caught errors to non-customer categories such as provider timeout, provider configuration, provider response invalid, provider request failed, storage unavailable, or database contention. Keep retries bounded, clear stale categories after success or explicit retry, and test that sensitive synthetic exception content reaches neither persisted work nor logs.