import assert from "node:assert/strict";
import test from "node:test";

import { leadDatabase } from "./fixtures/lead-db.ts";

// Each brand server forwards every visitor's lead to /api/leads/intake from
// its own address. The new-request limit used to be 5 per hour per address, so
// a busy hour refused real leads before they reached HubSpot. Limits are now
// keyed on the lead (brand + person, or brand + external_id for Step 2), with
// a generous per-address-and-brand ceiling kept as the spam backstop.

process.env.SESSION_SECRET ||= "synthetic-secret-for-tests";
delete process.env.SMTP_HOST;
delete process.env.HUBSPOT_TOKEN;

const db = await leadDatabase();
const { handleIntake } = await import("../app/api/leads/intake/handler.ts");
const { allowLeadIntake, INTAKE_LIMITS, leadIdentity } = await import("../app/api/leads/intake/abuse.ts");

type Json = Record<string, unknown>;
const BRAND_SERVER = "34.111.0.10";

async function post(body: Json, from = BRAND_SERVER, init: RequestInit = {}): Promise<{ status: number; json: Json }> {
  const response = await handleIntake(
    new Request("https://p5homeco.com/api/leads/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": from },
      body: JSON.stringify(body),
      ...init,
    }),
    () => undefined,
  );
  return { status: response.status, json: (await response.json()) as Json };
}

const forward = (i: number, brand = "Boise Handyman Co"): Json => ({
  brand,
  name: `Visitor ${i}`,
  form: "Handyman request",
  source: "Organic Website",
  sourceDetail: "boisehandyman.co request",
  phone: `(208) 555-${String(2000 + i)}`,
  summary: `Fix item ${i}`,
  external_id: `hm-req-${i}`,
  submission_kind: "initial",
});

const deals = async (brand: string) =>
  Number((await db.rows<{ n: number }>("SELECT count(*)::int AS n FROM deal WHERE brand = $1", [brand]))[0].n);

test("20 different leads forwarded from one brand server in one hour are all accepted", async () => {
  for (let i = 0; i < 20; i += 1) {
    const { status, json } = await post(forward(i));
    assert.equal(status, 201, `lead ${i}: ${JSON.stringify(json)}`);
    assert.equal(json.accepted, true);
  }
  assert.equal(await deals("Boise Handyman Co"), 20);
});

test("20 Step 2 posts for different leads from the same server are all accepted (past the old 40-per-address follow-up cap too)", async () => {
  for (let i = 0; i < 20; i += 1) {
    const { status } = await post({ brand: "Boise Handyman Co", submission_kind: "details", external_id: `hm-req-${i}`, timeline: "1 to 3 months" });
    assert.equal(status, 200, `details ${i}`);
  }
});

test("the same person spamming one brand is still limited, however the phone is written", async () => {
  const spellings = ["(208) 555-0199", "208-555-0199", "+1 208 555 0199", "2085550199", "1 (208) 555 0199"];
  for (const [i, phone] of spellings.entries()) {
    const { status } = await post({ brand: "Boise Remodeling Co", name: "Same Person", phone, summary: `Try ${i}` });
    assert.ok(status === 201 || status === 200, `${phone}: ${status}`);
  }
  const sixth = await post({ brand: "Boise Remodeling Co", name: "Same Person", phone: "208.555.0199", summary: "Try 6" });
  assert.equal(sixth.status, 429);
  assert.match(String(sixth.json.error), /several requests from you this hour/);
  // A different person through the same server is unaffected.
  assert.equal((await post({ brand: "Boise Remodeling Co", name: "Someone Else", phone: "2085550198", summary: "Hello" })).status, 201);
  // Email-only identities are limited the same way, case-insensitively.
  for (let i = 0; i < 5; i += 1) {
    const { status } = await post({ brand: "Boise Cabinet Co", name: "Mail Only", email: i % 2 ? "Spam@Example.com" : "spam@example.com ", summary: `Try ${i}` });
    assert.ok(status === 201 || status === 200, String(status));
  }
  assert.equal((await post({ brand: "Boise Cabinet Co", name: "Mail Only", email: "SPAM@example.com", summary: "Again" })).status, 429);
});

