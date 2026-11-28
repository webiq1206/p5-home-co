/**
 * Pricing releases: preview the workbook, stage a version, publish it, roll back.
 * Administrators only. A preview changes nothing. Staging stores an immutable
 * candidate. Only publish and rollback move the pointer, and each is one audited row.
 */
import { activeRelease, forgetActiveRelease } from "../../../lib/pricing-release/runtime.ts";
import {
  listPricingReleases, PricingReleaseError, PricingReleaseValidationError, promotePricingRelease,
  requirePricingAdministrator, stagePricingRelease, P5_COST_BOOK_WORKBOOK_ID,
} from "../../../lib/pricing-release/store.ts";
import { previewWorkbook, readLiveWorkbook, readUploadedWorkbook, workbookConfigured, type WorkbookValues } from "../../../lib/pricing-release/workbook.ts";
import { validPricingDigest } from "../../../../lib/p5/pricingRelease.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

function failure(error: unknown) {
  if (error instanceof PricingReleaseValidationError) return json({ error: error.message, issues: error.issues }, 422);
  if (error instanceof PricingReleaseError) return json({ error: error.message }, error.status);
  console.error("[pricing-release]", (error as Error).message);
  return json({ error: (error as Error).message || "The pricing release request failed." }, 400);
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try { return new URL(origin).host === host; } catch { return false; }
}

export async function GET() {
  try {
    const listing = await listPricingReleases();
    const active = await activeRelease();
    return json({ ...listing, pricing: { version: active.version, digest: active.digest, source: active.source }, liveWorkbook: workbookConfigured() });
  } catch (error) { return failure(error); }
}

async function workbookFrom(request: Request, form: FormData | null): Promise<WorkbookValues> {
  const file = form?.get("workbook");
  if (file instanceof File) return readUploadedWorkbook(await file.arrayBuffer());
  if (!workbookConfigured()) throw new PricingReleaseError(400, "Upload the workbook as .xlsx, or connect the live workbook with a service account.");
  return readLiveWorkbook();
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return json({ error: "This request did not come from P5 Admin." }, 403);
    await requirePricingAdministrator();
    const multipart = (request.headers.get("content-type") ?? "").includes("multipart/form-data");
    const form = multipart ? await request.formData() : null;
    const body = (form ? Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")) : await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "");

    if (action === "preview" || action === "stage") {
      const values = await workbookFrom(request, form);
      const active = await activeRelease();
      const preview = previewWorkbook(values, active);
      if (!preview.ok) return json({ ok: false, revision: preview.revision, issues: preview.issues, active: active.version }, action === "stage" ? 422 : 200);
      const summary = { ok: true, revision: preview.revision, digest: preview.digest, unchanged: preview.unchanged, active: active.version,
        diff: { ...preview.diff, rateChanges: preview.diff.rateChanges.slice(0, 500), rateChangeCount: preview.diff.rateChanges.length } };
      if (action === "preview") return json(summary);
      // Staging stores exactly what the administrator reviewed: the workbook is read again and must compile to the same digest.
      if (!validPricingDigest(body.expectedDigest) || body.expectedDigest !== preview.digest) {
        return json({ ...summary, error: "The workbook changed since the preview. Review the new preview before staging." }, 409);
      }
      if (preview.unchanged) return json({ ...summary, error: "This workbook matches the release already in force. There is nothing to stage." }, 409);
      const staged = await stagePricingRelease({ version: String(body.version ?? ""), snapshot: preview.snapshot, workbookId: P5_COST_BOOK_WORKBOOK_ID, workbookRevision: preview.revision });
      return json({ ...summary, staged });
    }

    if (action === "publish" || action === "rollback") {
      const result = await promotePricingRelease({
        action, version: String(body.version ?? ""), expectedDigest: String(body.expectedDigest ?? ""),
        expectedGeneration: Number(body.expectedGeneration), reason: String(body.reason ?? ""),
        verificationReference: String(body.verificationReference ?? ""),
      });
      forgetActiveRelease();
      return json({ ok: true, ...result });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (error) { return failure(error); }
}
