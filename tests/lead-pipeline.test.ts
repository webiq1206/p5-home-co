import assert from "node:assert/strict";
import test from "node:test";

import { leadDatabase } from "./fixtures/lead-db.ts";

// The lead pipeline against a migrated database (PGlite) and a mocked HubSpot:
// immediate sync after intake (bounded), every submitted field kept and sent
// as a note, contact matched by email then phone with address fields, the
// owner set for the "assigned to you" push, and the portal guard. No test
// reaches HubSpot: fetch is replaced and anything unexpected fails the test.

process.env.SESSION_SECRET ||= "synthetic-secret-for-tests";
process.env.HUBSPOT_TOKEN = "synthetic-hubspot-token";
delete process.env.SMTP_HOST;
delete process.env.SMTP_USER;
delete process.env.HUBSPOT_TASK_OWNER_ID;

const db = await leadDatabase();
await db.exec(`INSERT INTO app_user (email, full_name, role) VALUES ('coord@example.invalid','Coordinator One','lead_coordinator')`);

const { handleIntake } = await import("../app/api/leads/intake/handler.ts");
const { syncDealToHubSpot } = await import("../app/lib/integrations/hubspot.ts");
const { resetHubSpotPortalCheck } = await import("../app/lib/integrations/hubspot-portal.ts");
const { loadLeadAlert, within } = await import("../app/lib/leads/leadPipeline.ts");
const { collectAttribution, sourceFromAttribution } = await import("../app/lib/leads/attribution.ts");
const { submittedFieldsFromBody } = await import("../app/lib/leads/submittedFields.ts");

type Json = Record<string, unknown>;
let ip = 0;
const afterTasks: (() => Promise<void>)[] = [];
const one = async <T = Json>(sql: string, values: unknown[] = []) => (await db.rows<T>(sql, values))[0];

async function post(body: Json, deps: Parameters<typeof handleIntake>[2] = {}) {
  const response = await handleIntake(
    new Request("https://p5homeco.com/api/leads/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": `203.0.113.${++ip}` },
      body: JSON.stringify(body),
    }),
    (task) => afterTasks.push(task),
    deps,
  );
  return { status: response.status, json: (await response.json()) as Json };
}

type Call = { method: string; path: string; search: string; body: Json | null };

function mockHubSpot(options: { portal?: number; contacts?: Json[]; dealId?: string; contactId?: string } = {}) {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  resetHubSpotPortalCheck();
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.hubapi.com", "only HubSpot is called");
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Json) : null;
    calls.push({ method, path: url.pathname, search: url.search, body });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
    if (url.pathname === "/account-info/v3/details") return json({ portalId: options.portal ?? 247066159 });
    if (url.pathname === "/crm/v3/properties/deals") return json({ results: [] });
    if (url.pathname === "/crm/v3/objects/contacts/search") {
      const filters = (body?.filterGroups as { filters: { value: string }[] }[] | undefined)?.[0]?.filters;
      const results = (options.contacts ?? []).filter((c) => filters
        ? (c.properties as Json).email === filters[0].value
        : String((c.properties as Json).phone ?? "").replace(/\D/g, "").endsWith(String(body?.query)));
      return json({ total: results.length, results });
    }
    if (url.pathname.endsWith("/search")) return json({ total: 0, results: [] });
    if (url.pathname === "/crm/v3/objects/contacts" && method === "POST") return json({ id: options.contactId ?? "hs-contact-new" }, 201);
    if (url.pathname === "/crm/v3/objects/deals" && method === "POST") return json({ id: options.dealId ?? "hs-deal-new" }, 201);
    if (url.pathname.startsWith("/crm/v3/objects/contacts/") && method === "GET") return json({ id: url.pathname.split("/").pop(), properties: { hubspot_owner_id: "" } });
    if (url.pathname.startsWith("/crm/v3/objects/deals/") || url.pathname.startsWith("/crm/v3/objects/contacts/")) return json({ id: url.pathname.split("/").pop() });
    if (url.pathname.startsWith("/crm/v4/")) return json({});
    if (url.pathname === "/crm/v3/objects/notes") return json({ id: `hs-note-${calls.length}` }, 201);
    return json({ message: "unexpected" }, 404);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const writes = (calls: Call[]) => calls.filter((call) => call.method !== "GET" && !call.path.endsWith("/search"));

