import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { leadDatabase } from "./fixtures/lead-db.ts";

// The Meta Instant Form webhook end to end against a migrated database and a
// mocked Graph API. Meta, HubSpot and mail are never reached.

process.env.SESSION_SECRET ||= "synthetic-secret-for-tests";
delete process.env.SMTP_HOST;
delete process.env.SMTP_USER;

const db = await leadDatabase();
const { handleMetaVerify, handleMetaWebhook } = await import("../app/api/meta/leadgen/handler.ts");
const meta = await import("../app/lib/integrations/meta-leadgen.ts");
type LeadCreatedNotifyInput = import("../app/lib/notifications/lead-created.ts").LeadCreatedNotifyInput;

const SECRET = "synthetic-app-secret";
const env = {
  META_LEADGEN_VERIFY_TOKEN: "verify-me",
  META_APP_SECRET: SECRET,
  META_PAGE_ACCESS_TOKEN: "default-page-token",
  META_PAGE_TOKENS: JSON.stringify({ "222": "page-222-token" }),
};
const one = async <T = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await db.rows<T>(sql, values))[0];

function delivery(changes: { leadgen_id: string; page_id?: string; form_id?: string }[], secret = SECRET) {
  const raw = JSON.stringify({ object: "page", entry: [{ id: "1228704823655951", time: 1, changes: changes.map((value) => ({ field: "leadgen", value })) }] });
  const signature = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  return new Request("https://p5homeco.com/api/meta/leadgen", { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": signature }, body: raw });
}

const graphLeads: Record<string, unknown> = {
  "9001": {
    id: "9001",
    created_time: "2026-11-09T17:00:00+0000",
    form_id: "1152385197288111",
    campaign_id: "c1", campaign_name: "P5 | Boise Remodeling Co | Kitchens", adset_id: "s1", adset_name: "Boise 35+", ad_id: "a1", ad_name: "Kitchen carousel",
    platform: "ig",
    field_data: [
      { name: "full_name", values: ["Ana Ruiz"] },
      { name: "email", values: ["ana@example.com"] },
      { name: "phone_number", values: ["+12085550177"] },
      { name: "street_address", values: ["12 N 8th St"] },
      { name: "city", values: ["Boise"] },
      { name: "zip_code", values: ["83702"] },
      { name: "what_is_your_budget?", values: ["$40k to $60k"] },
      { name: "project", values: ["Kitchen remodel"] },
    ],
  },
  "9002": {
    id: "9002", form_id: "5550001", campaign_name: "Holiday test",
    field_data: [{ name: "first_name", values: ["Kim"] }, { name: "last_name", values: ["Tran"] }, { name: "phone_number", values: ["208-555-0123"] }],
  },
};

function graph(record: { urls: string[]; auth: string[]; fail?: boolean }) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://graph.facebook.com", "only the Graph API is called");
    record.urls.push(url.pathname + url.search);
    record.auth.push(String((init?.headers as Record<string, string>)?.Authorization));
    assert.equal(url.searchParams.has("access_token"), false, "the token never rides in the URL");
    if (record.fail) return new Response(JSON.stringify({ error: { code: 2 } }), { status: 500 });
    const id = url.pathname.split("/").pop()!;
    if (id === "5550001") return Response.json({ name: "Holiday Specials Form" });
    const lead = graphLeads[id];
    return lead ? Response.json(lead) : new Response("{}", { status: 404 });
  }) as typeof fetch;
}

test("GET verify echoes the challenge only for the right token, and fails closed without one", () => {
  const ok = handleMetaVerify(new Request("https://x/api/meta/leadgen?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345"), env);
  assert.equal(ok.status, 200);
  assert.equal(handleMetaVerify(new Request("https://x/api/meta/leadgen?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1"), env).status, 403);
  assert.equal(handleMetaVerify(new Request("https://x/api/meta/leadgen?hub.mode=subscribe&hub.verify_token=&hub.challenge=1"), {}).status, 503);
});

