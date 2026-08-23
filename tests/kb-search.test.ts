import { test } from "node:test";
import assert from "node:assert/strict";

import { ALL_ARTICLES } from "../app/lib/kb/index.ts";
import { buildIndex, expandQuery, search, tokenize } from "../app/lib/kb/search.ts";

const INDEX = buildIndex(ALL_ARTICLES);

function topSlugs(query: string, n = 3): string[] {
  return search(query, INDEX, n).map((r) => r.article.slug);
}

// --- Tokenization -----------------------------------------------------------

test("stemming meets plural/gerund variants in the middle", () => {
  assert.deepEqual(tokenize("invoices"), tokenize("invoice"));
  assert.deepEqual(tokenize("invoicing"), tokenize("invoice"));
  assert.deepEqual(tokenize("payments"), tokenize("payment"));
});

test("synonyms expand the query without polluting direct terms", () => {
  const { direct, expanded } = expandQuery("pay subcontractor");
  assert.ok(direct.length === 2);
  assert.ok(expanded.length > 0);
  for (const e of expanded) assert.ok(!direct.includes(e));
});

// --- The phrases from the brief must find the right instructions ------------

const EXPECTATIONS: [string, string[]][] = [
  ["pay subcontractor", ["pay-vendors", "enter-a-subcontractor-bill", "accounts-payable", "vendors-and-subcontractors"]],
  ["new lead", ["handle-a-new-lead", "lead-flow", "lead-intake-and-sla"]],
  ["change order", ["record-a-change-order", "projects-and-jobs"]],
  ["customer invoice", ["invoice-a-customer", "accounts-receivable"]],
  ["remaining project budget", ["project-financial-health", "projects-and-jobs", "daily-financial-report"]],
  ["vendor", ["vendors-and-subcontractors", "accounts-payable", "pay-vendors"]],
  ["deal stage", ["sales-pipeline", "crm-structure"]],
  ["reconcile bank", ["bank-reconciliation"]],
  ["cost code", ["cost-codes-and-cost-groups"]],
  ["safe cash", ["money-run"]],
];

for (const [query, acceptable] of EXPECTATIONS) {
  test(`search "${query}" surfaces the right page`, () => {
    const top = topSlugs(query, 3);
    assert.ok(top.length > 0, `no results for "${query}"`);
    assert.ok(
      acceptable.includes(top[0]) || acceptable.includes(top[1] ?? "") || acceptable.includes(top[2] ?? ""),
      `"${query}" returned ${top.join(", ")} - none acceptable (${acceptable.join(", ")})`,
    );
  });
}

// --- Honesty: garbage in, nothing out ---------------------------------------

test("nonsense queries return no results rather than noise", () => {
  assert.deepEqual(search("zzqx flurble", INDEX), []);
});

test("empty query returns nothing", () => {
  assert.deepEqual(search("   ", INDEX), []);
});

test("results carry a usable snippet", () => {
  const results = search("change order", INDEX, 3);
  for (const r of results) {
    assert.ok(r.snippet.length > 10, `snippet too short for ${r.article.slug}`);
  }
});
