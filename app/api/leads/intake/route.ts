/**
 * Public lead intake endpoint.
 *
 * Accepts submissions from the P5 website and the sibling brand sites. Kept
 * deliberately forgiving about field names, because the brand sites are
 * separate codebases and should not need to change shape to post here.
 */

import { NextResponse } from "next/server";

import { isDatabaseConfigured } from "../../../lib/db.ts";
import { ingestLead } from "../../../lib/leads/intake.ts";
import { loadSettings } from "../../../lib/leads/settings.ts";
import { BRANDS, LEAD_SOURCES, type Brand, type LeadSource } from "../../../lib/leads/types.ts";
import { allowIntakeRequest } from "./abuse.ts";

export const dynamic = "force-dynamic";

/** Reject oversized bodies before parsing them. */
const MAX_BODY_BYTES = 32 * 1024;

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 4000) : null;
}

function pickBrand(value: unknown): Brand | null {
  const raw = str(value);
  if (!raw) return null;
  const match = BRANDS.find((b) => b.toLowerCase() === raw.toLowerCase());
  return match ?? null;
}

function pickSource(value: unknown): LeadSource {
  const raw = str(value);
  const match = LEAD_SOURCES.find((s) => s.toLowerCase() === (raw ?? "").toLowerCase());
  return match ?? "Organic Website";
}

/** Collect utm_* parameters from the body and the referring URL. */
function collectUtm(body: Record<string, unknown>): Record<string, string> | null {
  const utm: Record<string, string> = {};
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
    const value = str(body[key]);
    if (value) utm[key] = value;
  }
  return Object.keys(utm).length ? utm : null;
}

function collectAttribution(body: Record<string, unknown>): Record<string, string> | null {
  const attribution: Record<string, string> = {};
  for (const key of [
    "gclid", "gbraid", "wbraid", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "landing_page", "referrer", "service",
    "first_gclid", "first_gbraid", "first_wbraid", "first_utm_source", "first_utm_medium",
     "first_utm_campaign", "first_utm_term", "first_utm_content", "first_landing_page", "first_referrer",
  ]) {
    const value = str(body[key]);
    if (!value) continue;
    if (key.endsWith("landing_page")) {
      try {
        const url = new URL(value, "https://p5homeco.invalid");
        if (url.origin === "https://p5homeco.invalid" && url.pathname.startsWith("/")) {
          const safe = new URLSearchParams();
          for (const allowed of ["gclid", "gbraid", "wbraid", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
            const campaignValue = url.searchParams.get(allowed);
            if (campaignValue) safe.set(allowed, campaignValue.slice(0, 300));
          }
          attribution[key] = url.pathname + (safe.size ? `?${safe}` : "");
        }
      } catch {
        // Ignore malformed landing data rather than retaining arbitrary URLs.
      }
    } else if (key.endsWith("referrer")) {
      try {
        const url = new URL(value);
        if (url.protocol === "https:" || url.protocol === "http:") attribution[key] = url.origin;
      } catch {
        // A referrer is optional and must be an origin, never an opaque string.
      }
    } else if (/^[A-Za-z0-9._~:-]{1,300}$/.test(value)) {
      attribution[key] = value;
    }
  }
  return Object.keys(attribution).length ? attribution : null;
}

function sourceFromAttribution(attribution: Record<string, string> | null): LeadSource {
  if (
    attribution?.gclid || attribution?.gbraid || attribution?.wbraid ||
    attribution?.utm_medium?.toLowerCase() === "cpc"
  ) return "Paid Search";
  if (attribution?.utm_medium?.toLowerCase().includes("social")) return "Social Media";
  return "Organic Website";
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isDatabaseConfigured()) {
    // Fail loudly to the operator, softly to the visitor: never imply a lead
    // was captured when there is nowhere to put it.
    console.error("[intake] DATABASE_URL is not configured; refusing the submission.");
    return NextResponse.json(
      { ok: false, error: "Lead intake is not configured yet." },
      { status: 503 },
    );
  }

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "Request too large." }, { status: 413 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Expected a JSON object." }, { status: 400 });
  }

  // Honeypots must never receive a thank-you response: no lead was accepted.
  if (str(body.website_url ?? body.company_website)) {
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
    console.error("[intake] anti-abuse check failed:", (error as Error).message);
    return NextResponse.json({ ok: false, error: "We could not safely accept that request just now." }, { status: 503 });
  }

  const brand = pickBrand(body.brand ?? body.company);
  if (!brand) {
    return NextResponse.json(
      { ok: false, error: `brand is required and must be one of: ${BRANDS.join(", ")}` },
      { status: 400 },
    );
  }

  // Accept either split names or a single "name" field.
  let firstName = str(body.firstName ?? body.first_name);
  let lastName = str(body.lastName ?? body.last_name);
  const wholeName = str(body.name ?? body.fullName);
  if (!firstName && !lastName && wholeName) {
    const parts = wholeName.split(/\s+/);
    firstName = parts[0] ?? null;
    lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;
  }

  const settings = await loadSettings();
  const attribution = collectAttribution(body);
  // Quote pages are public campaign destinations. Their source must reflect
  // retained click context, not a hardcoded label supplied by the browser.
  const isQuoteForm = str(body.form) === "Quote Landing Page";

  try {
    const result = await ingestLead(
      {
        firstName,
        lastName,
        email: str(body.email),
        phone: str(body.phone ?? body.telephone),
        brand,
         projectType: str(body.projectType ?? body.project_type ?? body.project),
         source: isQuoteForm ? sourceFromAttribution(attribution) : pickSource(body.source),
         sourceDetail: isQuoteForm
           ? attribution?.gclid ?? attribution?.gbraid ?? attribution?.wbraid ?? attribution?.utm_campaign ?? null
           : str(body.sourceDetail ?? body.source_detail),
        propertyAddress: str(body.address ?? body.propertyAddress),
        propertyCity: str(body.city ?? body.propertyCity),
        summary: str(body.summary ?? body.message ?? body.description),
        externalLeadId: str(body.externalLeadId ?? body.external_lead_id),
        originalForm: str(body.form ?? body.originalForm),
         originalCampaign: isQuoteForm
           ? attribution?.utm_campaign ?? null
           : str(body.campaign ?? body.originalCampaign),
          utm: (() => {
            const values = {
              ...(collectUtm(body) ?? {}),
              ...(attribution ?? {}),
              ...(str(body.service) ? { service: str(body.service)! } : {}),
            };
           return Object.keys(values).length ? values : null;
         })(),
        receivedAt: new Date(),
      },
      settings,
    );

    if (result.status === "rejected") {
      return NextResponse.json({ ok: false, errors: result.errors }, { status: 422 });
    }

    // A duplicate is a success from the visitor's point of view: their enquiry
    // is on file. Saying otherwise would invite them to submit again.
    return NextResponse.json(
      {
        ok: true,
        duplicate: result.status === "duplicate",
        accepted: result.status === "created",
        message: "Thanks. Your enquiry is with the right team and someone will be in touch.",
      },
      { status: result.status === "created" ? 201 : 200 },
    );
  } catch (error) {
    console.error("[intake] failed:", (error as Error).message);
    return NextResponse.json(
      { ok: false, error: "We could not record that just now. Please call (208) 477-1169." },
      { status: 500 },
    );
  }
}
