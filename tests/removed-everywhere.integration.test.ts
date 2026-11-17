/**
 * Deletions carry across HubSpot and QuickBooks (owner, 17 November 2026).
 *
 * Runs the real code against a fake HubSpot, a fake QuickBooks and a real
 * database, and holds it to the rules in app/lib/leads/removed-everywhere.ts:
 * only a proposal is ever deleted, a customer goes only when nothing else is
 * on it, a merge is not a deletion, and a lead someone is working survives
 * its estimate being deleted.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const TEST_DB = process.env.TEST_DATABASE_URL;

type Hub = { id: string; archived: boolean; properties: Record<string, string> };
type Estimate = { Id: string; SyncToken: string; TxnStatus: string; EmailStatus?: string; TotalAmt: number; CustomerRef: { value: string }; LinkedTxn?: { TxnType: string; TxnId: string }[]; deleted?: boolean };
type Customer = { Id: string; SyncToken: string; Active: boolean; Balance: number; ParentRef?: { value: string } };

describe("deletions carry across HubSpot and QuickBooks", { skip: TEST_DB ? false : "TEST_DATABASE_URL not set" }, () => {
  let pull: typeof import("../app/lib/integrations/hubspot-operations.ts").pullHubSpotLeadActions;
  let everywhere: typeof import("../app/lib/leads/removed-everywhere.ts");
  let scopes: typeof import("../app/lib/scopes/qbo.ts");
  let removed: typeof import("../app/lib/integrations/hubspot-removed.ts");
  let query: typeof import("../app/lib/db.ts").query;
  let getPool: typeof import("../app/lib/db.ts").getPool;
  const originalFetch = globalThis.fetch;
  const saved = { token: process.env.HUBSPOT_TOKEN, key: process.env.QBO_TOKEN_KEY, flag: process.env.CROSS_SYSTEM_DELETE, env: process.env.QBO_ENV };
  const now = new Date("2026-09-07T21:00:00Z");

  let hubDeals: Map<string, Hub>;
  let hubContacts: Map<string, Hub>;
  let contactDeals: Map<string, string[]>;
  let estimates: Map<string, Estimate>;
  let customers: Map<string, Customer>;
  let invoices: { CustomerRef: string }[];
  let hubWrites: string[];
  let qboWrites: string[];
  let unexpected: string[];
  let qboDown: boolean;

  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
  const gone = () => json({ Fault: { Error: [{ Message: "Object Not Found", code: "610" }] } }, 400);

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.HUBSPOT_TOKEN = "isolated-test-token";
    process.env.QBO_TOKEN_KEY = randomBytes(32).toString("base64");
    delete process.env.QBO_ENV;
    delete process.env.CROSS_SYSTEM_DELETE;
    ({ pullHubSpotLeadActions: pull } = await import("../app/lib/integrations/hubspot-operations.ts"));
    everywhere = await import("../app/lib/leads/removed-everywhere.ts");
    scopes = await import("../app/lib/scopes/qbo.ts");
    removed = await import("../app/lib/integrations/hubspot-removed.ts");
    ({ query, getPool } = await import("../app/lib/db.ts"));

    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;

      // ---- HubSpot ----
      if (url.startsWith("https://api.hubapi.com")) {
        const path = url.replace("https://api.hubapi.com", "");
        if (path.startsWith("/account-info/v3/details")) return json({ portalId: 247066159 });
        if (path === "/crm/v3/objects/deals/search") {
          const filter = body.filterGroups[0].filters[0];
          const found = [...hubDeals.values()].filter((d) => !d.archived &&
            (filter.operator === "CONTAINS_TOKEN"
              ? String(d.properties[filter.propertyName] ?? "").split(";").includes(filter.value)
              : d.properties[filter.propertyName] === filter.value));
          return json({ total: found.length, results: found });
        }
        const assoc = /^\/crm\/v4\/objects\/contacts\/(\d+)\/associations\/deals/.exec(path)?.[1];
        if (assoc) {
          const live = (contactDeals.get(assoc) ?? []).filter((id) => !hubDeals.get(id)?.archived);
          return json({ results: live.map((id) => ({ toObjectId: id })) });
        }
        const object = /^\/crm\/v3\/objects\/(deals|contacts)\/(\d+)/.exec(path);
        if (object) {
          const store = object[1] === "deals" ? hubDeals : hubContacts;
          const row = store.get(object[2]);
          if (method === "DELETE") {
            hubWrites.push(`DELETE ${object[1]}/${object[2]}`);
            if (!row || row.archived) return json({}, 404);
            row.archived = true;
            return new Response(null, { status: 204 });
          }
          const wantsArchived = /[?&]archived=true(&|$)/.test(url);
          if (!row || row.archived !== wantsArchived) return json({}, 404);
          return json({ id: row.id, archived: row.archived, archivedAt: row.archived ? now.toISOString() : undefined, properties: row.properties });
        }
        unexpected.push(`${method} ${url}`);
        return json({}, 500);
      }

      // ---- QuickBooks ----
      if (url.startsWith("https://quickbooks.api.intuit.com")) {
        if (qboDown) return json({ Fault: "unavailable" }, 400);
        const path = url.replace(/^https:\/\/quickbooks\.api\.intuit\.com\/v3\/company\/[^/]+/, "").replace(/[?&]minorversion=\d+/, "");
        if (path.startsWith("/query?query=")) {
          const sql = decodeURIComponent(path.slice("/query?query=".length));
          const entity = /FROM (\w+)/.exec(sql)![1];
          const customerId = /(?:CustomerRef|ParentRef) = '([^']+)'/.exec(sql)?.[1];
          let rows: unknown[] = [];
          if (entity === "Estimate") rows = [...estimates.values()].filter((e) => !e.deleted && e.CustomerRef.value === customerId);
          else if (entity === "Invoice") rows = invoices.filter((i) => i.CustomerRef === customerId);
          else if (entity === "Customer") rows = [...customers.values()].filter((c) => c.Active && c.ParentRef?.value === customerId);
          return json({ QueryResponse: { [entity]: rows } });
        }
        const estimate = /^\/estimate\/(\d+)$/.exec(path)?.[1];
        if (estimate && method === "GET") {
          const row = estimates.get(estimate);
          return !row || row.deleted ? gone() : json({ Estimate: row });
        }
        if (path.startsWith("/estimate?operation=delete") && method === "POST") {
          qboWrites.push(`DELETE estimate/${body.Id}`);
          const row = estimates.get(String(body.Id));
          if (!row || row.deleted) return gone();
          row.deleted = true;
          return json({ Estimate: { Id: row.Id, status: "Deleted" } });
        }
        const customer = /^\/customer\/(\d+)$/.exec(path)?.[1];
        if (customer && method === "GET") {
          const row = customers.get(customer);
          return row ? json({ Customer: row }) : gone();
        }
        if (path === "/customer" && method === "POST") {
          qboWrites.push(`UPDATE customer/${body.Id} Active=${body.Active}`);
          const row = customers.get(String(body.Id))!;
          row.Active = body.Active;
          return json({ Customer: row });
        }
        unexpected.push(`${method} ${url}`);
        return json({ Fault: "unexpected" }, 400);
      }
      throw new Error(`Unexpected external request in isolated test: ${method} ${url}`);
    };
  });

  after(async () => {
    globalThis.fetch = originalFetch;
    for (const [name, value] of [["HUBSPOT_TOKEN", saved.token], ["QBO_TOKEN_KEY", saved.key], ["CROSS_SYSTEM_DELETE", saved.flag], ["QBO_ENV", saved.env]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await getPool().end();
  });

  /** One website estimate for lead 1: scope project, version, QuickBooks estimate and the link between them. */
  async function estimateFor(lead: number, qboEstimateId: string, customerId: string, raw: Partial<Estimate> = {}): Promise<number> {
    const [project] = await query<{ id: number }>(
      "INSERT INTO scope_project (title, qbo_customer_id, qbo_customer_name) VALUES ($1,$2,'Test customer') RETURNING id::int AS id",
      [`Estimate ${qboEstimateId}`, customerId],
    );
    const [version] = await query<{ id: number }>(
      "INSERT INTO scope_version (project_id, version_no, source, doc) VALUES ($1,1,'guided','{}'::jsonb) RETURNING id::int AS id",
      [project.id],
    );
    await query("UPDATE scope_project SET current_version_id=$2 WHERE id=$1", [project.id, version.id]);
    const live: Estimate = { Id: qboEstimateId, SyncToken: "0", TxnStatus: "Pending", TotalAmt: 1000, CustomerRef: { value: customerId }, ...raw };
    estimates.set(qboEstimateId, live);
    await query(
      `INSERT INTO scope_estimate (project_id, version_id, qbo_estimate_id, doc_number, txn_status, total, sent_payload, qbo_snapshot)
       VALUES ($1,$2,$3,$4,$5,1000,'{}'::jsonb,$6::jsonb)`,
      [project.id, version.id, qboEstimateId, `10${qboEstimateId}`, live.TxnStatus, JSON.stringify(live)],
    );
    await query(
      `INSERT INTO guided_estimate (token, brand, client_key, project, tier, answers, first_name, last_name, email, phone,
         estimate_class, total, customer_view, internal_report, rules_version, cost_book_version, scope_project_id, scope_version_id, lead_deal_id)
       VALUES ($1,'cabinet',$1,'kitchen-cabinets','mid','{}'::jsonb,'Test','Lead','test@example.com','2085550100',
         'preliminary',1000,'{}'::jsonb,'{}'::jsonb,'r','c',$2,$3,$4)`,
      [`token-${qboEstimateId}-${"x".repeat(20)}`, project.id, version.id, lead],
    );
    return project.id;
  }

  beforeEach(async () => {
    hubDeals = new Map([["100", { id: "100", archived: false, properties: { dealstage: "appointmentscheduled" } }]]);
    hubContacts = new Map([["200", { id: "200", archived: false, properties: { email: "test@example.com" } }]]);
    contactDeals = new Map([["200", ["100"]]]);
    estimates = new Map();
    customers = new Map([["34", { Id: "34", SyncToken: "0", Active: true, Balance: 0 }]]);
    invoices = [];
    hubWrites = []; qboWrites = []; unexpected = []; qboDown = false;
    delete process.env.CROSS_SYSTEM_DELETE;
    await query("TRUNCATE guided_estimate,scope_event,scope_estimate,scope_version,scope_project,qbo_connection,hubspot_lead_review,lead_hubspot_retry,hubspot_archive_review,integration_health,lead_intake_submission,deal,contact,app_user,alert,lead_alert_incident,task,activity,audit_log,job_run,job_lock,setting RESTART IDENTITY CASCADE");
    await query("INSERT INTO setting (key,value) VALUES ('lead_manager',$1::jsonb)", [JSON.stringify({ featureFlags: { hubspotIntegrationEnabled: true } })]);
    const { encryptSecret } = await import("../app/lib/finance/crypto.ts");
    await query(
      `INSERT INTO qbo_connection (id, realm_id, access_cipher, refresh_cipher, access_expires_at, refresh_expires_at, connected_at, updated_at)
       VALUES (1,'realm1',$1,$2,now()+interval '1 hour',now()+interval '30 days',now(),now())`,
      [encryptSecret("access"), encryptSecret("refresh")],
    );
    await query("INSERT INTO contact (identity_key,first_name,email,hubspot_contact_id) VALUES ('email:test@example.com','Test','test@example.com','200')");
    await query(
      `INSERT INTO deal (contact_id,name,brand,lead_source,stage,received_at,hubspot_deal_id,integration_sync_status)
       VALUES (1,'Test inquiry','Boise Cabinet Co','Organic Website','New Lead',$1,'100','synced')`, [now],
    );
  });

  const lead = async () => (await query<{ stage: string; closed_lost_reason: string | null }>("SELECT stage,closed_lost_reason FROM deal WHERE id=1"))[0];
  const project = async (id: number) => (await query<{ deleted_at: Date | null; delete_note: string | null }>("SELECT deleted_at,delete_note FROM scope_project WHERE id=$1", [id]))[0];
  const audits = async (action: string) => query<{ new_value: Record<string, unknown>; succeeded: boolean }>("SELECT new_value,succeeded FROM audit_log WHERE action=$1 ORDER BY id", [action]);

  test("a deal deleted in HubSpot deletes the lead's unsent QuickBooks estimate and retires the unused customer", async () => {
    const projectId = await estimateFor(1, "90", "34");
    hubDeals.get("100")!.archived = true;
    await pull(now);
    assert.equal((await lead()).closed_lost_reason, "Removed in HubSpot");
    assert.equal(estimates.get("90")!.deleted, true);
    assert.equal(customers.get("34")!.Active, false);
    assert.deepEqual(qboWrites, ["DELETE estimate/90", "UPDATE customer/34 Active=false"]);
    assert.ok((await project(projectId)).deleted_at, "the scope project leaves the list");
    const [entry] = await audits("quickbooks_removed_with_hubspot_deal");
    assert.ok(entry, "what was removed is on the lead's audit trail");
    assert.deepEqual(hubWrites, [], "nothing is written back to HubSpot");
    assert.deepEqual(unexpected, []);
  });

  test("accepted or invoiced work is never deleted, and its customer stays", async () => {
    const accepted = await estimateFor(1, "90", "34", { TxnStatus: "Accepted" });
    const invoiced = await estimateFor(1, "91", "34", { TxnStatus: "Closed", LinkedTxn: [{ TxnType: "Invoice", TxnId: "500" }] });
    invoices.push({ CustomerRef: "34" });
    hubDeals.get("100")!.archived = true;
    await pull(now);
    assert.equal((await lead()).stage, "Closed Lost");
    assert.deepEqual(qboWrites, [], "QuickBooks is not touched");
    assert.equal(estimates.get("90")!.deleted, undefined);
    assert.equal(estimates.get("91")!.deleted, undefined);
    assert.equal(customers.get("34")!.Active, true);
    assert.equal((await project(accepted)).deleted_at, null);
    assert.equal((await project(invoiced)).deleted_at, null);
    const [entry] = await audits("quickbooks_removed_with_hubspot_deal");
    assert.equal((entry.new_value.kept as string[]).length, 2);
    assert.deepEqual(unexpected, []);
  });

  test("a customer with anything else on it is kept when the estimate goes", async () => {
    await estimateFor(1, "90", "34");
    invoices.push({ CustomerRef: "34" }); // an older job for the same customer
    hubDeals.get("100")!.archived = true;
    await pull(now);
    assert.equal(estimates.get("90")!.deleted, true);
    assert.equal(customers.get("34")!.Active, true);
    assert.deepEqual(qboWrites, ["DELETE estimate/90"]);
  });

  test("a deal merged in HubSpot is not a deletion: the lead follows the surviving deal and QuickBooks is untouched", async () => {
    const projectId = await estimateFor(1, "90", "34");
    hubDeals.get("100")!.archived = true;
    hubDeals.set("101", { id: "101", archived: false, properties: { dealstage: "qualifiedtobuy", hs_merged_object_ids: "100" } });
    await pull(now);
    const [row] = await query<{ stage: string; hubspot_deal_id: string; integration_sync_status: string }>("SELECT stage,hubspot_deal_id,integration_sync_status FROM deal WHERE id=1");
    assert.equal(row.stage, "New Lead");
    assert.equal(row.hubspot_deal_id, "101");
    assert.equal(row.integration_sync_status, "pending");
    assert.deepEqual(qboWrites, []);
    assert.equal((await project(projectId)).deleted_at, null);
    assert.equal((await audits("hubspot_deal_merged")).length, 1);
  });

  test("a merged deal whose survivor another lead already has closes as a duplicate, QuickBooks untouched", async () => {
    await estimateFor(1, "90", "34");
    await query(
      `INSERT INTO deal (contact_id,name,brand,lead_source,stage,received_at,hubspot_deal_id,integration_sync_status)
       VALUES (1,'Same person again','Boise Cabinet Co','Organic Website','Contacting',$1,'101','synced')`, [now],
    );
    hubDeals.get("100")!.archived = true;
    hubDeals.set("101", { id: "101", archived: false, properties: { dealstage: "qualifiedtobuy", hs_merged_object_ids: "77;100" } });
    await removed.mirrorRemovedDeal("100");
    assert.equal((await lead()).closed_lost_reason, "Merged into another deal in HubSpot");
    assert.deepEqual(qboWrites, []);
  });

  test("QuickBooks being unavailable is remembered and retried, not lost", async () => {
    await estimateFor(1, "90", "34");
    hubDeals.get("100")!.archived = true;
    qboDown = true;
    await pull(now);
    assert.equal((await lead()).stage, "Closed Lost", "the HubSpot side is settled regardless");
    assert.equal(estimates.get("90")!.deleted, undefined);
    const pending = await audits("quickbooks_cleanup_pending");
    assert.equal(pending.length, 1);
    assert.equal(pending[0].succeeded, false);
    // Not retried at once (six hours apart), then finished when QuickBooks is back.
    qboDown = false;
    assert.deepEqual(await everywhere.settleRemovedLeads(), { attempted: 0, finished: 0 });
    await query("UPDATE audit_log SET occurred_at=now()-interval '7 hours' WHERE action='quickbooks_cleanup_pending'");
    assert.deepEqual(await everywhere.settleRemovedLeads(), { attempted: 1, finished: 1 });
    assert.equal(estimates.get("90")!.deleted, true);
    assert.deepEqual(await everywhere.settleRemovedLeads(), { attempted: 0, finished: 0 });
  });

  test("a deletion from before this rule is mirrored but never reaches into QuickBooks", async () => {
    await estimateFor(1, "90", "34");
    hubDeals.get("100")!.archived = true;
    await query("INSERT INTO hubspot_archive_review(object_type,remote_id) VALUES('deals','100')");
    assert.equal(await removed.settleOpenArchiveReviews(), 1);
    assert.equal((await lead()).closed_lost_reason, "Removed in HubSpot");
    assert.deepEqual(qboWrites, []);
    assert.equal(estimates.get("90")!.deleted, undefined);
  });

  test("an estimate deleted in QuickBooks removes an untouched lead from HubSpot", async () => {
    const projectId = await estimateFor(1, "90", "34");
    estimates.get("90")!.deleted = true; // a person deleted it in QuickBooks
    await scopes.onEstimateDeleted("90"); // what the QuickBooks webhook calls
    assert.equal((await lead()).closed_lost_reason, "Removed in QuickBooks");
    assert.equal(hubDeals.get("100")!.archived, true);
    assert.equal(hubContacts.get("200")!.archived, true, "a contact with no other deal goes too");
    assert.deepEqual(hubWrites, ["DELETE deals/100", "DELETE contacts/200"]);
    assert.ok((await project(projectId)).deleted_at);
    assert.equal(customers.get("34")!.Active, false);
    assert.equal((await audits("quickbooks_estimate_removed")).length, 1);
    assert.deepEqual(unexpected, []);
  });

  test("a contact with another deal is kept when its lead is removed", async () => {
    await estimateFor(1, "90", "34");
    hubDeals.set("150", { id: "150", archived: false, properties: {} });
    contactDeals.set("200", ["100", "150"]);
    estimates.get("90")!.deleted = true;
    await scopes.onEstimateDeleted("90");
    assert.equal(hubDeals.get("100")!.archived, true);
    assert.equal(hubContacts.get("200")!.archived, false);
    assert.deepEqual(hubWrites, ["DELETE deals/100"]);
  });

  test("a lead someone is working survives its estimate being deleted to be redone", async () => {
    const projectId = await estimateFor(1, "90", "34");
    await query("UPDATE deal SET stage='Contacting', first_attempt_at=now() WHERE id=1");
    estimates.get("90")!.deleted = true;
    await scopes.onEstimateDeleted("90");
    assert.equal((await lead()).stage, "Contacting");
    assert.deepEqual(hubWrites, []);
    assert.equal((await project(projectId)).deleted_at, null);
    const [event] = await query<{ kind: string }>("SELECT kind FROM scope_event WHERE kind='estimate-deleted-lead-kept'");
    assert.ok(event, "why nothing was removed is on the project's log");
  });

  test("but a worked lead goes when its QuickBooks customer was removed as well", async () => {
    await estimateFor(1, "90", "34");
    await query("UPDATE deal SET stage='Contacting', first_attempt_at=now() WHERE id=1");
    estimates.get("90")!.deleted = true;
    customers.get("34")!.Active = false; // the person deleted the customer too
    await scopes.onEstimateDeleted("90");
    assert.equal((await lead()).closed_lost_reason, "Removed in QuickBooks");
    assert.equal(hubDeals.get("100")!.archived, true);
  });

  test("a lead with another live estimate stands when one estimate is deleted", async () => {
    await estimateFor(1, "90", "34");
    await estimateFor(1, "91", "34");
    estimates.get("90")!.deleted = true;
    await scopes.onEstimateDeleted("90");
    assert.equal((await lead()).stage, "New Lead");
    assert.deepEqual(hubWrites, []);
    assert.equal(estimates.get("91")!.deleted, undefined);
  });

  test("a won lead is never removed from HubSpot by a QuickBooks deletion", async () => {
    await estimateFor(1, "90", "34");
    await query("UPDATE deal SET stage='Closed Won', closed_at=now() WHERE id=1");
    estimates.get("90")!.deleted = true;
    await scopes.onEstimateDeleted("90");
    assert.equal((await lead()).stage, "Closed Won");
    assert.deepEqual(hubWrites, []);
  });

  test("an estimate this platform deleted itself does not come back round as a QuickBooks deletion", async () => {
    await estimateFor(1, "90", "34");
    hubDeals.get("100")!.archived = true;
    await pull(now); // HubSpot deletion: this platform deletes estimate 90
    hubWrites = [];
    await scopes.onEstimateDeleted("90"); // QuickBooks then reports that deletion
    assert.deepEqual(hubWrites, []);
    assert.equal((await lead()).closed_lost_reason, "Removed in HubSpot");
  });

  test("CROSS_SYSTEM_DELETE=off stops both directions", async () => {
    process.env.CROSS_SYSTEM_DELETE = "off";
    await estimateFor(1, "90", "34");
    await estimateFor(1, "91", "34");
    hubDeals.get("100")!.archived = true;
    await pull(now);
    assert.equal((await lead()).closed_lost_reason, "Removed in HubSpot", "the mirror itself still happens");
    assert.deepEqual(qboWrites, []);
    await query("UPDATE deal SET stage='New Lead', closed_at=NULL, closed_lost_reason=NULL WHERE id=1");
    hubDeals.get("100")!.archived = false;
    estimates.get("91")!.deleted = true;
    await scopes.onEstimateDeleted("91");
    assert.deepEqual(hubWrites, []);
  });
});
