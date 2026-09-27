---
name: Estimator regression runner
description: Node 24 handling for isolated estimator SQL and pricing regression scripts.
---

Run the isolated estimator SQL/pricing regression scripts with the project's installed `tsx` runner on Node 24, not native `--experimental-strip-types`.

**Why:** Those scripts intentionally copy TypeScript fixtures to temporary modules under `node_modules/.cache`. Node 24's native type stripping refuses TypeScript there before the assertions execute, while `tsx` can run the same synthetic fixtures. A native-strip failure is a runner limitation, not evidence that the estimator fix failed.

**How to apply:** Keep database and provider credentials unavailable to these synthetic runs; invoke the installed `tsx` loader rather than moving fixtures or editing the approved scripts. Use the normal native runner for the separate `.test.ts` suite.