/**
 * One file for a quote request that is already saved (Step 1 of the form).
 *
 * The browser sends each photo or plan on its own, with the request id and the
 * token Step 1 returned, so a slow or failed upload never costs the lead and
 * the success screen can name the one file that did not arrive and retry it.
 * Storing is idempotent: a retry of the same bytes is kept once.
 *
 * The last upload of a batch (`final=1`) sends the team a short "Files added"
 * email with an admin-gated link to every file on the lead.
 */

import { NextResponse, after } from "next/server";

import { isDatabaseConfigured, query } from "../../../../lib/db.ts";
import { leadFileAdminUrl, storeLeadRequestFiles } from "../../../../lib/leads/leadRequestFiles.ts";
import { verifyRequestToken } from "../../../../lib/leads/requestToken.ts";
import { MAX_SHORT_REQUEST_FILE_BYTES, readOneUpload, ShortRequestFileError } from "../../../../lib/leads/shortRequestFiles.ts";
import { notifyLeadDetailsAdded } from "../../../../lib/notifications/lead-created.ts";
import { allowIntakeRequest, FOLLOW_UP_SCOPE } from "../../intake/abuse.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** One file plus the multipart envelope. */
const MAX_BODY_BYTES = MAX_SHORT_REQUEST_FILE_BYTES + 512 * 1024;

function isUpload(value: FormDataEntryValue | null): value is File {
  return typeof value === "object" && value !== null && typeof (value as File).arrayBuffer === "function";
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "File upload is not available right now." }, { status: 503 });
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "Each file must be 20 MB or smaller." }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Expected a file upload." }, { status: 400 });
  }

  const check = verifyRequestToken(form.get("token"), form.get("id"));
  if (!check.ok) {
    const expired = check.reason === "expired";
    return NextResponse.json(
      { ok: false, error: expired ? "This page has been open a while. Text the photos to (208) 477-1169 instead." : "We could not match that upload to a request." },
      { status: expired ? 410 : 403 },
    );
  }

  try {
    if (!(await allowIntakeRequest(request, new Date(), FOLLOW_UP_SCOPE))) {
      return NextResponse.json({ ok: false, error: "Too many uploads from this connection. Text the photos to (208) 477-1169." }, { status: 429 });
    }
  } catch (error) {
    console.error("[short-request/files] anti-abuse check failed:", (error as Error).message);
    return NextResponse.json({ ok: false, error: "We could not safely accept that file just now." }, { status: 503 });
  }

  const entry = form.get("file");
  if (!isUpload(entry) || entry.size === 0) {
    return NextResponse.json({ ok: false, error: "Choose a file to send." }, { status: 422 });
  }

  let stored;
  try {
    stored = await readOneUpload(entry);
  } catch (error) {
    if (error instanceof ShortRequestFileError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 422 });
    }
    return NextResponse.json({ ok: false, error: "That file could not be read." }, { status: 400 });
  }

  try {
    const [outcome] = await storeLeadRequestFiles(check.dealId, [stored]);
    if (!outcome || outcome.status === "rejected") {
      return NextResponse.json({ ok: false, error: outcome?.error ?? "That file did not attach." }, { status: 422 });
    }

    if (form.get("final") === "1") {
      const dealId = check.dealId;
      after(async () => {
        const rows = await query<{ id: string; file_name: string; brand: string; first_name: string | null; last_name: string | null; phone: string | null; email: string | null }>(
          `SELECT f.id, f.file_name, d.brand, c.first_name, c.last_name, c.phone, c.email
             FROM lead_request_file f
             JOIN deal d ON d.id = f.deal_id
             JOIN contact c ON c.id = d.contact_id
            WHERE f.deal_id = $1
              AND d.original_form IS DISTINCT FROM 'p5-estimator-synthetic-qa'
            ORDER BY f.created_at, f.id`,
          [dealId],
        ).catch(() => []);
        if (!rows.length) return;
        await notifyLeadDetailsAdded(
          {
            dealId,
            brand: rows[0].brand,
            firstName: rows[0].first_name,
            lastName: rows[0].last_name,
            phone: rows[0].phone,
            email: rows[0].email,
            lines: rows.map((row) => `File: ${row.file_name} ${leadFileAdminUrl(row.id)}`),
          },
          { subjectPrefix: "Files added" },
        );
      });
    }

    return NextResponse.json(
      { ok: true, file: { name: outcome.name, size: stored.sizeBytes }, duplicate: outcome.status === "already_stored" },
      { status: outcome.status === "stored" ? 201 : 200 },
    );
  } catch (error) {
    console.error("[short-request/files] failed:", (error as Error).message);
    return NextResponse.json({ ok: false, error: "That file did not attach. Try again, or text it to (208) 477-1169." }, { status: 500 });
  }
}
