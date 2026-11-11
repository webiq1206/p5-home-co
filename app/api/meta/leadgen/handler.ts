/**
 * Meta Instant Form (leadgen) webhook: GET verify, POST deliveries.
 *
 * Contract and setup: docs/meta-leadgen-setup.md. Free of next/server so tests
 * call it with constructed Requests; route.ts passes the real `after` and
 * HubSpot sync.
 *
 * Fail closed: without META_APP_SECRET no delivery can be verified, so none is
 * accepted (503, and Meta retries later). A bad signature is a 403. Meta gets
 * its 200 only after every leadgen id in the delivery is durably saved; the
 * Graph fetch, intake, HubSpot sync and alert run after the response, and
 * anything unfinished is retried by the watchdog.
 */

import { isDatabaseConfigured } from "../../../lib/db.ts";
import {
  leadgenEvents,
  metaConfig,
  processMetaLeadEvent,
  saveLeadgenEvents,
  signatureIsValid,
  type MetaDeps,
} from "../../../lib/integrations/meta-leadgen.ts";

const LOG = "[meta-leadgen]";
const MAX_BODY_BYTES = 256 * 1024;

export type AfterResponse = (task: () => Promise<void>) => void;

export function handleMetaVerify(request: Request, env: Record<string, string | undefined> = process.env): Response {
  const params = new URL(request.url).searchParams;
  const { verifyToken } = metaConfig(env);
  const mode = params.get("hub.mode");
  const challenge = params.get("hub.challenge");
  if (!verifyToken) {
    console.error(`${LOG} META_LEADGEN_VERIFY_TOKEN is not set; the subscription handshake is refused.`);
    return new Response("Not configured", { status: 503 });
  }
  if (mode === "subscribe" && params.get("hub.verify_token") === verifyToken && challenge !== null && /^[A-Za-z0-9._-]{1,200}$/.test(challenge)) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  console.warn(`${LOG} verification handshake rejected (mode ${mode ?? "none"}).`);
  return new Response("Forbidden", { status: 403 });
}

export async function handleMetaWebhook(request: Request, after: AfterResponse, deps: MetaDeps = {}): Promise<Response> {
  // Never acknowledge an unpersisted delivery. A slow DB/body returns 503
  // within the acknowledgement budget, letting Meta redeliver safely.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = Date.now() + 1750;
  try {
    return await Promise.race([
      acceptMetaWebhook(request, after, deps, deadline),
      new Promise<Response>(resolve => { timer = setTimeout(() => resolve(new Response("Retry later", { status: 503 })), 1750); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

async function acceptMetaWebhook(request: Request, after: AfterResponse, deps: MetaDeps, deadline: number): Promise<Response> {
  const config = metaConfig(deps.env);
  if (!config.appSecret) {
    console.error(`${LOG} META_APP_SECRET is not set; deliveries cannot be verified and are refused (Meta will retry).`);
    return new Response("Not configured", { status: 503 });
  }
  if (!isDatabaseConfigured()) {
    console.error(`${LOG} DATABASE_URL is not configured; refusing the delivery so Meta retries.`);
    return new Response("Not configured", { status: 503 });
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return new Response("Too large", { status: 413 });
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return new Response("Too large", { status: 413 });
  if (!signatureIsValid(raw, request.headers.get("x-hub-signature-256"), config.appSecret)) {
    console.warn(`${LOG} signature check failed; delivery rejected.`);
    return new Response("Forbidden", { status: 403 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    // Signed but unreadable: nothing to save, and a retry would be identical.
    console.warn(`${LOG} signed delivery carried invalid JSON; acknowledged without processing.`);
    return Response.json({ received: true, saved: 0 });
  }
  const events = leadgenEvents(body);
  if (!config.defaultToken && !Object.keys(config.pageTokens).length) {
    console.error(`${LOG} no Page token is set (META_PAGE_ACCESS_TOKEN or META_PAGE_TOKENS); deliveries are saved and wait for one.`);
  }
  let fresh: string[];
  try {
    fresh = await saveLeadgenEvents(events);
  } catch {
    // Not saved means not acknowledged: Meta redelivers.
    console.error(`${LOG} could not save the delivery; answering 500 so Meta retries.`);
    return new Response("Not saved", { status: 500 });
  }
  if (fresh.length && Date.now() < deadline) {
    after(async () => {
      for (const id of fresh) {
        try {
          await processMetaLeadEvent(id, deps);
        } catch (error) {
          console.error(`${LOG} lead ${id} processing failed; the watchdog retries:`, (error as Error).message);
        }
      }
    });
  }
  return Response.json({ received: true, saved: fresh.length, duplicate: events.length - fresh.length });
}