test("one Step 2 request id cannot be replayed without limit", async () => {
  assert.equal((await post(forward(50))).status, 201);
  for (let i = 0; i < INTAKE_LIMITS.detailsPerRequest; i += 1) {
    const { status } = await post({ brand: "Boise Handyman Co", submission_kind: "details", external_id: "hm-req-50", note: `Note ${i}` });
    assert.equal(status, 200, `details ${i}`);
  }
  assert.equal((await post({ brand: "Boise Handyman Co", submission_kind: "details", external_id: "hm-req-50", note: "One more" })).status, 429);
  // Another lead's Step 2 from the same server still goes through.
  assert.equal((await post({ brand: "Boise Handyman Co", submission_kind: "details", external_id: "hm-req-2", note: "Fine" })).status, 200);
});

test("the per-address ceiling is a backstop per brand: 120 new requests an hour, then refused; other brands unaffected", async () => {
  const now = new Date("2026-11-02T15:10:00Z");
  const request = new Request("https://p5homeco.com/api/leads/intake", { headers: { "x-forwarded-for": "198.51.100.200" } });
  for (let i = 0; i < INTAKE_LIMITS.addressCeiling; i += 1) {
    const verdict = await allowLeadIntake(request, { kind: "new", brand: "Boise Construction Co", phone: `20855${String(10000 + i)}`, email: null }, now);
    assert.deepEqual(verdict, { ok: true }, `request ${i}`);
  }
  assert.deepEqual(
    await allowLeadIntake(request, { kind: "new", brand: "Boise Construction Co", phone: "2085599999", email: null }, now),
    { ok: false, reason: "address" },
  );
  assert.deepEqual(
    await allowLeadIntake(request, { kind: "new", brand: "P5 Home Co", phone: "2085599999", email: null }, now),
    { ok: true },
  );
  // The next hour starts a fresh window.
  assert.deepEqual(
    await allowLeadIntake(request, { kind: "new", brand: "Boise Construction Co", phone: "2085599998", email: null }, new Date("2026-11-02T16:00:01Z")),
    { ok: true },
  );
});

test("a post with no phone or email falls back to the address, 5 per hour as before", async () => {
  const now = new Date("2026-11-02T18:10:00Z");
  const request = new Request("https://p5homeco.com/api/leads/intake", { headers: { "x-forwarded-for": "198.51.100.201" } });
  for (let i = 0; i < 5; i += 1) {
    assert.deepEqual(await allowLeadIntake(request, { kind: "new", brand: "P5 Home Co", phone: null, email: null }, now), { ok: true });
  }
  assert.deepEqual(await allowLeadIntake(request, { kind: "new", brand: "P5 Home Co", phone: null, email: null }, now), { ok: false, reason: "identity" });
});

test("identity: phone digits without the US country code, else a lowercased email, never a short number", () => {
  assert.equal(leadIdentity("+1 (208) 555-0142", null), "tel:2085550142");
  assert.equal(leadIdentity("208.555.0142", "x@y.z"), "tel:2085550142");
  assert.equal(leadIdentity("123", " Jane@Example.COM "), "mail:jane@example.com");
  assert.equal(leadIdentity(null, "not-an-email"), null);
});

test("abuse protection still holds: honeypot 422, oversized body 413 with or without content-length", async () => {
  assert.equal((await post({ ...forward(900), website_url: "https://spam.example" })).status, 422);
  const big = { ...forward(901), summary: "x".repeat(40 * 1024) };
  assert.equal((await post(big)).status, 413);
  const chunked = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify(big)));
      controller.close();
    },
  });
  const response = await handleIntake(
    new Request("https://p5homeco.com/api/leads/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": BRAND_SERVER },
      body: chunked,
      duplex: "half",
    } as RequestInit),
    () => undefined,
  );
  assert.equal(response.status, 413);
});
