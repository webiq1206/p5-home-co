import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { leadDatabase } from "./fixtures/lead-db.ts";

// The intake contract end to end against a migrated database (PGlite) and a
// mocked HubSpot API: the brand sites' Step 1 and Step 2 posts, P5's own form,
// and the HubSpot deal, description and note they produce.

// `||=`, not `??=`: CI can export an empty value, which `??=` would keep.
process.env.SESSION_SECRET ||= "synthetic-secret-for-tests";
process.env.HUBSPOT_TOKEN = "synthetic-hubspot-token";
delete process.env.SMTP_HOST;

const db = await leadDatabase();
await db.exec(
  `INSERT INTO app_user (email, full_name, role) VALUES ('coord@example.invalid','Coordinator One','lead_coordinator')`,
);

const { handleIntake } = await import("../app/api/leads/intake/handler.ts");
const { ingestLead, mergeLeadDetails } = await import("../app/lib/leads/intake.ts");
const { DEFAULT_SETTINGS } = await import("../app/lib/leads/settings.ts");
const { storeLeadRequestFiles } = await import("../app/lib/leads/leadRequestFiles.ts");
const { syncDealToHubSpot } = await import("../app/lib/integrations/hubspot.ts");
const { PROJECT_OPTIONS } = await import("../app/quote/options.ts");

type Json = Record<string, unknown>;
let ip = 0;
const afterTasks: (() => Promise<void>)[] = [];

async function post(body: Json, from = `198.51.100.${++ip}`): Promise<{ status: number; json: Json }> {
  const response = await handleIntake(
    new Request("https://p5homeco.com/api/leads/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": from },
      body: JSON.stringify(body),
    }),
    (task) => afterTasks.push(task),
  );
  return { status: response.status, json: (await response.json()) as Json };
}

const one = async <T = Json>(sql: string, values: unknown[] = []) => (await db.rows<T>(sql, values))[0];
const count = async (sql: string, values: unknown[] = []) => Number((await one<{ n: number }>(sql, values)).n);

test("an older brand payload without the new fields works exactly as before", async () => {
  // The body Remodeling's bridge sends today (server/services/p5IntakeBridge.ts).
  const { status, json } = await post({
    brand: "Boise Remodeling Co",
    name: "Jane Doe",
    form: "Remodeling consultation",
    source: "Organic Website",
    sourceDetail: "boiseremodeling.co consultation",
    projectType: "kitchen",
    email: "jane@example.com",
    phone: "(208) 555-0142",
    address: "123 N Main St",
    city: "Boise",
    summary: "Wants a kitchen refresh.",
    externalLeadId: "boiseremodeling-consultation:41",
  });
  assert.equal(status, 201);
  assert.deepEqual(Object.keys(json).sort(), ["accepted", "duplicate", "message", "ok"]);
  assert.equal(json.accepted, true);
  const row = await one(
    "SELECT name, summary, property_address, request_kind, contact_preference, best_time, timeline, integration_sync_status FROM deal WHERE external_lead_id = $1",
    ["boiseremodeling-consultation:41"],
  );
  assert.deepEqual(row, {
    name: "Doe | Boise Remodeling Co | kitchen | Boise",
    summary: "Wants a kitchen refresh.",
    property_address: "123 N Main St",
    request_kind: null,
    contact_preference: null,
    best_time: null,
    timeline: null,
    integration_sync_status: "pending",
  });
  assert.equal(await count("SELECT count(*)::int AS n FROM lead_external_ref"), 0);
  assert.equal(await count("SELECT count(*)::int AS n FROM lead_file_link"), 0);
  // The same post again is a duplicate, as before.
  const again = await post({ brand: "Boise Remodeling Co", name: "Jane Doe", phone: "(208) 555-0142", email: "jane@example.com", externalLeadId: "boiseremodeling-consultation:41" });
  assert.equal(again.status, 200);
  assert.equal(again.json.duplicate, true);
});

let handymanDealId = 0;

