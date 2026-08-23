import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Status filters that silently match nothing (S217).
 *
 * p5_project.status is constrained to capitalised values ('Active', 'Closed',
 * 'Cancelled'). A query written as `status NOT IN ('closed','cancelled')`
 * therefore excludes nothing at all - and it fails in the worst possible way,
 * because it does not error. It just quietly returns rows that were meant to be
 * filtered out, and finished jobs turn up on the funding board with a
 * recommended draw against them.
 *
 * This test reads the CHECK constraint from the migration and compares every
 * status literal in the app against it, so the next one is caught by CI rather
 * than by somebody noticing a closed project in a list.
 */

function projectStatuses(): string[] {
  const sql = readFileSync(join("migrations", "003_finance.sql"), "utf8");
  const block = sql.match(
    /status\s+TEXT NOT NULL DEFAULT 'Draft' CHECK \(status IN \(([\s\S]*?)\)\)/,
  );
  assert.ok(block, "could not find the p5_project status CHECK constraint");
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) found.push(full);
  }
  return found;
}

test("the project status constraint is what this test thinks it is", () => {
  const statuses = projectStatuses();
  assert.ok(statuses.includes("Closed"), statuses.join(", "));
  assert.ok(statuses.includes("Cancelled"));
  assert.ok(statuses.includes("Active"));
});

test("no query filters p5_project.status with the wrong capitalisation", () => {
  const valid = projectStatuses();
  const lowerToCorrect = new Map(valid.map((s) => [s.toLowerCase(), s]));

  const problems: string[] = [];
  for (const file of sourceFiles("app")) {
    const source = readFileSync(file, "utf8");

    // Only queries that actually read p5_project. Other tables have their own
    // status vocabularies - lender_draw and subcontract are lowercase by
    // design - and flagging those would make this test noise rather than a
    // guard, which is how a failing check ends up being ignored or deleted.
    for (const statement of source.split(/`/)) {
      if (!/\bFROM\s+p5_project\b|\bUPDATE\s+p5_project\b/i.test(statement)) continue;

      // Every `status ... ('a','b')` or `status = 'a'` comparison in SQL text.
      for (const match of statement.matchAll(
        /\bstatus\s*(?:NOT\s+)?(?:IN\s*\(([^)]*)\)|=\s*('[^']*'))/gi,
      )) {
        const literals = [...(match[1] ?? match[2] ?? "").matchAll(/'([^']*)'/g)].map(
          (m) => m[1],
        );
        for (const literal of literals) {
          if (!literal) continue;
          if (valid.includes(literal)) continue; // correct as written
          const correct = lowerToCorrect.get(literal.toLowerCase());
          if (correct) {
            problems.push(`${file}: '${literal}' should be '${correct}'`);
          } else {
            // Not a case problem - a value the constraint does not allow at
            // all, which will never match either.
            problems.push(`${file}: '${literal}' is not a valid project status`);
          }
        }
      }
    }
  }

  assert.deepEqual(problems, [], `status literals that match nothing:\n${problems.join("\n")}`);
});
