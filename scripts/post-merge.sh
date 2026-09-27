#!/bin/bash
set -euo pipefail
npm install
node scripts/p5-schema-safety.mjs
# Add missing estimator objects only. Never reconcile by deleting other tables.
npm run db:prepare -- --optional
