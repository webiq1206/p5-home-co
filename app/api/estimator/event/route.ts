/**
 * Funnel events from the estimator (started, step viewed, completed...).
 * Carries no personal information: see guided_estimate_event.
 */

import { isDatabaseConfigured } from "../../../lib/db.ts";
import { brandConfig } from "../../../lib/estimator/brands.ts";
import { flowById } from "../../../lib/estimator/flows.ts";
import { recordEvent } from "../../../lib/estimator/store.ts";
import { collectAttribution } from "../../../lib/leads/attribution.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const text = await request.text();
    if (text.length > 4000 || !isDatabaseConfigured()) return new Response(null, { status: 204 });
    const body = JSON.parse(text) as Record<string, unknown>;
    const brand = brandConfig(String(body.brand ?? ""));
    if (!brand) return new Response(null, { status: 204 });
    await recordEvent({
      session: String(body.session ?? ""),
      brand: brand.id,
      project: flowById(String(body.project ?? ""))?.id ?? null,
      name: String(body.name ?? ""),
      step: typeof body.step === "string" ? body.step : null,
      attribution: collectAttribution((body.attribution ?? {}) as Record<string, unknown>),
    });
  } catch {
    // Analytics must never surface an error to a customer.
  }
  return new Response(null, { status: 204 });
}