test("Step 1 from a brand: request kind, preference, best time, files and external_id are kept", async () => {
  const { status, json } = await post({
    brand: "Boise Handyman Co",
    name: "Sam Ortiz",
    phone: "208-555-0199",
    form: "Handyman quote",
    projectType: "Something else, or I am not sure",
    summary: "Gate latch and a sticking door.",
    submission_kind: "initial",
    external_id: "hm-req-1001",
    request_kind: "callback",
    contact_preference: "text",
    best_time: "Morning",
    files: [
      { name: "gate.jpg", url: "https://boisehandyman.co/api/files/k1", contentType: "image/jpeg", size: 120394 },
      { name: "door.pdf", url: "https://boisehandyman.co/api/files/k2", contentType: "application/pdf", size: 88000 },
      { name: "bad.jpg", url: "http://boisehandyman.co/api/files/k3" },
    ],
  });
  assert.equal(status, 201);
  assert.equal(json.accepted, true);
  const ref = await one<{ deal_id: number }>("SELECT deal_id FROM lead_external_ref WHERE brand = 'Boise Handyman Co' AND external_id = 'hm-req-1001'");
  handymanDealId = Number(ref.deal_id);
  const row = await one("SELECT summary, request_kind, contact_preference, best_time, project_type FROM deal WHERE id = $1", [handymanDealId]);
  assert.deepEqual(row, {
    // Stored summaries are whitespace-normalized, as every intake summary is.
    summary: "Callback request: call this person back. Best time to call: Morning. Gate latch and a sticking door.",
    request_kind: "callback",
    contact_preference: "text",
    best_time: "Morning",
    project_type: "Something else, or I am not sure",
  });
  assert.deepEqual(
    await db.rows("SELECT file_name, url, content_type, size_bytes::int AS size FROM lead_file_link WHERE deal_id = $1 ORDER BY id", [handymanDealId]),
    [
      { file_name: "gate.jpg", url: "https://boisehandyman.co/api/files/k1", content_type: "image/jpeg", size: 120394 },
      { file_name: "door.pdf", url: "https://boisehandyman.co/api/files/k2", content_type: "application/pdf", size: 88000 },
    ],
  );
  // The team email (run after the response) is queued once for the new lead.
  assert.ok(afterTasks.length > 0);
  // A repeated Step 1 with the same id is a duplicate, not a second deal.
  const again = await post({ brand: "Boise Handyman Co", name: "Sam Ortiz", phone: "208-555-0199", external_id: "hm-req-1001", request_kind: "callback" });
  assert.equal(again.status, 200);
  assert.equal(again.json.duplicate, true);
  assert.equal(await count("SELECT count(*)::int AS n FROM deal WHERE brand = 'Boise Handyman Co'"), 1);
});

const step2 = {
  brand: "Boise Handyman Co",
  submission_kind: "details",
  external_id: "hm-req-1001",
  address: "9 W State St",
  zip: "83702",
  city: "Boise",
  projectType: "Home repairs or handyman work",
  timeline: "Soon",
  email: "sam@example.com",
  summary: "Side gate is the priority.",
  files: [
    { name: "latch.jpg", url: "https://boisehandyman.co/api/files/k4", contentType: "image/jpeg", size: 50000 },
    { name: "gate.jpg", url: "https://boisehandyman.co/api/files/k1" },
  ],
};

