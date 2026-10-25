/**
 * Download one file that arrived with a short website request.
 * Same ownership rule as the lead detail page: coordinators see their own leads.
 */

import { NextResponse } from "next/server";

import { getSessionUser } from "../../../lib/auth.ts";
import { isDatabaseConfigured, queryOne } from "../../../lib/db.ts";
import { seesAllLeads } from "../../../lib/leads/permissions.ts";
import { sanitizeUploadName, sniffMime } from "../../../lib/leads/shortRequestFiles.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type FileRow = {
  file_name: string;
  mime_type: string;
  data: Buffer;
  owner_user_id: string | null;
};

export async function GET(request: Request): Promise<NextResponse> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "Not available." }, { status: 503 });
  }
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });

  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "Missing file." }, { status: 404 });
  }

  const row = await queryOne<FileRow>(
    `SELECT f.file_name, f.mime_type, f.data, d.owner_user_id
       FROM lead_request_file f
       JOIN deal d ON d.id = f.deal_id
      WHERE f.id = $1`,
    [id],
  );
  if (!row) return NextResponse.json({ ok: false, error: "Missing file." }, { status: 404 });
  if (!seesAllLeads(user.role) && Number(row.owner_user_id) !== user.id) {
    return NextResponse.json({ ok: false, error: "Missing file." }, { status: 404 });
  }

  const bytes = row.data instanceof Uint8Array ? row.data : null;
  const sniffed = bytes ? sniffMime(bytes) : null;
  if (!bytes || !sniffed || sniffed !== row.mime_type) {
    return NextResponse.json({ ok: false, error: "Missing file." }, { status: 404 });
  }

  const filename = sanitizeUploadName(row.file_name).replace(/["\r\n]/g, "");
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": sniffed,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
