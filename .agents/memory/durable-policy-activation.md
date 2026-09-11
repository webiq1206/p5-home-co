---
name: Durable policy activation
description: Which write paths reliably persist estimator policy activation across runtime restarts.
---

Activate estimator policy through the managed development database write interface or the authenticated administrator application workflow. Do not rely on a shell process writing through `DATABASE_URL` for durable activation.

**Why:** A command-line importer reported and immediately read back a successful activation, but the active policy disappeared after the execution sandbox restarted while the staging record written through the managed database interface remained intact.

**How to apply:** For development automation, build and validate the configuration with the committed application logic, then save it atomically through the managed database interface with a recovery snapshot. For production, use an existing administrator's normal application session after publishing the validated release; agent production database access remains read-only.