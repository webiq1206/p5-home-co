/**
 * Short primary lead form, including optional photos and plans.
 *
 * The JSON intake route stays small on purpose. Files land here, after the
 * same lead record the rest of the site already creates.
 */

import { NextResponse, after } from "next/server";

import { isDatabaseConfigured, transaction } from "../../../lib/db.ts";
import { ingestLead } from "../../../lib/leads/intake.ts";
import { loadSettings } from "../../../lib/leads/settings.ts";
import { normalizeEmail, normalizePhone } from "../../../lib/leads/normalize.ts";
import { readShortRequestFiles, ShortRequestFileError } from "../../../lib/leads/shortRequestFiles.ts";
import { collectAttribution, sourceFromAttribution } from "../../../lib/leads/attribution.ts";
import { notifyLeadCreated } from "../../../lib/notifications/lead-created.ts";
import { allowIntakeRequest } from "../intake/abuse.ts";
import { brandForProject } from "../../../quote/options.ts";
import { QUOTE_SERVICES } from "../../../quote/services.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 22 * 1024 * 1024;
const FILE_FAIL_MESSAGE =
  "Thanks. Your request is with the team. The files did not attach. Call (208) 477-1169 and we will take them another way.";
const SAVED_MESSAGE = "Thanks. Your request is with the team and someone will follow up.";

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 4000) : null;
}

function isUpload(value: FormDataEntryValue): value is File {
  return typeof value === "object" && value !== null && typeof (value as File).arrayBuffer === "function";
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isDatabaseConfigured()) {
    console.error("[short-request] DATABASE_URL is not configured; refusing the submission.");
    return NextResponse.json({ ok: false, error: "Lead intake is not configured yet." }, { status: 503 });
  }

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "Request too large." }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Expected a form submission." }, { status: 400 });
  }

  if (str(form.get("website_url") ?? form.get("company_website"))) {
    return NextResponse.json({ ok: false, error: "We could not accept that request." }, { status: 422 });
  }

  try {
    if (!(await allowIntakeRequest(request))) {
      return NextResponse.json(
        { ok: false, error: "Too many requests from this connection. Please wait an hour or call (208) 477-1169." },
        { status: 429 },
      );
    }
  } catch (error) {
    console.error("[short-request] anti-abuse check failed:", (error as Error).message);
    return NextResponse.json({ ok: false, error: "We could not safely accept that request just now." }, { status: 503 });
  }

  const wholeName = str(form.get("name"));
  const phone = str(form.get("phone"));
  const email = str(form.get("email"));
  const note = str(form.get("note"));
  const project = str(form.get("project"));
  const formName = str(form.get("form")) ?? "Short request";
  if (!wholeName) {
    return NextResponse.json({ ok: false, error: "Enter a name." }, { status: 422 });
  }
  if (!phone || !normalizePhone(phone)) {
    return NextResponse.json({ ok: false, error: "Enter a phone number so we can respond." }, { status: 422 });
  }
  if (!email) {
    return NextResponse.json({ ok: false, error: "Enter an email address." }, { status: 422 });
  }
  if (!normalizeEmail(email)) {
    return NextResponse.json({ ok: false, error: "That email address does not look right." }, { status: 422 });
  }
  if (!note) {
    return NextResponse.json({ ok: false, error: "Add a short note about the project." }, { status: 422 });
  }

  const parts = wholeName.split(/\s+/);
  const firstName = parts[0] ?? null;
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;
  const rawBody: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") rawBody[key] = value;
  }
  const attribution = collectAttribution(rawBody);
  const isQuoteForm = formName === "Quote Landing Page";
  const attributedSource = sourceFromAttribution(attribution);
  const resolvedSource = isQuoteForm || attributedSource !== "Organic Website" ? attributedSource : "Organic Website";
  const service = QUOTE_SERVICES.find((entry) => entry.project === project);
  const brand = brandForProject(project);

  let files;
  try {
    files = await readShortRequestFiles([...form.getAll("files")].filter(isUpload));
  } catch (error) {
    if (error instanceof ShortRequestFileError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 422 });
    }
    console.error("[short-request] could not read files:", (error as Error).message);
    return NextResponse.json({ ok: false, error: "We could not read those files. Try again, or call (208) 477-1169." }, { status: 400 });
  }

  const summary = [
    project ? `Project: ${project}.` : "",
    note,
    files.length ? `Files: ${files.map((file) => file.fileName).join(", ")}.` : "",
  ].filter(Boolean).join(" ");

  try {
    const settings = await loadSettings();
    const result = await ingestLead(
      {
        firstName,
        lastName,
        email,
        phone,
        brand,
        projectType: project,
        source: resolvedSource,
        sourceDetail: attribution?.gclid ?? attribution?.gbraid ?? attribution?.wbraid ?? attribution?.first_gclid ?? attribution?.utm_campaign ?? null,
        propertyAddress: null,
        propertyCity: null,
        summary,
        externalLeadId: null,
        originalForm: formName,
        originalCampaign: attribution?.first_utm_campaign ?? attribution?.utm_campaign ?? null,
        utm: (() => {
          const values = { ...(attribution ?? {}), ...(service ? { service: service.slug } : {}) };
          return Object.keys(values).length ? values : null;
        })(),
        receivedAt: new Date(),
      },
      settings,
    );

    if (result.status === "rejected") {
      const message = result.errors[0]?.message ?? "Check the name and phone and try again.";
      return NextResponse.json({ ok: false, error: message }, { status: 422 });
    }

    const created = result.status === "created";
    let filesAttached = false;
    if (files.length && result.dealId > 0) {
      try {
        await transaction(async (client) => {
          for (const file of files) {
            await client.query(
              `INSERT INTO lead_request_file (deal_id, file_name, mime_type, size_bytes, sha256, data)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [result.dealId, file.fileName, file.mimeType, file.sizeBytes, file.sha256, file.data],
            );
          }
          await client.query(
            `INSERT INTO activity (deal_id, kind, body, is_human_attempt, is_two_way)
             VALUES ($1, 'note', $2, FALSE, FALSE)`,
            [result.dealId, `Short request included ${files.length} file(s): ${files.map((file) => file.fileName).join(", ")}.`],
          );
        });
        filesAttached = true;
      } catch (error) {
        console.error("[short-request] lead saved but files did not attach:", (error as Error).message);
      }
    }

    const filesMissing = files.length > 0 && !filesAttached;
    // Mail runs after the response is finished, so a send failure cannot
    // change 201. Duplicate and rejected leads are not notified.
    // Synthetic estimator acceptances are skipped inside notifyLeadCreated.
    if (created) {
      const notice = {
        dealId: result.dealId,
        brand,
        projectType: project,
        firstName,
        lastName,
        email,
        phone,
        propertyCity: null,
        propertyAddress: null,
        summary,
        source: resolvedSource,
        originalForm: formName,
      };
      after(async () => {
        await notifyLeadCreated(notice);
      });
    }
    return NextResponse.json(
      {
        ok: true,
        duplicate: result.status === "duplicate",
        accepted: created,
        filesAttached,
        message: filesMissing ? FILE_FAIL_MESSAGE : SAVED_MESSAGE,
      },
      { status: created ? 201 : 200 },
    );
  } catch (error) {
    console.error("[short-request] failed:", (error as Error).message);
    return NextResponse.json(
      { ok: false, error: "We could not record that just now. Please call (208) 477-1169." },
      { status: 500 },
    );
  }
}
