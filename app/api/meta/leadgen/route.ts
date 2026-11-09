/**
 * Meta Instant Form webhook: GET/POST /api/meta/leadgen.
 * Handling lives in handler.ts (setup: docs/meta-leadgen-setup.md).
 */

import { after } from "next/server";

import { syncDealToHubSpot } from "../../../lib/integrations/hubspot.ts";
import { handleMetaVerify, handleMetaWebhook } from "./handler.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleMetaVerify(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleMetaWebhook(request, after, { syncHubSpot: syncDealToHubSpot });
}
