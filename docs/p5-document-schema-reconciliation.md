# Document-service schema reconciliation

Source preparation only. Do not execute this plan against an existing database
until its target identity and the exact schema difference have been reviewed.

## Why this change exists

The document worker created its tables at startup, while development preparation
and checked migrations omitted them. Production could therefore acquire tables
that the development database did not have. A later publication can encounter a
database schema review even when its application change only affects PDF text.

`services/document-service/src/database-schema.mjs` now owns the same existing
runtime declarations. Development preparation imports these declarations, and
`migrations/017_document_service_schema.sql` is their exact checked snapshot.
Tests enforce parity, repeated application, preservation and rollback. The SQL
contains seven base tables, four QA tables and two indexes. It inserts no rows
and grants no permissions. Creating empty QA tables does not initialize a run,
allowance, project binding, intent or permit.

## Development-only target and execution plan

1. Use the existing P5 application workspace, with the reviewed commit and a
   clean tracked tree. Keep production running its current release. Do not
   change credentials, database attachments or environment variables.
2. Establish through read-only metadata that the existing workspace DATABASE_URL
   is the selected **Development Database**, distinct from Production Database.
   Record database identity privately without revealing the connection string.
   Check whether DOCUMENT_DATABASE_URL is separately configured; worker schema
   ownership follows that setting when present. Do not assume the two URLs name
   the same database, substitute one for the other, or copy either elsewhere.
3. Read both catalogs without DDL: migration identities, columns, defaults,
   nullability, primary/foreign/check constraints, indexes and predicates. Use a
   read-only transaction for SQL inspection. Inventory rows alone are not proof
   of schema equality. Review missing migrations separately instead of applying
   every pending file blindly.
4. Compare the exact SQL in migration017 to the target catalog. Existing objects
   must match; CREATE IF NOT EXISTS does not repair incompatible definitions.
   Stop for unexpected objects, types, constraints or dependencies. Preserve a
   schema inventory and relevant sentinel counts before any authorized write.
5. After development-write scope and the concrete difference are approved,
   apply only the reviewed missing additive declarations in a transaction with
   lock/statement timeouts. The existing db:prepare path has transaction locking
   and rollback, but includes estimator declarations too: use it only if its
   entire plan was reviewed for this target. It must not be represented as a
   QA-only operation. Migration-ledger changes, if desired, must match the actual
   migration execution and be separately included in that reviewed plan.
6. Read back object definitions and preserved rows. Confirm there are no new QA
   run, binding, intent or call rows. Do not start the document worker, execute
   provisioning helpers or send provider requests as part of reconciliation.
7. Obtain Replit's exact proposed publication schema diff through its supported
   review flow. Do not accept an unseen diff or toggle development-to-production
   copying. Development reconciliation does not authorize production changes or
   bypass the publication review. Keep the working release live if uncertain.

## Dry migration inspection

`npm run db:migrate -- --dry` now checks for the tracking table using SELECT and
does not create it. It lists pending files and reads table counts; it skips DDL,
migration-record inserts and administrator seeding. This reports pending checked
migrations, not Replit's schema-sync proposal and not a full catalog diff.

Repository additive-SQL checks do not intercept or approve Replit's own schema
operations. No production or existing development database was changed to test
this source fix.
