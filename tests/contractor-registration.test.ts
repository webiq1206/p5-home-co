import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

/** Company claims that we hold an Idaho contractor license. Trade licenses stay. */
const claimPatterns = [
  new RegExp("licensed, " + "bonded", "i"),
  new RegExp("Licensed & " + "insured"),
  new RegExp("Licensed, " + "insured"),
  new RegExp("License details " + "available", "i"),
  new RegExp("contractor " + "license", "i"),
  new RegExp("Fully " + "Licensed"),
  new RegExp('credentialCategory:\\s*"license"'),
  new RegExp("licensed " + "contractor", "i"),
  new RegExp("we(?:'re| are) " + "licensed", "i"),
  new RegExp("\\bis " + "licensed\\b", "i"),
];

function scrub(text: string): string {
  return text
    .replace(/licensed (plumber|electrician|architect|engineer|surveyor|specialist|trade|trades|abatement|mechanical|design|installer|plumbing|electrical)s?/gi, "")
    .replace(/licensed-(trade|plumber|electrician)/gi, "")
    .replace(/State of Idaho license/gi, "")
    .replace(/\bIdaho license\b/gi, "")
    .replace(/Idaho licensed/gi, "")
    .replace(/P5 is licensed to do/g, "");
}

function walk(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".git", ".next", "scripts", "seo-audit", "docs", "tests", "dist", "services"].includes(name)) continue;
    const path = join(dir, name);
    if (path.endsWith(`${join("lib", "p5")}`) || path.endsWith(join("app", "lib", "contracts")) || path.endsWith(join("app", "legal")) || path.endsWith(join("public", "p5-estimate"))) continue;
    if (statSync(path).isDirectory()) walk(path, found);
    else if (/\.(ts|tsx|js|mjs|md|txt|html|json)$/.test(name) && name !== "package-lock.json" && name !== "priceBookData.ts") {
      if (path.includes("local-seo-audit") && name !== "GBP-STEP-BY-STEP-GUIDE.md") continue;
      found.push(path);
    }
  }
  return found;
}

test("no licensed contractor claim remains", () => {
  const hits: string[] = [];
  for (const file of walk(root)) {
    const text = scrub(readFileSync(file, "utf8"));
    for (const pattern of claimPatterns) {
      if (pattern.test(text)) hits.push(`${file.slice(root.length)} ${pattern}`);
    }
  }
  assert.deepEqual(hits, []);
});

test("the published credential is Idaho contractor registration 8381215", () => {
  const text = walk(root).map((file) => readFileSync(file, "utf8")).join("\n");
  assert.match(text, /8381215/);
  assert.match(text, /Idaho contractor registration|Registered Idaho contractor \(#8381215\)/);
});