test("Step 2 from a brand merges into the same deal, fills only blanks, keeps everything, marks HubSpot", async () => {
  await db.query("UPDATE deal SET integration_sync_status = 'synced' WHERE id = $1", [handymanDealId]);
  const { status, json } = await post(step2);
  assert.equal(status, 200);
  assert.deepEqual(json, { ok: true, merged: true, duplicate: false, accepted: false, message: "Thanks. The details are with the team." });
  const row = await one<Json>(
    `SELECT d.brand, d.project_type, d.property_address, d.property_city, d.timeline, d.best_time, d.contact_preference,
            d.summary, d.integration_sync_status, d.name, c.email
       FROM deal d JOIN contact c ON c.id = d.contact_id WHERE d.id = $1`,
    [handymanDealId],
  );
  assert.equal(row.brand, "Boise Handyman Co"); // brand posts never reroute
  assert.equal(row.project_type, "Home repairs or handyman work"); // "not sure" may be refined
  assert.equal(row.property_address, "9 W State St, 83702");
  assert.equal(row.property_city, "Boise");
  assert.equal(row.timeline, "Soon");
  assert.equal(row.best_time, "Morning"); // Step 1 answer kept
  assert.equal(row.contact_preference, "text");
  assert.equal(row.email, "sam@example.com");
  assert.equal(row.integration_sync_status, "pending");
  assert.equal(row.name, "Ortiz | Boise Handyman Co | Home repairs or handyman work | Boise");
  assert.match(String(row.summary), /^Callback request: call this person back\./);
  assert.match(String(row.summary), /\n\nDetails added:\nProject: Home repairs or handyman work\nAddress: 9 W State St, 83702\nCity: Boise\nTiming: Soon\nEmail: sam@example.com\nNote: Side gate is the priority\.\nFile: latch\.jpg https:\/\/boisehandyman\.co\/api\/files\/k4\nFile: gate\.jpg https:\/\/boisehandyman\.co\/api\/files\/k1$/);
  assert.equal(await count("SELECT count(*)::int AS n FROM lead_file_link WHERE deal_id = $1", [handymanDealId]), 3);
  assert.equal(await count("SELECT count(*)::int AS n FROM lead_details_event WHERE deal_id = $1 AND hubspot_note_state <> 'initial'", [handymanDealId]), 1);
  assert.equal(await count("SELECT count(*)::int AS n FROM activity WHERE deal_id = $1 AND body LIKE 'Details added:%'", [handymanDealId]), 1);
  assert.equal(await count("SELECT count(*)::int AS n FROM audit_log WHERE record_id = $1 AND action = 'details_added'", [String(handymanDealId)]), 1);
});

test("Step 2 is idempotent, never overwrites with blanks or new values, and is scoped by brand", async () => {
  const summaryBefore = (await one<{ summary: string }>("SELECT summary FROM deal WHERE id = $1", [handymanDealId])).summary;
  const again = await post(step2);
  assert.deepEqual(again.json, { ok: true, merged: false, duplicate: true, accepted: false, message: "Thanks. The details are with the team." });
  assert.equal((await one<{ summary: string }>("SELECT summary FROM deal WHERE id = $1", [handymanDealId])).summary, summaryBefore);
  assert.equal(await count("SELECT count(*)::int AS n FROM lead_details_event WHERE deal_id = $1 AND hubspot_note_state <> 'initial'", [handymanDealId]), 1);

  // Blank and different values: nothing already answered changes; the new words are kept in the summary.
  const later = await post({ brand: "Boise Handyman Co", submission_kind: "details", external_id: "hm-req-1001", address: "1 Other Rd", timeline: "", city: "   ", best_time: "Evening" });
  assert.equal(later.json.merged, true);
  const row = await one<Json>("SELECT property_address, property_city, timeline, best_time, summary FROM deal WHERE id = $1", [handymanDealId]);
  assert.equal(row.property_address, "9 W State St, 83702");
  assert.equal(row.property_city, "Boise");
  assert.equal(row.timeline, "Soon");
  assert.equal(row.best_time, "Morning");
  assert.match(String(row.summary), /Details added:\nAddress: 1 Other Rd\nBest time to call: Evening$/);

  // The same external_id under another brand is a different request.
  // (it waits for its own Step 1, see below, and never touches this deal).
  const other = await post({ brand: "Boise Cabinet Co", submission_kind: "details", external_id: "hm-req-1001", timeline: "Soon" });
  assert.equal(other.status, 202);
  assert.equal(other.json.pending, true);
  assert.equal((await one<{ timeline: string }>("SELECT timeline FROM deal WHERE id = $1", [handymanDealId])).timeline, "Soon");
  await db.query("DELETE FROM lead_pending_details");
  // An empty details post changes nothing.
  const empty = await post({ brand: "Boise Handyman Co", submission_kind: "details", external_id: "hm-req-1001" });
  assert.equal(empty.status, 200);
  assert.equal(empty.json.merged, false);
  assert.equal(empty.json.duplicate, false);
  // external_id is required for details.
  const missing = await post({ brand: "Boise Handyman Co", submission_kind: "details", timeline: "Soon" });
  assert.equal(missing.status, 400);
});

