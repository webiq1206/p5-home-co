import {readFileSync, readdirSync, existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

// Fail closed. Only the additive DDL forms used by our migrations are allowed.
// This is a repository guard, not an interceptor for Replit's own provisioning.
export function assertAdditiveSql(sql, label = 'migration') {
  const statements = [[]];
  const tokens = /\s+|--[^\r\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|[A-Za-z_][A-Za-z_0-9$]*|[0-9]+|[();,.=:+\-<>\[\]]/gy;
  let offset = 0;
  while (offset < sql.length) {
    tokens.lastIndex = offset;
    const match = tokens.exec(sql);
    if (!match) throw new Error(`${label}: unsupported SQL syntax; manual additive migration required`);
    const token = match[0]; offset = tokens.lastIndex;
    if (/^\s|^--|^\/\*/.test(token)) continue;
    if (token === ';') { statements.push([]); continue; }
    statements.at(-1).push(token.startsWith("'") ? 'LITERAL' : token.startsWith('"') ? 'IDENTIFIER' : token.toUpperCase());
  }
  for (const statement of statements.filter(s => s.length)) {
    const text = statement.join(' ');
    if (statement.some(t => ['DROP','TRUNCATE','RENAME','EXECUTE','DO','CALL','SELECT','REPLACE'].includes(t))) {
      throw new Error(`${label}: destructive or dynamic SQL is prohibited`);
    }
    if (/^CREATE (TABLE|(?:UNIQUE )?INDEX) IF NOT EXISTS /.test(text)) continue;
    // Existing migrations annotate columns. Metadata comments cannot drop data.
    if (/^COMMENT ON (COLUMN|TABLE) [A-Z_][A-Z_0-9$]*(?: \. [A-Z_][A-Z_0-9$]*)* IS LITERAL(?: LITERAL)*$/.test(text)) continue;
    if (/^ALTER TABLE (?:[A-Z_][A-Z_0-9$]*)(?: \. [A-Z_][A-Z_0-9$]*)? ADD COLUMN IF NOT EXISTS /.test(text)
        && !statement.includes('ALTER', 1)) continue;
    throw new Error(`${label}: only additive CREATE IF NOT EXISTS and ADD COLUMN IF NOT EXISTS are permitted`);
  }
}

export function verifyMigrationFiles(root = '.') {
  if (!existsSync(`${root}/migrations`)) return;
  for (const name of readdirSync(`${root}/migrations`).filter(n => n.endsWith('.sql'))) {
    assertAdditiveSql(readFileSync(`${root}/migrations/${name}`, 'utf8'), name);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyMigrationFiles();
  console.log('Database migration safety check passed: no destructive migration SQL.');
}
