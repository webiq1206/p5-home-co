/**
 * Real-provider smoke test for the P5 scope reader.
 *
 * This intentionally calls only the analysis provider with synthetic files.
 * It does not create a draft, send a lead, write the database, or publish
 * anything. Run it after changing the provider adapter or extraction prompt:
 *
 *   npm run check:p5-extraction
 */
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { analyzeScope } from "../lib/p5/extraction";
import { prepareAnalysisFiles, verifyUpload } from "../lib/p5/documents";
import sharp from "sharp";

function fail(message: string): never {
  console.error(`check:p5-extraction: ${message}`);
  process.exit(1);
}

function providerIsAvailable(): boolean {
  return Boolean(
    (process.env.AI_INTEGRATIONS_OPENAI_API_KEY && process.env.AI_INTEGRATIONS_OPENAI_BASE_URL) ||
      process.env.OPENAI_API_KEY ||
      process.env.ANTHROPIC_API_KEY,
  );
}

async function syntheticPdf(): Promise<Buffer> {
  const document = await PDFDocument.create();
  const page = document.addPage();
  // Keep each line legible: overlapping glyphs make this a bad OCR fixture.
  page.drawText("KITCHEN REMODEL SCOPE", { x: 40, y: 700 });
  page.drawText("Project area: 180 square feet", { x: 40, y: 675 });
  page.drawText("Room dimensions: 12 feet by 15 feet", { x: 40, y: 650 });
  page.drawText("Base cabinets: 24 linear feet", { x: 40, y: 625 });
  return Buffer.from(await document.save());
}

async function syntheticSpreadsheet(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Kitchen scope");
  sheet.addRow(["Measurement", "Value", "Unit"]);
  sheet.addRow(["Project area", 180, "SF"]);
  sheet.addRow(["Base cabinets", 24, "LF"]);
  sheet.addRow(["Finish", "mid-range", ""]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function syntheticPhoto(): Promise<Buffer> {
  const width = 320;
  const height = 240;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 3;
      pixels[offset] = Math.round(185 - y * 0.25);
      pixels[offset + 1] = Math.round(150 - y * 0.18 + x * 0.06);
      pixels[offset + 2] = Math.round(115 - y * 0.12);
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg({ quality: 85 }).toBuffer();
}

async function main(): Promise<void> {
  if (!providerIsAvailable()) {
    console.log("check:p5-extraction: provider credentials are not available; skipped.");
    process.exit(2);
  }

  const files = [
    verifyUpload("synthetic-scope.pdf", await syntheticPdf()),
    verifyUpload("synthetic-scope.xlsx", await syntheticSpreadsheet()),
    verifyUpload("synthetic-site-photo.jpg", await syntheticPhoto()),
  ];
  const prepared = await prepareAnalysisFiles(files);
  if (prepared.manualReview.length || prepared.readable.length !== 3) {
    fail(`synthetic files were not all prepared for analysis (${prepared.manualReview.join("; ") || "unexpected file count"})`);
  }

  const result = await analyzeScope(
    "Kitchen remodel in Boise. Use the measurements in the supplied scope documents.",
    prepared.readable,
    { service: "kitchen" },
  );
  const fields = new Set(result.extraction.facts.map((fact) => fact.field));
  const fact = (field: string) => result.extraction.facts.find((item) => item.field === field)?.value.trim();
  if (!fields.has("sqft") || !fields.has("cabinetBaseLf") || fact("sqft") !== "180" || fact("cabinetBaseLf") !== "24") {
    fail(`mapped measurements are missing (fields: ${[...fields].join(", ") || "none"})`);
  }
  if (!result.extraction.facts.some((fact) => fact.source.includes("synthetic-scope.pdf"))) {
    fail("the PDF source was not retained in the extracted evidence");
  }
  if (!result.extraction.facts.some((fact) => fact.source.includes("synthetic-scope.xlsx"))) {
    fail("the spreadsheet source was not retained in the extracted evidence");
  }
  if (result.extraction.reviewNotes.some((note) => /automatic (analysis|read) failed/i.test(note))) {
    fail("a provider or page failure was recorded in the successful synthetic run");
  }

  console.log(
    JSON.stringify({
      provider: result.provider,
      model: result.model,
      facts: result.extraction.facts.length,
      mappedFields: [...fields].sort(),
      conflicts: result.extraction.conflicts.length,
      reviewNotes: result.extraction.reviewNotes.length,
    }),
  );
  console.log("check:p5-extraction: OK - synthetic PDF, photo, spreadsheet, and typed scope were analyzed.");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  fail(message.replace(/(?:sk|key|token)[-_][A-Za-z0-9_-]+/gi, "[redacted]"));
});