test("Step 2 that arrives before Step 1 becomes the lead when it can reach the person", async () => {
  const lost = await post({ brand: "Boise Cabinet Co", submission_kind: "details", external_id: "cab-77", name: "Lee Park", phone: "2085550177", timeline: "1 to 3 months", projectType: "Kitchen cabinets" });
  assert.equal(lost.status, 201);
  assert.equal(lost.json.accepted, true);
  assert.equal(lost.json.merged, false);
  const ref = await one<{ deal_id: number }>("SELECT deal_id FROM lead_external_ref WHERE brand = 'Boise Cabinet Co' AND external_id = 'cab-77'");
  assert.equal((await one<{ timeline: string }>("SELECT timeline FROM deal WHERE id = $1", [ref.deal_id])).timeline, "1 to 3 months");
  // Then its own Step 2 merges into it.
  const merged = await post({ brand: "Boise Cabinet Co", submission_kind: "details", external_id: "cab-77", address: "5 Elm St" });
  assert.equal(merged.json.merged, true);
});

test("Step 2 before Step 1 without a phone or email waits, then merges when Step 1 lands: one deal, nothing dropped", async () => {
  const early = await post({
    brand: "Boise Handyman Co", submission_kind: "details", external_id: "hm-early-1",
    address: "77 Elm St", timeline: "3 to 6 months",
    files: [{ name: "fence.jpg", url: "https://boisehandyman.co/api/files/e1", contentType: "image/jpeg", size: 1000 }],
  });
  assert.equal(early.status, 202);
  assert.deepEqual(early.json, { ok: true, merged: false, duplicate: false, pending: true, accepted: false, message: "Thanks. The details are with the team." });
  // The same early post twice is held once.
  assert.equal((await post({ brand: "Boise Handyman Co", submission_kind: "details", external_id: "hm-early-1", address: "77 Elm St", timeline: "3 to 6 months", files: [{ name: "fence.jpg", url: "https://boisehandyman.co/api/files/e1" }] })).status, 202);
  assert.equal(await count("SELECT count(*)::int AS n FROM lead_pending_details WHERE external_id = 'hm-early-1'"), 1);

  const step1 = await post({ brand: "Boise Handyman Co", name: "Early Bird", phone: "2085550101", summary: "Fence gate sags. Files: 1 uploading.", external_id: "hm-early-1", request_kind: "quote", contact_preference: "text" });
  assert.equal(step1.status, 201);
  const ref = await one<{ deal_id: number }>("SELECT deal_id FROM lead_external_ref WHERE brand = 'Boise Handyman Co' AND external_id = 'hm-early-1'");
  const row = await one<Json>("SELECT property_address, timeline, summary FROM deal WHERE id = $1", [ref.deal_id]);
  assert.equal(row.property_address, "77 Elm St");
  assert.equal(row.timeline, "3 to 6 months");
  assert.equal(String(row.summary), "Fence gate sags. Files: 1 uploading.\n\nDetails added:\nAddress: 77 Elm St\nTiming: 3 to 6 months\nFile: fence.jpg https://boisehandyman.co/api/files/e1");
  assert.equal(await count("SELECT count(*)::int AS n FROM lead_file_link WHERE deal_id = $1", [ref.deal_id]), 1);
  assert.equal(await count("SELECT count(*)::int AS n FROM lead_pending_details"), 0);
  assert.equal(await count("SELECT count(*)::int AS n FROM deal WHERE name LIKE 'Bird |%'"), 1);
  // The same Step 2 sent again after the merge is a duplicate, not a second block.
  const again = await post({ brand: "Boise Handyman Co", submission_kind: "details", external_id: "hm-early-1", address: "77 Elm St", timeline: "3 to 6 months", files: [{ name: "fence.jpg", url: "https://boisehandyman.co/api/files/e1" }] });
  assert.equal(again.json.duplicate, true);
  // An identical repeat of Step 1 changes nothing either.
  const summary = (await one<{ summary: string }>("SELECT summary FROM deal WHERE id = $1", [ref.deal_id])).summary;
  const repeat = await post({ brand: "Boise Handyman Co", name: "Early Bird", phone: "2085550101", summary: "Fence gate sags. Files: 1 uploading.", external_id: "hm-early-1", request_kind: "quote", contact_preference: "text" });
  assert.equal(repeat.json.duplicate, true);
  assert.equal((await one<{ summary: string }>("SELECT summary FROM deal WHERE id = $1", [ref.deal_id])).summary, summary);
});

