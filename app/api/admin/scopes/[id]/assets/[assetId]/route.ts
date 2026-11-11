/** Stream a saved file. Supports Range so recordings can be played from a timestamp. */

import { NextResponse } from "next/server";

import { requireProject } from "../../../../../../lib/scopes/http.ts";
import { readBytes } from "../../../../../../lib/scopes/files.ts";
import { assetStorage } from "../../../../../../lib/scopes/store.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; assetId: string }> };

export async function GET(request: Request, { params }: Ctx) {
  const p = await params;
  const g = await requireProject(p.id);
  if ("response" in g) return g.response;
  const row = await assetStorage(g.project.id, Number(p.assetId));
  if (!row) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  let data: Buffer;
  try {
    data = await readBytes(row);
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
  const type = row.mime_type || "application/octet-stream";
  const headers: Record<string, string> = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "Content-Disposition": `inline; filename="${(row.file_name ?? "file").replace(/["\r\n]/g, "")}"`,
    "X-Content-Type-Options": "nosniff",
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, data.length - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
    if (start >= data.length || start > end) {
      return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${data.length}` } });
    }
    const chunk = data.subarray(start, end + 1);
    return new NextResponse(new Uint8Array(chunk), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${data.length}`, "Content-Length": String(chunk.length) },
    });
  }
  return new NextResponse(new Uint8Array(data), { headers: { ...headers, "Content-Length": String(data.length) } });
}
