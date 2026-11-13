/**
 * Upload a large file in pieces. One request per piece; the last request
 * (finish=1) joins them into one stored file. Idempotent: a piece sent twice is
 * kept once, and a repeated finish returns the file created the first time.
 */

import { fail, ok, requireProject } from "../../../../../lib/scopes/http.ts";
import { MAX_FILE_BYTES, UPLOAD_PART_BYTES, storeBytes } from "../../../../../lib/scopes/files.ts";
import { assetByClientKey, clearUploadParts, insertAsset, readUploadPart, saveUploadPart, uploadPartCount, type AssetRow } from "../../../../../lib/scopes/store.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };
const KINDS = new Set(["document", "photo", "quote"]);
const KEY = /^[A-Za-z0-9_.:-]{8,120}$/;

export async function POST(request: Request, { params }: Ctx) {
  const g = await requireProject((await params).id);
  if ("response" in g) return g.response;
  try {
    const form = await request.formData();
    const uploadKey = String(form.get("uploadKey") ?? "");
    const total = Number(form.get("parts"));
    const size = Number(form.get("size"));
    if (!KEY.test(uploadKey)) throw new Error("Missing upload key.");
    if (!Number.isInteger(total) || total < 1 || total > Math.ceil(MAX_FILE_BYTES / UPLOAD_PART_BYTES)) throw new Error("This file is too large to upload.");
    if (!Number.isFinite(size) || size <= 0 || size > MAX_FILE_BYTES) throw new Error(`Files up to ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB can be uploaded.`);

    const piece = form.get("file");
    if (piece instanceof File) {
      const part = Number(form.get("part"));
      if (!Number.isInteger(part) || part < 0 || part >= total) throw new Error("Unknown piece.");
      if (piece.size === 0 || piece.size > UPLOAD_PART_BYTES) throw new Error("This piece is the wrong size.");
      await saveUploadPart(g.project.id, uploadKey, part, Buffer.from(await piece.arrayBuffer()));
    }
    if (form.get("finish") !== "1") return ok({ received: await uploadPartCount(g.project.id, uploadKey), parts: total });

    const have = await uploadPartCount(g.project.id, uploadKey);
    // Already joined on an earlier attempt: insertAsset below returns that file.
    const pieces: Buffer[] = [];
    if (have > 0) {
      if (have !== total) throw new Error(`Only ${have} of ${total} pieces arrived. Upload the file again.`);
      for (let i = 0; i < total; i++) {
        const data = await readUploadPart(g.project.id, uploadKey, i);
        if (!data) throw new Error("A piece of the file is missing. Upload it again.");
        pieces.push(data);
      }
    }
    const kind = String(form.get("kind") ?? "document");
    if (!KINDS.has(kind)) throw new Error("Unknown upload type.");
    const name = String(form.get("name") ?? "file").replace(/[\u0000-\u001f/\\]/g, "_").slice(0, 180);
    if (!pieces.length) {
      // Nothing waiting: either it was joined on an earlier attempt, or it never arrived.
      const existing = await assetByClientKey(g.project.id, uploadKey);
      if (!existing) throw new Error("The file did not arrive. Upload it again.");
      return ok({ asset: { id: existing.id, clientKey: existing.client_key, kind: existing.kind, state: existing.state }, duplicate: true });
    }
    const data = Buffer.concat(pieces);
    if (data.length !== size) throw new Error("The file did not arrive complete. Upload it again.");
    const stored = await storeBytes(g.project.id, data);
    const { asset, duplicate } = await insertAsset({
      projectId: g.project.id,
      clientKey: uploadKey,
      kind: kind as AssetRow["kind"],
      label: String(form.get("label") ?? name).slice(0, 200),
      fileName: name,
      mimeType: String(form.get("mime") ?? "") || "application/octet-stream",
      size: data.length,
      sha256: stored.sha256,
      bucket: stored.bucket,
      key: stored.key,
      data: stored.data,
      state: "ready",
      userId: g.user.id,
    });
    await clearUploadParts(g.project.id, uploadKey);
    return ok({ asset: { id: asset.id, clientKey: asset.client_key, kind: asset.kind, state: asset.state }, duplicate });
  } catch (error) {
    return fail(error);
  }
}