test("fbclid is captured with gclid and a Meta click reads as Social Media", () => {
  const attribution = collectAttribution({ fbclid: "IwAR0abc_DEF-123", landing_page: "/kitchens?fbclid=IwAR0abc_DEF-123&x=secret", gclid: "" });
  assert.equal(attribution?.fbclid, "IwAR0abc_DEF-123");
  assert.equal(attribution?.landing_page, "/kitchens?fbclid=IwAR0abc_DEF-123");
  assert.equal(sourceFromAttribution(attribution), "Social Media");
  assert.equal(sourceFromAttribution({ gclid: "g1", fbclid: "f1" }), "Paid Search");
});

test("every submitted field is kept, including ones the contract does not read", () => {
  const fields = submittedFieldsFromBody({
    brand: "Boise Remodeling Co", name: "Ana Ruiz", budget: "$40k to $60k",
    answers: { rooms: ["Kitchen", "Pantry"], "Cabinet style": "Shaker" },
    files: [{ name: "plan.pdf", url: "https://boiseremodeling.co/f/1" }],
    website_url: "",
  });
  assert.deepEqual(fields, [
    { label: "Brand", value: "Boise Remodeling Co" },
    { label: "Name", value: "Ana Ruiz" },
    { label: "Budget", value: "$40k to $60k" },
    { label: "Answers: Rooms", value: "Kitchen, Pantry" },
    { label: "Answers: Cabinet style", value: "Shaker" },
    { label: "File", value: "plan.pdf https://boiseremodeling.co/f/1" },
  ]);
});

let dealId = 0;

test("intake syncs to HubSpot immediately, bounded, and keeps every field, state and ZIP", async () => {
  const synced: number[] = [];
  const started = Date.now();
  const { status } = await post(
    {
      brand: "Boise Remodeling Co",
      name: "Ana Ruiz",
      email: "ana@example.com",
      phone: "(208) 555-0177",
      address: "12 N 8th St",
      city: "Boise",
      state: "ID",
      zip: "83702",
      projectType: "Kitchen remodel",
      summary: "Gut the kitchen.",
      budget: "$40k to $60k",
      timeline: "1 to 3 months",
      answers: { "Cabinet style": "Shaker" },
      fbclid: "IwAR0abc",
      utm_source: "facebook",
      landing_page: "/kitchen?fbclid=IwAR0abc",
      form: "Kitchen quote",
    },
    {
      // A sync slower than the bound: the response must not wait for it.
      syncHubSpot: async (id) => { synced.push(id); await new Promise((resolve) => setTimeout(resolve, 2_000)); },
      inlineSyncTimeoutMs: 150,
    },
  );
  assert.equal(status, 201);
  assert.ok(Date.now() - started < 1_500, "the visitor never waits on HubSpot past the bound");
  const row = await one<{ id: number; property_state: string; property_zip: string; property_address: string; utm: Json; lead_source: string }>(
    "SELECT id, property_state, property_zip, property_address, utm, lead_source FROM deal WHERE external_lead_id IS NULL AND brand = 'Boise Remodeling Co' ORDER BY id DESC LIMIT 1",
  );
  dealId = Number(row.id);
  assert.deepEqual(synced, [dealId], "the sync started inline for the new deal");
  assert.equal(row.property_state, "ID");
  assert.equal(row.property_zip, "83702");
  assert.equal(row.property_address, "12 N 8th St, 83702");
  assert.equal(row.utm.fbclid, "IwAR0abc");
  assert.equal(row.lead_source, "Social Media");
  const submission = await one<{ channel: string; fields: { label: string; value: string }[] }>("SELECT channel, fields FROM lead_intake_submission WHERE deal_id = $1", [dealId]);
  assert.equal(submission.channel, "Website form");
  for (const [label, value] of [["Budget", "$40k to $60k"], ["Answers: Cabinet style", "Shaker"], ["Timing", "1 to 3 months"], ["State", "ID"], ["Meta click id (fbclid)", "IwAR0abc"]]) {
    assert.ok(submission.fields.some((field) => field.label === label && field.value === value), `${label} kept`);
  }
  // A repeat attaches to the same deal (no second deal); its own fields are
  // kept as a second submission.
  await post({ brand: "Boise Remodeling Co", name: "Ana Ruiz", email: "ana@example.com", phone: "(208) 555-0177", projectType: "Kitchen remodel", city: "Boise", address: "12 N 8th St", zip: "83702" });
  assert.equal(Number((await one<{ n: number }>("SELECT count(*)::int AS n FROM deal WHERE brand = 'Boise Remodeling Co'")).n), 1);
});

