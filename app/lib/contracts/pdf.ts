/**
 * A minimal PDF writer for contract documents (S222).
 *
 * QuickBooks contract templates accept PDF and nothing else, and this repo does
 * not take new dependencies. Contracts are pure text - no images, no tables, no
 * colour - so writing the PDF directly is a smaller and more predictable job
 * than pulling in a rendering library for a fraction of its features.
 *
 * What it produces: Letter pages, Helvetica, wrapped body text, bold headings,
 * automatic page breaks, page numbers, and an optional watermark line at the
 * top of every page for documents counsel has not approved.
 *
 * What it deliberately does not do: fonts beyond the two built-in Helvetica
 * faces, embedded images, or any layout that needs measuring beyond text width.
 * If a contract ever needs those, that is the moment to reconsider - not now.
 */

/** Letter, in PDF points (72 per inch). */
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 72;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const BODY_SIZE = 10.5;
const HEADING_SIZE = 12;
const TITLE_SIZE = 16;
const LINE_HEIGHT = 14.5;

/**
 * Average glyph width as a fraction of font size.
 *
 * Helvetica's real widths vary per character; carrying the full metrics table
 * to save a few points of line length is not worth it here. This runs
 * deliberately WIDE so a line is more likely to wrap early than to overrun the
 * right margin - a contract with text running off the page is a serious defect,
 * whereas a slightly short line is invisible.
 */
const AVG_CHAR_WIDTH = 0.52;
const BOLD_CHAR_WIDTH = 0.56;

function textWidth(text: string, size: number, bold: boolean): number {
  return text.length * size * (bold ? BOLD_CHAR_WIDTH : AVG_CHAR_WIDTH);
}

/** Wrap a paragraph to the content width, preserving explicit line breaks. */
export function wrapText(
  text: string,
  size: number,
  bold: boolean,
  width = CONTENT_WIDTH,
): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph.trim() === "") {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, size, bold) > width && line) {
        out.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

/**
 * Escape a string for a PDF literal.
 *
 * Backslash first - escaping it after the parentheses would double-escape the
 * backslashes this function just added.
 */
function pdfString(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    // The built-in Helvetica encoding has no glyphs for these, and they appear
    // constantly in text pasted from elsewhere. Substituted rather than
    // dropped, so a contract never silently loses a character.
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E]/g, "");
}

export type PdfBlock =
  | { kind: "title"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "body"; text: string }
  | { kind: "spacer" }
  /** A signature line: a rule with a caption beneath it. */
  | { kind: "signature"; role: string };

export type PdfDocument = {
  title: string;
  blocks: PdfBlock[];
  /** Printed at the top of every page, when present. */
  watermark?: string | null;
  /** Printed at the bottom of every page, before the page number. */
  footer?: string | null;
};

type Line = { text: string; size: number; bold: boolean; gapBefore: number; rule?: boolean };

/** Flatten blocks into positioned lines, so pagination is a simple loop. */
function layout(doc: PdfDocument): Line[] {
  const lines: Line[] = [];
  const push = (text: string, size: number, bold: boolean, gapBefore = 0, rule = false) =>
    lines.push({ text, size, bold, gapBefore, rule });

  push(doc.title, TITLE_SIZE, true, 0);
  push("", BODY_SIZE, false, 6);

  for (const block of doc.blocks) {
    switch (block.kind) {
      case "title":
        for (const l of wrapText(block.text, TITLE_SIZE, true)) push(l, TITLE_SIZE, true, 10);
        break;
      case "heading":
        for (const l of wrapText(block.text, HEADING_SIZE, true)) push(l, HEADING_SIZE, true, 12);
        break;
      case "body":
        for (const l of wrapText(block.text, BODY_SIZE, false)) push(l, BODY_SIZE, false, 0);
        break;
      case "spacer":
        push("", BODY_SIZE, false, 8);
        break;
      case "signature":
        // Room to actually sign, then the rule, then who is signing. QuickBooks
        // places its e-signature field over this area.
        push("", BODY_SIZE, false, 26);
        push("", BODY_SIZE, false, 0, true);
        push(block.role, BODY_SIZE, false, 2);
        break;
    }
  }
  return lines;
}

/** Build the PDF as bytes. */
export function buildPdf(doc: PdfDocument): Uint8Array {
  const lines = layout(doc);
  const pages: string[] = [];

  let content = "";
  let y = PAGE_HEIGHT - MARGIN;
  const bottom = MARGIN + 24; // leave room for the footer

  const startPage = () => {
    content = "";
    y = PAGE_HEIGHT - MARGIN;
    if (doc.watermark) {
      const wrapped = wrapText(doc.watermark, 8, true);
      for (const l of wrapped) {
        content += `BT /F2 8 Tf ${MARGIN} ${y} Td (${pdfString(l)}) Tj ET\n`;
        y -= 10;
      }
      y -= 8;
    }
  };

  startPage();

  for (const line of lines) {
    y -= line.gapBefore;
    if (y < bottom) {
      pages.push(content);
      startPage();
      y -= line.gapBefore;
    }
    if (line.rule) {
      content += `${MARGIN} ${y + 3} m ${MARGIN + 260} ${y + 3} l S\n`;
    } else if (line.text) {
      const font = line.bold ? "/F2" : "/F1";
      content += `BT ${font} ${line.size} Tf ${MARGIN} ${y} Td (${pdfString(line.text)}) Tj ET\n`;
    }
    y -= LINE_HEIGHT;
  }
  pages.push(content);

  // Footer and page number on every page, added after pagination is known.
  const total = pages.length;
  const finished = pages.map((body, i) => {
    const label = doc.footer ? `${doc.footer}   -   Page ${i + 1} of ${total}` : `Page ${i + 1} of ${total}`;
    return `${body}BT /F1 8 Tf ${MARGIN} ${MARGIN - 18} Td (${pdfString(label)}) Tj ET\n`;
  });

  return assemble(finished);
}

/** Object numbering: 1 catalog, 2 pages, 3 F1, 4 F2, then page/content pairs. */
function assemble(pageContents: string[]): Uint8Array {
  const objects: string[] = [];
  const pageIds: number[] = [];
  const firstPageObj = 5;

  pageContents.forEach((_, i) => pageIds.push(firstPageObj + i * 2));

  objects.push(`<< /Type /Catalog /Pages 2 0 R >>`);
  objects.push(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageContents.length} >>`,
  );
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`);
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`);

  pageContents.forEach((body, i) => {
    const contentId = firstPageObj + i * 2 + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    objects.push(`<< /Length ${body.length} >>\nstream\n${body}endstream`);
  });

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  // latin1 so every byte written is the byte counted in /Length above. UTF-8
  // would silently widen any non-ASCII character and corrupt the stream length.
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}
