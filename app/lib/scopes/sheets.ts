/**
 * Reading a long PDF page by page. Server only.
 *
 * A plan set or a long scope of work is too large to hand to the model whole:
 * dimension text on a full sheet is unreadable once the sheet is shrunk to fit.
 * Each page is therefore read on its own, from its exact text layer plus an
 * overview and enlarged tiles, and what was read is saved per page. Reading
 * resumes where it stopped, so a set of any length is finished across as many
 * requests as it takes and no page is read twice.
 */

import { createCanvas } from "@napi-rs/canvas";

import { pdfjsAssetOptions } from "../../../lib/p5/pdfjsAssets.ts";
import { pageTextFromItems } from "../../../lib/p5/pdfText.ts";
import { readSheet } from "./ai.ts";
import { listSheets, saveSheet } from "./store.ts";

/** A short PDF is read whole by the model; anything longer or heavier goes page by page. */
export const WHOLE_PDF_MAX_PAGES = 8;
export const WHOLE_PDF_MAX_BYTES = 20 * 1024 * 1024;
const TILE = 1500;
const OVERLAP = 120;
const MAX_TILES = 12;
const CONCURRENCY = 3;

export function readsPageByPage(pages: number, bytes: number): boolean {
  return pages > WHOLE_PDF_MAX_PAGES || bytes > WHOLE_PDF_MAX_BYTES;
}

/** How a rendered page is cut into tiles: columns, rows and each tile's rectangle. Pure. */
export function tileGrid(width: number, height: number): { x: number; y: number; w: number; h: number }[] {
  if (width <= TILE * 1.25 && height <= TILE * 1.25) return [];
  const cuts = (size: number) => {
    const n = Math.max(1, Math.ceil((size - OVERLAP) / (TILE - OVERLAP)));
    const step = n === 1 ? 0 : (size - TILE) / (n - 1);
    return Array.from({ length: n }, (_, i) => Math.max(0, Math.round(i * step)));
  };
  const xs = cuts(width);
  const ys = cuts(height);
  const out: { x: number; y: number; w: number; h: number }[] = [];
  for (const y of ys) for (const x of xs) out.push({ x, y, w: Math.min(TILE, width - x), h: Math.min(TILE, height - y) });
  return out;
}

/** The render scale for a page: enough detail to read dimension text, capped so tiles stay within the limit. */
export function renderScale(pointsWide: number, pointsHigh: number): number {
  // 150 DPI is 150/72 of a point. Large sheets are reduced until they fit the tile budget.
  let scale = 150 / 72;
  while (scale > 0.6) {
    const tiles = tileGrid(Math.ceil(pointsWide * scale), Math.ceil(pointsHigh * scale)).length;
    if (tiles <= MAX_TILES) break;
    scale *= 0.9;
  }
  return scale;
}

type PdfDoc = {
  numPages: number;
  getPage: (n: number) => Promise<{
    getViewport: (o: { scale: number }) => { width: number; height: number };
    render: (o: Record<string, unknown>) => { promise: Promise<void> };
    getTextContent: () => Promise<{ items: unknown[] }>;
    cleanup: () => void;
  }>;
};

async function openPdf(data: Buffer): Promise<{ document: PdfDoc; close: () => Promise<void> }> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(data), ...pdfjsAssetOptions(), disableFontFace: true } as never);
  const document = (await task.promise) as unknown as PdfDoc;
  return { document, close: () => task.destroy().catch(() => undefined) as Promise<void> };
}

export async function pdfPageCount(data: Buffer): Promise<number> {
  const pdf = await openPdf(data);
  try {
    return pdf.document.numPages;
  } finally {
    await pdf.close();
  }
}

/** One page as exact text plus images: an overview, then tiles in reading order. */
async function pageInput(document: PdfDoc, pageNumber: number): Promise<{ text: string; images: string[] }> {
  const sharp = (await import("sharp")).default;
  const page = await document.getPage(pageNumber);
  try {
    const text = await page
      .getTextContent()
      .then((c) => pageTextFromItems(c.items as never))
      .catch(() => "");
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: renderScale(base.width, base.height) });
    const width = Math.ceil(viewport.width);
    const height = Math.ceil(viewport.height);
    const canvas = createCanvas(width, height);
    await page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport, background: "white" } as never).promise;
    const full = canvas.toBuffer("image/png");
    canvas.width = 1;
    const jpeg = async (input: Buffer) => `data:image/jpeg;base64,${(await sharp(input).jpeg({ quality: 82 }).toBuffer()).toString("base64")}`;
    const overview = await jpeg(await sharp(full).resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).toBuffer());
    const images = [overview];
    for (const t of tileGrid(width, height)) {
      images.push(await jpeg(await sharp(full).extract({ left: t.x, top: t.y, width: t.w, height: t.h }).toBuffer()));
    }
    return { text, images };
  } finally {
    page.cleanup();
  }
}

export type SheetProgress = { total: number; read: number; failed: number; complete: boolean };

/**
 * Read every page not yet read, until done or the deadline. A page that fails
 * is recorded and retried on the next pass rather than skipped silently.
 */
export async function readSheets(input: {
  assetId: number;
  fileName: string;
  data: Buffer;
  deadline: number;
  onProgress?: (p: SheetProgress) => Promise<void> | void;
}): Promise<SheetProgress> {
  const pdf = await openPdf(input.data);
  try {
    const total = pdf.document.numPages;
    const done = new Map((await listSheets(input.assetId)).map((s) => [s.page, s]));
    const todo: number[] = [];
    for (let p = 1; p <= total; p++) if (!done.get(p)?.notes) todo.push(p);
    let read = total - todo.length;
    let failed = 0;
    const report = () => input.onProgress?.({ total, read, failed, complete: false });

    // Rendering is done one page at a time (it is processor work); the model calls overlap.
    const running = new Set<Promise<void>>();
    for (const pageNumber of todo) {
      if (Date.now() > input.deadline) break;
      const prepared = await pageInput(pdf.document, pageNumber).catch((e: Error) => e);
      const job = (async () => {
        if (prepared instanceof Error) {
          failed++;
          await saveSheet(input.assetId, pageNumber, null, `Could not be opened: ${prepared.message.slice(0, 200)}`);
          return;
        }
        try {
          const notes = await readSheet({ fileName: input.fileName, page: pageNumber, pages: total, text: prepared.text, images: prepared.images });
          await saveSheet(input.assetId, pageNumber, notes || "(blank page)", null);
          read++;
        } catch (e) {
          failed++;
          await saveSheet(input.assetId, pageNumber, null, (e as Error).message.slice(0, 300));
        }
        await report();
      })();
      running.add(job);
      void job.finally(() => running.delete(job));
      if (running.size >= CONCURRENCY) await Promise.race(running);
    }
    await Promise.all(running);
    return { total, read, failed, complete: read === total };
  } finally {
    await pdf.close();
  }
}

/** Everything read from a file, as one text source for the scope. */
export async function sheetNotes(assetId: number): Promise<string> {
  const sheets = await listSheets(assetId);
  return sheets
    .filter((s) => s.notes)
    .map((s) => `[page ${s.page}]\n${s.notes}`)
    .join("\n\n");
}
