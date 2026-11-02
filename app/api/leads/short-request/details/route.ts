/**
 * Step 2 of the quote form: "Help us prepare (optional)".
 *
 * Adds project type, address, timing, best time to call or an email to the
 * request Step 1 saved, through the same merge the brand sites use
 * (mergeLeadDetails, docs/lead-intake-contract.md): it fills only what is
 * empty, appends a "Details added" block, is idempotent, and marks the deal
 * for HubSpot re-sync. A "not sure" request is rerouted to the company that
 * owns the project type picked here.
 *
 * The browser proves the request is its own with the Step 1 token. Nothing is
 * read back: a valid token can only add, never see.
 */

import { NextResponse, after } from "next/server";

import { isDatabaseConfigured } from "../../../../lib/db.ts";
import { mergeLeadDetails } from "../../../../lib/leads/intake.ts";
import { verifyRequestToken } from "../../../../lib/leads/requestToken.ts";
import { readShortRequestDetails } from "../../../../lib/leads/shortRequest.ts";
import { notifyLeadDetailsAdded } from "../../../../lib/notifications/lead-created.ts";
import { PROJECT_OPTIONS } from "../../../../quote/options.ts";
import { allowIntakeRequest, FOLLOW_UP_SCOPE } from "../../intake/abuse.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 8 * 1024;
const PROJECTS = PROJECT_OPTIONS.map((option) => option.value);

export async function POST(request: Request): Promise<NextResponse> {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "Saving details is not available right now." }, { status: 503 });
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "Request too large." }, { status: 413 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Expected a JSON object." }, { status: 400 });
  }

  const check = verifyRequestToken(body.token, body.id);
  if (!check.ok) {
    const expired = check.reason === "expired";
    return NextResponse.json(
      { ok: false, error: expired ? "This page has been open a while. Call or text (208) 477-1169 with the details." : "We could not match these details to a request." },
      { status: expired ? 410 : 403 },
    );
  }

  try {
    if (!(await allowIntakeRequest(request, new Date(), FOLLOW_UP_SCOPE))) {
      return NextResponse.json({ ok: false, error: "Too many requests from this connection. Call or text (208) 477-1169." }, { status: 429 });
    }
  } catch (error) {
    console.error("[short-request/details] anti-abuse check failed:", (error as Error).message);
    return NextResponse.json({ ok: false, error: "We could not safely accept that just now." }, { status: 503 });
  }

  const read = readShortRequestDetails((key) => body[key], PROJECTS);
  if (!read.ok) {
    return NextResponse.json({ ok: false, error: read.error, field: read.field }, { status: 422 });
  }
  const value = read.value;

  try {
    const result = await mergeLeadDetails(
      { dealId: check.dealId },
      {
        projectType: value.project,
        propertyAddress: value.address,
        propertyCity: null,
        timeline: value.timing,
        bestTime: value.bestTime,
        contactPreference: null,
        email: value.email,
        note: null,
        files: [],
      },
      { reroute: (project) => PROJECT_OPTIONS.find((option) => option.value === project)?.brand ?? null },
    );
    if (result.status === "not_found") {
      return NextResponse.json({ ok: false, error: "We could not match these details to a request." }, { status: 404 });
    }
    if (result.status === "merged") {
      const notice = {
        dealId: result.dealId,
        brand: result.brand,
        firstName: result.firstName,
        lastName: result.lastName,
        phone: result.phone,
        email: result.email,
        lines: result.lines,
        reroutedFrom: result.reroutedFrom,
      };
      after(async () => {
        await notifyLeadDetailsAdded(notice);
      });
    }
    return NextResponse.json({
      ok: true,
      saved: result.status === "merged",
      duplicate: result.status === "duplicate",
      team: result.status === "merged" ? result.brand : null,
    });
  } catch (error) {
    console.error("[short-request/details] failed:", (error as Error).message);
    return NextResponse.json({ ok: false, error: "We could not save that just now. Call or text (208) 477-1169." }, { status: 500 });
  }
}
