/**
 * Intuit webhook receiver (S155, S201).
 *
 * Contract: verify the HMAC signature against the raw body, persist the
 * events, answer 2xx fast. Entity refetching happens after the response via
 * after(); anything that slips through is picked up by the daily job's
 * reconciliation pass. An unverified signature is a 401 and touches nothing.
 *
 * Configure QBO_WEBHOOK_VERIFIER with the verifier token from the Intuit
 * developer portal (Webhooks section), and register
 * https://<host>/api/qbo/webhook as the endpoint.
 */

import { NextResponse, after } from "next/server";

import { isDatabaseConfigured } from "../../../lib/db.ts";
import {
  parseWebhookEvents,
  processPendingWebhookEvents,
  storeWebhookEvents,
  verifyWebhookSignature,
} from "../../../lib/finance/qbo/webhook.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const verifier = process.env.QBO_WEBHOOK_VERIFIER;
  if (!verifier) {
    // Unconfigured is a visible operator problem, not a silent drop (S176).
    console.error("[qbo-webhook] QBO_WEBHOOK_VERIFIER is not set; refusing.");
    return NextResponse.json({ ok: false, error: "Not configured." }, { status: 503 });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "No database configured." }, { status: 503 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("intuit-signature");
  if (!verifyWebhookSignature(rawBody, signature, verifier)) {
    console.error("[qbo-webhook] signature verification failed; rejecting.");
    return NextResponse.json({ ok: false, error: "Bad signature." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "Bad JSON." }, { status: 400 });
  }

  const events = parseWebhookEvents(payload);
  const stored = events.length ? await storeWebhookEvents(events) : 0;

  // Respond now; refetch the changed entities after the response is sent.
  if (stored > 0) {
    after(async () => {
      try {
        await processPendingWebhookEvents();
      } catch (error) {
        console.error("[qbo-webhook] post-response processing failed:", (error as Error).message);
      }
    });
  }

  return NextResponse.json({ ok: true, received: events.length, stored });
}