test("Step 2 with a phone before Step 1 becomes the lead, and Step 1 then merges into it instead of a second deal", async () => {
  const early = await post({ brand: "Boise Construction Co", submission_kind: "details", external_id: "con-early-9", name: "Quinn Lake", phone: "2085550109", timeline: "Just planning" });
  assert.equal(early.status, 201);
  const step1 = await post({
    brand: "Boise Construction Co", name: "Quinn Lake", phone: "2085550109", external_id: "con-early-9", request_kind: "callback", best_time: "Midday",
    summary: "Build on our lot in Star.", files: [{ name: "lot.pdf", url: "https://boiseconstruction.co/api/files/l9", contentType: "application/pdf", size: 5000 }],
  });
  assert.equal(step1.status, 200);
  assert.equal(step1.json.duplicate, true);
  const deals = await db.rows<Json>("SELECT d.id, d.request_kind, d.best_time, d.timeline, d.summary FROM deal d JOIN lead_external_ref r ON r.deal_id = d.id WHERE r.external_id = 'con-early-9'");
  assert.equal(deals.length, 1);
  assert.equal(await count("SELECT count(*)::int AS n FROM deal WHERE name LIKE 'Lake |%'"), 1);
  assert.equal(deals[0].request_kind, "callback");
  assert.equal(deals[0].best_time, "Midday");
  assert.equal(deals[0].timeline, "Just planning");
  assert.equal(String(deals[0].summary).split("\n\n").at(-1), "Request received:\nBest time to call: Midday\nNote: Build on our lot in Star.\nFile: lot.pdf https://boiseconstruction.co/api/files/l9");
  assert.equal(await count("SELECT count(*)::int AS n FROM lead_file_link WHERE deal_id = $1", [deals[0].id]), 1);
});

test("Step 2 has its own rate window, so adding details never competes with new requests", async () => {
  // New requests are limited per brand + person (tests/lead-intake-rate-limit.test.ts),
  // so the window is used up by one person, not by five different leads.
  const from = "203.0.113.50";
  for (let i = 0; i < 5; i += 1) {
    const { status } = await post({ brand: "Boise Construction Co", name: "Rate Test", phone: "2085551000", summary: `Attempt ${i}` }, from);
    assert.ok(status === 201 || status === 200, String(status));
  }
  assert.equal((await post({ brand: "Boise Construction Co", name: "Rate Test", phone: "2085551000", summary: "Attempt 6" }, from)).status, 429);
  const details = await post({ brand: "Boise Handyman Co", submission_kind: "details", external_id: "hm-req-1001", timeline: "3 to 6 months" }, from);
  assert.equal(details.status, 200);
});

test("P5's own form: Step 2 merges by deal id and routes a not-sure request to the company that owns the work", async () => {
  const created = await ingestLead(
    {
      firstName: "Dana",
      lastName: "Reyes",
      email: null,
      phone: "(208) 555-0142",
      brand: "P5 Home Co",
      projectType: "Something else, or I am not sure",
      source: "Organic Website",
      sourceDetail: null,
      propertyAddress: null,
      propertyCity: null,
      summary: "Preferred contact: Text me. Kitchen ideas",
      externalLeadId: null,
      originalForm: "Quote Landing Page",
      originalCampaign: null,
      utm: null,
      receivedAt: new Date(),
      requestKind: "quote",
      contactPreference: "text",
    },
    DEFAULT_SETTINGS,
  );
  assert.equal(created.status, "created");
  if (created.status !== "created") return;
  const reroute = (project: string) => PROJECT_OPTIONS.find((option) => option.value === project)?.brand ?? null;
  const details = { projectType: "Kitchen remodel", propertyAddress: "83646", propertyCity: null, timeline: "1 to 3 months", bestTime: null, contactPreference: null, email: "dana@example.com", note: null, files: [] };
  const merged = await mergeLeadDetails({ dealId: created.dealId }, details, { reroute });
  assert.equal(merged.status, "merged");
  if (merged.status !== "merged") return;
  assert.equal(merged.brand, "Boise Remodeling Co");
  assert.equal(merged.reroutedFrom, "P5 Home Co");
  assert.deepEqual(merged.filled.sort(), ["brand", "email", "project_type", "property_address", "timeline"]);
  const row = await one<Json>("SELECT brand, name, project_type, request_kind FROM deal WHERE id = $1", [created.dealId]);
  assert.deepEqual(row, { brand: "Boise Remodeling Co", name: "Reyes | Boise Remodeling Co | Kitchen remodel", project_type: "Kitchen remodel", request_kind: "quote" });
  assert.equal((await mergeLeadDetails({ dealId: created.dealId }, details, { reroute })).status, "duplicate");
  assert.equal((await mergeLeadDetails({ dealId: 999999 }, details, { reroute })).status, "not_found");

  // Files: stored once per content, at most ten per request, each one marks HubSpot.
  const file = (name: string, text: string) => {
    const data = Buffer.from(`%PDF-1.7 ${text}`);
    return { fileName: name, mimeType: "application/pdf", sizeBytes: data.length, sha256: createHash("sha256").update(data).digest("hex"), data };
  };
  await db.query("UPDATE deal SET integration_sync_status = 'synced' WHERE id = $1", [created.dealId]);
  const first = await storeLeadRequestFiles(created.dealId, [file("plan.pdf", "a"), file("plan copy.pdf", "a")]);
  assert.deepEqual(first.map((o) => o.status), ["stored", "already_stored"]);
  assert.equal((await one<{ s: string }>("SELECT integration_sync_status AS s FROM deal WHERE id = $1", [created.dealId])).s, "pending");
  const many = await storeLeadRequestFiles(created.dealId, Array.from({ length: 10 }, (_, i) => file(`p${i}.pdf`, `n${i}`)));
  assert.equal(many.filter((o) => o.status === "stored").length, 9);
  assert.deepEqual(many.at(-1), { name: "p9.pdf", status: "rejected", error: "Attach up to 10 files." });
});

