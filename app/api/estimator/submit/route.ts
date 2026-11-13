/**
 * POST /api/estimator/submit: price a completed estimate and return the
 * customer's view. Delivery (scope platform, lead, QuickBooks, email) runs
 * after the response, so the customer sees their estimate at once.
 */

import { after } from "next/server";

import { allowIntakeRequest, clientAddress } from "../../leads/intake/abuse.ts";
import { deliverEstimate } from "../../../lib/estimator/deliver.ts";
import { handleSubmit } from "../../../lib/estimator/submit.ts";
import { publicOrigin } from "../../../lib/public-url.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const origin = publicOrigin(request);
  const address = clientAddress(request);
  return handleSubmit(request, {
    allow: (r) => allowIntakeRequest(r, new Date(), { name: "estimator-submit", max: 20 }),
    deliver: (row, estimate) =>
      after(async () => {
        try {
          await deliverEstimate({ id: row.id, origin, clientAddress: address, doc: estimate.doc, pricing: estimate.pricing, service: estimate.service });
        } catch (error) {
          console.error("[estimator] delivery failed:", (error as Error).message);
        }
      }),
  });
}
