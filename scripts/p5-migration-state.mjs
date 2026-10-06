// Source integration is not production DDL approval. Keep this reviewed file
// on main, but never execute or mark it applied until a separate source change
// follows the exact target catalog review. No environment/CLI bypass.
export const migrationDeferred = name => name === '017_document_service_schema.sql';

// Dry inspection must work on an empty database without creating its ledger.
export async function readMigrationState(client, {dry = false} = {}) {
  if (dry) {
    const {rows} = await client.query("SELECT to_regclass('schema_migration') AS ledger");
    if (!rows[0]?.ledger) return new Set();
  } else {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migration (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  }
  const {rows} = await client.query('SELECT version FROM schema_migration');
  return new Set(rows.map(row => row.version));
}