type Call = { method: string; path: string; body: Json | null };

function mockHubSpot(options: { properties?: string[]; notes?: "ok" | "forbidden" } = {}) {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.hubapi.com", "only HubSpot is called");
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Json) : null;
    calls.push({ method, path: url.pathname, body });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
    if (url.pathname === "/crm/v3/properties/deals") return json({ results: (options.properties ?? []).map((name) => ({ name })) });
    if (url.pathname.endsWith("/search")) return json({ total: 0, results: [] });
    if (url.pathname === "/crm/v3/objects/contacts") return json({ id: "hs-contact-1" }, 201);
    if (url.pathname === "/crm/v3/objects/deals") return json({ id: "hs-deal-1" }, 201);
    if (url.pathname.startsWith("/crm/v3/objects/deals/") || url.pathname.startsWith("/crm/v3/objects/contacts/")) return json({ id: url.pathname.split("/").pop() });
    if (url.pathname.startsWith("/crm/v4/")) return json({});
    if (url.pathname === "/crm/v3/objects/notes") {
      return options.notes === "forbidden"
        ? json({ status: "error", category: "MISSING_SCOPES", message: "This app hasn't been granted all required scopes" }, 403)
        : json({ id: `hs-note-${calls.length}` }, 201);
    }
    return json({ message: "unexpected" }, 404);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test("HubSpot: the deal carries the callback, preference, best time, files and details, and each details post becomes one note", async () => {
  const hubspot = mockHubSpot();
  try {
    const outcome = await syncDealToHubSpot(handymanDealId);
    assert.equal(outcome.status, "synced");
    const dealWrite = hubspot.calls.find((call) => call.path === "/crm/v3/objects/deals" && call.method === "POST");
    assert.ok(dealWrite);
    const properties = (dealWrite.body as { properties: Record<string, string> }).properties;
    const description = properties.description;
    assert.match(description, /^Callback request: call this person back\. Best time to call: Morning\./);
    assert.match(description, /Details added:\nProject: Home repairs or handyman work/);
    assert.match(description, /Request: Callback request\nPreferred contact: Text\nBest time to call: Morning\nTiming: Soon\nFiles:\ngate\.jpg: https:\/\/boisehandyman\.co\/api\/files\/k1\ndoor\.pdf: https:\/\/boisehandyman\.co\/api\/files\/k2\nlatch\.jpg: https:\/\/boisehandyman\.co\/api\/files\/k4$/);
    assert.equal(properties.p5_property_address, "9 W State St, 83702");
    assert.equal("p5_request_kind" in properties, false, "no property is guessed into existence");
    const notes = hubspot.calls.filter((call) => call.path === "/crm/v3/objects/notes");
    assert.equal(notes.length, 3, "one note per distinct details post");
    const firstNote = notes[0].body as { properties: Record<string, string>; associations: { to: { id: string }; types: { associationTypeId: number }[] }[] };
    assert.match(firstNote.properties.hs_note_body, /^<p><strong>Details added<\/strong><\/p><p>Project: Home repairs or handyman work<br>/);
    assert.match(firstNote.properties.hs_note_body, /File: <a href="https:\/\/boisehandyman\.co\/api\/files\/k4">latch\.jpg<\/a>/);
    assert.deepEqual(firstNote.associations[0].to, { id: "hs-deal-1" });
    assert.equal(firstNote.associations[0].types[0].associationTypeId, 214);
    assert.equal(await count("SELECT count(*)::int AS n FROM lead_details_event WHERE deal_id = $1 AND hubspot_note_state = 'sent'", [handymanDealId]), 3);
    assert.equal((await one<{ s: string }>("SELECT integration_sync_status AS s FROM deal WHERE id = $1", [handymanDealId])).s, "synced");

    // A re-sync adds no second note.
    hubspot.calls.length = 0;
    assert.equal((await syncDealToHubSpot(handymanDealId)).status, "synced");
    assert.equal(hubspot.calls.filter((call) => call.path === "/crm/v3/objects/notes").length, 0);
  } finally {
    hubspot.restore();
  }
});

