import { createHash } from "node:crypto";

/**
 * A short request can carry photos, plans or inspiration. It is not a document
 * vault. The browser sends each file in its own request after the lead is
 * saved, so one file is checked at a time against the per-file limit and the
 * per-lead count. MAX_SHORT_REQUEST_TOTAL_BYTES caps a single request, which
 * only matters for the no-JavaScript form that posts files with the lead.
 */
export const MAX_SHORT_REQUEST_FILES = 10;
export const MAX_SHORT_REQUEST_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_SHORT_REQUEST_TOTAL_BYTES = 20 * 1024 * 1024;

export const SHORT_REQUEST_FILE_ERRORS = {
  count: `Attach up to ${MAX_SHORT_REQUEST_FILES} files.`,
  size: "Each file must be 20 MB or smaller.",
  total: "Those files together are larger than 20 MB.",
  type: "Use a photo (JPEG, PNG, GIF, WebP, or HEIC) or a PDF.",
  empty: "That file is empty.",
} as const;

const HEIC_BRANDS = new Set(["heic", "heif", "mif1", "msf1"]);

export class ShortRequestFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShortRequestFileError";
  }
}

export interface StoredLeadFile {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  data: Buffer;
}

export interface UploadLike {
  name: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

/** Magic bytes only. A browser-supplied type is not evidence. */
export function sniffMime(data: Uint8Array): string | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  ) {
    return "image/png";
  }
  const head6 = ascii(data, 0, 6);
  if (head6 === "GIF87a" || head6 === "GIF89a") return "image/gif";
  if (ascii(data, 0, 4) === "RIFF" && ascii(data, 8, 12) === "WEBP") return "image/webp";
  if (ascii(data, 0, 5) === "%PDF-") return "application/pdf";
  if (ascii(data, 4, 8) === "ftyp" && HEIC_BRANDS.has(ascii(data, 8, 12))) return "image/heic";
  return null;
}

/** Drop directories and control characters. The stored name is a label, not a path. */
export function sanitizeUploadName(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "";
  const cleaned = base.replace(/[^\w.\- ()]+/g, "").replace(/^\.+/, "").trim().slice(0, 120);
  return cleaned || "upload";
}

/** Read and check one file. Throws ShortRequestFileError with a plain message. */
export async function readOneUpload(file: UploadLike): Promise<StoredLeadFile> {
  // The declared size is checked before reading, so an oversized file is never buffered.
  if (file.size > MAX_SHORT_REQUEST_FILE_BYTES) throw new ShortRequestFileError(SHORT_REQUEST_FILE_ERRORS.size);
  const data = Buffer.from(await file.arrayBuffer());
  if (data.length === 0) throw new ShortRequestFileError(SHORT_REQUEST_FILE_ERRORS.empty);
  if (data.length > MAX_SHORT_REQUEST_FILE_BYTES) throw new ShortRequestFileError(SHORT_REQUEST_FILE_ERRORS.size);
  const mimeType = sniffMime(data);
  if (!mimeType) throw new ShortRequestFileError(SHORT_REQUEST_FILE_ERRORS.type);
  return {
    fileName: sanitizeUploadName(file.name || "upload"),
    mimeType,
    sizeBytes: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
    data,
  };
}

export type UploadOutcome = { name: string; file: StoredLeadFile | null; error: string | null };

/**
 * Check several files, one verdict each. A bad file never takes the others,
 * or the lead, down with it: the caller stores what passed and names the rest.
 */
export async function readEachUpload(entries: Iterable<UploadLike>): Promise<UploadOutcome[]> {
  const outcomes: UploadOutcome[] = [];
  let total = 0;
  for (const entry of [...entries].filter((file) => file.size > 0)) {
    const name = sanitizeUploadName(entry.name || "upload");
    if (outcomes.filter((outcome) => outcome.file).length >= MAX_SHORT_REQUEST_FILES) {
      outcomes.push({ name, file: null, error: SHORT_REQUEST_FILE_ERRORS.count });
      continue;
    }
    if (total + entry.size > MAX_SHORT_REQUEST_TOTAL_BYTES) {
      outcomes.push({ name, file: null, error: SHORT_REQUEST_FILE_ERRORS.total });
      continue;
    }
    try {
      const file = await readOneUpload(entry);
      total += file.sizeBytes;
      outcomes.push({ name, file, error: null });
    } catch (error) {
      outcomes.push({ name, file: null, error: error instanceof ShortRequestFileError ? error.message : "That file could not be read." });
    }
  }
  return outcomes;
}

/** All-or-nothing check of a batch, rejecting extras before reading any of them. */
export async function readShortRequestFiles(entries: Iterable<UploadLike>): Promise<StoredLeadFile[]> {
  const files = [...entries].filter((file) => file.size > 0);
  if (files.length > MAX_SHORT_REQUEST_FILES) {
    throw new ShortRequestFileError(SHORT_REQUEST_FILE_ERRORS.count);
  }
  let declared = 0;
  for (const file of files) {
    if (file.size > MAX_SHORT_REQUEST_FILE_BYTES) {
      throw new ShortRequestFileError(SHORT_REQUEST_FILE_ERRORS.size);
    }
    declared += file.size;
    if (declared > MAX_SHORT_REQUEST_TOTAL_BYTES) {
      throw new ShortRequestFileError(SHORT_REQUEST_FILE_ERRORS.total);
    }
  }
  const stored: StoredLeadFile[] = [];
  for (const outcome of await readEachUpload(files)) {
    if (outcome.error && outcome.error !== SHORT_REQUEST_FILE_ERRORS.empty) throw new ShortRequestFileError(outcome.error);
    if (outcome.file) stored.push(outcome.file);
  }
  return stored;
}

function ascii(data: Uint8Array, start: number, end: number): string {
  if (data.length < end) return "";
  let text = "";
  for (let i = start; i < end; i += 1) text += String.fromCharCode(data[i]);
  return text;
}