test("a failing inline sync never fails the visitor", async () => {
  const { status } = await post(
    { brand: "Boise Handyman Co", name: "Lee Park", phone: "208-555-0190", summary: "Fence gate." },
    { syncHubSpot: async () => { throw new Error("HubSpot down"); }, inlineSyncTimeoutMs: 500 },
  );
  assert.equal(status, 201);
  assert.equal(await within(Promise.reject(new Error("x")), 10), undefined);
});

test("HubSpot: contact gets address, city, state, ZIP and owner 97300513; the deal is assigned; one note with every field", async () => {
  const hubspot = mockHubSpot();
  try {
    const outcome = await syncDealToHubSpot(dealId);
    assert.equal(outcome.status, "synced");
    const contact = hubspot.calls.find((call) => call.path === "/crm/v3/objects/contacts" && call.method === "POST")!;
    assert.deepEqual((contact.body as { properties: Json }).properties, {
      firstname: "Ana", lastname: "Ruiz", email: "ana@example.com", phone: "+12085550177",
      address: "12 N 8th St", city: "Boise", state: "ID", zip: "83702", hubspot_owner_id: "97300513",
    });
    const deal = hubspot.calls.find((call) => call.path === "/crm/v3/objects/deals" && call.method === "POST")!;
    assert.equal((deal.body as { properties: Json }).properties.hubspot_owner_id, "97300513");
    const notes = hubspot.calls.filter((call) => call.path === "/crm/v3/objects/notes");
    assert.equal(notes.length, 2, "the first submission and the repeat each get one note");
    const note = notes[0].body as { properties: Record<string, string>; associations: { to: { id: string }; types: { associationTypeId: number }[] }[] };
    for (const text of ["Website form submission", "Budget:</strong> $40k to $60k", "Cabinet style:</strong> Shaker", "Meta click id (fbclid):</strong> IwAR0abc", "Landing page:</strong> /kitchen?fbclid=IwAR0abc", "Source and attribution"]) {
      assert.ok(note.properties.hs_note_body.includes(text), text);
    }
    assert.deepEqual(note.associations.map((a) => [a.to.id, a.types[0].associationTypeId]), [["hs-deal-new", 214], ["hs-contact-new", 202]]);
    // Second sync: no second note, and the contact owner is only filled when empty.
    hubspot.calls.length = 0;
    assert.equal((await syncDealToHubSpot(dealId)).status, "synced");
    assert.equal(hubspot.calls.filter((call) => call.path === "/crm/v3/objects/notes").length, 0);
  } finally {
    hubspot.restore();
  }
  const alert = await loadLeadAlert(dealId, { dealId, brand: "x", projectType: null, firstName: null, lastName: null, email: null, phone: null, propertyCity: null, propertyAddress: null, summary: null, source: null, originalForm: null });
  assert.equal(alert.hubspotContactId, "hs-contact-new");
  assert.equal(alert.hubspotDealId, "hs-deal-new");
  assert.equal(alert.propertyState, "ID");
  assert.ok(alert.submittedFields?.some((field) => field.label === "Budget"));
  assert.ok(alert.attribution?.some((field) => field.label === "Meta click id (fbclid)"));
});

test("HubSpot: no email means a phone match, and an existing owner and values are never blanked", async () => {
  const created = await post({ brand: "Boise Cabinet Co", name: "Kim Tran", phone: "208.555.0123", summary: "Pantry cabinets." });
  assert.equal(created.status, 201);
  const id = Number((await one<{ id: number }>("SELECT id FROM deal WHERE brand = 'Boise Cabinet Co'")).id);
  const hubspot = mockHubSpot({ dealId: "hs-deal-kim", contacts: [{ id: "hs-kim", properties: { phone: "(208) 555-0123", hubspot_owner_id: "55" } }] });
  try {
    const outcome = await syncDealToHubSpot(id);
    assert.equal(outcome.status, "synced", JSON.stringify(outcome));
    assert.equal(hubspot.calls.some((call) => call.path === "/crm/v3/objects/contacts" && call.method === "POST"), false, "no duplicate contact");
    const patch = hubspot.calls.find((call) => call.path === "/crm/v3/objects/contacts/hs-kim" && call.method === "PATCH")!;
    const properties = (patch.body as { properties: Json }).properties;
    assert.equal("hubspot_owner_id" in properties, false, "HubSpot's own assignment stands");
    assert.equal("email" in properties || "address" in properties || "city" in properties, false, "blank values are never sent");
  } finally {
    hubspot.restore();
  }
});