test("HubSpot: request properties are used when the portal has them; notes fall back to the description without the scope", async () => {
  await post({ brand: "Boise Handyman Co", submission_kind: "details", external_id: "hm-req-1001", summary: "Also a loose stair rail." });
  const hubspot = mockHubSpot({
    properties: ["p5_request_kind", "p5_contact_preference", "p5_best_time", "p5_timeline", "p5_file_links"],
    notes: "forbidden",
  });
  try {
    assert.equal((await syncDealToHubSpot(handymanDealId)).status, "synced");
    const write = hubspot.calls.find((call) => call.path === "/crm/v3/objects/deals/hs-deal-1" && call.method === "PATCH");
    assert.ok(write);
    const properties = (write.body as { properties: Record<string, string> }).properties;
    assert.equal(properties.p5_request_kind, "Callback request");
    assert.equal(properties.p5_contact_preference, "Text");
    assert.equal(properties.p5_best_time, "Morning");
    assert.equal(properties.p5_timeline, "Soon");
    assert.match(properties.p5_file_links, /^gate\.jpg: https:\/\/boisehandyman\.co\/api\/files\/k1\n/);
    assert.doesNotMatch(properties.description, /\nRequest: Callback request\n/);
    assert.match(properties.description, /Note: Also a loose stair rail\.$/);
    assert.equal(
      (await one<{ s: string }>("SELECT hubspot_note_state AS s FROM lead_details_event WHERE deal_id = $1 ORDER BY received_at DESC LIMIT 1", [handymanDealId])).s,
      "description",
    );
    assert.equal(await count("SELECT count(*)::int AS n FROM audit_log WHERE record_id = $1 AND action = 'hubspot_note_fallback'", [String(handymanDealId)]), 1);
    assert.equal((await one<{ s: string }>("SELECT integration_sync_status AS s FROM deal WHERE id = $1", [handymanDealId])).s, "synced");
  } finally {
    hubspot.restore();
  }
});

test("HubSpot: nothing is called while the flag is off or the token is missing", async () => {
  const hubspot = mockHubSpot();
  const token = process.env.HUBSPOT_TOKEN;
  try {
    delete process.env.HUBSPOT_TOKEN;
    assert.deepEqual(await syncDealToHubSpot(handymanDealId), { status: "skipped", reason: "HUBSPOT_TOKEN is not set." });
    process.env.HUBSPOT_TOKEN = token;
    await db.query(
      "INSERT INTO setting (key, value) VALUES ('lead_manager', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
      [JSON.stringify({ featureFlags: { hubspotIntegrationEnabled: false } })],
    );
    assert.deepEqual(await syncDealToHubSpot(handymanDealId), { status: "skipped", reason: "hubspotIntegrationEnabled is false." });
    assert.equal(hubspot.calls.length, 0);
  } finally {
    process.env.HUBSPOT_TOKEN = token;
    await db.query("DELETE FROM setting WHERE key = 'lead_manager'");
    hubspot.restore();
  }
});
