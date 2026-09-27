# Database preservation policy

Never approve a publish plan that drops a table or column, truncates data, or
recreates an existing table. This applies even to apparently unused tables.

## Before republishing

1. Cancel any pending publish with a destructive plan.
2. Pull the latest Git main into the affected Replit app.
3. In the development workspace Shell, run `npm install`, then
   `npm run db:prepare`. Wait for the success message.
   Restarting Run also performs this additive preparation before the dev server.
4. Start a NEW publish and inspect the generated database plan. Do not reuse the
   previously generated plan. If it proposes any deletion, cancel and investigate
   the development/production schema difference. Do not approve the deletion.

## Repository protections

- `db:push` is a compatibility alias for `db:prepare`, NOT Drizzle schema push.
- Merge hooks and development startup use additive estimator setup.
- Setup creates missing objects and adds missing columns using IF NOT EXISTS.
  It never deletes, renames or replaces existing objects or rows.
- Setup is transactional, serializes concurrent preparation, uses timeouts, and
  stops on error. No force mode or alternate production connection fallback.
- The snapshot covers runtime estimator tables, including customer review
  requests and policy import audit records. Keep retired table definitions.
- Build/CI validate migration SQL and test record preservation. P5 Home's
  migration runner validates the complete migration directory before connecting.
- New non-estimator schema changes need an explicitly reviewed additive
  migration. The old broad schema reconciliation command is intentionally gone.

## Platform boundary

Replit provisioning compares the actual development and production databases,
outside these scripts and potentially before application build. Git declarations
and passing tests do not prove that its plan is non-destructive. No repository
guard can intercept a platform-generated migration. Unknown production-only
tables must be retained and represented safely in development before publishing.
Do not copy customer data into development just to align table structures.
Do not change database ownership, install DDL event triggers, or replace the
managed production connection as a workaround without a separate reviewed plan.
