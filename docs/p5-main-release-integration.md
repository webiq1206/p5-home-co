# One main branch, deferred migration017

This integration combines current main's document-schema reconciliation and
saved-analysis reuse with PR101's approved recovery/accounting fixes. Main is
the intended source of future releases; a separate long-lived release branch
is no longer needed. This source integration does not authorize a concurrent
publication or migration execution.

## Why017 was excluded

Production boot runs `npm run db:migrate && npm run start:host`. Previously,
putting017 into that source tree would execute it automatically when its name
was absent from schema_migration. The recorded production history through016
does not prove the document tables are absent: the worker already creates them
at startup. The release stayed on the reviewed PR97 baseline to avoid applying
an unreviewed production schema plan during an application repair.

## Exact purpose and effects

017 snapshots the existing document-service runtime DDL so development
preparation, checked migration source and runtime declarations agree. It
contains eleven CREATE TABLE IF NOT EXISTS statements and two CREATE INDEX
IF NOT EXISTS statements:

- Documents, pages and jobs retain uploaded bytes, extracted page evidence,
  job payload/results, queue state and leases.
- Nonces, capacity and provider leases implement request replay protection,
  rate accounting and concurrency. Metrics retain stage timings/details.
- QA runs, projects, intents and calls retain the existing fixed acceptance
  run, project bindings, exact requests and spending reservations/settlements.
- The jobs index supports queue lookup; the unique QA index permits one active
  permitted/in-flight call per run.

There are no INSERT, UPDATE, DELETE, copy, seed, provider or credential actions
in017. It does not reset budgets, create a QA run, grant permits or dispatch
jobs. Successful execution through the migrator would additionally insert its
filename into schema_migration. Existing ON DELETE CASCADE relationships only
act on a later deletion, not when the tables are declared.

CREATE IF NOT EXISTS preserves existing rows but does not verify or repair an
incompatible existing table/index. Missing objects would be created. Index
creation can lock tables or fail on duplicate active QA rows. The migration
transaction rolls back its own changes on failure; boot then stops before
starting the app. Replit's separate schema synchronization is not governed by
this SQL guard and still requires review.

## Dependencies and deferral

database-schema.mjs exports DDL, QA_DDL and documentSchemaStatements. Store and
QaBudget import the declarations for their existing runtime initialization;
development db:prepare includes them. The SQL file is a snapshot, not imported
by application code. Recovery fixes do not depend on017 being recorded as
applied. Existing production QA objects were confirmed by successful reads,
but full column/constraint/index parity has not been established.

The migration runner now explicitly defers017 before SQL execution or ledger
insertion. There is no CLI or environment override. The build accepts only the
exact deferred017 filename and still rejects unexpected017 variants; additive
SQL validation and compilation remain. Existing development preparation and
runtime initialization can still issue their prior additive declarations:
deferring the checked migration is not a claim that all startup DDL is disabled.
Do not run db:prepare as a substitute for approved migration execution.

Before a later change removes deferral, inspect the exact production database
catalog against all declarations, preserve sentinel counts and constraints,
review locks and the actual Replit publication schema proposal, and approve
that concrete plan. Do not mark017 applied just because some tables exist.

## Review

The integration's only textual merge conflict was the generated shared-file
manifest; it was regenerated from combined source. Main-side files were
compared by Git blob identity to current GitHub main. Recovery application
files remain byte-identical to the approved PR101 candidate. No code tests,
database command, paid call or deployment were performed to prepare this source.
