/**
 * Stage alignment between QuickBooks estimates, the P5 lead and HubSpot
 * (owner, 17 November 2026).
 *
 * Runs the real code against a fake HubSpot, a fake QuickBooks and a real
 * database, and holds it to the rules in app/lib/leads/stage-alignment.ts:
 * an estimate's status moves the lead (forward only, never a won lead, never
 * one that was removed), a paid job moves the HubSpot deal to "Job Complete",
 * a closed lead sets its open estimate in QuickBooks, and none of it loops.
 *
 * The fake QuickBooks is strict where the real one is: it refuses a query on
 * a field it does not index, and it applies an update only with the current
 * SyncToken.
 */
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const TEST_DB = process.env.TEST_DATABASE_URL;

type Hub = { id: string; archived: boolean; properties: Record<string, string> };
type Estimate = {
  Id: string; SyncToken: string; TxnStatus: string; EmailStatus?: string; TotalAmt: number; DocNumber: string;
  CustomerRef: { value: string }; LinkedTxn?: { TxnType: string; TxnId: string }[]; Line?: unknown; deleted?: boolean;
};
type Customer = { Id: string; SyncToken: string; Active: boolean; Balance: number; DisplayName?: string; IsProject?: boolean; ParentRef?: { value: string } };
type Invoice = { Id: string; TotalAmt: number; Balance: number; CustomerRef: { value: string }; LinkedTxn?: { TxnType: string; TxnId: string }[] };

const JOB_COMPLETE = "9001";
const P5_STAGES = [
  { id: "appointmentscheduled", label: "New Lead" }, { id: "qualifiedtobuy", label: "Contacting" },
  { id: "presentationscheduled", label: "Appointment Scheduled" }, { id: "decisionmakerboughtin", label: "Estimate in Progress" },
  { id: "contractsent", label: "Estimate Sent" }, { id: "4182226638", label: "Decision Pending" },
  { id: "closedwon", label: "Closed Won" }, { id: "closedlost", label: "Closed Lost" },
];

