import { createHash } from "node:crypto";

/** A short request can carry a few photos or a plan. It is not a document vault. */
export const MAX_SHORT_REQUEST_FILES = 4;
export const MAX_SHORT_REQUEST_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_SHORT_REQUEST_TOTAL_BYTES = 20 * 1024 * 1024;

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

export async function readShortRequestFiles(entries: Iterable<UploadLike>): Promise<StoredLeadFile[]> {
  const files = [...entries].filter((file) => file.size > 0);
  if (files.length > MAX_SHORT_REQUEST_FILES) {
    throw new ShortRequestFileError("Attach up to 4 files.");
  }
  let declared = 0;
  for (const file of files) {
    if (file.size > MAX_SHORT_REQUEST_FILE_BYTES) {
      throw new ShortRequestFileError("Each file must be 8 MB or smaller.");
    }
    declared += file.size;
    if (declared > MAX_SHORT_REQUEST_TOTAL_BYTES) {
      throw new ShortRequestFileError("Those files together are larger than 20 MB.");
    }
  }

  const stored: StoredLeadFile[] = [];
  let total = 0;
  for (const file of files) {
    const data = Buffer.from(await file.arrayBuffer());
    if (data.length === 0) continue;
    if (data.length > MAX_SHORT_REQUEST_FILE_BYTES) {
      throw new ShortRequestFileError("Each file must be 8 MB or smaller.");
    }
    total += data.length;
    if (total > MAX_SHORT_REQUEST_TOTAL_BYTES) {
      throw new ShortRequestFileError("Those files together are larger than 20 MB.");
    }
    const mimeType = sniffMime(data);
    if (!mimeType) {
      throw new ShortRequestFileError("Use a photo (JPEG, PNG, GIF, WebP, or HEIC) or a PDF.");
    }
    stored.push({
      fileName: sanitizeUploadName(file.name || "upload"),
      mimeType,
      sizeBytes: data.length,
      sha256: createHash("sha256").update(data).digest("hex"),
      data,
    });
  }
  return stored;
}

function ascii(data: Uint8Array, start: number, end: number): string {
  if (data.length < end) return "";
  let text = "";
  for (let i = start; i < end; i += 1) text += String.fromCharCode(data[i]);
  return text;
}
