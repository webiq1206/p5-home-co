---
name: Plans-only qualification recovery
description: How to resume a preserved paid plans checkpoint without touching historical short-file work.
---

Resume an inspected plans checkpoint through the plans fixture directly under the qualification lock. Do not route it through a consolidated wrapper that first revalidates or recovers the historical short fixture.

**Why:** A consolidated wrapper can stop on stale short-file probe assumptions before reaching plans, and retrying that historical fixture violates the explicit no-retry boundary without improving the preserved plans state.

**How to apply:** Keep cumulative plans ledger and call caps active, use the existing plans profile and lock, invoke only the plans fixture, and stop for inspection on any unknown charge or exhausted one-time recovery.