describe("stage alignment between QuickBooks, the lead and HubSpot", { skip: TEST_DB ? false : "TEST_DATABASE_URL not set" }, () => {
  let alignment: typeof import("../app/lib/leads/stage-alignment.ts");
  let pull: typeof import("../app/lib/integrations/hubspot-operations.ts").pullHubSpotLeadActions;
  let push: typeof import("../app/lib/integrations/hubspot.ts").syncDealToHubSpot;
  let scopes: typeof import("../app/lib/scopes/qbo.ts");
  let store: typeof import("../app/lib/scopes/store.ts");
  let sync: typeof import("../app/lib/finance/qbo/sync.ts");
  let query: typeof import("../app/lib/db.ts").query;
  let getPool: typeof import("../app/lib/db.ts").getPool;
  const originalFetch = globalThis.fetch;
  const ENV = ["HUBSPOT_TOKEN", "QBO_TOKEN_KEY", "QBO_ENV", "STAGE_ALIGNMENT", "STAGE_ALIGNMENT_QUICKBOOKS_WRITE", "CROSS_SYSTEM_DELETE", "REVIEW_REQUEST", "REVIEW_REQUEST_DELAY_HOURS"] as const;
  const saved = Object.fromEntries(ENV.map((name) => [name, process.env[name]]));

  let hubDeals: Map<string, Hub>;
  let hubContacts: Map<string, Hub>;
  let pipeline: { id: string; label: string }[];
  let pipelineDown: boolean;
  let hubWrites: string[];
  let estimates: Map<string, Estimate>;
  let customers: Map<string, Customer>;
  let invoices: Map<string, Invoice>;
  let qboWrites: string[];
  let qboReads: string[];
  let unexpected: string[];
  let qboRefused: string[];
  let qboDown: boolean;
  /** Someone else saving the estimate between our read and our write. Runs once. */
  let beforeEstimateWrite: ((row: Estimate) => void) | null;
  /** QuickBooks answering an update without applying the status. */
  let ignoreStatus: boolean;
  /** Holds every QuickBooks request until released. */
  let qboGate: Promise<void> | null;
  let nextId: number;

  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
  const gone = () => json({ Fault: { Error: [{ Message: "Object Not Found", Detail: "Object Not Found : Something you're trying to use has been made inactive.", code: "610" }], type: "ValidationFault" } }, 400);
  // The real answer to an update that carries an old SyncToken.
  const stale = () => json({ Fault: { Error: [{ Message: "Stale Object Error", Detail: "Stale Object Error : You and Test User were working on the same thing. Test User finished before you did.", code: "5010", element: "" }], type: "ValidationFault" }, time: new Date().toISOString() }, 400);

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.HUBSPOT_TOKEN = "isolated-test-token";
    process.env.QBO_TOKEN_KEY = randomBytes(32).toString("base64");
    for (const name of ["QBO_ENV", "STAGE_ALIGNMENT", "STAGE_ALIGNMENT_QUICKBOOKS_WRITE", "CROSS_SYSTEM_DELETE"]) delete process.env[name];
    alignment = await import("../app/lib/leads/stage-alignment.ts");
    ({ pullHubSpotLeadActions: pull } = await import("../app/lib/integrations/hubspot-operations.ts"));
    ({ syncDealToHubSpot: push } = await import("../app/lib/integrations/hubspot.ts"));
    scopes = await import("../app/lib/scopes/qbo.ts");
    store = await import("../app/lib/scopes/store.ts");
    sync = await import("../app/lib/finance/qbo/sync.ts");
    ({ query, getPool } = await import("../app/lib/db.ts"));

    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;

      // ---- HubSpot ----
      if (url.startsWith("https://api.hubapi.com")) {
        const path = url.replace("https://api.hubapi.com", "");
        if (path.startsWith("/account-info/v3/details")) return json({ portalId: 247066159 });
        if (path.startsWith("/crm/v3/properties/deals")) return json({ results: [] });
        const pipelineId = /^\/crm\/v3\/pipelines\/deals\/([^/?]+)$/.exec(path)?.[1];
        if (pipelineId && method === "GET") {
          if (pipelineDown) return json({ message: "unavailable" }, 500);
          return pipelineId === "default"
            ? json({ id: "default", stages: pipeline.map((stage, i) => ({ ...stage, displayOrder: i, archived: false })) })
            : json({}, 404);
        }
        if (path.includes("/associations/") && method === "PUT") return json({});
        if (path === "/crm/v3/objects/notes" && method === "POST") return json({ id: String(nextId++) });
        if (path === "/crm/v3/objects/deals/search" || path === "/crm/v3/objects/contacts/search") {
          const rows = path.includes("/deals/") ? hubDeals : hubContacts;
          const filter = body.filterGroups?.[0]?.filters?.[0];
          const found = filter ? [...rows.values()].filter((d) => !d.archived &&
            (filter.operator === "CONTAINS_TOKEN"
              ? String(d.properties[filter.propertyName] ?? "").split(";").includes(filter.value)
              : d.properties[filter.propertyName] === filter.value)) : [];
          return json({ total: found.length, results: found });
        }
        const assoc = /^\/crm\/v4\/objects\/contacts\/(\d+)\/associations\/deals/.exec(path)?.[1];
        if (assoc && method === "GET") return json({ results: [...hubDeals.values()].filter((d) => !d.archived).map((d) => ({ toObjectId: d.id })) });
        const object = /^\/crm\/v3\/objects\/(deals|contacts)\/(\d+)/.exec(path);
        if (object) {
          const rows = object[1] === "deals" ? hubDeals : hubContacts;
          const row = rows.get(object[2]);
          if (method === "DELETE") {
            hubWrites.push(`DELETE ${object[1]}/${object[2]}`);
            if (!row || row.archived) return json({}, 404);
            row.archived = true;
            return new Response(null, { status: 204 });
          }
          if (method === "PATCH") {
            if (!row || row.archived) return json({}, 404);
            if (object[1] === "deals" && body.properties.dealstage) hubWrites.push(`PATCH deals/${object[2]} dealstage=${body.properties.dealstage}`);
            Object.assign(row.properties, body.properties);
            return json({ id: row.id });
          }
          const wantsArchived = /[?&]archived=true(&|$)/.test(url);
          if (!row || row.archived !== wantsArchived) return json({}, 404);
          return json({ id: row.id, archived: row.archived, archivedAt: row.archived ? new Date().toISOString() : undefined, properties: row.properties });
        }
        unexpected.push(`${method} ${url}`);
        return json({}, 400);
      }

      // ---- QuickBooks ----
      if (url.startsWith("https://quickbooks.api.intuit.com")) {
        if (qboGate) await qboGate;
        if (qboDown) return json({ Fault: "unavailable" }, 400);
        const path = url.replace(/^https:\/\/quickbooks\.api\.intuit\.com\/v3\/company\/[^/]+/, "").replace(/[?&]minorversion=\d+/, "");
        if (path.startsWith("/query?query=")) {
          const sql = decodeURIComponent(path.slice("/query?query=".length));
          const entity = /FROM (\w+)/.exec(sql)![1];
          // The real QuickBooks refuses a filter on a field it does not index
          // (ParentRef on a customer, found live on 17 November 2026). A check
          // written against a more forgiving fake proves nothing.
          const where = /WHERE (.*?)(?: STARTPOSITION| MAXRESULTS|$)/.exec(sql)?.[1] ?? "";
          const fields = [...where.matchAll(/(\w+) (?:=|IN|LIKE|<|>)/g)].map((m) => m[1]);
          const queryable = entity === "Customer" ? ["Id", "Active", "Job", "DisplayName"] : ["Id", "CustomerRef", "DocNumber", "TxnDate"];
          const refused = fields.find((field) => !queryable.includes(field));
          if (refused) {
            qboRefused.push(`${entity}.${refused}`);
            return json({ Fault: { Error: [{ Message: "Invalid query", Detail: `QueryValidationError: Property ${refused} is not queryable`, code: "4001" }], type: "ValidationFault" } }, 400);
          }
          const customerId = /CustomerRef = '([^']+)'/.exec(sql)?.[1];
          let rows: unknown[] = [];
          if (entity === "Estimate") rows = [...estimates.values()].filter((e) => !e.deleted && e.CustomerRef.value === customerId);
          else if (entity === "Invoice") rows = [...invoices.values()].filter((i) => i.CustomerRef.value === customerId);
          else if (entity === "Customer") rows = [...customers.values()].filter((c) => c.Active);
          return json({ QueryResponse: { [entity]: rows } });
        }
        const estimate = /^\/estimate\/(\d+)$/.exec(path)?.[1];
        if (estimate && method === "GET") {
          qboReads.push(`estimate/${estimate}`);
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
        if (/^\/estimate(\?requestid=[^&]+)?$/.test(path) && method === "POST") {
          if (!body.Id) {
            // Create: QuickBooks starts every record at SyncToken "0".
            const id = String(nextId++);
            const row: Estimate = { ...body, Id: id, SyncToken: "0", TxnStatus: body.TxnStatus ?? "Pending", DocNumber: `10${id}`, TotalAmt: 1000 };
            estimates.set(id, row);
            qboWrites.push(`CREATE estimate/${id}`);
            return json({ Estimate: row });
          }
          const row = estimates.get(String(body.Id));
          if (!row || row.deleted) return gone();
          if (beforeEstimateWrite) { const edit = beforeEstimateWrite; beforeEstimateWrite = null; edit(row); }
          // An update is applied only with the token of the copy it was read from.
          if (String(body.SyncToken) !== row.SyncToken) { qboWrites.push(`STALE estimate/${row.Id}`); return stale(); }
          // A full update replaces the document, so one without its lines is refused.
          if (body.sparse !== true && !body.Line) {
            return json({ Fault: { Error: [{ Message: "Required param missing, need to supply the required value for the API", Detail: "Required parameter Line is missing in the request", code: "2020" }], type: "ValidationFault" } }, 400);
          }
          const { Id: _id, SyncToken: _token, sparse: _sparse, TxnStatus: status, ...rest } = body;
          void _id; void _token; void _sparse;
          Object.assign(row, rest);
          if (status && !ignoreStatus) row.TxnStatus = status;
          row.SyncToken = String(Number(row.SyncToken) + 1);
          qboWrites.push(status ? `UPDATE estimate/${row.Id} TxnStatus=${status}` : `UPDATE estimate/${row.Id} lines`);
          return json({ Estimate: row });
        }
        const invoice = /^\/invoice\/(\d+)$/.exec(path)?.[1];
        if (invoice && method === "GET") {
          qboReads.push(`invoice/${invoice}`);
          const row = invoices.get(invoice);
          return row ? json({ Invoice: row }) : gone();
        }
        const customer = /^\/customer\/(\d+)$/.exec(path)?.[1];
        if (customer && method === "GET") {
          const row = customers.get(customer);
          return row ? json({ Customer: row }) : gone();
        }
        if (/^\/customer(\?requestid=[^&]+)?$/.test(path) && method === "POST") {
          if (!body.Id) {
            const id = String(nextId++);
            const row: Customer = { ...body, Id: id, SyncToken: "0", Active: true, Balance: 0 };
            customers.set(id, row);
            qboWrites.push(`CREATE customer/${id}${row.IsProject ? " project" : ""}`);
            return json({ Customer: row });
          }
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
    for (const name of ENV) {
      if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name];
    }
    await getPool().end();
  });

  beforeEach(async () => {
    hubDeals = new Map([["100", { id: "100", archived: false, properties: { dealstage: "appointmentscheduled" } }]]);
    hubContacts = new Map([["200", { id: "200", archived: false, properties: { email: "test@example.com" } }]]);
    pipeline = [...P5_STAGES, { id: JOB_COMPLETE, label: "Job Complete" }];
    pipelineDown = false;
    estimates = new Map();
    customers = new Map([["34", { Id: "34", SyncToken: "0", Active: true, Balance: 0 }]]);
    invoices = new Map();
    hubWrites = []; qboWrites = []; qboReads = []; unexpected = []; qboRefused = [];
    qboDown = false; beforeEstimateWrite = null; ignoreStatus = false; qboGate = null; nextId = 5000;
    for (const name of ["STAGE_ALIGNMENT", "STAGE_ALIGNMENT_QUICKBOOKS_WRITE", "CROSS_SYSTEM_DELETE", "REVIEW_REQUEST", "REVIEW_REQUEST_DELAY_HOURS"]) delete process.env[name];
    alignment.resetStageAlignmentCache();
    await query("TRUNCATE guided_estimate,scope_event,scope_estimate,scope_version,scope_project,qbo_connection,qbo_txn,qbo_customer,qbo_write_intent,hubspot_lead_review,lead_hubspot_retry,hubspot_archive_review,integration_health,lead_intake_submission,deal,contact,app_user,alert,lead_alert_incident,task,activity,audit_log,job_run,job_lock,setting RESTART IDENTITY CASCADE");
    await query("INSERT INTO setting (key,value) VALUES ('lead_manager',$1::jsonb)", [JSON.stringify({ featureFlags: { hubspotIntegrationEnabled: true } })]);
    const { encryptSecret } = await import("../app/lib/finance/crypto.ts");
    await query(
      `INSERT INTO qbo_connection (id, realm_id, access_cipher, refresh_cipher, access_expires_at, refresh_expires_at, connected_at, updated_at)
       VALUES (1,'realm1',$1,$2,now()+interval '1 hour',now()+interval '30 days',now(),now())`,
      [encryptSecret("access"), encryptSecret("refresh")],
    );
    await query("INSERT INTO app_user (email,full_name,role) VALUES ('estimator@p5homeco.com','Estimator','manager')");
    await query("INSERT INTO contact (identity_key,first_name,email,hubspot_contact_id) VALUES ('email:test@example.com','Test','test@example.com','200')");
    await query(
      `INSERT INTO deal (contact_id,name,brand,lead_source,stage,received_at,hubspot_deal_id,integration_sync_status)
       VALUES (1,'Test inquiry','Boise Cabinet Co','Organic Website','New Lead',now()-interval '1 day','100','synced')`,
    );
  });

  afterEach(async () => {
    await alignment.stageAlignmentSettled();
    assert.deepEqual(unexpected, [], "no request the fakes did not expect");
    assert.deepEqual(qboRefused, [], "every query is one QuickBooks accepts");
  });

  // ---- fixtures ----------------------------------------------------------

  const LINES = [{ DetailType: "SalesItemLineDetail", Description: "Cabinets", Amount: 1000, SalesItemLineDetail: { Qty: 1, UnitPrice: 1000 } }];

  /** A scope project the website made for a lead, linked to it, with no QuickBooks estimate yet. */
  async function websiteProject(leadId: number | null, customerId = "34"): Promise<{ projectId: number; versionId: number }> {
    const [project] = await query<{ id: number }>(
      "INSERT INTO scope_project (title, qbo_customer_id, qbo_customer_name) VALUES ('Website estimate',$1,'Test customer') RETURNING id::int AS id",
      [customerId],
    );
    const versionId = await addVersion(project.id, 1);
    if (leadId !== null) {
      const token = `token-${project.id}-${"x".repeat(24)}`;
      await query(
        `INSERT INTO guided_estimate (token, brand, client_key, project, tier, answers, first_name, last_name, email, phone,
           estimate_class, total, customer_view, internal_report, rules_version, cost_book_version, scope_project_id, scope_version_id, lead_deal_id)
         VALUES ($1,'cabinet',$1,'kitchen-cabinets','mid','{}'::jsonb,'Test','Lead','test@example.com','2085550100',
           'preliminary',1000,'{}'::jsonb,'{}'::jsonb,'r','c',$2,$3,$4)`,
        [token, project.id, versionId, leadId],
      );
    }
    return { projectId: project.id, versionId };
  }
  async function addVersion(projectId: number, versionNo: number): Promise<number> {
    const [version] = await query<{ id: number }>(
      "INSERT INTO scope_version (project_id, version_no, source, doc) VALUES ($1,$2,'online-estimator','{}'::jsonb) RETURNING id::int AS id",
      [projectId, versionNo],
    );
    await query("UPDATE scope_project SET current_version_id=$2 WHERE id=$1", [projectId, version.id]);
    return version.id;
  }

  /**
   * A website estimate that already exists in QuickBooks and in P5, exactly as
   * the online estimator leaves it: unsent, SyncToken "0", created by nobody.
   * No status is applied here, so the lead is where the test put it.
   */
  async function estimateFor(leadId: number | null, qboEstimateId: string, raw: Partial<Estimate> = {}, customerId = "34"): Promise<number> {
    const { projectId, versionId } = await websiteProject(leadId, customerId);
    const live: Estimate = { Id: qboEstimateId, SyncToken: "0", TxnStatus: "Pending", TotalAmt: 1000, DocNumber: `10${qboEstimateId}`, CustomerRef: { value: customerId }, Line: LINES, ...raw };
    estimates.set(qboEstimateId, live);
    await query(
      `INSERT INTO scope_estimate (project_id, version_id, qbo_estimate_id, doc_number, sync_token, txn_status, email_status, total, sent_payload, qbo_snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1000,$8::jsonb,$9::jsonb)`,
      [projectId, versionId, qboEstimateId, live.DocNumber, live.SyncToken, live.TxnStatus, live.EmailStatus ?? null, JSON.stringify({ Line: LINES }), JSON.stringify(live)],
    );
    return projectId;
  }

  /** Someone changes the estimate in QuickBooks, and QuickBooks reports it (what the webhook and the daily sync do). */
  async function quickBooksChanges(qboEstimateId: string, changes: Partial<Estimate>): Promise<void> {
    const row = estimates.get(qboEstimateId)!;
    Object.assign(row, changes);
    row.SyncToken = String(Number(row.SyncToken) + 1);
    await sync.upsertTxn("Estimate", row as never);
    await alignment.stageAlignmentSettled();
  }
  /** QuickBooks makes an invoice from the estimate (which closes and links the estimate) and reports both. */
  async function invoiceFor(qboEstimateId: string, invoiceId: string, amounts: { total: number; balance: number }): Promise<void> {
    const estimate = estimates.get(qboEstimateId)!;
    invoices.set(invoiceId, { Id: invoiceId, TotalAmt: amounts.total, Balance: amounts.balance, CustomerRef: estimate.CustomerRef, LinkedTxn: [{ TxnType: "Estimate", TxnId: qboEstimateId }] });
    await quickBooksChanges(qboEstimateId, { TxnStatus: "Closed", LinkedTxn: [...(estimate.LinkedTxn ?? []), { TxnType: "Invoice", TxnId: invoiceId }] });
    await sync.upsertTxn("Invoice", invoices.get(invoiceId) as never);
    await alignment.stageAlignmentSettled();
  }
  /** The team moves the deal in HubSpot, and the read-back notices. */
  async function hubSpotMoves(dealstage: string, properties: Record<string, string> = {}): Promise<void> {
    Object.assign(hubDeals.get("100")!.properties, { dealstage, ...properties });
    await pull(new Date());
    await alignment.stageAlignmentSettled();
  }

  type Lead = { stage: string; closed_lost_reason: string | null; closed_at: Date | null; next_action: string | null; next_action_at: Date | null; integration_sync_status: string; updated_at: Date };
  const lead = async (id = 1) => (await query<Lead>("SELECT stage,closed_lost_reason,closed_at,next_action,next_action_at,integration_sync_status,updated_at FROM deal WHERE id=$1", [id]))[0];
  const setLead = (sql: string, id = 1) => query(`UPDATE deal SET ${sql} WHERE id=$1`, [id]);
  const audits = async (action: string) => query<{ previous_value: Record<string, unknown> | null; new_value: Record<string, unknown>; succeeded: boolean; integration_source: string }>(
    "SELECT previous_value,new_value,succeeded,integration_source FROM audit_log WHERE action=$1 ORDER BY id", [action]);
  const events = async (kind: string) => query<{ project_id: number; detail: Record<string, unknown> }>("SELECT project_id::int AS project_id, detail FROM scope_event WHERE kind=$1 ORDER BY id", [kind]);
  const p5Estimate = async (qboId: string) => (await query<{ id: number; txn_status: string; sync_token: string }>("SELECT id::int AS id, txn_status, sync_token FROM scope_estimate WHERE qbo_estimate_id=$1", [qboId]))[0];
  const hubStage = () => hubDeals.get("100")!.properties.dealstage;
  const stageWrites = () => hubWrites.filter((w) => w.includes("dealstage="));
  const statusWrites = () => qboWrites.filter((w) => w.includes("TxnStatus=") || w.startsWith("STALE"));

  // =========================================================================
  // A. QuickBooks estimate status -> lead stage -> HubSpot
  // =========================================================================

  test("the estimate the website creates by itself leaves a new lead exactly where it is", async () => {
    const { projectId, versionId } = await websiteProject(1);
    const before = await lead();
    const project = (await store.getProject(projectId))!;
    // What the online estimator's delivery does: nobody behind it, first creation.
    const result = await scopes.createOrReviseEstimate({ project, version: { id: versionId, version_no: 1 } as never, payload: { CustomerRef: { value: "34" }, Line: LINES } as never, userId: null as unknown as number });
    await alignment.stageAlignmentSettled();
    assert.equal(estimates.get(result.qboId)!.SyncToken, "0");
    const now = await lead();
    assert.equal(now.stage, "New Lead");
    assert.equal(now.integration_sync_status, "synced", "nothing is queued for HubSpot");
    assert.equal(now.updated_at.getTime(), before.updated_at.getTime(), "the lead row is not written at all");
    assert.deepEqual(await audits("stage_aligned_with_quickbooks"), []);
    assert.deepEqual(hubWrites, []);
    // QuickBooks reporting that same creation back changes nothing either.
    await sync.upsertTxn("Estimate", estimates.get(result.qboId) as never);
    await store.applyEstimateStatus((await p5Estimate(result.qboId)).id, { raw: estimates.get(result.qboId) as never, source: "refresh", drift: null });
    await alignment.stageAlignmentSettled();
    assert.equal((await lead()).stage, "New Lead");
    assert.deepEqual(await audits("stage_aligned_with_quickbooks"), []);
  });

  test("after an automatic creation, deleting the estimate in QuickBooks still removes the untouched lead from HubSpot", async () => {
    const { projectId, versionId } = await websiteProject(1);
    const project = (await store.getProject(projectId))!;
    const result = await scopes.createOrReviseEstimate({ project, version: { id: versionId, version_no: 1 } as never, payload: { CustomerRef: { value: "34" }, Line: LINES } as never, userId: null as unknown as number });
    await alignment.stageAlignmentSettled();
    assert.equal((await lead()).stage, "New Lead", "still untouched, so the deletion rule still applies");
    estimates.get(result.qboId)!.deleted = true; // a person deletes the spam estimate in QuickBooks
    await scopes.onEstimateDeleted(result.qboId); // what the QuickBooks webhook calls
    assert.equal((await lead()).closed_lost_reason, "Removed in QuickBooks");
    assert.equal(hubDeals.get("100")!.archived, true);
    assert.equal(hubContacts.get("200")!.archived, true);
    assert.deepEqual(hubWrites, ["DELETE deals/100", "DELETE contacts/200"]);
    assert.deepEqual(statusWrites(), [], "and a removed lead never sets a status in QuickBooks");
  });

  test("an estimate a staff member creates from the scope platform moves the lead to Estimate in Progress, and HubSpot follows", async () => {
    const { projectId, versionId } = await websiteProject(1);
    const project = (await store.getProject(projectId))!;
    await scopes.createOrReviseEstimate({ project, version: { id: versionId, version_no: 1 } as never, payload: { CustomerRef: { value: "34" }, Line: LINES } as never, userId: 1 });
    assert.equal((await lead()).stage, "Estimate in Progress", "the stage is written before the caller returns");
    await alignment.stageAlignmentSettled();
    const now = await lead();
    assert.equal(now.integration_sync_status, "synced", "pushed without waiting for the watchdog");
    assert.equal(now.closed_at, null);
    assert.equal(hubStage(), "decisionmakerboughtin");
    const [entry] = await audits("stage_aligned_with_quickbooks");
    assert.equal(entry.previous_value!.stage, "New Lead");
    assert.equal(entry.new_value.stage, "Estimate in Progress");
    assert.equal(entry.new_value.estimateStatus, "created_unsent");
    assert.equal(entry.new_value.projectId, projectId);
    assert.ok(entry.new_value.docNumber);
    assert.equal(entry.integration_source, "quickbooks");
  });

  test("a staff revision of the website's estimate moves the lead to Estimate in Progress", async () => {
    const { projectId, versionId } = await websiteProject(1);
    const project = (await store.getProject(projectId))!;
    const created = await scopes.createOrReviseEstimate({ project, version: { id: versionId, version_no: 1 } as never, payload: { CustomerRef: { value: "34" }, Line: LINES } as never, userId: null as unknown as number });
    await alignment.stageAlignmentSettled();
    assert.equal((await lead()).stage, "New Lead");
    // A person revises the scope and sends the new version to QuickBooks.
    const secondVersion = await addVersion(projectId, 2);
    const revised = await scopes.createOrReviseEstimate({ project: (await store.getProject(projectId))!, version: { id: secondVersion, version_no: 2 } as never, payload: { CustomerRef: { value: "34" }, Line: LINES } as never, userId: 1 });
    await alignment.stageAlignmentSettled();
    assert.equal(revised.revised, true);
    assert.equal(estimates.get(created.qboId)!.SyncToken, "1", "QuickBooks saved it again");
    assert.equal((await lead()).stage, "Estimate in Progress");
    assert.equal(hubStage(), "decisionmakerboughtin");
    assert.equal((await audits("stage_aligned_with_quickbooks")).length, 1);
  });

  test("an unsent estimate edited in QuickBooks moves the lead to Estimate in Progress", async () => {
    await estimateFor(1, "90");
    await quickBooksChanges("90", { TotalAmt: 1200 }); // someone opens it in QuickBooks and saves a change
    assert.equal((await lead()).stage, "Estimate in Progress");
    assert.equal(hubStage(), "decisionmakerboughtin");
  });

  test("a sent estimate moves the lead to Estimate Sent", async () => {
    await estimateFor(1, "90");
    await setLead("next_action='Call back', next_action_at=now()+interval '1 day'");
    await quickBooksChanges("90", { EmailStatus: "EmailSent" });
    const now = await lead();
    assert.equal(now.stage, "Estimate Sent");
    assert.equal(now.next_action, "Call back", "an open stage keeps its next action");
    assert.equal(now.closed_at, null);
    assert.equal(hubStage(), "contractsent");
    assert.equal(now.integration_sync_status, "synced");
  });

  test("an accepted estimate closes the lead as won, clears its next action and gets its QuickBooks project", async () => {
    const projectId = await estimateFor(1, "90");
    await setLead("stage='Estimate Sent', next_action='Follow up', next_action_at=now()+interval '1 day', closed_lost_reason='stale'");
    await quickBooksChanges("90", { TxnStatus: "Accepted" });
    const now = await lead();
    assert.equal(now.stage, "Closed Won");
    assert.ok(now.closed_at);
    assert.equal(now.next_action, null);
    assert.equal(now.next_action_at, null);
    assert.equal(now.closed_lost_reason, null, "a won lead carries no lost reason");
    assert.equal(hubStage(), "closedwon");
    const [project] = await query<{ qbo_project_id: string | null }>("SELECT qbo_project_id FROM scope_project WHERE id=$1", [projectId]);
    assert.ok(project.qbo_project_id, "settleAccepted still creates the QuickBooks project");
    assert.deepEqual(statusWrites(), [], "an acceptance made in QuickBooks is never written back to it");
  });

  test("an invoiced estimate closes the lead as won", async () => {
    await estimateFor(1, "90");
    await invoiceFor("90", "500", { total: 400, balance: 400 });
    assert.equal((await lead()).stage, "Closed Won");
    assert.equal(hubStage(), "closedwon", "invoiced but not paid: Closed Won, not Job Complete");
  });

  test("a declined estimate closes the lead as lost, with the reason, when it was the lead's only live estimate", async () => {
    await estimateFor(1, "90");
    await setLead("stage='Estimate Sent', next_action='Follow up', next_action_at=now()+interval '1 day'");
    await quickBooksChanges("90", { TxnStatus: "Rejected" });
    const now = await lead();
    assert.equal(now.stage, "Closed Lost");
    assert.equal(now.closed_lost_reason, "Estimate declined in QuickBooks");
    assert.ok(now.closed_at);
    assert.equal(now.next_action, null);
    assert.equal(hubStage(), "closedlost");
    assert.equal(hubDeals.get("100")!.properties.closed_lost_reason, "Estimate declined in QuickBooks");
  });

  for (const [name, other] of [
    ["unsent", {}], ["sent", { EmailStatus: "EmailSent" }], ["accepted", { TxnStatus: "Accepted" }],
    ["invoiced", { TxnStatus: "Closed", LinkedTxn: [{ TxnType: "Invoice", TxnId: "700" }] }],
  ] as const) {
    test(`a decline does not lose a lead that has another live estimate that is ${name}`, async () => {
      await estimateFor(1, "90");
      await estimateFor(1, "91", other as Partial<Estimate>);
      await setLead("stage='Estimate Sent'");
      await quickBooksChanges("90", { TxnStatus: "Rejected" });
      assert.equal((await lead()).stage, "Estimate Sent");
      assert.deepEqual(await audits("stage_aligned_with_quickbooks"), []);
    });
  }

  test("a decline does lose the lead when its other estimates are declined, closed, deleted or on a removed project", async () => {
    await estimateFor(1, "90");
    await estimateFor(1, "91", { TxnStatus: "Rejected" });
    await estimateFor(1, "92", { TxnStatus: "Closed" });
    const deleted = await estimateFor(1, "93");
    await query("UPDATE scope_estimate SET txn_status='Deleted' WHERE project_id=$1", [deleted]);
    const removed = await estimateFor(1, "94", { EmailStatus: "EmailSent" });
    await query("UPDATE scope_project SET deleted_at=now() WHERE id=$1", [removed]);
    await quickBooksChanges("90", { TxnStatus: "Rejected" });
    assert.equal((await lead()).stage, "Closed Lost");
  });

  test("closed, deleted, unreadable and missing estimates change nothing", async () => {
    await setLead("stage='Contacting'");
    await estimateFor(1, "90");
    await quickBooksChanges("90", { TxnStatus: "Closed" }); // closed by hand, no invoice
    await estimateFor(1, "91");
    await quickBooksChanges("91", { TxnStatus: "Something QuickBooks adds later" });
    const gonePid = await estimateFor(1, "92");
    await query("UPDATE scope_estimate SET txn_status='Deleted' WHERE project_id=$1", [gonePid]);
    await alignment.alignLeadsWithProject(gonePid);
    const { projectId: none } = await websiteProject(1); // no estimate in QuickBooks at all
    await alignment.alignLeadsWithProject(none);
    await alignment.stageAlignmentSettled();
    assert.equal((await lead()).stage, "Contacting");
    assert.deepEqual(await audits("stage_aligned_with_quickbooks"), []);
    assert.deepEqual(hubWrites, []);
  });

  test("open stages only move forward", async () => {
    await estimateFor(1, "90");
    await setLead("stage='Decision Pending'");
    await quickBooksChanges("90", { TotalAmt: 1100 }); // worked, unsent
    assert.equal((await lead()).stage, "Decision Pending");
    await quickBooksChanges("90", { EmailStatus: "EmailSent" });
    assert.equal((await lead()).stage, "Decision Pending");
    assert.equal((await lead()).integration_sync_status, "synced");
    assert.deepEqual(await audits("stage_aligned_with_quickbooks"), []);
    // Forward from an earlier stage does move.
    await setLead("stage='Contacting'");
    await quickBooksChanges("90", { TotalAmt: 1150 });
    assert.equal((await lead()).stage, "Estimate Sent");
  });

  test("a won lead is never moved", async () => {
    await estimateFor(1, "90");
    await setLead("stage='Closed Won', closed_at=now()");
    await quickBooksChanges("90", { TotalAmt: 900 });
    await quickBooksChanges("90", { EmailStatus: "EmailSent" });
    await quickBooksChanges("90", { TxnStatus: "Rejected" }); // its only estimate, declined
    const now = await lead();
    assert.equal(now.stage, "Closed Won");
    assert.equal(now.closed_lost_reason, null);
    assert.equal(now.integration_sync_status, "synced");
    assert.deepEqual(await audits("stage_aligned_with_quickbooks"), []);
    assert.deepEqual(hubWrites, []);
  });

  test("a lost lead is won when its estimate is accepted, and keeps the day it was first closed", async () => {
    await estimateFor(1, "90");
    await setLead("stage='Closed Lost', closed_lost_reason='Price', closed_at=now()-interval '3 days'");
    const closedAt = (await lead()).closed_at!;
    await quickBooksChanges("90", { EmailStatus: "EmailSent" });
    assert.equal((await lead()).stage, "Closed Lost", "a sent estimate does not reopen a lost lead");
    await quickBooksChanges("90", { TxnStatus: "Accepted" });
    const now = await lead();
    assert.equal(now.stage, "Closed Won");
    assert.equal(now.closed_lost_reason, null);
    assert.equal(now.closed_at!.getTime(), closedAt.getTime());
    assert.equal(hubStage(), "closedwon");
  });

  for (const reason of ["Removed in HubSpot", "Merged into another deal in HubSpot", "Removed in QuickBooks"]) {
    test(`a lead closed as "${reason}" stays closed when its estimate is accepted`, async () => {
      await estimateFor(1, "90");
      await query("UPDATE deal SET stage='Closed Lost', closed_lost_reason=$1, closed_at=now() WHERE id=1", [reason]);
      await quickBooksChanges("90", { TxnStatus: "Accepted" });
      const now = await lead();
      assert.equal(now.stage, "Closed Lost");
      assert.equal(now.closed_lost_reason, reason);
      assert.equal(now.integration_sync_status, "synced");
      assert.deepEqual(await audits("stage_aligned_with_quickbooks"), []);
      assert.deepEqual(stageWrites(), []);
    });
  }

  test("the same status arriving again writes nothing and adds nothing to the audit trail", async () => {
    await estimateFor(1, "90");
    await quickBooksChanges("90", { EmailStatus: "EmailSent" });
    const first = await lead();
    const row = await p5Estimate("90");
    await store.applyEstimateStatus(row.id, { raw: estimates.get("90") as never, source: "refresh", drift: null });
    await alignment.alignLeadsWithProject((await query<{ id: number }>("SELECT project_id::int AS id FROM scope_estimate WHERE id=$1", [row.id]))[0].id, { wait: true });
    await alignment.stageAlignmentSettled();
    const second = await lead();
    assert.equal(second.updated_at.getTime(), first.updated_at.getTime());
    assert.equal((await audits("stage_aligned_with_quickbooks")).length, 1);
    assert.equal(stageWrites().length, 1);
  });

  test("an estimate with no linked lead is out of scope", async () => {
    await estimateFor(null, "90");
    await quickBooksChanges("90", { TxnStatus: "Accepted" });
    assert.equal((await lead()).stage, "New Lead");
    assert.deepEqual(await audits("stage_aligned_with_quickbooks"), []);
    assert.deepEqual(hubWrites, []);
  });

  test("an estimate that was replaced does not speak for the project", async () => {
    const projectId = await estimateFor(1, "90");
    const old = await p5Estimate("90");
    // The first estimate was deleted and a new one made for the same project.
    await query("UPDATE scope_estimate SET txn_status='Deleted', created_at=now()-interval '1 day' WHERE id=$1", [old.id]);
    await query(
      `INSERT INTO scope_estimate (project_id, version_id, qbo_estimate_id, doc_number, sync_token, txn_status, total, sent_payload, qbo_snapshot)
       SELECT project_id, version_id, '95', '1095', '0', 'Pending', 1000, sent_payload, '{"TxnStatus":"Pending","SyncToken":"0"}'::jsonb FROM scope_estimate WHERE id=$1`, [old.id],
    );
    await store.applyEstimateStatus(old.id, { raw: { Id: "90", SyncToken: "4", TxnStatus: "Accepted" }, source: "refresh", drift: null });
    await alignment.stageAlignmentSettled();
    assert.equal((await lead()).stage, "New Lead");
    assert.ok(projectId);
  });

  // =========================================================================
  // B. Paid in full -> HubSpot "Job Complete"
  // =========================================================================

  test("a job paid in full moves the HubSpot deal to Job Complete, once, and the P5 lead stays Closed Won", async () => {
    await estimateFor(1, "90");
    await invoiceFor("90", "500", { total: 1000, balance: 1000 });
    assert.equal(hubStage(), "closedwon");
    // The customer pays. The payment touches the invoice, not the estimate.
    invoices.get("500")!.Balance = 0;
    await sync.upsertTxn("Invoice", invoices.get("500") as never);
    await alignment.stageAlignmentSettled();
    assert.equal(hubStage(), JOB_COMPLETE);
    assert.equal((await lead()).stage, "Closed Won");
    const [entry] = await audits("hubspot_deal_job_complete");
    assert.equal(entry.new_value.outcome, "moved");
    assert.equal(entry.new_value.hubspotDealId, "100");
    assert.equal(entry.new_value.stageId, JOB_COMPLETE);
    assert.deepEqual(entry.new_value.docNumbers, ["1090"]);
    assert.equal(entry.integration_source, "hubspot");

    // The daily sync stores the same invoice and estimate again: nothing is rewritten.
    await sync.upsertTxn("Invoice", invoices.get("500") as never);
    await store.applyEstimateStatus((await p5Estimate("90")).id, { raw: estimates.get("90") as never, source: "refresh", drift: null });
    await alignment.stageAlignmentSettled();
    assert.equal(stageWrites().filter((w) => w.endsWith(JOB_COMPLETE)).length, 1);
    assert.equal((await audits("hubspot_deal_job_complete")).length, 1);

    // The read-back leaves a stage P5 has no name for alone...
    await pull(new Date());
    assert.equal((await lead()).stage, "Closed Won");
    assert.equal((await lead()).integration_sync_status, "synced");
    // ...and a later push never drags the deal back to Closed Won.
    await setLead("integration_sync_status='pending'");
    await push(1);
    assert.equal(hubStage(), JOB_COMPLETE);
    assert.deepEqual(statusWrites(), []);
  });

  test("the paid status arriving with the estimate itself closes the lead and completes the job in one go", async () => {
    await estimateFor(1, "90");
    // The invoice and its payment are already mirrored when the estimate change is applied.
    invoices.set("500", { Id: "500", TotalAmt: 1000, Balance: 0, CustomerRef: { value: "34" }, LinkedTxn: [{ TxnType: "Estimate", TxnId: "90" }] });
    await sync.upsertTxn("Invoice", invoices.get("500") as never);
    assert.equal((await lead()).stage, "New Lead", "P5's copy of the estimate does not show the invoice yet");
    await quickBooksChanges("90", { TxnStatus: "Closed", LinkedTxn: [{ TxnType: "Invoice", TxnId: "500" }] });
    assert.equal((await lead()).stage, "Closed Won");
    assert.equal(hubStage(), JOB_COMPLETE);
    assert.deepEqual(stageWrites(), ["PATCH deals/100 dealstage=closedwon", `PATCH deals/100 dealstage=${JOB_COMPLETE}`]);
  });

  test("a part payment is not a finished job", async () => {
    await estimateFor(1, "90");
    await invoiceFor("90", "500", { total: 400, balance: 0 }); // a deposit invoice, paid
    assert.equal((await lead()).stage, "Closed Won");
    assert.equal(hubStage(), "closedwon");
    assert.deepEqual(await audits("hubspot_deal_job_complete"), []);
  });

  // ---- The Google review request rides on the same moment (owner, 20 November 2026) ----

  test("a job paid in full queues the customer's Google review request once, when REVIEW_REQUEST is on", async () => {
    process.env.REVIEW_REQUEST = "on";
    await query("UPDATE contact SET email='jordan@homeowner.test' WHERE id=1");
    await estimateFor(1, "90");
    await invoiceFor("90", "500", { total: 1000, balance: 1000 });
    assert.deepEqual(await audits("review_request_queued"), [], "invoiced and won is not finished");
    invoices.get("500")!.Balance = 0;
    await sync.upsertTxn("Invoice", invoices.get("500") as never);
    await alignment.stageAlignmentSettled();
    assert.equal(hubStage(), JOB_COMPLETE);
    const [queued, ...more] = await audits("review_request_queued");
    assert.deepEqual(more, []);
    assert.equal(queued.new_value.delayHours, 24);
    assert.equal(queued.new_value.brand, "Boise Cabinet Co");
    assert.deepEqual(queued.new_value.docNumbers, ["1090"]);
    // The daily sync stores the same invoice and estimate again: nothing more is queued.
    await sync.upsertTxn("Invoice", invoices.get("500") as never);
    await store.applyEstimateStatus((await p5Estimate("90")).id, { raw: estimates.get("90") as never, source: "refresh", drift: null });
    await alignment.stageAlignmentSettled();
    assert.equal((await audits("review_request_queued")).length, 1);
    assert.deepEqual(await audits("review_request_sent"), [], "nothing is sent before it is due");
  });

  test("the review request does not wait on HubSpot: a pipeline with no Job Complete stage still queues it", async () => {
    process.env.REVIEW_REQUEST = "on";
    await query("UPDATE contact SET email='jordan@homeowner.test' WHERE id=1");
    pipeline = [...P5_STAGES];
    await estimateFor(1, "90");
    await invoiceFor("90", "500", { total: 1000, balance: 0 });
    assert.equal(hubStage(), "closedwon");
    assert.equal((await audits("review_request_queued")).length, 1);
  });

  test("with REVIEW_REQUEST off (the default) a paid job queues and sends nothing", async () => {
    await query("UPDATE contact SET email='jordan@homeowner.test' WHERE id=1");
    await estimateFor(1, "90");
    await invoiceFor("90", "500", { total: 1000, balance: 0 });
    assert.equal(hubStage(), JOB_COMPLETE);
    assert.equal((await query("SELECT 1 FROM audit_log WHERE action LIKE 'review_request%'")).length, 0);
  });

  test("a part payment asks for no review", async () => {
    process.env.REVIEW_REQUEST = "on";
    await query("UPDATE contact SET email='jordan@homeowner.test' WHERE id=1");
    await estimateFor(1, "90");
    await invoiceFor("90", "500", { total: 400, balance: 0 });
    assert.equal((await query("SELECT 1 FROM audit_log WHERE action LIKE 'review_request%'")).length, 0);
  });

  test("a pipeline with no Job Complete stage is left alone, and says so once", async () => {
    pipeline = [...P5_STAGES];
    await estimateFor(1, "90");
    await invoiceFor("90", "500", { total: 1000, balance: 0 });
    await sync.upsertTxn("Invoice", invoices.get("500") as never);
    await alignment.stageAlignmentSettled();
    assert.equal(hubStage(), "closedwon");
    assert.equal((await lead()).stage, "Closed Won");
    const entries = await audits("hubspot_deal_job_complete");
    assert.equal(entries.length, 1);
    assert.equal(entries[0].new_value.outcome, "no-stage");
    assert.match(String(entries[0].new_value.note), /no "Job Complete" stage/);
    assert.deepEqual(await audits("hubspot_job_complete_pending"), [], "nothing to retry");
  });

  test("a deal the team already moved to another stage of their own is left there", async () => {
    await estimateFor(1, "90");
    await invoiceFor("90", "500", { total: 1000, balance: 1000 });
    hubDeals.get("100")!.properties.dealstage = "7777"; // "Warranty", say: a stage the team added
    invoices.get("500")!.Balance = 0;
    await sync.upsertTxn("Invoice", invoices.get("500") as never);
    await alignment.stageAlignmentSettled();
    assert.equal(hubStage(), "7777");
    assert.equal((await audits("hubspot_deal_job_complete"))[0].new_value.outcome, "left");
  });

  test("a deal already at Job Complete is not written again", async () => {
    await estimateFor(1, "90");
    await invoiceFor("90", "500", { total: 1000, balance: 1000 });
    hubDeals.get("100")!.properties.dealstage = JOB_COMPLETE; // the team got there first
    invoices.get("500")!.Balance = 0;
    await sync.upsertTxn("Invoice", invoices.get("500") as never);
    await alignment.stageAlignmentSettled();
    assert.deepEqual(stageWrites().filter((w) => w.endsWith(JOB_COMPLETE)), []);
    assert.equal((await audits("hubspot_deal_job_complete"))[0].new_value.outcome, "already");
  });

  test("the job waits while another accepted estimate on the lead is still unpaid", async () => {
    await estimateFor(1, "90");
    await estimateFor(1, "91", { TxnStatus: "Accepted" });
    await invoiceFor("90", "500", { total: 1000, balance: 0 });
    assert.equal(hubStage(), "closedwon");
    assert.deepEqual(await audits("hubspot_deal_job_complete"), []);
  });

  test("a payment that names the invoice is enough: the invoice is read again and the job completes", async () => {
    await estimateFor(1, "90");
    await invoiceFor("90", "500", { total: 1000, balance: 1000 });
    invoices.get("500")!.Balance = 0; // paid in QuickBooks, but only the payment is reported
    qboReads = [];
    await sync.upsertTxn("Payment", { Id: "800", TotalAmt: 1000, Line: [{ Amount: 1000, LinkedTxn: [{ TxnId: "500", TxnType: "Invoice" }] }] } as never);
    await alignment.stageAlignmentSettled();
    assert.deepEqual(qboReads, ["invoice/500"]);
    assert.equal(hubStage(), JOB_COMPLETE);
    // The same payment stored again (the daily sync) does not read the invoice again.
    qboReads = [];
    await sync.upsertTxn("Payment", { Id: "800", TotalAmt: 1000, Line: [{ Amount: 1000, LinkedTxn: [{ TxnId: "500", TxnType: "Invoice" }] }] } as never);
    assert.deepEqual(qboReads, []);
    // A payment for an invoice that has nothing to do with a website estimate reads nothing.
    await sync.upsertTxn("Payment", { Id: "801", TotalAmt: 50, Line: [{ Amount: 50, LinkedTxn: [{ TxnId: "999", TxnType: "Invoice" }] }] } as never);
    assert.deepEqual(qboReads, []);
  });

  test("HubSpot not answering is remembered and the job is completed on the retry", async () => {
    await estimateFor(1, "90");
    await invoiceFor("90", "500", { total: 1000, balance: 1000 });
    pipelineDown = true;
    invoices.get("500")!.Balance = 0;
    await sync.upsertTxn("Invoice", invoices.get("500") as never);
    await alignment.stageAlignmentSettled();
    assert.equal(hubStage(), "closedwon");
    const pending = await audits("hubspot_job_complete_pending");
    assert.equal(pending.length, 1);
    assert.equal(pending[0].succeeded, false);
    pipelineDown = false;
    assert.deepEqual(await alignment.settleStageAlignment(), { attempted: 0, finished: 0 }, "not retried at once");
    await query("UPDATE audit_log SET occurred_at=now()-interval '7 hours' WHERE action='hubspot_job_complete_pending'");
    assert.deepEqual(await alignment.settleStageAlignment(), { attempted: 1, finished: 1 });
    assert.equal(hubStage(), JOB_COMPLETE);
    assert.equal((await audits("hubspot_job_complete_pending")).filter((row) => !row.succeeded).length, 0);
    assert.deepEqual(await alignment.settleStageAlignment(), { attempted: 0, finished: 0 });
  });

  // =========================================================================
  // C. Lead closed -> QuickBooks estimate status
  // =========================================================================

  test("a deal closed as won in HubSpot marks the lead's one open estimate accepted in QuickBooks", async () => {
    const projectId = await estimateFor(1, "90", { EmailStatus: "EmailSent" });
    await setLead("stage='Estimate Sent'");
    hubDeals.get("100")!.properties.dealstage = "contractsent";
    await hubSpotMoves("closedwon");
    assert.equal((await lead()).stage, "Closed Won");
    assert.equal(estimates.get("90")!.TxnStatus, "Accepted");
    assert.equal(estimates.get("90")!.SyncToken, "1");
    assert.deepEqual(statusWrites(), ["UPDATE estimate/90 TxnStatus=Accepted"]);
    assert.deepEqual(qboReads.filter((r) => r === "estimate/90").length >= 1, true, "read live before the write");
    const copy = await p5Estimate("90");
    assert.equal(copy.txn_status, "Accepted", "P5's copy is current without waiting for the webhook");
    assert.equal(copy.sync_token, "1");
    const [snapshot] = await query<{ source: string }>("SELECT source FROM scope_estimate_snapshot WHERE estimate_id=$1 AND sync_token='1'", [copy.id]);
    assert.equal(snapshot.source, "stage-alignment");
    const [entry] = await audits("quickbooks_estimate_status_set");
    assert.equal(entry.new_value.docNumber, "1090");
    assert.equal(entry.new_value.from, "sent");
    assert.equal(entry.new_value.to, "Accepted");
    assert.match(String(entry.new_value.why), /closed as won/);
    assert.equal((await events("estimate-status-set"))[0].project_id, projectId);
    // The acceptance gets its QuickBooks project, exactly as one made in QuickBooks does.
    const [project] = await query<{ qbo_project_id: string | null }>("SELECT qbo_project_id FROM scope_project WHERE id=$1", [projectId]);
    assert.ok(project.qbo_project_id);
    assert.equal(qboWrites.filter((w) => w.startsWith("CREATE customer/") && w.endsWith("project")).length, 1);
    // Loop safety: storing the result re-entered rule A, which did nothing.
    assert.deepEqual(await audits("stage_aligned_with_quickbooks"), []);
    assert.equal((await lead()).integration_sync_status, "synced");
    assert.deepEqual(stageWrites(), [], "nothing is pushed back to HubSpot");
  });

  test("an unsent estimate is accepted the same way", async () => {
    await estimateFor(1, "90");
    await hubSpotMoves("closedwon");
    assert.deepEqual(statusWrites(), ["UPDATE estimate/90 TxnStatus=Accepted"]);
    assert.equal((await audits("quickbooks_estimate_status_set"))[0].new_value.from, "created_unsent");
  });

  test("won with more than one open estimate writes nothing and asks a person to choose, once", async () => {
    const first = await estimateFor(1, "90");
    const second = await estimateFor(1, "91", { EmailStatus: "EmailSent" });
    await hubSpotMoves("closedwon");
    assert.equal((await lead()).stage, "Closed Won");
    assert.deepEqual(statusWrites(), []);
    assert.equal(estimates.get("90")!.TxnStatus, "Pending");
    assert.equal(estimates.get("91")!.TxnStatus, "Pending");
    assert.deepEqual((await events("estimate-choice-needed")).map((e) => e.project_id), [first, second]);
    const [entry] = await audits("quickbooks_estimate_choice_needed");
    assert.deepEqual(entry.new_value.estimates, ["1090", "1091"]);
    assert.match(String(entry.new_value.note), /more than one open estimate/);
    // Asked again (a retry, the other hook): still one note.
    await alignment.alignQuickBooksWithClosedLead(1);
    assert.equal((await audits("quickbooks_estimate_choice_needed")).length, 1);
    assert.equal((await events("estimate-choice-needed")).length, 2);
    assert.deepEqual(await audits("quickbooks_stage_pending"), [], "nothing to retry: it waits for a person");
  });

  for (const [name, raw] of [
    ["accepted", { TxnStatus: "Accepted" }],
    ["invoiced", { TxnStatus: "Closed", LinkedTxn: [{ TxnType: "Invoice", TxnId: "700" }] }],
  ] as const) {
    test(`won with an estimate already ${name} writes nothing, even beside an open one`, async () => {
      await estimateFor(1, "90", raw as Partial<Estimate>);
      await estimateFor(1, "91");
      await hubSpotMoves("closedwon");
      assert.deepEqual(statusWrites(), []);
      assert.equal(estimates.get("91")!.TxnStatus, "Pending");
      assert.deepEqual(await audits("quickbooks_estimate_choice_needed"), []);
    });
  }

  test("a deal closed as lost in HubSpot rejects every open estimate and touches nothing else", async () => {
    await estimateFor(1, "90");
    await estimateFor(1, "91", { EmailStatus: "EmailSent" });
    await estimateFor(1, "92", { TxnStatus: "Accepted" });
    await estimateFor(1, "93", { TxnStatus: "Closed", LinkedTxn: [{ TxnType: "Invoice", TxnId: "700" }] });
    await estimateFor(1, "94", { TxnStatus: "Closed" });
    await estimateFor(1, "95", { TxnStatus: "Rejected" });
    await setLead("stage='Decision Pending'");
    hubDeals.get("100")!.properties.dealstage = "4182226638";
    await hubSpotMoves("closedlost", { closed_lost_reason: "Price" });
    const now = await lead();
    assert.equal(now.stage, "Closed Lost");
    assert.equal(now.closed_lost_reason, "Price");
    assert.deepEqual(statusWrites(), ["UPDATE estimate/90 TxnStatus=Rejected", "UPDATE estimate/91 TxnStatus=Rejected"]);
    assert.deepEqual(["92", "93", "94", "95"].map((id) => estimates.get(id)!.SyncToken), ["0", "0", "0", "0"], "accepted, invoiced, closed and declined estimates are not written");
    assert.equal((await audits("quickbooks_estimate_status_set")).length, 2);
    assert.match(String((await audits("quickbooks_estimate_status_set"))[0].new_value.why), /closed as lost/);
    // Loop safety: the rejections came back through rule A and moved nothing.
    assert.deepEqual(await audits("stage_aligned_with_quickbooks"), []);
    assert.equal((await lead()).integration_sync_status, "synced");
  });

  for (const reason of ["Removed in HubSpot", "Merged into another deal in HubSpot", "Removed in QuickBooks", "Estimate declined in QuickBooks"]) {
    test(`a lead lost as "${reason}" never rejects an estimate`, async () => {
      await estimateFor(1, "90");
      await query("UPDATE deal SET stage='Closed Lost', closed_lost_reason=$1, closed_at=now() WHERE id=1", [reason]);
      await alignment.onLeadStageChanged(1, "Contacting", "Closed Lost");
      assert.deepEqual(await alignment.alignQuickBooksWithClosedLead(1), { set: [], kept: [], pending: null });
      assert.deepEqual(qboWrites, []);
      assert.deepEqual(qboReads, [], "QuickBooks is not even read");
    });
  }

  test("a deal deleted in HubSpot is the deletion logic's: the estimate is deleted, not rejected", async () => {
    await estimateFor(1, "90");
    hubDeals.get("100")!.archived = true;
    await pull(new Date());
    await alignment.stageAlignmentSettled();
    assert.equal((await lead()).closed_lost_reason, "Removed in HubSpot");
    assert.deepEqual(statusWrites(), []);
    assert.equal(estimates.get("90")!.deleted, true);
  });

  test("a lead closed in the P5 admin carries to QuickBooks through the same function", async () => {
    await estimateFor(1, "90", { EmailStatus: "EmailSent" });
    // What logOutcomeAction commits, then its hook.
    await setLead("stage='Closed Won', closed_at=now(), integration_sync_status='pending'");
    await alignment.onLeadStageChanged(1, "Estimate Sent", "Closed Won", { waitMs: 8_000 });
    assert.equal(estimates.get("90")!.TxnStatus, "Accepted");
    assert.deepEqual(statusWrites(), ["UPDATE estimate/90 TxnStatus=Accepted"]);
    assert.equal((await lead()).stage, "Closed Won");
    assert.deepEqual(await audits("quickbooks_stage_pending"), []);
  });

  test("a lead closed as lost in the P5 admin rejects its open estimate", async () => {
    await estimateFor(1, "90");
    await setLead("stage='Closed Lost', closed_lost_reason='Went with someone else', closed_at=now(), integration_sync_status='pending'");
    await alignment.onLeadStageChanged(1, "Contacting", "Closed Lost", { waitMs: 8_000 });
    assert.deepEqual(statusWrites(), ["UPDATE estimate/90 TxnStatus=Rejected"]);
    assert.equal((await p5Estimate("90")).txn_status, "Rejected");
  });

  test("the admin form is answered on time when QuickBooks is slow, and the work still finishes", async () => {
    await estimateFor(1, "90");
    await setLead("stage='Closed Won', closed_at=now(), integration_sync_status='pending'");
    let release!: () => void;
    qboGate = new Promise<void>((resolve) => { release = resolve; });
    await alignment.onLeadStageChanged(1, "Estimate Sent", "Closed Won", { waitMs: 50 });
    assert.equal(estimates.get("90")!.TxnStatus, "Pending", "still waiting on QuickBooks");
    const waiting = await audits("quickbooks_stage_pending");
    assert.equal(waiting.length, 1, "noted, so the watchdog finishes it if this process does not");
    assert.equal(waiting[0].succeeded, false);
    qboGate = null;
    release();
    await alignment.stageAlignmentSettled();
    assert.equal(estimates.get("90")!.TxnStatus, "Accepted");
    assert.equal((await audits("quickbooks_stage_pending")).filter((row) => !row.succeeded).length, 0);
  });

  test("a lead that is reopened, or moved between open stages, never changes QuickBooks", async () => {
    await estimateFor(1, "90");
    await setLead("stage='Closed Lost', closed_lost_reason='Price', closed_at=now()");
    hubDeals.get("100")!.properties.dealstage = "closedlost";
    await hubSpotMoves("qualifiedtobuy"); // reopened in HubSpot
    assert.equal((await lead()).stage, "Contacting");
    await alignment.onLeadStageChanged(1, "Closed Lost", "Contacting", { waitMs: 8_000 }); // reopened in the admin
    await alignment.onLeadStageChanged(1, "Contacting", "Estimate Sent");
    assert.deepEqual(await alignment.alignQuickBooksWithClosedLead(1), { set: [], kept: [], pending: null }, "even asked directly, an open lead writes nothing");
    assert.deepEqual(qboWrites, []);
    assert.deepEqual(qboReads, []);
  });

  test("a lead saved again in the same closed stage does nothing", async () => {
    await estimateFor(1, "90");
    await setLead("stage='Closed Won', closed_at=now()");
    await alignment.onLeadStageChanged(1, "Closed Won", "Closed Won", { waitMs: 8_000 });
    assert.deepEqual(qboWrites, []);
    assert.deepEqual(qboReads, []);
  });

  test("the decision rests on QuickBooks as it is now, not on P5's copy", async () => {
    await estimateFor(1, "90");
    // Accepted in QuickBooks a moment ago; P5's copy still says unsent.
    Object.assign(estimates.get("90")!, { TxnStatus: "Accepted", SyncToken: "1" });
    await setLead("stage='Closed Lost', closed_lost_reason='Price', closed_at=now()");
    const outcome = await alignment.alignQuickBooksWithClosedLead(1);
    assert.deepEqual(statusWrites(), []);
    assert.deepEqual(outcome.kept, ["estimate 1090 (accepted)"]);
    assert.equal(estimates.get("90")!.TxnStatus, "Accepted");
  });

  test("an estimate saved by someone else between the read and the write is read again, then written with the new token", async () => {
    await estimateFor(1, "90");
    await setLead("stage='Closed Won', closed_at=now()");
    beforeEstimateWrite = (row) => { row.TotalAmt = 1300; row.SyncToken = String(Number(row.SyncToken) + 1); };
    const outcome = await alignment.alignQuickBooksWithClosedLead(1);
    assert.deepEqual(statusWrites(), ["STALE estimate/90", "UPDATE estimate/90 TxnStatus=Accepted"]);
    assert.equal(estimates.get("90")!.TxnStatus, "Accepted");
    assert.equal(estimates.get("90")!.TotalAmt, 1300, "the other person's change is kept");
    assert.equal(outcome.pending, null);
  });

  test("an estimate answered by someone else between the read and the write is left as they set it", async () => {
    await estimateFor(1, "90");
    await setLead("stage='Closed Lost', closed_lost_reason='Price', closed_at=now()");
    beforeEstimateWrite = (row) => { row.TxnStatus = "Accepted"; row.SyncToken = String(Number(row.SyncToken) + 1); };
    const outcome = await alignment.alignQuickBooksWithClosedLead(1);
    assert.deepEqual(statusWrites(), ["STALE estimate/90"]);
    assert.equal(estimates.get("90")!.TxnStatus, "Accepted");
    assert.deepEqual(outcome, { set: [], kept: [], pending: null });
    assert.deepEqual(await audits("quickbooks_estimate_status_set"), []);
  });

  test("QuickBooks being unavailable is remembered and retried, not lost", async () => {
    await estimateFor(1, "90");
    qboDown = true;
    await hubSpotMoves("closedwon");
    assert.equal((await lead()).stage, "Closed Won", "the HubSpot side is settled regardless");
    assert.equal(estimates.get("90")!.TxnStatus, "Pending");
    const pending = await audits("quickbooks_stage_pending");
    assert.equal(pending.length, 1);
    assert.equal(pending[0].succeeded, false);
    // Not retried at once (six hours apart), then finished when QuickBooks is back.
    qboDown = false;
    assert.deepEqual(await alignment.settleStageAlignment(), { attempted: 0, finished: 0 });
    await query("UPDATE audit_log SET occurred_at=now()-interval '7 hours' WHERE action='quickbooks_stage_pending'");
    assert.deepEqual(await alignment.settleStageAlignment(), { attempted: 1, finished: 1 });
    assert.equal(estimates.get("90")!.TxnStatus, "Accepted");
    assert.equal((await audits("quickbooks_stage_pending")).filter((row) => !row.succeeded).length, 0);
    assert.deepEqual(await alignment.settleStageAlignment(), { attempted: 0, finished: 0 });
    assert.deepEqual(statusWrites(), ["UPDATE estimate/90 TxnStatus=Accepted"]);
  });

  test("QuickBooks not being connected is remembered the same way, and given up after a fortnight", async () => {
    await estimateFor(1, "90");
    await query("DELETE FROM qbo_connection");
    await setLead("stage='Closed Lost', closed_lost_reason='Price', closed_at=now()");
    const outcome = await alignment.alignQuickBooksWithClosedLead(1);
    assert.equal(outcome.pending, "QuickBooks is not connected.");
    assert.equal((await audits("quickbooks_stage_pending")).length, 1);
    await query("UPDATE audit_log SET occurred_at=now()-interval '15 days' WHERE action='quickbooks_stage_pending'");
    assert.deepEqual(await alignment.settleStageAlignment(), { attempted: 0, finished: 0 }, "a person sets it by hand after that");
  });

  test("a retry for a lead that was reopened in the meantime does nothing and clears itself", async () => {
    await estimateFor(1, "90");
    qboDown = true;
    await hubSpotMoves("closedwon");
    qboDown = false;
    await setLead("stage='Contacting', closed_at=NULL");
    await query("UPDATE audit_log SET occurred_at=now()-interval '7 hours' WHERE action='quickbooks_stage_pending'");
    assert.deepEqual(await alignment.settleStageAlignment(), { attempted: 1, finished: 1 });
    assert.deepEqual(statusWrites(), []);
    assert.equal(estimates.get("90")!.TxnStatus, "Pending");
  });

  test("a status QuickBooks answers but does not apply is a failure, not a success", async () => {
    await estimateFor(1, "90");
    await setLead("stage='Closed Won', closed_at=now()");
    ignoreStatus = true;
    const outcome = await alignment.alignQuickBooksWithClosedLead(1);
    assert.match(String(outcome.pending), /did not set the estimate to Accepted/);
    assert.deepEqual(await audits("quickbooks_estimate_status_set"), []);
    assert.equal((await audits("quickbooks_stage_pending")).length, 1);
  });

  // =========================================================================
  // Kill switches
  // =========================================================================

  test("STAGE_ALIGNMENT=off stops every direction", async () => {
    process.env.STAGE_ALIGNMENT = "off";
    await estimateFor(1, "90");
    await quickBooksChanges("90", { EmailStatus: "EmailSent" });
    assert.equal((await lead()).stage, "New Lead");
    await invoiceFor("90", "500", { total: 1000, balance: 0 });
    assert.equal((await lead()).stage, "New Lead");
    assert.deepEqual(hubWrites, []);
    await estimateFor(1, "91");
    await hubSpotMoves("closedwon");
    assert.equal((await lead()).stage, "Closed Won", "the HubSpot read-back itself still happens");
    assert.deepEqual(await alignment.alignQuickBooksWithClosedLead(1), { set: [], kept: [], pending: null });
    assert.equal(await alignment.completeJobInHubSpot(1), "skipped");
    assert.deepEqual(await alignment.settleStageAlignment(), { attempted: 0, finished: 0 });
    assert.deepEqual(statusWrites(), []);
    assert.equal(hubStage(), "closedwon");
    assert.equal((await query("SELECT 1 FROM audit_log WHERE action LIKE 'quickbooks_%' OR action LIKE 'stage_%' OR action LIKE 'hubspot_deal_job%' OR action LIKE 'hubspot_job%'")).length, 0);
  });

  test("STAGE_ALIGNMENT_QUICKBOOKS_WRITE=off stops only the writes to QuickBooks", async () => {
    process.env.STAGE_ALIGNMENT_QUICKBOOKS_WRITE = "off";
    await estimateFor(1, "90");
    await quickBooksChanges("90", { EmailStatus: "EmailSent" });
    assert.equal((await lead()).stage, "Estimate Sent", "QuickBooks still moves the lead");
    await hubSpotMoves("closedwon");
    assert.equal((await lead()).stage, "Closed Won");
    await alignment.onLeadStageChanged(1, "Estimate Sent", "Closed Won", { waitMs: 8_000 });
    assert.deepEqual(await alignment.alignQuickBooksWithClosedLead(1), { set: [], kept: [], pending: null });
    assert.deepEqual(statusWrites(), []);
    assert.equal(estimates.get("90")!.TxnStatus, "Pending");
    assert.deepEqual(await audits("quickbooks_stage_pending"), []);
    assert.deepEqual(qboReads, [], "QuickBooks is not read for it either");
  });

  test("work waiting for a retry is kept, not forgotten, while the QuickBooks writes are switched off", async () => {
    await estimateFor(1, "90");
    qboDown = true;
    await hubSpotMoves("closedwon");
    qboDown = false;
    await query("UPDATE audit_log SET occurred_at=now()-interval '7 hours' WHERE action='quickbooks_stage_pending'");
    process.env.STAGE_ALIGNMENT_QUICKBOOKS_WRITE = "off";
    assert.deepEqual(await alignment.settleStageAlignment(), { attempted: 0, finished: 0 });
    await alignment.alignQuickBooksWithClosedLead(1);
    assert.equal((await audits("quickbooks_stage_pending")).filter((row) => !row.succeeded).length, 1, "still waiting");
    delete process.env.STAGE_ALIGNMENT_QUICKBOOKS_WRITE;
    assert.deepEqual(await alignment.settleStageAlignment(), { attempted: 1, finished: 1 });
    assert.equal(estimates.get("90")!.TxnStatus, "Accepted");
  });

  // =========================================================================
  // Loop safety
  // =========================================================================

  test("a stage set from QuickBooks is pushed to HubSpot and does not bounce on the read-back", async () => {
    await estimateFor(1, "90");
    await quickBooksChanges("90", { EmailStatus: "EmailSent" });
    assert.equal(hubStage(), "contractsent");
    await pull(new Date());
    await alignment.stageAlignmentSettled();
    assert.equal((await lead()).stage, "Estimate Sent");
    assert.equal((await audits("stage_aligned_with_quickbooks")).length, 1);
    assert.deepEqual(statusWrites(), []);

    // And before the push has landed (the lead is still pending), HubSpot's older stage is not read back over it.
    hubDeals.get("100")!.properties.dealstage = "appointmentscheduled";
    await setLead("integration_sync_status='pending'");
    await pull(new Date());
    assert.equal((await lead()).stage, "Estimate Sent");
  });

  test("the webhook for a status this platform wrote is a no-op", async () => {
    await estimateFor(1, "90", { EmailStatus: "EmailSent" });
    await hubSpotMoves("closedwon");
    assert.deepEqual(statusWrites(), ["UPDATE estimate/90 TxnStatus=Accepted"]);
    const before = await lead();
    // QuickBooks reports the change this platform just made.
    await sync.upsertTxn("Estimate", estimates.get("90") as never);
    await store.applyEstimateStatus((await p5Estimate("90")).id, { raw: estimates.get("90") as never, source: "webhook", drift: null });
    await pull(new Date());
    await alignment.stageAlignmentSettled();
    const now = await lead();
    assert.equal(now.stage, "Closed Won");
    assert.equal(now.integration_sync_status, "synced");
    assert.equal(now.updated_at.getTime(), before.updated_at.getTime(), "the lead is not written again");
    assert.deepEqual(await audits("stage_aligned_with_quickbooks"), []);
    assert.deepEqual(statusWrites(), ["UPDATE estimate/90 TxnStatus=Accepted"], "and QuickBooks is not written again");
    assert.deepEqual(stageWrites(), []);
  });

  test("a lead lost because QuickBooks declined the estimate never writes Rejected back", async () => {
    await estimateFor(1, "90");
    await estimateFor(1, "91", { TxnStatus: "Rejected" });
    await quickBooksChanges("90", { TxnStatus: "Rejected" });
    assert.equal((await lead()).closed_lost_reason, "Estimate declined in QuickBooks");
    assert.equal(hubStage(), "closedlost");
    // Everything that could carry it back round: the read-back, both hooks, the function itself, the retry.
    await pull(new Date());
    await alignment.onLeadStageChanged(1, "New Lead", "Closed Lost", { waitMs: 8_000 });
    await alignment.alignQuickBooksWithClosedLead(1);
    await alignment.settleStageAlignment();
    await alignment.stageAlignmentSettled();
    assert.deepEqual(statusWrites(), []);
    assert.equal(estimates.get("90")!.SyncToken, "1", "only the change the person made in QuickBooks");
    assert.equal((await audits("stage_aligned_with_quickbooks")).length, 1);
  });

  test("a lead won because QuickBooks accepted the estimate never writes Accepted back", async () => {
    await estimateFor(1, "90");
    await quickBooksChanges("90", { TxnStatus: "Accepted" });
    assert.equal((await lead()).stage, "Closed Won");
    assert.equal(hubStage(), "closedwon");
    await pull(new Date());
    await alignment.onLeadStageChanged(1, "New Lead", "Closed Won", { waitMs: 8_000 });
    const outcome = await alignment.alignQuickBooksWithClosedLead(1);
    await alignment.stageAlignmentSettled();
    assert.deepEqual(statusWrites(), []);
    assert.deepEqual(outcome.kept, ["estimate 1090 (accepted)"]);
    assert.equal(estimates.get("90")!.SyncToken, "1");
    assert.equal((await audits("stage_aligned_with_quickbooks")).length, 1);
    assert.deepEqual(stageWrites(), ["PATCH deals/100 dealstage=closedwon"]);
  });
});
