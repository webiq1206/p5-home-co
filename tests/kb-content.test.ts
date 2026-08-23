import { test } from "node:test";
import assert from "node:assert/strict";

import { ALL_ARTICLES, SECTIONS, articlesInSection, getArticle } from "../app/lib/kb/index.ts";
import { blockText } from "../app/lib/kb/search.ts";

// --- Structural integrity ---------------------------------------------------

test("article slugs are unique", () => {
  const seen = new Set<string>();
  for (const a of ALL_ARTICLES) {
    assert.ok(!seen.has(a.slug), `duplicate slug: ${a.slug}`);
    seen.add(a.slug);
  }
});

test("every article belongs to a declared section", () => {
  const ids = new Set(SECTIONS.map((s) => s.id));
  for (const a of ALL_ARTICLES) {
    assert.ok(ids.has(a.section), `${a.slug} has unknown section ${a.section}`);
  }
});

test("every section has at least one article", () => {
  for (const s of SECTIONS) {
    assert.ok(articlesInSection(s.id).length > 0, `section ${s.id} is empty`);
  }
});

test("every article carries a lastVerified ISO date and a summary", () => {
  for (const a of ALL_ARTICLES) {
    assert.match(a.lastVerified, /^\d{4}-\d{2}-\d{2}$/, `${a.slug} lastVerified`);
    assert.ok(a.summary.length >= 20, `${a.slug} summary too short`);
  }
});

// --- Internal links must resolve: a Knowledge Center with dead links is
// worse than none, because it teaches people not to click. ------------------

test("every internal kb link points at a real article", () => {
  for (const a of ALL_ARTICLES) {
    for (const block of a.blocks) {
      if (block.t !== "links") continue;
      for (const link of block.items) {
        const match = link.href.match(/^\/admin\/kb\/([a-z0-9-]+)$/);
        if (!match) continue; // non-article links (sections, external)
        assert.ok(getArticle(match[1]), `${a.slug} links to missing article ${match[1]}`);
      }
    }
  }
});

test("every block renders to non-empty text (search can index everything)", () => {
  for (const a of ALL_ARTICLES) {
    for (const block of a.blocks) {
      assert.ok(blockText(block).trim().length > 0, `${a.slug} has an empty ${block.t} block`);
    }
  }
});

// --- The distinction the whole KC leans on: automatic vs human --------------

test("automation and action callouts are actually used across the corpus", () => {
  let automatic = 0;
  let action = 0;
  for (const a of ALL_ARTICLES) {
    for (const block of a.blocks) {
      if (block.t === "callout" && block.kind === "automatic") automatic += 1;
      if (block.t === "callout" && block.kind === "action") action += 1;
    }
  }
  assert.ok(automatic >= 8, `expected many AUTOMATIC callouts, found ${automatic}`);
  assert.ok(action >= 5, `expected many ACTION callouts, found ${action}`);
});