test("HubSpot: a token for any other portal (Timber and Love 247282537) writes nothing and stays on the retry path", async () => {
  await db.query("UPDATE deal SET integration_sync_status = 'pending' WHERE id = $1", [dealId]);
  const hubspot = mockHubSpot({ portal: 247282537 });
  try {
    const outcome = await syncDealToHubSpot(dealId);
    assert.equal(outcome.status, "failed");
    assert.match((outcome as { error: string }).error, /247282537.*not P5 portal 247066159/);
    assert.deepEqual(writes(hubspot.calls), [], "not a single write");
    assert.deepEqual(hubspot.calls.map((call) => call.path), ["/account-info/v3/details"], "checked once, cached");
    const row = await one<{ s: string }>("SELECT integration_sync_status AS s FROM deal WHERE id = $1", [dealId]);
    assert.equal(row.s, "failed", "the watchdog retries failed deals");
  } finally {
    hubspot.restore();
    resetHubSpotPortalCheck();
  }
});

test("HubSpot: the inline sync and the watchdog cannot push one deal at the same moment", async () => {
  await db.query("UPDATE deal SET hubspot_sync_lease_until = now() + interval '1 minute' WHERE id = $1", [dealId]);
  const hubspot = mockHubSpot();
  try {
    assert.deepEqual(await syncDealToHubSpot(dealId), { status: "skipped", reason: "A HubSpot sync for this deal is already running." });
    assert.deepEqual(writes(hubspot.calls), []);
  } finally {
    hubspot.restore();
    await db.query("UPDATE deal SET hubspot_sync_lease_until = NULL WHERE id = $1", [dealId]);
  }
});

test("the route wires the real sync; tests get none unless they pass one", async () => {
  const { readFileSync } = await import("node:fs");
  const route = readFileSync("app/api/leads/intake/route.ts", "utf8");
  assert.match(route, /handleIntake\(request, after, \{ syncHubSpot: syncDealToHubSpot \}\)/);
  assert.ok(afterTasks.length > 0);
});

test("a synthetic Meta Testing Tool-style lead gets the requested deal title, owner, stage, answers and two-sided note", async () => {
  const { metaInboundLead, resolveMetaBrand } = await import("../app/lib/integrations/meta-leadgen.ts");
  const { ingestLead } = await import("../app/lib/leads/intake.ts");
  const { DEFAULT_SETTINGS } = await import("../app/lib/leads/settings.ts");
  const graphLead = {
    id: "synthetic-meta-9009", form_id: "1636211868536619", created_time: "2026-11-11T00:00:00Z",
    campaign_name: "Synthetic cabinet campaign", adset_name: "Synthetic ad set", ad_name: "Synthetic ad", platform: "fb",
    field_data: [
      { name: "full_name", values: ["Synthetic Meta Tester"] },
      { name: "email", values: ["meta-test@example.com"] },
      { name: "project", values: ["Custom cabinets"] },
      { name: "Custom exact question?", values: ["  Original answer\nSecond line  "] },
    ],
  };
  const inbound = metaInboundLead(graphLead, resolveMetaBrand(graphLead, { pageId: "1235083469680398" }));
  const created = await ingestLead(inbound, DEFAULT_SETTINGS);
  assert.equal(created.status, "created");
  if (created.status !== "created") return;
  const hubspot = mockHubSpot({ contactId: "hs-contact-meta", dealId: "hs-deal-meta" });
  try {
    const result = await syncDealToHubSpot(created.dealId);
    assert.equal(result.status, "synced");
    const dealWrite = hubspot.calls.find(c => c.path === "/crm/v3/objects/deals" && c.method === "POST")!;
    const props = dealWrite.body!.properties as Json;
    assert.equal(props.dealname, "Boise Cabinet Co lead: Synthetic Meta Tester");
    assert.equal(props.dealstage, "appointmentscheduled");
    assert.equal(props.hubspot_owner_id, "97300513");
    assert.equal(props.p5_lead_source, "Facebook Lead Ad");
    assert.equal(props.p5_facebook_lead_id, graphLead.id);
    assert.match(String(props.description), /Custom exact question\?:   Original answer\nSecond line  /);
    assert.match(String(props.description), /Ad set.*Synthetic ad set/i);
    const note = hubspot.calls.find(c => c.path === "/crm/v3/objects/notes" && c.method === "POST")!;
    assert.match(String((note.body!.properties as Json).hs_note_body), /Custom exact question/);
    assert.equal((note.body!.associations as unknown[]).length, 2);
  } finally { hubspot.restore(); }
});