test("POST fails closed: no secret 503, bad signature 403, nothing saved", async () => {
  const tasks: (() => Promise<void>)[] = [];
  assert.equal((await handleMetaWebhook(delivery([{ leadgen_id: "1" }]), (t) => tasks.push(t), { env: {} })).status, 503);
  assert.equal((await handleMetaWebhook(delivery([{ leadgen_id: "1" }], "forged"), (t) => tasks.push(t), { env })).status, 403);
  assert.equal(tasks.length, 0);
  assert.equal(Number((await one<{ n: number }>("SELECT count(*)::int AS n FROM meta_leadgen_event")).n), 0);
});

test("a delivery is saved before the 200, then read from Graph, ingested, synced and alerted", async () => {
  const tasks: (() => Promise<void>)[] = [];
  const record = { urls: [] as string[], auth: [] as string[] };
  const synced: number[] = [];
  const alerts: LeadCreatedNotifyInput[] = [];
  const deps = {
    env,
    fetch: graph(record),
    syncHubSpot: async (id: number) => { synced.push(id); },
    notify: async (input: LeadCreatedNotifyInput) => { alerts.push(input.prepare ? await input.prepare() : input); },
    inlineSyncTimeoutMs: 200,
  };
  const response = await handleMetaWebhook(delivery([{ leadgen_id: "9001", page_id: "1228704823655951", form_id: "1152385197288111" }]), (t) => tasks.push(t), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { received: true, saved: 1, duplicate: 0 });
  assert.equal((await one<{ state: string }>("SELECT state FROM meta_leadgen_event WHERE leadgen_id = '9001'")).state, "pending", "durable before any Graph call");
  for (const task of tasks) await task();

  assert.equal(record.auth[0], "Bearer default-page-token");
  assert.match(record.urls[0], /^\/v21\.0\/9001\?fields=id,created_time,form_id,field_data,ad_id/);
  const event = await one<{ state: string; deal_id: number }>("SELECT state, deal_id FROM meta_leadgen_event WHERE leadgen_id = '9001'");
  assert.equal(event.state, "ingested");
  const deal = await one<Record<string, unknown>>(
    "SELECT d.brand, d.lead_source, d.external_lead_id, d.facebook_lead_id, d.project_type, d.property_address, d.property_zip, d.original_form, d.original_campaign, d.utm, c.first_name, c.last_name, c.email FROM deal d JOIN contact c ON c.id = d.contact_id WHERE d.id = $1",
    [event.deal_id],
  );
  assert.equal(deal.brand, "Boise Remodeling Co");
  assert.equal(deal.lead_source, "Facebook Lead Ad");
  assert.equal(deal.external_lead_id, "9001");
  assert.equal(deal.facebook_lead_id, "9001");
  assert.equal(deal.project_type, "Kitchen remodel");
  assert.equal(deal.property_address, "12 N 8th St, 83702");
  assert.equal(deal.property_zip, "83702");
  assert.equal(deal.original_form, "Boise Remodeling Co | Remodel Quote | 2026-11");
  assert.equal(deal.first_name, "Ana");
  const utm = deal.utm as Record<string, string>;
  assert.equal(utm.utm_source, "instagram");
  assert.equal(utm.meta_form_id, "1152385197288111");
  assert.equal(utm.meta_ad_name, "Kitchen carousel");
  const fields = (await one<{ fields: { label: string; value: string }[] }>("SELECT fields FROM lead_intake_submission WHERE deal_id = $1", [event.deal_id])).fields;
  assert.ok(fields.some((f) => f.label === "what_is_your_budget?" && f.value === "$40k to $60k"), "custom questions kept verbatim");
  assert.deepEqual(synced, [event.deal_id]);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].brand, "Boise Remodeling Co");
  assert.ok(alerts[0].attribution?.some((f) => f.label === "Meta ad" && f.value === "Kitchen carousel"));

  // Meta redelivers: acknowledged, never a second lead.
  const again = await handleMetaWebhook(delivery([{ leadgen_id: "9001" }]), (t) => tasks.push(t), deps);
  assert.deepEqual(await again.json(), { received: true, saved: 0, duplicate: 1 });
  assert.equal(Number((await one<{ n: number }>("SELECT count(*)::int AS n FROM deal WHERE external_lead_id = '9001'")).n), 1);
});

