/**
 * Add a recording segment, dictated note, document, photo, quote or typed
 * note. Idempotent by clientKey: the recorder retries a segment until it gets
 * a response, and a repeat returns the row created the first time.
 */

import { fail, ok, requireProject } from "../../../../../lib/scopes/http.ts";
import { MAX_UPLOAD_BYTES, storeBytes } from "../../../../../lib/scopes/files.ts";
import { insertAsset, type AssetRow } from "../../../../../lib/scopes/store.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
const KINDS = new Set(["recording", "note", "document", "photo", "quote", "text"]);
const KEY = /^[A-Za-z0-9_.:-]{8,120}$/;

export async function POST(request: Request, { params }: Ctx) {
  const g = await requireProject((await params).id);
  if ("response" in g) return g.response;
  try {
    const type = request.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      const body = (await request.json()) as { clientKey?: string; text?: string; label?: string };
      if (!body.clientKey || !KEY.test(body.clientKey)) throw new Error("Missing upload key.");
      const text = (body.text ?? "").trim();
      if (!text) throw new Error("The note is empty.");
      const { asset, duplicate } = await insertAsset({
        projectId: g.project.id,
        clientKey: body.clientKey,
        kind: "text",
        label: (body.label ?? "Typed note").slice(0, 200),
        bodyText: text.slice(0, 100_000),
        state: "ready",
        userId: g.user.id,
      });
      return ok({ asset: summary(asset), duplicate });
    }
    const form = await request.formData();
    const file = form.get("file");
    const clientKey = String(form.get("clientKey") ?? "");
    const kind = String(form.get("kind") ?? "document");
    if (!(file instanceof File)) throw new Error("No file was received.");
    if (!KEY.test(clientKey)) throw new Error("Missing upload key.");
    if (!KINDS.has(kind) || kind === "text") throw new Error("Unknown upload type.");
    if (file.size === 0) throw new Error(`${file.name} is empty.`);
    if (file.size > MAX_UPLOAD_BYTES) throw new Error(`${file.name} is over 40 MB.`);
    const data = Buffer.from(await file.arrayBuffer());
    const stored = await storeBytes(g.project.id, data);
    const num = (k: string) => {
      const v = form.get(k);
      const n = v === null ? NaN : Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const { asset, duplicate } = await insertAsset({
      projectId: g.project.id,
      clientKey,
      kind: kind as AssetRow["kind"],
      label: String(form.get("label") ?? file.name).slice(0, 200),
      fileName: file.name.replace(/[\u0000-\u001f/\\]/g, "_").slice(0, 180),
      mimeType: file.type || "application/octet-stream",
      size: data.length,
      sha256: stored.sha256,
      bucket: stored.bucket,
      key: stored.key,
      data: stored.data,
      recordingId: (form.get("recordingId") as string | null)?.slice(0, 80) ?? null,
      segmentIndex: num("segmentIndex"),
      offsetSeconds: num("offsetSeconds") ?? 0,
      durationSeconds: num("durationSeconds"),
      bodyText: (form.get("note") as string | null)?.slice(0, 10_000) ?? null,
      state: kind === "recording" || kind === "note" ? "stored" : "ready",
      userId: g.user.id,
    });
    return ok({ asset: summary(asset), duplicate });
  } catch (error) {
    return fail(error);
  }
}

function summary(a: AssetRow) {
  return { id: a.id, clientKey: a.client_key, kind: a.kind, state: a.state };
}
