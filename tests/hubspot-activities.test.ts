import assert from "node:assert/strict";
import test from "node:test";

import { leadDatabase } from "./fixtures/lead-db.ts";

// Calls, texts and notes logged in the P5 admin become HubSpot engagements on
// the contact and the deal. HubSpot is a mock request function here.

process.env.HUBSPOT_TOKEN = "synthetic-hubspot-token";
const db = await leadDatabase();
const { ActivityApiError, engagementFor, pushActivityToHubSpot, syncPendingActivities, CALL_DISPOSITIONS } = await import("../app/lib/integrations/hubspot-activities.ts");

await db.exec(`
  INSERT INTO app_user (email, full_name, role, hubspot_owner_id) VALUES ('rep@example.invalid','Rep One','lead_coordinator','97300513');
  INSERT INTO contact (identity_key, first_name, phone, hubspot_contact_id) VALUES ('phone:+12085550177','Ana','+12085550177','hs-c1');
  INSERT INTO contact (identity_key, first_name, phone) VALUES ('phone:+12085550178','Bo','+12085550178');
  INSERT INTO deal (contact_id, name, brand, lead_source, stage, received_at, hubspot_deal_id) VALUES (1,'Ana','Boise Remodeling Co','Organic Website','Contacting',now(),'hs-d1');
  INSERT INTO deal (contact_id, name, brand, lead_source, stage, received_at) VALUES (2,'Bo','Boise Remodeling Co','Organic Website','Contacting',now());
`);

async function activity(kind: string, outcome: string, body: string | null, deal = 1): Promise<number> {
  const rows = await db.rows<{ id: number }>(
    `INSERT INTO activity (deal_id, user_id, kind, outcome, body, is_human_attempt, occurred_at, hubspot_sync_state)
     VALUES ($1, 1, $2, $3, $4, TRUE, '2026-11-09T18:00:00Z', 'pending') RETURNING id`,
    [deal, kind, outcome, body],
  );
  return Number(rows[0].id);
}

type Post = { path: string; body: { properties: Record<string, string>; associations: { to: { id: string }; types: { associationTypeId: number }[] }[] } };
function mock(answer: (path: string) => { id?: string } | number) {
  const posts: Post[] = [];
  const request = async (path: string, init: { method: string; body?: unknown }) => {
    posts.push({ path, body: init.body as Post["body"] });
    const result = answer(path);
    if (typeof result === "number") throw new ActivityApiError(result, `hubspot-http-${result}`);
    return result;
  };
  return { posts, request };
}

const state = async (id: number) => (await db.rows<{ s: string; t: string | null; h: string | null; e: string | null }>(
  "SELECT hubspot_sync_state AS s, hubspot_object_type AS t, hubspot_activity_id AS h, hubspot_last_error AS e FROM activity WHERE id = $1", [id]))[0];

test("a logged call becomes a CALL with the outcome, disposition and owner, on the contact and deal", async () => {
  const id = await activity("call", "Left Voicemail", "Left a message about the kitchen.");
  const hub = mock(() => ({ id: "c-1" }));
  assert.equal(await pushActivityToHubSpot(id, hub.request), "sent");
  assert.equal(hub.posts[0].path, "/crm/v3/objects/calls");
  const p = hub.posts[0].body.properties;
  assert.equal(p.hs_call_title, "Call: Left Voicemail");
  assert.equal(p.hs_call_disposition, CALL_DISPOSITIONS["Left Voicemail"]);
  assert.equal(p.hubspot_owner_id, "97300513");
  assert.match(p.hs_call_body, /Left a message about the kitchen\.\nLogged in P5 by Rep One\./);
  assert.deepEqual(hub.posts[0].body.associations.map((a) => [a.to.id, a.types[0].associationTypeId]), [["hs-c1", 194], ["hs-d1", 206]]);
  assert.deepEqual(await state(id), { s: "sent", t: "calls", h: "c-1", e: null });
  // Never pushed twice.
  assert.equal(await pushActivityToHubSpot(id, hub.request), "skipped");
});

test("a text is an SMS communication; refused, it becomes a NOTE headed as a text", async () => {
  const id = await activity("text", "Sent Text", "Sent the intake link.");
  const ok = mock(() => ({ id: "m-1" }));
  assert.equal(await pushActivityToHubSpot(id, ok.request), "sent");
  assert.equal(ok.posts[0].path, "/crm/v3/objects/communications");
  assert.equal(ok.posts[0].body.properties.hs_communication_channel_type, "SMS");
  assert.deepEqual(ok.posts[0].body.associations.map((a) => a.types[0].associationTypeId), [81, 85]);

  const refused = await activity("text", "Sent Text", "Second text.");
  const noComms = mock((path) => (path.endsWith("/communications") ? 403 : { id: "n-9" }));
  assert.equal(await pushActivityToHubSpot(refused, noComms.request), "sent");
  assert.deepEqual(noComms.posts.map((post) => post.path), ["/crm/v3/objects/communications", "/crm/v3/objects/notes"]);
  assert.deepEqual(noComms.posts[1].body.associations.map((a) => a.types[0].associationTypeId), [202, 214]);
  assert.deepEqual(await state(refused), { s: "sent", t: "notes", h: "n-9", e: null });
  const plan = engagementFor({ id: String(refused), deal_id: "1", kind: "text", outcome: "Sent Text", body: "Second text.", occurred_at: new Date(), hubspot_attempts: 0, hubspot_deal_id: "d", hubspot_contact_id: "c", actor_name: null, actor_owner_id: null, deal_owner_id: null }, true);
  assert.equal(plan.object, "notes");
  assert.match(plan.properties.hs_note_body, /Text message \(SMS\) sent/);
});

test("notes and other outcomes are NOTES; a deal without HubSpot ids waits", async () => {
  const id = await activity("note", "Not Ready", "Back in spring.");
  const hub = mock(() => ({ id: "n-1" }));
  assert.equal(await pushActivityToHubSpot(id, hub.request), "sent");
  assert.equal(hub.posts[0].path, "/crm/v3/objects/notes");
  assert.match(hub.posts[0].body.properties.hs_note_body, /Note: Not Ready.*Back in spring\./);
  const waiting = await activity("call", "No Answer", null, 2);
  assert.equal(await pushActivityToHubSpot(waiting, hub.request), "waiting");
  assert.equal((await state(waiting)).s, "pending");
  // The watchdog only considers activities whose deal has an id.
  const before = hub.posts.length;
  assert.deepEqual(await syncPendingActivities(25, hub.request), { attempted: 0, sent: 0 });
  assert.equal(hub.posts.length, before);
});

test("an unknown outcome (network) is never reposted; a clear 5xx is retried", async () => {
  const lost = await activity("call", "Connected", "Talked.");
  const network = { request: async () => { throw new ActivityApiError(0, "hubspot-network-or-timeout"); } };
  assert.equal(await pushActivityToHubSpot(lost, network.request), "uncertain");
  assert.equal((await state(lost)).s, "uncertain");
  assert.equal(await pushActivityToHubSpot(lost, mock(() => ({ id: "x" })).request), "skipped");
  const busy = await activity("call", "Connected", "Again.");
  assert.equal(await pushActivityToHubSpot(busy, mock(() => 503).request), "retry");
  assert.equal((await state(busy)).s, "pending");
  assert.equal(await pushActivityToHubSpot(busy, mock(() => ({ id: "c-2" })).request), "sent");
});