test("an unknown form falls back to P5 Home Co with the form's own name, using that page's token", async () => {
  const tasks: (() => Promise<void>)[] = [];
  const record = { urls: [] as string[], auth: [] as string[] };
  await handleMetaWebhook(delivery([{ leadgen_id: "9002", page_id: "222", form_id: "5550001" }]), (t) => tasks.push(t), { env, fetch: graph(record), notify: async () => undefined });
  for (const task of tasks) await task();
  assert.deepEqual(record.auth, ["Bearer page-222-token", "Bearer page-222-token"]);
  const deal = await one<{ brand: string; original_form: string; summary: string }>("SELECT brand, original_form, summary FROM deal WHERE external_lead_id = '9002'");
  assert.equal(deal.brand, "P5 Home Co");
  assert.equal(deal.original_form, "Holiday Specials Form");
  assert.match(deal.summary, /not mapped/);
});

test("a Graph outage or a missing token keeps the lead pending for the watchdog", async () => {
  const tasks: (() => Promise<void>)[] = [];
  await handleMetaWebhook(delivery([{ leadgen_id: "9003" }]), (t) => tasks.push(t), { env, fetch: graph({ urls: [], auth: [], fail: true }) });
  for (const task of tasks) await task();
  let row = await one<{ state: string; last_error: string; attempts: number }>("SELECT state, last_error, attempts FROM meta_leadgen_event WHERE leadgen_id = '9003'");
  assert.deepEqual([row.state, row.last_error, row.attempts], ["pending", "graph-http-500-code-2", 1]);

  const noToken = { META_APP_SECRET: SECRET };
  await handleMetaWebhook(delivery([{ leadgen_id: "9004" }]), (t) => tasks.push(t), { env: noToken });
  for (const task of tasks.splice(0)) await task();
  row = await one("SELECT state, last_error, attempts FROM meta_leadgen_event WHERE leadgen_id = '9004'");
  assert.equal(row.state, "pending");
  assert.equal(row.last_error, "missing-page-token");

  // The watchdog path picks both up once Graph answers again.
  graphLeads["9003"] = { ...(graphLeads["9002"] as object), id: "9003", form_id: "965115442960999", field_data: [{ name: "full_name", values: ["Sam Lee"] }, { name: "email", values: ["sam@example.com"] }] };
  graphLeads["9004"] = { ...(graphLeads["9003"] as object), id: "9004", field_data: [{ name: "full_name", values: ["Jo Fox"] }, { name: "email", values: ["jo@example.com"] }] };
  const retried = await meta.processPendingMetaLeads(10, { env, fetch: graph({ urls: [], auth: [] }), notify: async () => undefined });
  assert.deepEqual(retried, { attempted: 2, ingested: 2 });
  assert.equal((await one<{ brand: string }>("SELECT brand FROM deal WHERE external_lead_id = '9003'")).brand, "Boise Construction Co");
});

test("brand mapping: form id, then campaign name, then P5", () => {
  assert.equal(meta.resolveMetaBrand({ id: "1", form_id: "1636211868536619" }, {}).brand, "Boise Cabinet Co");
  assert.equal(meta.resolveMetaBrand({ id: "1", form_id: "x", campaign_name: "P5 | Boise Handyman Co | Fall" }, {}).brand, "Boise Handyman Co");
  const unknown = meta.resolveMetaBrand({ id: "1", form_id: "77" }, {}, "Spring form");
  assert.deepEqual([unknown.brand, unknown.resolvedBy, unknown.formName], ["P5 Home Co", "none", "Spring form"]);
  assert.equal(meta.signatureIsValid("{}", "sha256=" + "0".repeat(64), SECRET), false);
  assert.equal(meta.signatureIsValid("{}", null, SECRET), false);
});

test("slow receipt storage is not falsely acknowledged and does not trigger provider work after timeout", async () => {
  const pool = globalThis.__p5Pool!;
  const original = pool.query;
  let afterRegistered = false;
  try {
    // No real DB/network: emulate one slow atomic receipt insert.
    pool.query = (async () => {
      await new Promise(resolve => setTimeout(resolve, 1900));
      return { rows: [{ leadgen_id: "slow-synthetic" }] };
    }) as typeof pool.query;
    const started = Date.now();
    const response = await handleMetaWebhook(delivery([{ leadgen_id: "9997" }]), () => { afterRegistered = true; }, { env });
    assert.equal(response.status, 503);
    assert.ok(Date.now() - started < 2000);
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(afterRegistered, false);
  } finally { pool.query = original; }
});
