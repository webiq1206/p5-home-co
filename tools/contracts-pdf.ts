/**
 * Write every contract template out as a PDF, for upload to QuickBooks (S222).
 *
 *   npm run contracts:pdf              # writes to ./build/contracts
 *   npm run contracts:pdf -- --out DIR
 *
 * QuickBooks contract templates take PDF only and must carry no prefilled
 * customer information, so these are rendered BLANK: every value becomes a
 * labelled rule that QuickBooks places a fill or signature field over.
 *
 * The client agreement and the Idaho disclosure are written as a numbered pair
 * so they upload into one template. Idaho requires the disclosure before
 * residential work begins, and bundling it into the same signing packet is what
 * makes "delivered and acknowledged before work" true by construction rather
 * than by someone remembering a second step.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { ALL_TEMPLATES, getTemplate } from "../app/lib/contracts/index.ts";
import { renderBlank, toPdfDocument } from "../app/lib/contracts/render.ts";
import { buildPdf } from "../app/lib/contracts/pdf.ts";

/**
 * Documents that must travel together in one QuickBooks template.
 *
 * QuickBooks allows up to five documents per template and signs them as one
 * packet, which is exactly the shape a statutory disclosure needs: the customer
 * cannot sign the agreement without also acknowledging the disclosure, and both
 * carry the same date.
 */
const BUNDLES: { name: string; templates: string[]; why: string }[] = [
  {
    name: "client-construction-agreement",
    templates: ["client_construction_agreement", "idaho_residential_disclosure"],
    why: "Idaho Code 45-525 requires the disclosure before residential work begins. Signed as one packet, the acknowledgement cannot be skipped or separately dated.",
  },
];

const bundled = new Set(BUNDLES.flatMap((b) => b.templates));

function outDir(): string {
  const i = process.argv.indexOf("--out");
  return i !== -1 && process.argv[i + 1]
    ? process.argv[i + 1]
    : path.join(process.cwd(), "build", "contracts");
}

async function main(): Promise<void> {
  const dir = outDir();
  await mkdir(dir, { recursive: true });
  const written: string[] = [];

  // Bundles first, numbered so the upload order into QuickBooks is unambiguous.
  for (const bundle of BUNDLES) {
    for (const [index, key] of bundle.templates.entries()) {
      const template = getTemplate(key);
      if (!template) throw new Error(`bundle "${bundle.name}" names unknown template "${key}"`);
      const pdf = buildPdf(toPdfDocument(renderBlank(template)));
      const file = path.join(dir, `${bundle.name}-${index + 1}-${key}.pdf`);
      await writeFile(file, pdf);
      written.push(file);
    }
    console.log(`bundle ${bundle.name}: ${bundle.templates.length} document(s)`);
    console.log(`  why: ${bundle.why}`);
  }

  for (const template of ALL_TEMPLATES) {
    if (bundled.has(template.key)) continue;
    const pdf = buildPdf(toPdfDocument(renderBlank(template)));
    const file = path.join(dir, `${template.key}.pdf`);
    await writeFile(file, pdf);
    written.push(file);
  }

  console.log(`\n${written.length} PDF(s) written to ${dir}`);
  const unreviewed = ALL_TEMPLATES.filter((t) => t.reviewState !== "approved").length;
  if (unreviewed > 0) {
    console.log(
      `\n${unreviewed} of ${ALL_TEMPLATES.length} templates are NOT attorney-reviewed.\n` +
        `Every page of those PDFs carries that warning. Do not send them to a\n` +
        `customer or subcontractor until counsel has been through them.`,
    );
  }
}

await main();
