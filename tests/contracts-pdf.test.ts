import { test } from "node:test";
import assert from "node:assert/strict";

import { buildPdf, wrapText } from "../app/lib/contracts/pdf.ts";
import { ALL_TEMPLATES, renderBlank, toPdfDocument } from "../app/lib/contracts/index.ts";

const decode = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

test("every template produces a structurally valid PDF", () => {
  // Hand-rolled writer, so the invariants a reader depends on are asserted
  // rather than assumed: a PDF that opens in one viewer and not another is the
  // failure mode here, and it is invisible without these checks.
  for (const template of ALL_TEMPLATES) {
    const pdf = decode(buildPdf(toPdfDocument(renderBlank(template))));

    assert.ok(pdf.startsWith("%PDF-1.4"), `${template.key}: missing header`);
    assert.ok(pdf.endsWith("%%EOF"), `${template.key}: missing trailer`);

    // /Length must equal the real stream size or viewers truncate the page.
    for (const m of pdf.matchAll(/<< \/Length (\d+) >>\s*stream\n([\s\S]*?)endstream/g)) {
      assert.equal(Number(m[1]), m[2].length, `${template.key}: stream length is wrong`);
    }

    // startxref must point at the xref table itself.
    const start = /startxref\n(\d+)/.exec(pdf);
    assert.ok(start, `${template.key}: no startxref`);
    assert.equal(pdf.slice(Number(start[1]), Number(start[1]) + 4), "xref", `${template.key}: startxref is wrong`);
  }
});

test("an unreviewed template prints the warning on every page", () => {
  const template = ALL_TEMPLATES.find((t) => t.reviewState === "unreviewed");
  assert.ok(template);
  const pdf = decode(buildPdf(toPdfDocument(renderBlank(template))));
  const pages = [...pdf.matchAll(/\/Type \/Page[^s]/g)].length;
  const warnings = [...pdf.matchAll(/NOT REVIEWED BY AN ATTORNEY/g)].length;
  assert.ok(pages > 0);
  assert.equal(warnings, pages, "the watermark must appear once per page, not once per document");
});

test("a blank template carries no customer data, as QuickBooks requires", () => {
  // QuickBooks: "make sure the contract doesn't include any prefilled customer
  // information". Any surviving marker would also be a broken document.
  for (const template of ALL_TEMPLATES) {
    const doc = renderBlank(template);
    for (const clause of doc.clauses) {
      assert.doesNotMatch(clause.body, /\{\{/, `${template.key}/${clause.heading}`);
    }
    // Every blank is labelled, so nobody guesses what goes in the gap.
    const joined = doc.clauses.map((c) => c.body).join(" ");
    if (template.fields.length > 0) {
      assert.match(joined, /_{10,} \[/, `${template.key}: blanks must be labelled`);
    }
  }
});

test("parentheses and backslashes are escaped, not left to corrupt the file", () => {
  // An unescaped ")" ends the PDF string early and garbles everything after
  // it, so the rest of the page renders as nonsense. Plain string checks here
  // rather than regexes, because escaping the escapes is how this gets wrong.
  const bs = String.fromCharCode(92);
  const pdf = decode(
    buildPdf({
      title: `Test (a) ${bs} b`,
      blocks: [{ kind: "body", text: `cost (net) 50${bs}50` }],
    }),
  );
  assert.ok(pdf.includes(bs + "(a" + bs + ")"), "parentheses must be escaped");
  assert.ok(pdf.includes("50" + bs + bs + "50"), "backslashes must be doubled");
  assert.ok(!pdf.includes("(cost (net)"), "an unescaped inner paren would break the string");
});

test("text wraps rather than running off the page", () => {
  const long = "word ".repeat(200).trim();
  const lines = wrapText(long, 10.5, false);
  assert.ok(lines.length > 1);
  for (const line of lines) assert.ok(line.length < 130, `line too long: ${line.length}`);
});

test("a word longer than the line does not hang the wrapper", () => {
  const lines = wrapText("x".repeat(500), 10.5, false);
  assert.ok(lines.length >= 1);
});
