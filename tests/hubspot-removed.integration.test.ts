/**
 * Deletions in HubSpot are routine, never a failure (owner, 17 November 2026).
 *
 * The team deletes spam and junk in HubSpot. These tests run the real sync
 * code against a fake HubSpot and a real database, and hold it to that:
 *   - a deleted deal closes the P5 lead as "Removed in HubSpot" and is never
 *     recreated, unless the customer writes in again afterwards;
 *   - a deleted contact is made again when its lead is still being sent;
 *   - a deleted task is dismissed;
 *   - a lead is never held back from HubSpot (bad email, deleted contact);
 *   - none of it leaves an integration reporting "failed".
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

const TEST_DB = process.env.TEST_DATABASE_URL;

type Remote = { id: string; archived: boolean; archivedAt: string | null; properties: Record<string, string> };

describe("HubSpot deletions are mirrored, not failures", { skip: TEST_DB ? false : "TEST_DATABASE_URL not set" }, () => {
  let push: typeof import("../app/lib/integrations/hubspot.ts").syncDealToHubSpot;
  let pending: typeof import("../app/lib/integrations/hubspot.ts").syncPendingDeals;
  let pull: typeof import("../app/lib/integrations/hubspot-operations.ts").pullHubSpotLeadActions;
  let tasksSync: typeof import("../app/lib/integrations/hubspot-tasks.ts").syncHubSpotAlertTasks;
  let watchdog: typeof import("../app/lib/leads/watchdog.ts").runWatchdog;
  let query: typeof import("../app/lib/db.ts").query;
  let getPool: typeof import("../app/lib/db.ts").getPool;
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.HUBSPOT_TOKEN;
  const originalEmails = process.env.P5_LEAD_ALERT_EMAILS_ENABLED;
  const now = new Date("2026-09-07T21:00:00Z");
  const received = new Date("2026-09-04T16:00:00Z");

  let contacts: Map<string, Remote>;
  let deals: Map<string, Remote>;
  let tasks: Map<string, Remote>;
  let nextId: number;
  let writes: { method: string; path: string; body: unknown }[];
  let rejectEmail: string | null;
  let requests: number;

  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
  const remote = (id: string, properties: Record<string, string>): Remote => ({ id, archived: false, archivedAt: null, properties });
  const deleteInHubSpot = (store: Map<string, Remote>, id: string, at = new Date().toISOString()) => {
    const row = store.get(id)!;
    row.archived = true;
    row.archivedAt = at;
  };
  const read = (store: Map<string, Remote>, id: string, url: string) => {
    const row = store.get(id);
    const wantsArchived = /[?&]archived=true(&|$)/.test(url);
    if (!row || row.archived !== wantsArchived) return json({}, 404);
    return json({ id, archived: row.archived, archivedAt: row.archivedAt ?? undefined, properties: row.properties });
  };

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.HUBSPOT_TOKEN = "isolated-test-token";
    delete process.env.P5_LEAD_ALERT_EMAILS_ENABLED;
    ({ syncDealToHubSpot: push, syncPendingDeals: pending } = await import("../app/lib/integrations/hubspot.ts"));
    ({ pullHubSpotLeadActions: pull } = await import("../app/lib/integrations/hubspot-operations.ts"));
    ({ syncHubSpotAlertTasks: tasksSync } = await import("../app/lib/integrations/hubspot-tasks.ts"));
    ({ runWatchdog: watchdog } = await import("../app/lib/leads/watchdog.ts"));
    ({ query, getPool } = await import("../app/lib/db.ts"));

    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const path = url.replace("https://api.hubapi.com", "");
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      requests++;
      if (method !== "GET" && !path.endsWith("/search")) writes.push({ method, path, body });

      if (path.startsWith("/account-info/v3/details")) return json({ portalId: 247066159 });
      if (path.startsWith("/crm/v3/properties/deals")) return json({ results: [] });
      if (path.startsWith("/crm/v3/owners/")) return json({ results: [{ id: "55", email: "hello@p5homeco.com", archived: false }] });
      if (path.includes("/labels")) return json({ results: [{ category: "HUBSPOT_DEFINED", label: null, typeId: path.includes("/deals/") ? 216 : 204 }] });
      if (path.includes("/associations/") && method === "PUT") return json({});
      if (path === "/crm/v3/objects/notes" && method === "POST") return json({ id: String(nextId++) });

      if (path === "/crm/v3/objects/contacts/search") {
        const filter = body.filterGroups[0].filters[0];
        const found = [...contacts.values()].filter((c) => !c.archived && c.properties[filter.propertyName] === filter.value);
        return json({ total: found.length, results: found });
      }
      if (path === "/crm/v3/objects/contacts" && method === "POST") {
        if (rejectEmail && body.properties.email === rejectEmail) {
          return json({ errors: [{ code: "INVALID_EMAIL", context: { propertyName: ["email"] } }] }, 400);
        }
        const id = String(nextId++);
        contacts.set(id, remote(id, body.properties));
        return json({ id });
      }
      const contact = /^\/crm\/v3\/objects\/contacts\/(\d+)/.exec(path)?.[1];
      if (contact && method === "GET") return read(contacts, contact, url);
      if (contact && method === "PATCH") {
        const row = contacts.get(contact);
        if (!row || row.archived) return json({}, 404);
        if (rejectEmail && body.properties.email === rejectEmail) {
          return json({ errors: [{ code: "INVALID_EMAIL", context: { propertyName: ["email"] } }] }, 400);
        }
        Object.assign(row.properties, body.properties);
        return json({ id: contact });
      }

      if (path === "/crm/v3/objects/deals/search") {
        const filter = body.filterGroups[0].filters[0];
        const found = [...deals.values()].filter((d) => !d.archived && d.properties[filter.propertyName] === filter.value);
        return json({ total: found.length, results: found });
      }
      if (path === "/crm/v3/objects/deals" && method === "POST") {
        const id = String(nextId++);
        deals.set(id, remote(id, body.properties));
        return json({ id });
      }
      const deal = /^\/crm\/v3\/objects\/deals\/(\d+)/.exec(path)?.[1];
      if (deal && method === "GET") return read(deals, deal, url);
      if (deal && method === "PATCH") {
        const row = deals.get(deal);
        if (!row || row.archived) return json({}, 404);
        Object.assign(row.properties, body.properties);
        return json({ id: deal });
      }

      if (path === "/crm/v3/objects/tasks/search") {
        const subject = body.filterGroups[0].filters[0].value;
        const found = [...tasks.values()].filter((t) => !t.archived && t.properties.hs_task_subject === subject);
        return json({ total: found.length, results: found });
      }
      if (path === "/crm/v3/objects/tasks" && method === "POST") {
        const id = String(nextId++);
        tasks.set(id, remote(id, body.properties));
        return json({ id, properties: body.properties });
      }
      const task = /^\/crm\/v3\/objects\/tasks\/(\d+)/.exec(path)?.[1];
      if (task && method === "GET") return read(tasks, task, url);
      if (task && method === "PATCH") {
        const row = tasks.get(task);
        if (!row || row.archived) return json({}, 404);
        Object.assign(row.properties, body.properties);
        return json({ id: task, properties: row.properties });
      }
      throw new Error(`Unexpected external request in isolated test: ${method} ${url}`);
    };
  });

  after(async () => {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.HUBSPOT_TOKEN; else process.env.HUBSPOT_TOKEN = originalToken;
    if (originalEmails === undefined) delete process.env.P5_LEAD_ALERT_EMAILS_ENABLED; else process.env.P5_LEAD_ALERT_EMAILS_ENABLED = originalEmails;
    await getPool().end();
  });

  beforeEach(async () => {
    contacts = new Map([["200", remote("200", { email: "test@example.com", hubspot_owner_id: "55" })]]);
    deals = new Map([["100", remote("100", { dealstage: "appointmentscheduled", hubspot_owner_id: "55" })]]);
    tasks = new Map();
    nextId = 1000;
    writes = [];
    rejectEmail = null;
    requests = 0;
    await query("TRUNCATE hubspot_lead_review,lead_hubspot_retry,hubspot_archive_review,integration_health,lead_intake_submission,deal,contact,app_user,alert,lead_alert_incident,task,activity,audit_log,job_run,job_lock,setting RESTART IDENTITY CASCADE");
    await query("INSERT INTO setting (key,value) VALUES ('lead_manager',$1::jsonb)", [JSON.stringify({ featureFlags: { hubspotIntegrationEnabled: true } })]);
    await query("INSERT INTO app_user (email,full_name,role,hubspot_owner_id) VALUES ('hello@p5homeco.com','Manager','manager','55')");
    await query("INSERT INTO contact (identity_key,first_name,email,hubspot_contact_id) VALUES ('email:test@example.com','Test','test@example.com','200')");
    await query(
      `INSERT INTO deal (contact_id,name,brand,lead_source,stage,owner_user_id,received_at,
       next_action,next_action_at,hubspot_deal_id,integration_sync_status)
       VALUES (1,'Test inquiry','P5 Home Co','Organic Website','New Lead',1,$1,
       'Make first contact',$1::timestamptz+interval '5 minutes','100','synced')`, [received],
    );
  });

  const health = async (name: string) => (await query<{ state: string; last_error: string | null }>("SELECT state,last_error FROM integration_health WHERE name=$1", [name]))[0];
  const localDeal = async (id = 1) => (await query<{ stage: string; closed_lost_reason: string | null; closed_at: Date | null; hubspot_deal_id: string | null; integration_sync_status: string; last_integration_error: string | null }>(
    "SELECT stage,closed_lost_reason,closed_at,hubspot_deal_id,integration_sync_status,last_integration_error FROM deal WHERE id=$1", [id]))[0];
  const submission = (at: string) => query(
    "INSERT INTO lead_intake_submission (deal_id,fingerprint,channel,fields,received_at) VALUES (1,$1,'Website form','[]'::jsonb,$2)", [`fp-${at}`, at]);

  test("a deal deleted in HubSpot closes the lead here and is not recreated", async () => {
    deleteInHubSpot(deals, "100");
    await query("UPDATE deal SET integration_sync_status='pending'");
    const result = await push(1);
    assert.equal(result.status, "removed");
    const deal = await localDeal();
    assert.equal(deal.stage, "Closed Lost");
    assert.equal(deal.closed_lost_reason, "Removed in HubSpot");
    assert.ok(deal.closed_at);
    assert.equal(deal.integration_sync_status, "synced");
    assert.equal(deal.last_integration_error, null);
    // Nothing was written to HubSpot: no new deal, no new contact, no update.
    assert.deepEqual(writes, []);
    assert.equal(deals.size, 1);
    const [audit] = await query<{ action: string }>("SELECT action FROM audit_log WHERE action='hubspot_deal_removed'");
    assert.ok(audit, "the removal is on the lead's audit trail");
    // A later pass has nothing left to do and reports healthy.
    const batch = await pending();
    assert.deepEqual(batch, { attempted: 0, synced: 0, failed: 0, skipped: 0 });
    assert.equal((await health("hubspot")).state, "connected");
  });

  test("the watchdog's retry pass settles deleted deals instead of failing forever", async () => {
    deleteInHubSpot(deals, "100");
    await query("UPDATE deal SET integration_sync_status='failed',last_integration_error='HTTP 404'");
    await query("INSERT INTO integration_health(name,state,last_error) VALUES('hubspot','failed','1 delivery record(s) remain pending or failed.')");
    const batch = await pending();
    assert.equal(batch.failed, 0);
    assert.equal(batch.synced, 1);
    const state = await health("hubspot");
    assert.equal(state.state, "connected");
    assert.equal(state.last_error, null);
    assert.equal((await localDeal()).stage, "Closed Lost");
    assert.deepEqual(writes, []);
  });

  test("a customer who writes in again after the deletion gets a new HubSpot deal", async () => {
    deleteInHubSpot(deals, "100", "2026-09-05T12:00:00Z");
    await submission("2026-09-06T09:00:00Z");
    await query("UPDATE deal SET integration_sync_status='pending'");
    const result = await push(1);
    assert.equal(result.status, "synced");
    const deal = await localDeal();
    assert.equal(deal.stage, "New Lead", "the lead stays open");
    assert.notEqual(deal.hubspot_deal_id, "100");
    assert.ok(deals.get(deal.hubspot_deal_id!) && !deals.get(deal.hubspot_deal_id!)!.archived);
    assert.equal(deal.integration_sync_status, "synced");
    const [audit] = await query<{ action: string }>("SELECT action FROM audit_log WHERE action='hubspot_deal_recreated'");
    assert.ok(audit);
  });

  test("a submission from before the deletion does not bring the deal back", async () => {
    await submission("2026-09-04T16:00:00Z");
    deleteInHubSpot(deals, "100", "2026-09-05T12:00:00Z");
    await query("UPDATE deal SET integration_sync_status='pending'");
    assert.equal((await push(1)).status, "removed");
    assert.equal(deals.size, 1);
    assert.deepEqual(writes, []);
  });

  test("a purged deal (gone from HubSpot's archive too) is settled the same way", async () => {
    deals.delete("100");
    await query("UPDATE deal SET integration_sync_status='pending'");
    assert.equal((await push(1)).status, "removed");
    assert.equal((await localDeal()).closed_lost_reason, "Removed in HubSpot");
    assert.deepEqual(writes, []);
  });

  test("reading stages back from HubSpot mirrors a deleted deal and stays healthy", async () => {
    deleteInHubSpot(deals, "100");
    const result = await pull(now);
    assert.deepEqual(result, { read: 1, failed: 0 });
    assert.equal((await localDeal()).stage, "Closed Lost");
    const state = await health("hubspot_actions");
    assert.equal(state.state, "connected");
    assert.equal(state.last_error, null);
    assert.deepEqual(writes, []);
  });

  test("a deletion is noticed once: later passes neither read the deal again nor repeat the audit entry", async () => {
    deleteInHubSpot(deals, "100");
    await pull(now);
    const after = requests;
    const second = await pull(new Date(now.getTime() + 60_000));
    assert.deepEqual(second, { read: 0, failed: 0 });
    assert.equal(requests, after, "a mirrored deal is not read again");
    // Something marks the closed lead as waiting again (a staff edit): it is settled without a second audit entry.
    await query("UPDATE deal SET integration_sync_status='pending'");
    assert.equal((await push(1)).status, "removed");
    const audits = await query("SELECT 1 FROM audit_log WHERE action='hubspot_deal_removed'");
    assert.equal(audits.length, 1);
    assert.equal((await localDeal()).integration_sync_status, "synced");
  });

  test("a deal already won stays won when it is deleted in HubSpot", async () => {
    await query("UPDATE deal SET stage='Closed Won',closed_at=now()");
    deleteInHubSpot(deals, "100");
    await pull(now);
    const deal = await localDeal();
    assert.equal(deal.stage, "Closed Won");
    assert.equal(deal.closed_lost_reason, null);
    const [kept] = await query<{ next_action: string | null }>("SELECT next_action FROM deal WHERE id=1");
    assert.equal(kept.next_action, "Make first contact", "a won deal keeps its next step");
  });

  test("a deleted deal settles its alerts and tasks without touching HubSpot", async () => {
    await watchdog(now);
    const [opened] = await query<{ id: string; hubspot_task_id: string | null }>("SELECT id,hubspot_task_id FROM lead_alert_incident");
    assert.ok(opened?.hubspot_task_id, "the missed deadline raised a HubSpot task");
    writes = [];
    deleteInHubSpot(deals, "100");
    const summary = await tasksSync(now);
    assert.equal(summary.failed, 0);
    const [incident] = await query<{ acknowledged_at: Date | null; acknowledgement_source: string | null; task_completed_at: Date | null; last_error: string | null }>(
      "SELECT acknowledged_at,acknowledgement_source,task_completed_at,last_error FROM lead_alert_incident");
    assert.ok(incident.acknowledged_at && incident.task_completed_at);
    assert.equal(incident.acknowledgement_source, "hubspot_deal_removed");
    assert.equal(incident.last_error, null);
    assert.equal((await localDeal()).stage, "Closed Lost");
    assert.deepEqual(writes, []);
    const state = await health("hubspot_tasks");
    assert.equal(state.state, "connected");
    assert.equal(state.last_error, null);
    // The next watchdog pass raises nothing new for a closed lead.
    await watchdog(new Date(now.getTime() + 3_600_000));
    assert.equal(tasks.size, 1);
  });

  test("a task deleted in HubSpot is dismissed and never made again", async () => {
    await watchdog(now);
    const [opened] = await query<{ hubspot_task_id: string }>("SELECT hubspot_task_id FROM lead_alert_incident");
    deleteInHubSpot(tasks, opened.hubspot_task_id);
    writes = [];
    const summary = await tasksSync(now);
    assert.equal(summary.failed, 0);
    const [incident] = await query<{ acknowledgement_source: string | null; task_completed_at: Date | null; last_error: string | null }>(
      "SELECT acknowledgement_source,task_completed_at,last_error FROM lead_alert_incident");
    assert.equal(incident.acknowledgement_source, "hubspot_task_removed");
    assert.ok(incident.task_completed_at);
    assert.equal(incident.last_error, null);
    // The lead itself is untouched: only the task was dismissed.
    assert.equal((await localDeal()).stage, "New Lead");
    assert.equal((await health("hubspot_tasks")).state, "connected");
    await tasksSync(new Date(now.getTime() + 60_000));
    await watchdog(new Date(now.getTime() + 3_600_000));
    assert.equal(tasks.size, 1, "no replacement task");
    assert.deepEqual(writes, []);
  });

  test("reviews the earlier rule left open are settled on the next pass", async () => {
    deleteInHubSpot(deals, "100");
    await query("INSERT INTO hubspot_archive_review(object_type,remote_id) VALUES('deals','100'),('tasks','4242'),('deals','999')");
    await query("INSERT INTO integration_health(name,state,last_error) VALUES('hubspot_tasks','failed','3 archived HubSpot reference(s) need review. No automatic restoration or replacement.')");
    await tasksSync(now);
    const [open] = await query<{ count: string }>("SELECT count(*)::text AS count FROM hubspot_archive_review WHERE restored_at IS NULL");
    assert.equal(open.count, "0");
    assert.equal((await localDeal()).stage, "Closed Lost");
    const state = await health("hubspot_tasks");
    assert.equal(state.state, "connected");
    assert.equal(state.last_error, null);
    assert.deepEqual(writes, []);
  });

  test("a contact deleted in HubSpot is made again when its lead is still being sent", async () => {
    deleteInHubSpot(contacts, "200");
    await query("UPDATE deal SET integration_sync_status='pending'");
    const result = await push(1);
    assert.equal(result.status, "synced");
    const [contact] = await query<{ hubspot_contact_id: string }>("SELECT hubspot_contact_id FROM contact WHERE id=1");
    assert.notEqual(contact.hubspot_contact_id, "200");
    assert.equal(contacts.get(contact.hubspot_contact_id)!.properties.email, "test@example.com");
    assert.equal((await query("SELECT 1 FROM hubspot_lead_review WHERE released_at IS NULL")).length, 0, "nothing is held for review");
    assert.equal((await localDeal()).integration_sync_status, "synced");
  });

  test("an email HubSpot rejects does not keep the lead out: it goes in without the address", async () => {
    rejectEmail = "test@example.com";
    contacts.clear();
    deals.clear();
    await query("UPDATE contact SET hubspot_contact_id=NULL");
    await query("UPDATE deal SET hubspot_deal_id=NULL,integration_sync_status='pending',summary='Kitchen remodel'");
    const result = await push(1);
    assert.equal(result.status, "synced");
    const deal = await localDeal();
    assert.equal(deal.integration_sync_status, "synced");
    const created = deals.get(deal.hubspot_deal_id!)!;
    assert.match(created.properties.description ?? "", /Email as entered \(HubSpot would not accept it, please correct\): test@example\.com/);
    const [contact] = await query<{ hubspot_contact_id: string; email: string }>("SELECT hubspot_contact_id,email FROM contact WHERE id=1");
    assert.equal(contacts.get(contact.hubspot_contact_id)!.properties.email, undefined);
    assert.equal(contact.email, "test@example.com", "the address as typed stays on the P5 lead");
    assert.equal((await query("SELECT 1 FROM hubspot_lead_review WHERE released_at IS NULL")).length, 0);
    assert.equal((await pending()).failed, 0);
    assert.equal((await health("hubspot")).state, "connected");
  });

  test("a lead the earlier rule held for review is released and sent", async () => {
    await query("UPDATE deal SET integration_sync_status='failed'");
    await query("INSERT INTO hubspot_lead_review(deal_id,reason,remote_contact_id,next_check_at) VALUES(1,'archived_contact','200',now()+interval '24 hours')");
    await query("INSERT INTO lead_hubspot_retry(deal_id,next_attempt_at) VALUES(1,now()+interval '1 hour')");
    const batch = await pending();
    assert.deepEqual(batch, { attempted: 1, synced: 1, failed: 0, skipped: 0 });
    assert.equal((await query("SELECT 1 FROM hubspot_lead_review WHERE released_at IS NULL")).length, 0);
    assert.equal((await localDeal()).integration_sync_status, "synced");
    assert.equal((await health("hubspot")).state, "connected");
  });

  test("a HubSpot stage P5 has no name for is left alone in both directions", async () => {
    deals.get("100")!.properties.dealstage = "4646475481"; // "Job Complete", added in HubSpot on 15 November 2026
    await query("UPDATE deal SET stage='Closed Won',closed_at=now()");
    const result = await pull(now);
    assert.deepEqual(result, { read: 1, failed: 0 });
    assert.equal((await localDeal()).stage, "Closed Won");
    assert.equal((await health("hubspot_actions")).state, "connected");
    // Pushing the lead must not drag the HubSpot deal back to a P5 stage.
    await query("UPDATE deal SET integration_sync_status='pending'");
    assert.equal((await push(1)).status, "synced");
    assert.equal(deals.get("100")!.properties.dealstage, "4646475481");
  });
});
