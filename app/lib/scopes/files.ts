/**
 * Storing project files and turning them into model input. Server only.
 *
 * Bytes go to the p5homeco.com object storage bucket when object storage is
 * enabled for this deployment (P5_OBJECT_STORAGE_ENABLED, the same switch the
 * public estimator uses); otherwise they are kept in the database row. Every
 * read verifies size and SHA-256.
 */

import { createHash } from "node:crypto";
import { Client } from "@replit/object-storage";

import { ESTIMATOR_BUCKETS } from "../../../lib/p5/objectStorage.ts";

/** Just under next.config.ts proxyClientMaxBodySize (24 MiB), leaving room for the multipart envelope. */
export const MAX_UPLOAD_BYTES = 23 * 1024 * 1024;
const BUCKET = ESTIMATOR_BUCKETS["p5homeco.com"];

export function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export async function storeBytes(
  projectId: number,
  data: Buffer,
): Promise<{ bucket: string | null; key: string | null; data: Buffer | null; sha256: string }> {
  const digest = sha256(data);
  if (process.env.P5_OBJECT_STORAGE_ENABLED === "true") {
    const key = `scope-platform/${projectId}/${digest}`;
    const result = await new Client({ bucketId: BUCKET }).uploadFromBytes(key, data);
    if (!result.ok) throw new Error("The file could not be saved to storage. Please retry.");
    return { bucket: BUCKET, key, data: null, sha256: digest };
  }
  return { bucket: null, key: null, data, sha256: digest };
}

export async function readBytes(row: {
  data: Buffer | null;
  storage_bucket: string | null;
  storage_key: string | null;
  sha256: string | null;
  size_bytes: string | number | null;
}): Promise<Buffer> {
  let data: Buffer;
  if (row.storage_key && row.storage_bucket) {
    if (row.storage_bucket !== BUCKET) throw new Error("Invalid saved file location.");
    const result = await new Client({ bucketId: row.storage_bucket }).downloadAsBytes(row.storage_key);
    if (!result.ok) throw new Error("The saved file could not be read. Please retry.");
    data = result.value[0];
  } else if (row.data) {
    data = Buffer.from(row.data);
  } else {
    throw new Error("This item has no saved file.");
  }
  if (row.sha256 && sha256(data) !== row.sha256) throw new Error("Saved file verification failed.");
  if (row.size_bytes !== null && row.size_bytes !== undefined && data.length !== Number(row.size_bytes)) {
    throw new Error("Saved file verification failed.");
  }
  return data;
}

export function classify(fileName: string, mime: string): "audio" | "image" | "pdf" | "docx" | "xlsx" | "text" | "other" {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (mime.startsWith("audio/") || mime.startsWith("video/") || ["webm", "m4a", "mp3", "wav", "ogg", "mp4", "aac", "caf"].includes(ext)) return "audio";
  if (mime.startsWith("image/") || ["jpg", "jpeg", "png", "heic", "heif", "webp", "gif"].includes(ext)) return "image";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "xlsx") return "xlsx";
  if (mime.startsWith("text/") || ["txt", "csv", "md", "json"].includes(ext)) return "text";
  return "other";
}

/** Model input for one file: text, an image, or a PDF the model reads directly. */
export type Prepared =
  | { kind: "text"; text: string }
  | { kind: "image"; dataUrl: string }
  | { kind: "pdf"; dataUrl: string; text: string }
  | { kind: "none"; reason: string };

export async function prepareForModel(fileName: string, mime: string, data: Buffer): Promise<Prepared> {
  const type = classify(fileName, mime);
  try {
    if (type === "text") return { kind: "text", text: data.toString("utf8").slice(0, 200_000) };
    if (type === "docx") {
      const mammoth = (await import("mammoth")).default;
      const { value } = await mammoth.extractRawText({ buffer: data });
      return { kind: "text", text: value.slice(0, 200_000) };
    }
    if (type === "xlsx") {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(data as unknown as ArrayBuffer);
      const out: string[] = [];
      wb.eachSheet((sheet) => {
        out.push(`## ${sheet.name}`);
        sheet.eachRow((row) => {
          const values = (row.values as unknown[]).slice(1).map((v) => (v && typeof v === "object" && "result" in (v as object) ? String((v as { result: unknown }).result) : String(v ?? "")));
          out.push(values.join(" | "));
        });
      });
      return { kind: "text", text: out.join("\n").slice(0, 200_000) };
    }
    if (type === "pdf") {
      const { pdfTextLayers } = await import("../../../lib/p5/pdfText.ts");
      const text = (await pdfTextLayers(data).catch(() => [] as string[]))
        .map((t, i) => `[page ${i + 1}]\n${t}`)
        .join("\n\n")
        .slice(0, 200_000);
      if (data.length <= 20 * 1024 * 1024) {
        return { kind: "pdf", dataUrl: `data:application/pdf;base64,${data.toString("base64")}`, text };
      }
      return { kind: "text", text };
    }
    if (type === "image") {
      let input = data;
      if (/\.(heic|heif)$/i.test(fileName) || /heic|heif/i.test(mime)) {
        // @ts-expect-error heic-convert ships without type declarations.
        const convert = (await import("heic-convert")).default as (o: { buffer: Buffer; format: "JPEG"; quality: number }) => Promise<ArrayBuffer>;
        input = Buffer.from(await convert({ buffer: data, format: "JPEG", quality: 0.85 }));
      }
      const sharp = (await import("sharp")).default;
      const jpeg = await sharp(input).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
      return { kind: "image", dataUrl: `data:image/jpeg;base64,${jpeg.toString("base64")}` };
    }
  } catch (error) {
    return { kind: "none", reason: `Could not read ${fileName}: ${(error as Error).message}` };
  }
  return { kind: "none", reason: `${fileName} is not a readable document type.` };
}
