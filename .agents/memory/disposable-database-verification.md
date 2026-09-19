---
name: Disposable database verification
description: Safe database target selection for destructive or concurrency verification in production-marked runtimes.
---

Run database-backed destructive, isolation, or concurrency verification only against a newly created loopback-only PostgreSQL cluster when the runtime is marked production. Do not connect through the configured application database URL, even to create a temporary database.

**Why:** A runtime-level production marker means the configured database identity cannot be assumed safe for test setup or cleanup. A local ephemeral cluster proves that no customer database or production credential participates.

**How to apply:** Create a uniquely named local cluster and database under temporary storage, bind only to loopback, verify the exact database/user/address/port and non-recovery state, run gated tests through their dedicated test URL variables, then drop the database, stop the cluster, and verify removal in cleanup.