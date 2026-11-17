/**
 * Site estimates into QuickBooks (owner, 13 and 17 November 2026): every
 * price a website gives a visitor becomes a QuickBooks customer and an UNSENT
 * estimate linked to its lead.
 *
 * Runs the real intake, the real site-estimate code, the real deletion and
 * stage rules against a fake HubSpot, a fake QuickBooks and a real database.
 *
 * The fake QuickBooks is strict where the real one is: a create repeated with
 * the same request id returns the first record, a display name can be used
 * once, an estimate line must reference an item that exists and its amount
 * must be its quantity times its rate, an update is applied only with the
 * current SyncToken, a query on a field it does not index is refused, and
 * the total is whatever the lines add up to. It also refuses to be handed a
 * cost or a margin: any write that names one fails the test.
 */
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const TEST_DB = process.env.TEST_DATABASE_URL;

type Hub = { id: string; archived: boolean; properties: Record<string, string> };
type Line = { DetailType: string; Description?: string; Amount?: number; SalesItemLineDetail?: { ItemRef?: { value?: string; name?: string }; Qty?: number; UnitPrice?: number } };
type Estimate = {
  Id: string; SyncToken: string; TxnStatus: string; EmailStatus: string; TotalAmt: number; DocNumber: string;
  CustomerRef: { value: string }; Line: Line[]; CustomerMemo?: { value: string }; PrivateNote?: string; deleted?: boolean;
};
type Customer = {
  Id: string; SyncToken: string; Active: boolean; Balance: number; DisplayName: string;
  PrimaryEmailAddr?: { Address: string }; PrimaryPhone?: { FreeFormNumber: string }; ParentRef?: { value: string };
};
type Json = Record<string, unknown>;

const ITEMS = [
  "Direct Labor", "Subcontractor Work", "Project Materials", "Equipment and Rentals", "Permits and Fees", "Freight and Delivery", "Other Direct Cost",
  "Design and Preconstruction Services", "Handyman Service Work", "Cabinet Product", "Cabinet Installation", "Cabinet Freight and Delivery",
];
const round2 = (n: number) => Math.round(n * 100) / 100;

describe("site estimates into QuickBooks", { skip: TEST_DB ? false : "TEST_DATABASE_URL not set" }, () => {
  let handleIntake: typeof import("../app/api/leads/intake/handler.ts").handleIntake;
  let site: typeof import("../app/lib/leads/site-estimate.ts");
  let links: typeof import("../app/lib/leads/estimate-links.ts");
  let alignment: typeof import("../app/lib/leads/stage-alignment.ts");
  let pull: typeof import("../app/lib/integrations/hubspot-operations.ts").pullHubSpotLeadActions;
  let scopes: typeof import("../app/lib/scopes/qbo.ts");
  let sync: typeof import("../app/lib/finance/qbo/sync.ts");
  let syncCrm: typeof import("../lib/p5/deliveryAdapter.ts").syncCrm;
  let query: typeof import("../app/lib/db.ts").query;
  let getPool: typeof import("../app/lib/db.ts").getPool;
  const originalFetch = globalThis.fetch;
  const ENV = ["HUBSPOT_TOKEN", "QBO_TOKEN_KEY", "QBO_ENV", "SITE_ESTIMATE_QBO", "STAGE_ALIGNMENT", "STAGE_ALIGNMENT_QUICKBOOKS_WRITE", "CROSS_SYSTEM_DELETE", "SESSION_SECRET", "SYNTHETIC_QA_EMAIL_ALLOWLIST"] as const;
  const saved = Object.fromEntries(ENV.map((name) => [name, process.env[name]]));

  let hubDeals: Map<string, Hub>;
  let hubContacts: Map<string, Hub>;
  let hubWrites: string[];
  let estimates: Map<string, Estimate>;
  let customers: Map<string, Customer>;
  let items: Map<string, { Id: string; Name: string; Active: boolean; Type: string }>;
  let requestIds: Map<string, Json>;
  let qboWrites: string[];
  let qboRequests: string[];
  let qboRefused: string[];
  let leaked: string[];
  let unexpected: string[];
  let qboDown: boolean;
  /** Fails estimate creation only, after the customer was made. */
  let estimateCreateDown: boolean;
  /** Holds every QuickBooks request until released. */
  let qboGate: Promise<void> | null;
  let nextId: number;
  let timeline: string[];
  let sent: { to: string; subject: string; text: string }[];
  let ip = 0;

  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
  const fault = (message: string, code: string, detail = message) => json({ Fault: { Error: [{ Message: message, Detail: detail, code }], type: "ValidationFault" } }, 400);
  const gone = () => fault("Object Not Found", "610", "Object Not Found : Something you're trying to use has been made inactive.");
  const stale = () => fault("Stale Object Error", "5010", "Stale Object Error : You and Test User were working on the same thing.");
  const transport = {
    name: "test",
    async send(to: string, message: { subject: string; text: string; html: string }) {
      timeline.push("email");
      sent.push({ to, subject: message.subject, text: message.text });
      return { ok: true as const };
    },
  };

  /** What QuickBooks checks on an estimate's lines before it stores them. */
  function refuseLines(body: Json): Response | null {
    const lines = body.Line as Line[] | undefined;
    if (!Array.isArray(lines) || !lines.length) return fault("Required param missing, need to supply the required value for the API", "2020", "Required parameter Line is missing in the request");
    for (const line of lines) {
      if (line.DetailType !== "SalesItemLineDetail") continue;
      const detail = line.SalesItemLineDetail;
      if (!detail?.ItemRef?.value || !items.has(detail.ItemRef.value)) return fault("Invalid Reference Id", "2500", "Invalid Reference Id : Line.SalesItemLineDetail.ItemRef");
      if (typeof line.Amount !== "number" || round2(Number(detail.Qty) * Number(detail.UnitPrice)) !== line.Amount) {
        return fault("Amount calculation incorrect in the request", "6070", "Amount is not equal to UnitPrice * Qty. Supplied value:" + String(line.Amount));
      }
    }
    return null;
  }
  const lineTotal = (lines: Line[]) => round2(lines.filter((l) => l.DetailType === "SalesItemLineDetail").reduce((sum, l) => sum + Number(l.Amount), 0));

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.HUBSPOT_TOKEN = "isolated-test-token";
    process.env.QBO_TOKEN_KEY = randomBytes(32).toString("base64");
    process.env.SESSION_SECRET = "synthetic-secret-for-tests";
    for (const name of ["QBO_ENV", "SITE_ESTIMATE_QBO", "STAGE_ALIGNMENT", "STAGE_ALIGNMENT_QUICKBOOKS_WRITE", "CROSS_SYSTEM_DELETE", "SYNTHETIC_QA_EMAIL_ALLOWLIST", "SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"]) delete process.env[name];
    ({ handleIntake } = await import("../app/api/leads/intake/handler.ts"));
    site = await import("../app/lib/leads/site-estimate.ts");
    links = await import("../app/lib/leads/estimate-links.ts");
    alignment = await import("../app/lib/leads/stage-alignment.ts");
    ({ pullHubSpotLeadActions: pull } = await import("../app/lib/integrations/hubspot-operations.ts"));
    scopes = await import("../app/lib/scopes/qbo.ts");
    sync = await import("../app/lib/finance/qbo/sync.ts");
    ({ syncCrm } = await import("../lib/p5/deliveryAdapter.ts"));
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
        const path = url.replace(/^https:\/\/quickbooks\.api\.intuit\.com\/v3\/company\/[^/]+/, "").replace(/[?&]minorversion=\d+/, "");
        qboRequests.push(`${method} ${path.split("?")[0]}`);
        timeline.push("quickbooks");
        if (qboGate) await qboGate;
        if (qboDown) return json({ Fault: "unavailable" }, 400);
        // QuickBooks holds customer prices. Nothing it is sent may name a cost or a margin.
        if (body && /cost|margin|mark-?up|profit|overhead|contingenc/i.test(JSON.stringify(body))) leaked.push(`${method} ${path.split("?")[0]}`);
        const requestId = /[?&]requestid=([^&]+)/.exec(path)?.[1] ?? null;

        if (path.startsWith("/query?query=")) {
          const sql = decodeURIComponent(path.slice("/query?query=".length));
          const entity = /FROM (\w+)/.exec(sql)![1];
          const where = /WHERE (.*?)(?: STARTPOSITION| MAXRESULTS|$)/.exec(sql)?.[1] ?? "";
          const fields = [...where.matchAll(/(\w+) (?:=|IN|LIKE|<|>)/g)].map((m) => m[1]);
          const queryable = entity === "Customer" ? ["Id", "Active", "Job", "DisplayName"] : entity === "Item" ? ["Id", "Name", "Active", "Type"] : ["Id", "CustomerRef", "DocNumber", "TxnDate"];
          const refused = fields.find((field) => !queryable.includes(field));
          if (refused) {
            qboRefused.push(`${entity}.${refused}`);
            return fault("Invalid query", "4001", `QueryValidationError: Property ${refused} is not queryable`);
          }
          const customerId = /CustomerRef = '([^']+)'/.exec(sql)?.[1];
          let rows: unknown[] = [];
          if (entity === "Item") rows = [...items.values()];
          else if (entity === "Customer") rows = [...customers.values()].filter((c) => c.Active);
          else if (entity === "Estimate") rows = [...estimates.values()].filter((e) => !e.deleted && e.CustomerRef.value === customerId);
          return json({ QueryResponse: { [entity]: rows } });
        }

        const estimateId = /^\/estimate\/(\d+)$/.exec(path)?.[1];
        if (estimateId && method === "GET") {
          const row = estimates.get(estimateId);
          return !row || row.deleted ? gone() : json({ Estimate: row });
        }
        if (path.startsWith("/estimate?operation=delete") && method === "POST") {
          const row = estimates.get(String(body.Id));
          if (!row || row.deleted) return gone();
          if (String(body.SyncToken) !== row.SyncToken) return stale();
          row.deleted = true;
          qboWrites.push(`DELETE estimate/${row.Id}`);
          return json({ Estimate: { Id: row.Id, status: "Deleted" } });
        }
        if (/^\/estimate(\?requestid=[^&]+)?$/.test(path) && method === "POST") {
          if (!body.Id) {
            // A repeat of the same request returns the record the first one made.
            if (requestId && requestIds.has(requestId)) return json({ Estimate: requestIds.get(requestId) });
            if (estimateCreateDown) return json({ Fault: "unavailable" }, 400);
            const customer = customers.get(String(body.CustomerRef?.value));
            if (!customer || !customer.Active) return fault("Invalid Reference Id", "2500", "Invalid Reference Id : CustomerRef");
            const refused = refuseLines(body);
            if (refused) return refused;
            const id = String(nextId++);
            const row: Estimate = { ...body, Id: id, SyncToken: "0", TxnStatus: "Pending", EmailStatus: body.EmailStatus ?? "NotSet", DocNumber: `10${id}`, TotalAmt: lineTotal(body.Line) };
            estimates.set(id, row);
            if (requestId) requestIds.set(requestId, row as unknown as Json);
            qboWrites.push(`CREATE estimate/${id}`);
            return json({ Estimate: row });
          }
          const row = estimates.get(String(body.Id));
          if (!row || row.deleted) return gone();
          if (String(body.SyncToken) !== row.SyncToken) { qboWrites.push(`STALE estimate/${row.Id}`); return stale(); }
          if (body.Line) {
            const refused = refuseLines(body);
            if (refused) return refused;
          } else if (body.sparse !== true) {
            return fault("Required param missing, need to supply the required value for the API", "2020", "Required parameter Line is missing in the request");
          }
          const { Id: _id, SyncToken: _token, sparse: _sparse, ...rest } = body;
          void _id; void _token; void _sparse;
          Object.assign(row, rest);
          row.TotalAmt = lineTotal(row.Line);
          row.SyncToken = String(Number(row.SyncToken) + 1);
          qboWrites.push(body.Line ? `UPDATE estimate/${row.Id} lines` : `UPDATE estimate/${row.Id}`);
          return json({ Estimate: row });
        }

        const customerId = /^\/customer\/(\d+)$/.exec(path)?.[1];
        if (customerId && method === "GET") {
          const row = customers.get(customerId);
          return row ? json({ Customer: row }) : gone();
        }
        if (/^\/customer(\?requestid=[^&]+)?$/.test(path) && method === "POST") {
          if (!body.Id) {
            if (requestId && requestIds.has(requestId)) return json({ Customer: requestIds.get(requestId) });
            if (!String(body.DisplayName ?? "").trim()) return fault("Required param missing, need to supply the required value for the API", "2020", "Required parameter DisplayName is missing in the request");
            // One name, once: across active and inactive customers alike.
            if ([...customers.values()].some((c) => c.DisplayName.toLowerCase() === String(body.DisplayName).toLowerCase())) {
              return fault("Duplicate Name Exists Error", "6240", "The name supplied already exists. : Another customer is already using this name.");
            }
            const id = String(nextId++);
            const row: Customer = { ...body, Id: id, SyncToken: "0", Active: true, Balance: 0 };
            customers.set(id, row);
            if (requestId) requestIds.set(requestId, row as unknown as Json);
            qboWrites.push(`CREATE customer/${id} ${row.DisplayName}`);
            return json({ Customer: row });
          }
          const row = customers.get(String(body.Id));
          if (!row) return gone();
          if (String(body.SyncToken) !== row.SyncToken) return stale();
          row.Active = body.Active;
          row.SyncToken = String(Number(row.SyncToken) + 1);
          qboWrites.push(`UPDATE customer/${row.Id} Active=${body.Active}`);
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

  async function connectQuickBooks(): Promise<void> {
    const { encryptSecret } = await import("../app/lib/finance/crypto.ts");
    await query(
      `INSERT INTO qbo_connection (id, realm_id, access_cipher, refresh_cipher, access_expires_at, refresh_expires_at, connected_at, updated_at)
       VALUES (1,'realm1',$1,$2,now()+interval '1 hour',now()+interval '30 days',now(),now())`,
      [encryptSecret("access"), encryptSecret("refresh")],
    );
  }

  beforeEach(async () => {
    hubDeals = new Map([["100", { id: "100", archived: false, properties: { dealstage: "appointmentscheduled" } }]]);
    hubContacts = new Map([["200", { id: "200", archived: false, properties: {} }]]);
    estimates = new Map();
    customers = new Map();
    items = new Map(ITEMS.map((name, i) => [String(700 + i), { Id: String(700 + i), Name: name, Active: true, Type: "Service" }]));
    requestIds = new Map();
    hubWrites = []; qboWrites = []; qboRequests = []; qboRefused = []; leaked = []; unexpected = []; timeline = []; sent = [];
    qboDown = false; estimateCreateDown = false; qboGate = null; nextId = 5000;
    for (const name of ["SITE_ESTIMATE_QBO", "STAGE_ALIGNMENT", "STAGE_ALIGNMENT_QUICKBOOKS_WRITE", "CROSS_SYSTEM_DELETE"]) delete process.env[name];
    alignment.resetStageAlignmentCache();
    await query(`TRUNCATE guided_estimate,scope_event,scope_estimate_snapshot,scope_estimate,scope_version,scope_project,qbo_connection,qbo_txn,qbo_customer,qbo_item,qbo_write_intent,
      hubspot_lead_review,lead_hubspot_retry,hubspot_archive_review,integration_health,lead_intake_submission,lead_intake_rate_limit,lead_pending_details,lead_external_ref,
      deal,contact,app_user,alert,lead_alert_incident,task,activity,audit_log,job_run,job_lock,setting RESTART IDENTITY CASCADE`);
    await query("INSERT INTO setting (key,value) VALUES ('lead_manager',$1::jsonb)", [JSON.stringify({ featureFlags: { hubspotIntegrationEnabled: true } })]);
    await query("INSERT INTO app_user (email,full_name,role) VALUES ('coord@p5homeco.com','Coordinator One','lead_coordinator')");
    await connectQuickBooks();
  });

  afterEach(async () => {
    await site.siteEstimatesSettled();
    await alignment.stageAlignmentSettled();
    assert.deepEqual(unexpected, [], "no request the fakes did not expect");
    assert.deepEqual(qboRefused, [], "every query is one QuickBooks accepts");
    assert.deepEqual(leaked, [], "no cost or margin is ever sent to QuickBooks");
  });

  // ---- helpers -------------------------------------------------------------

  const LINES = [
    { title: "Flooring", amount: 8200, division: "FLOORING", quantity: 410, unit: "SF" },
    { title: "Cabinets", description: "Shaker, painted", amount: 21450.1, division: "COUNTERTOPS + CABINETRY" },
    { title: "Permits", amount: 349.9, division: "Permits" },
    { title: "Plumbing", amount: 6000, division: "PLUMBING" },
  ];
  const RANGE = { kind: "planning-range", low: 32000, high: 41000, label: "Kitchen remodel, mid-range, 180 sq ft", verified: true, lines: LINES };

  const request = (extra: Json = {}): Json => ({
    brand: "Boise Remodeling Co",
    name: "Pat Example",
    email: "pat@example.com",
    phone: "(208) 555-0142",
    projectType: "Kitchen remodel",
    address: "123 N Main St",
    city: "Boise",
    zip: "83702",
    form: "Consultation request",
    summary: "We would like to redo the kitchen.",
    external_id: "req-1",
    ...extra,
  });

  /** Post to the real intake. Nothing queued for after the response runs until `finish()`. */
  async function post(body: Json, deps: Json = {}): Promise<{ status: number; json: Json; tasks: (() => Promise<void>)[]; finish: () => Promise<void> }> {
    const tasks: (() => Promise<void>)[] = [];
    const response = await handleIntake(
      new Request("https://p5homeco.com/api/leads/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": `198.51.100.${++ip % 250}` },
        body: JSON.stringify(body),
      }),
      (task) => void tasks.push(task),
      { alertTransport: transport, ...deps },
    );
    return {
      status: response.status,
      json: (await response.json()) as Json,
      tasks,
      // In the order they were queued, one after another: the strictest reading of "after the response".
      finish: async () => { for (const task of tasks) await task(); await site.siteEstimatesSettled(); await alignment.stageAlignmentSettled(); },
    };
  }

  const audits = (action: string) => query<{ record_id: string; new_value: Json; succeeded: boolean; error: string | null }>("SELECT record_id,new_value,succeeded,error FROM audit_log WHERE action=$1 ORDER BY id", [action]);
  const leadRow = async (id = 1) => (await query<{ stage: string; closed_lost_reason: string | null; brand: string }>("SELECT stage,closed_lost_reason,brand FROM deal WHERE id=$1", [id]))[0];
  const projects = () => query<{ id: number; lead_deal_id: number | null; client_first_name: string | null; client_last_name: string | null; client_email: string | null; client_phone: string | null; project_address: string | null; service: string; title: string; qbo_customer_id: string | null; deleted_at: Date | null; scope_status: string }>(
    "SELECT id::int AS id, lead_deal_id::int AS lead_deal_id, client_first_name, client_last_name, client_email, client_phone, project_address, service, title, qbo_customer_id, deleted_at, scope_status FROM scope_project ORDER BY id");
  const versions = (projectId: number) => query<{ id: number; version_no: number; source: string; created_by: number | null; note: string | null; pricing: { lines: Json[]; totals: Json } }>(
    "SELECT id::int AS id, version_no, source, created_by::int AS created_by, note, pricing FROM scope_version WHERE project_id=$1 ORDER BY version_no", [projectId]);
  const storedEstimates = () => query<{ id: number; project_id: number; qbo_estimate_id: string; version_id: number; sync_token: string | null; txn_status: string | null; email_status: string | null; total: string | null; created_by: number | null }>(
    "SELECT id::int AS id, project_id::int AS project_id, qbo_estimate_id, version_id::int AS version_id, sync_token, txn_status, email_status, total::text AS total, created_by::int AS created_by FROM scope_estimate ORDER BY id");
  const sales = (estimate: Estimate) => estimate.Line.filter((l) => l.DetailType === "SalesItemLineDetail");
  const only = <T,>(rows: Iterable<T>): T => {
    const all = [...rows];
    assert.equal(all.length, 1, `expected exactly one, found ${all.length}`);
    return all[0];
  };
  /** Make a pending retry old enough for the watchdog to take it. */
  const age = (hours: number) => query("UPDATE audit_log SET occurred_at = occurred_at - ($1 || ' hours')::interval WHERE action='site_estimate_pending'", [String(hours)]);
  /** Someone changes the estimate in QuickBooks, and QuickBooks reports it (what the webhook and the daily sync do). */
  async function quickBooksChanges(qboEstimateId: string, changes: Partial<Estimate>): Promise<void> {
    const row = estimates.get(qboEstimateId)!;
    Object.assign(row, changes);
    row.SyncToken = String(Number(row.SyncToken) + 1);
    await sync.upsertTxn("Estimate", row as never);
    await alignment.stageAlignmentSettled();
  }
  /** Give the lead its HubSpot records, as the sync would have. */
  async function inHubSpot(dealId = 1): Promise<void> {
    await query("UPDATE deal SET hubspot_deal_id='100', integration_sync_status='synced' WHERE id=$1", [dealId]);
    await query("UPDATE contact SET hubspot_contact_id='200' WHERE id=(SELECT contact_id FROM deal WHERE id=$1)", [dealId]);
  }

  // ---- creation from the intake ---------------------------------------------

  test("a request with a planning range and lines becomes a customer and an unsent estimate, after the response", async () => {
    const posted = await post(request({ estimate: RANGE, team_notes: ["Lead dashboard: https://boiseremodeling.co/admin"] }));
    assert.equal(posted.status, 201);
    assert.equal(posted.json.accepted, true);

    // Nothing on the visitor's path: no QuickBooks request and no project until the response has gone.
    assert.deepEqual(qboRequests, []);
    assert.deepEqual(await projects(), []);
    await posted.finish();
    // The team email is never delayed by QuickBooks: it is queued, and sent, first.
    assert.ok(timeline.indexOf("email") >= 0 && timeline.indexOf("email") < timeline.indexOf("quickbooks"), `email first: ${timeline.slice(0, 4).join(", ")}`);

    // One customer, created from the lead's own details.
    const customer = only(customers.values());
    assert.equal(customer.DisplayName, "Pat Example");
    assert.equal(customer.PrimaryEmailAddr?.Address, "pat@example.com");

    // One estimate: unsent, on that customer, itemized, and its total is the base to the cent.
    const estimate = only(estimates.values());
    assert.equal(estimate.EmailStatus, "NotSet");
    assert.equal(estimate.TxnStatus, "Pending");
    assert.equal(estimate.CustomerRef.value, customer.Id);
    assert.equal(estimate.TotalAmt, 36000);
    assert.deepEqual(sales(estimate).map((l) => [l.Description, l.Amount, l.SalesItemLineDetail?.ItemRef?.name]), [
      ["Permits", 349.9, "Permits and Fees"],
      ["Flooring", 8200, "Subcontractor Work"],
      ["Cabinets\nShaker, painted", 21450.1, "Subcontractor Work"],
      ["Plumbing", 6000, "Subcontractor Work"],
    ]);
    assert.deepEqual([sales(estimate)[1].SalesItemLineDetail?.Qty, sales(estimate)[1].SalesItemLineDetail?.UnitPrice], [410, 20]);
    const headings = estimate.Line.filter((l) => l.DetailType === "DescriptionOnly").map((l) => l.Description);
    assert.deepEqual(headings, ["PHASE 1: PRE-CONSTRUCTION", "DIVISION 00 PRE-CONSTRUCTION & FEES", "PHASE 2: CONSTRUCTION", "DIVISION 09 FINISHES", "DIVISION 12 CASEWORK, CABINETS & COUNTERTOPS", "DIVISION 22 PLUMBING"]);

    // The range travels as words, with the tool it came from and whether the site verified it.
    const memo = estimate.CustomerMemo!.value;
    assert.match(memo, /^Preliminary range given online: \$32,000 to \$41,000\. The total on this estimate \(\$36,000\) is the base figure that range is built on\.\n/);
    assert.match(memo, /Planning range from the Boise Remodeling Co request form\. Figures verified by the site's server\./);
    assert.match(memo, /Schedule a time with us/);
    assert.match(estimate.PrivateNote!, /Preliminary range given online: \$32,000 to \$41,000/);
    assert.match(estimate.PrivateNote!, /Planning range from the Boise Remodeling Co request form\. Figures verified by the site's server\./);
    assert.match(estimate.PrivateNote!, /Customer prices only\. Created unsent; review before sending\./);
    assert.doesNotMatch(`${memo}\n${estimate.PrivateNote}`, /\bquote\b|\bbid\b|final price/i);
    assert.deepEqual(qboWrites, [`CREATE customer/${customer.Id} Pat Example`, `CREATE estimate/${estimate.Id}`]);

    // In P5: one scope project linked to the lead, made by nobody, with a version built from the lines.
    const project = only(await projects());
    assert.deepEqual(
      [project.lead_deal_id, project.client_first_name, project.client_last_name, project.client_email, project.client_phone, project.project_address, project.service, project.qbo_customer_id],
      [1, "Pat", "Example", "pat@example.com", "(208) 555-0142", "123 N Main St, Boise, 83702", "remodel", customer.Id],
    );
    assert.equal(project.title, "Example - 123 N Main St - Remodel");
    const version = only(await versions(project.id));
    assert.deepEqual([version.source, version.created_by, version.version_no], ["site-estimate", null, 1]);
    assert.equal(version.pricing.totals.basePrice, 36000);
    assert.equal(version.pricing.totals.baseCost, null);
    assert.ok(version.pricing.lines.every((l) => l.cost === null && l.unitCost === null && l.basis === "site-estimate"));
    const stored = only(await storedEstimates());
    assert.deepEqual([stored.qbo_estimate_id, stored.sync_token, stored.total, stored.created_by, stored.email_status], [estimate.Id, "0", "36000.00", null, "NotSet"]);

    // On the lead: what was made. The lead itself has not moved.
    const [created] = await audits("site_estimate_created");
    assert.equal(created.record_id, "1");
    assert.equal(created.succeeded, true);
    assert.deepEqual(
      [created.new_value.kind, created.new_value.total, created.new_value.low, created.new_value.high, created.new_value.verified, created.new_value.qboEstimateId, created.new_value.quickBooksTotal],
      ["planning-range", 36000, 32000, 41000, true, estimate.Id, 36000],
    );
    assert.deepEqual(created.new_value.customer, { qboId: customer.Id, how: "created" });
    assert.equal((await leadRow()).stage, "New Lead", "the estimate the website made moves nothing");
    assert.deepEqual(await audits("stage_aligned_with_quickbooks"), []);
    assert.deepEqual(await audits("site_estimate_pending"), []);

    // The lead page finds it, and the estimate was never stored on the lead or printed in the team email.
    const [listed] = await links.estimatesForLead(1);
    assert.deepEqual([listed.projectId, listed.source, listed.qboEstimateId, listed.total], [project.id, "site-estimate", estimate.Id, 36000]);
    assert.deepEqual(await links.projectsForLead(1), [project.id]);
    assert.equal(await links.leadForProject(project.id), 1);
    const submission = await query<{ fields: unknown }>("SELECT fields FROM lead_intake_submission");
    assert.doesNotMatch(JSON.stringify(submission), /planning-range|21450|Shaker/);
    const [deal] = await query<{ summary: string | null }>("SELECT summary FROM deal WHERE id=1");
    assert.doesNotMatch(deal.summary ?? "", /36,000|planning-range|Shaker/);
    assert.equal(sent.length, 1);
    assert.doesNotMatch(sent[0].text, /planning-range|21,?450|Shaker/);
  });

  test("a planning range without lines is one line at the midpoint, titled from its label", async () => {
    const posted = await post(request({ brand: "Boise Handyman Co", estimate: { kind: "planning-range", low: 900, high: 1500, label: "Punch list, half day" } }));
    await posted.finish();
    const estimate = only(estimates.values());
    assert.equal(estimate.TotalAmt, 1200);
    const line = only(sales(estimate));
    assert.deepEqual([line.Description, line.Amount, line.SalesItemLineDetail?.Qty, line.SalesItemLineDetail?.UnitPrice, line.SalesItemLineDetail?.ItemRef?.name], ["Punch list, half day", 1200, 1, 1200, "Handyman Service Work"]);
    // Not verified by the site's server, and it says so.
    assert.match(estimate.CustomerMemo!.value, /Planning range from the Boise Handyman Co request form\. Figures as sent by the visitor's browser, not verified by the site's server\./);
    assert.equal(only(await projects()).service, "handyman");
    assert.equal((await audits("site_estimate_created"))[0].new_value.verified, false);

    // With no label either, the line is simply "Planning range".
    const second = await post(request({ name: "Sam Other", email: "sam@example.com", phone: "(208) 555-0177", external_id: "req-2", estimate: { kind: "planning-range", low: 2000, high: 2600, base: 2250.5 } }));
    await second.finish();
    const other = [...estimates.values()][1];
    assert.equal(other.TotalAmt, 2250.5, "the base that was sent is the total");
    assert.equal(only(sales(other)).Description, "Planning range");
  });

  test("a firm price is one figure, and the message says so", async () => {
    const posted = await post(request({ brand: "Boise Cabinet Co", estimate: { kind: "planning-range", low: 18400, high: 18400, verified: true, lines: [{ title: "Kitchen", amount: 14200 }, { title: "Primary bath", amount: 4200 }] } }));
    await posted.finish();
    const estimate = only(estimates.values());
    assert.equal(estimate.TotalAmt, 18400);
    assert.match(estimate.CustomerMemo!.value, /^Price given online: \$18,400, one figure and not a range\. The total on this estimate \(\$18,400\) is the base figure that price is built on\./);
    assert.doesNotMatch(estimate.CustomerMemo!.value, /Preliminary range given online/);
    assert.deepEqual(sales(estimate).map((l) => [l.Description, l.SalesItemLineDetail?.ItemRef?.name]), [["Kitchen", "Cabinet Installation"], ["Primary bath", "Cabinet Installation"]]);
    assert.ok(estimate.Line.some((l) => l.Description === "DIVISION 12 CASEWORK, CABINETS & COUNTERTOPS"));
  });

  test("the total equals the base to the cent, whatever the cents and quantities", async () => {
    const lines = [
      { title: "Tile", amount: 3333.34, quantity: 7, unit: "SF" },
      { title: "Paint", amount: 1234.56, quantity: 3, unit: "rooms" },
      { title: "Trim", amount: 0.01 },
      { title: "Doors", amount: 2999.97, quantity: 3, unit: "EA" },
    ];
    const posted = await post(request({ estimate: { kind: "planning-range", low: 7000, high: 8200, verified: true, lines } }));
    await posted.finish();
    const estimate = only(estimates.values());
    assert.equal(sales(estimate).length, 4);
    assert.equal(estimate.TotalAmt, 7567.88);
    // A quantity that does not divide the amount to the cent becomes one lump sum, with the quantity in words.
    const byName = new Map(sales(estimate).map((l) => [String(l.Description).split(" (")[0], l]));
    assert.deepEqual([byName.get("Tile")!.SalesItemLineDetail!.Qty, byName.get("Tile")!.Description], [1, "Tile (7 SF)"]);
    assert.deepEqual([byName.get("Doors")!.SalesItemLineDetail!.Qty, byName.get("Doors")!.SalesItemLineDetail!.UnitPrice], [3, 999.99]);
    assert.equal(only(await storedEstimates()).total, "7567.88");
    assert.equal((await audits("site_estimate_created"))[0].succeeded, true, "the QuickBooks total was checked against the base");
  });

  test("a pricing change in the scope platform does not replace the website's figures with an empty version", async () => {
    await (await post(request({ estimate: RANGE }))).finish();
    const { reprice, compute, currentDoc } = await import("../app/lib/scopes/engine.ts");
    const { getProject } = await import("../app/lib/scopes/store.ts");
    // Saving Pricing setup re-prices every open project. There is no scope behind a site estimate to price again.
    await reprice(1, 1, "Pricing setup changed");
    const version = only(await versions(1));
    assert.deepEqual([version.source, version.pricing.totals.basePrice], ["site-estimate", 36000]);
    // The scope platform itself prices from tasks, and there are none: nothing is ready to be sent from there.
    const project = (await getProject(1))!;
    const computed = await compute(project, (await currentDoc(project)).doc);
    assert.deepEqual([computed.pricing.lines.length, computed.readiness.status], [0, "in_progress"]);
    assert.equal(only(estimates.values()).TotalAmt, 36000);
    // The website can still revise its own estimate afterwards.
    await (await post(request({ estimate: { ...RANGE, low: 36000, high: 46000, lines: [...LINES.slice(0, 3), { title: "Plumbing", amount: 10500, division: "PLUMBING" }] } }))).finish();
    assert.equal(only(estimates.values()).TotalAmt, 40500);
  });

  // ---- the customer ----------------------------------------------------------

  test("an existing QuickBooks customer with the same email is linked, not made again", async () => {
    customers.set("34", { Id: "34", SyncToken: "3", Active: true, Balance: 0, DisplayName: "Patricia Example-Jones", PrimaryEmailAddr: { Address: "PAT@example.com" } });
    await (await post(request({ estimate: RANGE }))).finish();
    assert.equal(customers.size, 1);
    assert.equal(only(estimates.values()).CustomerRef.value, "34");
    assert.deepEqual(qboWrites, [`CREATE estimate/${only(estimates.values()).Id}`]);
    assert.deepEqual((await audits("site_estimate_created"))[0].new_value.customer, { qboId: "34", how: "matched" });
  });

  test("an existing QuickBooks customer with the same phone is linked, not made again", async () => {
    customers.set("35", { Id: "35", SyncToken: "0", Active: true, Balance: 0, DisplayName: "The Example Household", PrimaryEmailAddr: { Address: "household@example.com" }, PrimaryPhone: { FreeFormNumber: "208.555.0142" } });
    await (await post(request({ estimate: RANGE }))).finish();
    assert.equal(customers.size, 1);
    assert.equal(only(estimates.values()).CustomerRef.value, "35");
    assert.deepEqual((await audits("site_estimate_created"))[0].new_value.customer, { qboId: "35", how: "matched" });
  });

  test("a namesake with another email and phone is a different family: a new customer is made", async () => {
    customers.set("36", { Id: "36", SyncToken: "0", Active: true, Balance: 0, DisplayName: "Pat Example", PrimaryEmailAddr: { Address: "another.pat@example.com" }, PrimaryPhone: { FreeFormNumber: "(208) 555-0999" } });
    await (await post(request({ estimate: RANGE }))).finish();
    assert.equal(customers.size, 2);
    const made = [...customers.values()].find((c) => c.Id !== "36")!;
    assert.equal(made.DisplayName, "Pat Example (123 N Main St)", "QuickBooks allows a name once, so the street tells them apart");
    assert.equal(only(estimates.values()).CustomerRef.value, made.Id, "the estimate is not put on the namesake's account");
    assert.deepEqual((await audits("site_estimate_created"))[0].new_value.customer, { qboId: made.Id, how: "created" });
  });

  // ---- one estimate per lead and kind ---------------------------------------

  test("a repeat, a Step 2 and a retry change nothing: one project, one customer, one estimate", async () => {
    await (await post(request({ estimate: RANGE }))).finish();
    const writes = [...qboWrites];
    const requests = qboRequests.length;

    // The same request again (a double submit).
    const again = await post(request({ estimate: RANGE }));
    assert.equal(again.json.duplicate, true);
    await again.finish();
    // Step 2 for the same request, carrying the same estimate.
    const details = await post({ brand: "Boise Remodeling Co", submission_kind: "details", external_id: "req-1", timeline: "1 to 3 months", estimate: RANGE });
    assert.equal(details.json.merged, true);
    await details.finish();
    // Called directly, twice at once.
    const estimate = (await import("../app/lib/leads/intakeContract.ts")).readSiteEstimate(RANGE).estimate!;
    const outcomes = await Promise.all([1, 2].map(() => site.createSiteEstimate({ dealId: 1, brand: "Boise Remodeling Co", estimate })));
    assert.deepEqual(outcomes.map((o) => o.status), ["unchanged", "unchanged"]);

    assert.deepEqual(qboWrites, writes, "nothing more was written to QuickBooks");
    assert.equal(qboRequests.length, requests, "QuickBooks was not even asked");
    assert.equal((await projects()).length, 1);
    assert.equal((await versions(1)).length, 1);
    assert.equal((await storedEstimates()).length, 1);
    assert.equal(customers.size, 1);
    assert.equal(estimates.size, 1);
    assert.equal((await audits("site_estimate_created")).length, 1);
    assert.equal((await audits("site_estimate_revised")).length, 0);
  });

  test("two first attempts at the same moment still make one project, one customer and one estimate", async () => {
    await (await post(request())).finish();
    const estimate = (await import("../app/lib/leads/intakeContract.ts")).readSiteEstimate(RANGE).estimate!;
    const outcomes = await Promise.all([1, 2, 3].map(() => site.createSiteEstimate({ dealId: 1, brand: "Boise Remodeling Co", estimate })));
    assert.deepEqual(outcomes.map((o) => o.status).sort(), ["created", "unchanged", "unchanged"]);
    assert.equal((await projects()).length, 1);
    assert.equal(customers.size, 1);
    assert.equal(estimates.size, 1);
  });

  test("different figures of the same kind revise that estimate, and the lead does not move", async () => {
    await (await post(request({ estimate: RANGE }))).finish();
    await inHubSpot();
    const estimate = only(estimates.values());
    const changed = { ...RANGE, low: 36000, high: 46000, label: "Kitchen remodel, high-end, 180 sq ft", lines: [...LINES.slice(0, 3), { title: "Plumbing", amount: 10500, division: "PLUMBING" }] };
    const again = await post(request({ estimate: changed }));
    assert.equal(again.json.duplicate, true, "the same lead");
    await again.finish();

    assert.equal(estimates.size, 1, "never a second estimate");
    assert.equal(customers.size, 1);
    assert.equal((await projects()).length, 1, "never a second project");
    assert.deepEqual([estimate.TotalAmt, estimate.SyncToken, estimate.EmailStatus], [40500, "1", "NotSet"]);
    assert.match(estimate.CustomerMemo!.value, /Preliminary range given online: \$36,000 to \$46,000\. The total on this estimate \(\$40,500\)/);
    assert.equal(qboWrites.at(-1), `UPDATE estimate/${estimate.Id} lines`);
    const all = await versions(1);
    assert.deepEqual(all.map((v) => [v.version_no, v.source, v.created_by]), [[1, "site-estimate", null], [2, "site-estimate", null]]);
    const stored = only(await storedEstimates());
    assert.deepEqual([stored.version_id, stored.total, stored.sync_token], [all[1].id, "40500.00", "1"]);
    const [revised] = await audits("site_estimate_revised");
    assert.deepEqual([revised.new_value.total, revised.new_value.previousTotal, revised.new_value.quickBooksTotal, revised.succeeded], [40500, 36000, 40500, true]);
    // QuickBooks saved the estimate again, but the website did it, not a person: the lead stays "New Lead".
    assert.equal((await leadRow()).stage, "New Lead");
    assert.deepEqual(await audits("stage_aligned_with_quickbooks"), []);
    const notes = await query<{ detail: Json }>("SELECT detail FROM scope_event WHERE kind='site-estimate-synced' ORDER BY id");
    assert.deepEqual(notes.map((n) => [n.detail.syncToken, n.detail.state]), [["1", "done"]], "the website's own save is on record, confirmed");

    // The same changed figures again: nothing.
    const writes = qboWrites.length;
    await (await post(request({ estimate: changed }))).finish();
    assert.equal(qboWrites.length, writes);
    assert.equal((await versions(1)).length, 2);

    // A second change is revised the same way, and still moves nothing.
    await (await post(request({ estimate: { ...changed, lines: [...changed.lines.slice(0, 3), { title: "Plumbing", amount: 11500, division: "PLUMBING" }] } }))).finish();
    assert.deepEqual([estimate.TotalAmt, estimate.SyncToken], [41500, "2"]);
    assert.equal((await leadRow()).stage, "New Lead");

    // The next save by a person does count: the lead moves on.
    await quickBooksChanges(estimate.Id, { PrivateNote: "Called the customer." });
    assert.equal((await leadRow()).stage, "Estimate in Progress");
  });

  test("an estimate a person has worked, sent or answered is never changed by the website", async () => {
    await (await post(request({ estimate: RANGE }))).finish();
    await inHubSpot();
    const estimate = only(estimates.values());
    const changed = { ...RANGE, low: 36000, high: 46000, lines: [...LINES.slice(0, 3), { title: "Plumbing", amount: 10500, division: "PLUMBING" }] };

    // A person saves the estimate in QuickBooks (a note, nothing else).
    await quickBooksChanges(estimate.Id, { PrivateNote: "Reviewed." });
    assert.equal((await leadRow()).stage, "Estimate in Progress");
    const writes = [...qboWrites];
    await (await post(request({ estimate: changed }))).finish();
    assert.deepEqual(qboWrites, writes, "QuickBooks was not written");
    assert.equal(estimate.TotalAmt, 36000);
    assert.equal((await versions(1)).length, 1, "the project keeps the version the estimate was made from");
    const [skipped] = await audits("site_estimate_skipped");
    assert.match(String(skipped.new_value.reason), /A person has worked on the QuickBooks estimate, so the website's new figures were not applied/);
    assert.deepEqual([skipped.new_value.total, skipped.new_value.low, skipped.new_value.high], [40500, 36000, 46000], "the new figures are on the lead's audit trail");
    assert.deepEqual(await audits("site_estimate_pending"), [], "nothing is left to retry");

    // Sent to the customer: still not changed, and said once however often the figures arrive.
    await quickBooksChanges(estimate.Id, { EmailStatus: "EmailSent" });
    await (await post(request({ estimate: changed }))).finish();
    await (await post(request({ estimate: changed }))).finish();
    assert.deepEqual(qboWrites, writes);
    const reasons = (await audits("site_estimate_skipped")).map((row) => String(row.new_value.reason));
    assert.equal(reasons.length, 2);
    assert.match(reasons[1], /The QuickBooks estimate is sent, so the website's new figures were not applied/);
  });

  test("a note of a website revision that never happened stops counting: a person's save is a person's", async () => {
    await (await post(request({ estimate: RANGE }))).finish();
    await inHubSpot();
    const estimate = only(estimates.values());
    const stored = only(await storedEstimates());
    // The process stopped after noting the revision it was about to make, and before making it.
    await query(
      "INSERT INTO scope_event (project_id, kind, detail, created_at) VALUES ($1,'site-estimate-synced',$2::jsonb, now() - interval '11 minutes')",
      [stored.project_id, JSON.stringify({ estimateId: stored.id, syncToken: "1", from: "0", state: "expected" })],
    );
    assert.equal(await site.savedByWebsiteOnly(stored.project_id, stored.id, "1"), false);
    await quickBooksChanges(estimate.Id, { PrivateNote: "Called the customer." });
    assert.equal(estimate.SyncToken, "1");
    assert.equal((await leadRow()).stage, "Estimate in Progress", "the person's save moved the lead");
    // And the website does not treat that estimate as its own any more.
    const writes = [...qboWrites];
    await (await post(request({ estimate: { ...RANGE, low: 36000, high: 46000 } }))).finish();
    assert.deepEqual(qboWrites, writes);
    // A confirmed note counts for good; an unconfirmed one only while the write could still be in flight.
    await query("INSERT INTO scope_event (project_id, kind, detail) VALUES ($1,'site-estimate-synced',$2::jsonb)", [stored.project_id, JSON.stringify({ estimateId: stored.id, syncToken: "7", state: "expected" })]);
    assert.equal(await site.savedByWebsiteOnly(stored.project_id, stored.id, "7"), true);
    await query("UPDATE scope_event SET created_at = now() - interval '2 days', detail = detail || '{\"state\":\"done\"}'::jsonb WHERE detail->>'syncToken' = '7'");
    assert.equal(await site.savedByWebsiteOnly(stored.project_id, stored.id, "7"), true);
    assert.equal(await site.savedByWebsiteOnly(stored.project_id, stored.id, "8"), false);
    assert.equal(await site.savedByWebsiteOnly(stored.project_id, stored.id, ""), false);
  });

  test("an estimate changed in QuickBooks without a save P5 has seen is still left alone", async () => {
    await (await post(request({ estimate: RANGE }))).finish();
    const estimate = only(estimates.values());
    // Edited in QuickBooks; the webhook has not arrived, so P5's copy still reads SyncToken 0.
    estimate.Line = estimate.Line.map((l) => (l.Description === "Plumbing" ? { ...l, Amount: 7000, SalesItemLineDetail: { ...l.SalesItemLineDetail!, UnitPrice: 7000 } } : l));
    estimate.TotalAmt = 37000;
    estimate.SyncToken = "1";
    const writes = [...qboWrites];
    await (await post(request({ estimate: { ...RANGE, low: 36000, high: 46000 } }))).finish();
    assert.deepEqual(qboWrites, writes);
    assert.equal(estimate.TotalAmt, 37000, "the person's figures stand");
    assert.equal((await audits("site_estimate_skipped")).length, 1);
  });

  // ---- what is refused -------------------------------------------------------

  test("the ceilings: the lead is saved, nothing reaches QuickBooks, and the lead's audit trail says why", async () => {
    const over = await post(request({ estimate: { kind: "planning-range", low: 5_200_000, high: 6_100_000, verified: true } }));
    assert.equal(over.status, 201, "a lead is never refused for its estimate");
    await over.finish();
    const browser = await post(request({ name: "Sam Other", email: "sam@example.com", phone: "(208) 555-0177", external_id: "req-2", estimate: { kind: "planning-range", low: 600_000, high: 700_000 } }));
    assert.equal(browser.status, 201);
    await browser.finish();
    const malformed = await post(request({ name: "Lee Third", email: "lee@example.com", phone: "(208) 555-0188", external_id: "req-3", estimate: { kind: "planning-range", low: 500, high: 100 } }));
    assert.equal(malformed.status, 201);
    await malformed.finish();

    assert.deepEqual(qboRequests, []);
    assert.deepEqual(await projects(), []);
    const skipped = await audits("site_estimate_skipped");
    assert.deepEqual(skipped.map((row) => row.record_id), ["1", "2", "3"]);
    assert.match(String(skipped[0].new_value.reason), /above the \$5,000,000 ceiling/);
    assert.match(String(skipped[1].new_value.reason), /not verified by the site's server and is above the \$500,000 ceiling/);
    assert.match(String(skipped[2].new_value.reason), /range is reversed/);
    assert.deepEqual(await audits("site_estimate_pending"), []);
    // Verified by the site's server, the same figures are accepted.
    await (await post(request({ name: "Sam Other", email: "sam@example.com", phone: "(208) 555-0177", external_id: "req-2", estimate: { kind: "planning-range", low: 600_000, high: 700_000, verified: true } }))).finish();
    assert.equal(only(estimates.values()).TotalAmt, 650_000);
  });

  test("SITE_ESTIMATE_QBO=off: the lead is saved and nothing else happens", async () => {
    process.env.SITE_ESTIMATE_QBO = "off";
    const posted = await post(request({ estimate: RANGE }));
    assert.equal(posted.status, 201);
    await posted.finish();
    assert.deepEqual(qboRequests, []);
    assert.deepEqual(await projects(), []);
    assert.deepEqual(await audits("site_estimate_pending"), []);
    assert.match(String((await audits("site_estimate_skipped"))[0].new_value.reason), /switched off/);
    assert.deepEqual(await site.settleSiteEstimates(), { attempted: 0, finished: 0 });
  });

  test("the guided estimator's own post never makes a second estimate through the intake", async () => {
    // The guided estimator posts with skipLeadAlert and writes its own QuickBooks estimate.
    const posted = await post(request({ form: "Online estimator", external_id: "guided-token", estimate: RANGE }), { skipLeadAlert: true });
    assert.equal(posted.status, 201);
    await posted.finish();
    assert.deepEqual(qboRequests, []);
    assert.deepEqual(await projects(), []);
    assert.deepEqual(await audits("site_estimate_created"), []);
  });

  test("nothing is made for a closed lead, and what a person removed is not made again from the same figures", async () => {
    await (await post(request({ estimate: RANGE }))).finish();
    const estimate = only(estimates.values());
    const readEstimate = (await import("../app/lib/leads/intakeContract.ts")).readSiteEstimate;

    // A person deletes the estimate in QuickBooks on a lead that is being worked: the lead stays.
    await query("UPDATE deal SET stage='Contacting', first_attempt_at=now() WHERE id=1");
    estimate.deleted = true;
    await scopes.onEstimateDeleted(estimate.Id);
    assert.equal((await leadRow()).stage, "Contacting");
    const writes = [...qboWrites];
    const same = await site.createSiteEstimate({ dealId: 1, brand: "Boise Remodeling Co", estimate: readEstimate(RANGE).estimate! });
    assert.equal(same.status, "unchanged");
    assert.match(same.reason!, /deleted in QuickBooks and is not made again from the same figures/);
    assert.deepEqual(qboWrites, writes);

    // New figures from the customer are a new estimate: one is made, as the website makes them.
    const fresh = await site.createSiteEstimate({ dealId: 1, brand: "Boise Remodeling Co", estimate: readEstimate({ ...RANGE, low: 36000, high: 46000 }).estimate! });
    assert.equal(fresh.status, "created");
    assert.equal([...estimates.values()].filter((e) => !e.deleted).length, 1);
    assert.equal((await projects()).length, 1, "on the same project");
    assert.equal(customers.size, 1, "and the same customer");

    // The whole project removed by a person: the same figures do not bring it back.
    const live = [...estimates.values()].find((e) => !e.deleted)!;
    const { getProject } = await import("../app/lib/scopes/store.ts");
    await scopes.deleteProjectEverywhere((await getProject(1))!, null as never);
    assert.equal(live.deleted, true);
    const removed = await site.createSiteEstimate({ dealId: 1, brand: "Boise Remodeling Co", estimate: readEstimate({ ...RANGE, low: 36000, high: 46000 }).estimate! });
    assert.equal(removed.status, "unchanged");
    assert.match(removed.reason!, /removed earlier and is not made again/);
    assert.equal((await projects()).length, 1);

    // A closed lead gets nothing, whatever the figures.
    await query("UPDATE deal SET stage='Closed Lost', closed_lost_reason='Went elsewhere', closed_at=now() WHERE id=1");
    const closed = await site.createSiteEstimate({ dealId: 1, brand: "Boise Remodeling Co", estimate: readEstimate({ ...RANGE, low: 20000, high: 60000 }).estimate! });
    assert.equal(closed.status, "skipped");
    assert.match(closed.reason!, /The lead is closed \(Closed Lost, Went elsewhere\)/);
    assert.equal((await projects()).length, 1);
    assert.equal([...estimates.values()].filter((e) => !e.deleted).length, 0);
  });

  // ---- QuickBooks unavailable ------------------------------------------------

  test("QuickBooks not connected: remembered on the lead and made by the watchdog's retry, six hours on", async () => {
    await query("DELETE FROM qbo_connection");
    const posted = await post(request({ estimate: RANGE }));
    assert.equal(posted.status, 201);
    await posted.finish();
    assert.deepEqual(qboRequests, []);
    assert.deepEqual(await projects(), [], "nothing is half made");
    const [pending] = await audits("site_estimate_pending");
    assert.deepEqual([pending.record_id, pending.succeeded, pending.error], ["1", false, "QuickBooks is not connected."]);
    // What the retry needs is in the note: the estimate, and no person's details.
    const remembered = pending.new_value.input as { estimate: { base: number; lines: unknown[] }; brand: string };
    assert.deepEqual([remembered.estimate.base, remembered.estimate.lines.length, remembered.brand], [36000, 4, "Boise Remodeling Co"]);
    assert.doesNotMatch(JSON.stringify(pending.new_value), /pat@example\.com|555-0142|Pat Example/);

    await connectQuickBooks();
    assert.deepEqual(await site.settleSiteEstimates(), { attempted: 0, finished: 0 }, "not retried at once");
    await age(7);
    assert.deepEqual(await site.settleSiteEstimates(), { attempted: 1, finished: 1 });
    assert.equal(only(estimates.values()).TotalAmt, 36000);
    assert.equal(only(customers.values()).DisplayName, "Pat Example", "the person is read from the lead");
    assert.equal(only(await projects()).project_address, "123 N Main St, Boise, 83702");
    assert.equal((await audits("site_estimate_created")).length, 1);
    assert.ok((await audits("site_estimate_pending")).every((row) => row.succeeded), "the note is settled");
    await age(7);
    assert.deepEqual(await site.settleSiteEstimates(), { attempted: 0, finished: 0 });
  });

  test("QuickBooks failing part way: the retry finishes it with the same customer and one estimate", async () => {
    estimateCreateDown = true;
    await (await post(request({ estimate: RANGE }))).finish();
    assert.equal(customers.size, 1, "the customer was made");
    assert.equal(estimates.size, 0);
    assert.equal((await audits("site_estimate_pending")).length, 1);
    assert.deepEqual(await audits("site_estimate_created"), []);

    // Still failing six hours on: another note, another wait.
    await age(7);
    assert.deepEqual(await site.settleSiteEstimates(), { attempted: 1, finished: 0 });
    assert.equal(estimates.size, 0);
    assert.deepEqual(await site.settleSiteEstimates(), { attempted: 0, finished: 0 });

    estimateCreateDown = false;
    await age(7);
    assert.deepEqual(await site.settleSiteEstimates(), { attempted: 1, finished: 1 });
    assert.equal(customers.size, 1, "never a second customer");
    assert.equal(only(estimates.values()).TotalAmt, 36000);
    assert.equal((await projects()).length, 1);
    assert.equal((await versions(1)).length, 1);
    assert.equal((await audits("site_estimate_created")).length, 1);

    // Given up after a fortnight: a person enters it by hand.
    await query("DELETE FROM qbo_connection");
    await (await post(request({ name: "Sam Other", email: "sam@example.com", phone: "(208) 555-0177", external_id: "req-2", estimate: RANGE }))).finish();
    await age(15 * 24);
    await connectQuickBooks();
    assert.deepEqual(await site.settleSiteEstimates(), { attempted: 0, finished: 0 });
    assert.equal(estimates.size, 1);
  });

  test("every QuickBooks request failing never fails the intake or the caller", async () => {
    qboDown = true;
    const posted = await post(request({ estimate: RANGE }));
    assert.equal(posted.status, 201);
    await assert.doesNotReject(posted.finish());
    assert.equal(sent.length, 1, "the team email went");
    const outcome = await site.createSiteEstimate({ dealId: 1, estimate: (await import("../app/lib/leads/intakeContract.ts")).readSiteEstimate(RANGE).estimate! });
    assert.equal(outcome.status, "pending");
    assert.equal((await audits("site_estimate_pending")).length, 2);
    // A lead that does not exist, an estimate that is not one: an answer, never a throw.
    assert.equal((await site.createSiteEstimate({ dealId: 999, estimate: (await import("../app/lib/leads/intakeContract.ts")).readSiteEstimate(RANGE).estimate! })).status, "skipped");
    assert.equal((await site.createSiteEstimate({ dealId: 1, estimate: { kind: "nonsense" } as never })).status, "skipped");
    assert.equal((await site.createSiteEstimate({ dealId: 0, estimate: null as never })).status, "skipped");
  });

  test("a caller that cannot wait is answered, the work is noted as pending, and it still finishes", async () => {
    await (await post(request())).finish();
    let release!: () => void;
    qboGate = new Promise<void>((resolve) => { release = resolve; });
    const estimate = (await import("../app/lib/leads/intakeContract.ts")).readSiteEstimate(RANGE).estimate!;
    const started = Date.now();
    const outcome = await site.createSiteEstimate({ dealId: 1, brand: "Boise Remodeling Co", estimate }, { waitMs: 60 });
    assert.equal(outcome.status, "pending");
    assert.ok(Date.now() - started < 2000, "the caller was not held by QuickBooks");
    assert.match(String((await audits("site_estimate_pending"))[0].error), /Still writing to QuickBooks/);
    // QuickBooks answers after all: the estimate is made once and the note is settled.
    qboGate = null;
    release();
    await site.siteEstimatesSettled();
    assert.equal(only(estimates.values()).TotalAmt, 36000);
    assert.equal(customers.size, 1);
    assert.ok((await audits("site_estimate_pending")).every((row) => row.succeeded));
    await age(7);
    assert.deepEqual(await site.settleSiteEstimates(), { attempted: 0, finished: 0 });
  });

  test("a brand site that waits for the team email is answered first; QuickBooks comes after, and Step 2 can change the figures", async () => {
    const posted = await post(request({ team_alert: "confirm", estimate: RANGE }));
    assert.equal(posted.status, 201);
    assert.equal(posted.json.alert, "sent", "the team email went before the answer");
    assert.deepEqual(qboRequests, [], "and QuickBooks had not been touched");
    assert.equal(posted.tasks.length, 1, "only the QuickBooks work is left for after the response");
    await posted.finish();
    assert.equal(only(estimates.values()).TotalAmt, 36000);

    // Step 2 for the same request, with the visitor's changed selections: the same estimate, revised.
    const details = await post({ brand: "Boise Remodeling Co", submission_kind: "details", external_id: "req-1", timeline: "Soon", estimate: { ...RANGE, low: 36000, high: 46000, lines: [...LINES.slice(0, 3), { title: "Plumbing", amount: 10500, division: "PLUMBING" }] } });
    assert.equal(details.json.merged, true);
    await details.finish();
    assert.equal(only(estimates.values()).TotalAmt, 40500);
    assert.equal((await projects()).length, 1);
    assert.equal(only(customers.values()).DisplayName, "Pat Example", "Step 2 carried no name: the person is read from the lead");
    assert.equal((await leadRow()).stage, "New Lead");
  });

  // ---- the document estimator -----------------------------------------------

  const documentRecord = (extra: Json = {}): Json => ({
    draftId: "12345678-1234-4123-8123-123456789abc",
    revision: 3,
    brand: "P5 Home Co",
    contact: { name: "Dana Document", email: "dana@example.com", phone: "(208) 555-0155" },
    attribution: {},
    scope: { instructions: "Install trim and paint it", answers: { service: "installation", address: "77 W Idaho St", location: "Boise" } },
    customer: { summary: "Install 120 LF of trim and paint it", range: { low: 3000, high: 3600 } },
    internal: {
      contractPrice: 3333.335,
      directCost: 2100, contingency: 210, operatingProfit: 360,
      lines: [
        { id: "a", description: "Install owner-supplied trim", quantity: 120, unit: "LF", trade: "Trim & Finish Carpentry", category: "field-labor", sellingAmount: 1111.1117, sellingUnitPrice: 9.2593, cost: 700, unitCost: 5.83, operatingProfit: 120, overheadRecovery: 200, contingency: 70, riskAdjustedCost: 770 },
        { id: "b", description: "Paint new trim", quantity: 1, unit: "LS", trade: "Painting", category: "subcontractors", sellingAmount: 2222.2233, cost: 1400, operatingProfit: 240 },
      ],
    },
    ...extra,
  });

  test("the document estimator: its lead gets a customer and an unsent estimate from the customer amounts", async () => {
    const dealId = Number(await syncCrm(documentRecord(), "p5-draft-key-1"));
    await site.siteEstimatesSettled();
    assert.equal(dealId, 1);
    const customer = only(customers.values());
    assert.equal(customer.DisplayName, "Dana Document");
    const estimate = only(estimates.values());
    assert.equal(estimate.EmailStatus, "NotSet");
    assert.equal(estimate.TotalAmt, 3333.34, "the contract price, to the cent");
    assert.deepEqual(sales(estimate).map((l) => [l.Description, l.SalesItemLineDetail?.ItemRef?.name]).sort(), [["Install owner-supplied trim (120 LF)", "Subcontractor Work"], ["Paint new trim", "Subcontractor Work"]]);
    assert.ok(estimate.Line.some((l) => l.Description === "DIVISION 06 WOOD & CARPENTRY") && estimate.Line.some((l) => l.Description === "DIVISION 09 FINISHES"));
    assert.match(estimate.CustomerMemo!.value, /Preliminary range given online: \$3,000 to \$3,600\. The total on this estimate \(\$3,333\)/);
    assert.match(estimate.CustomerMemo!.value, /Document estimator on P5 Home Co\. Figures verified by the site's server\./);
    const project = only(await projects());
    assert.deepEqual([project.lead_deal_id, project.client_first_name, project.client_last_name, project.project_address], [1, "Dana", "Document", "77 W Idaho St, Boise"]);
    const [created] = await audits("site_estimate_created");
    assert.deepEqual([created.new_value.kind, created.new_value.total, created.new_value.verified], ["document", 3333.34, true]);
    assert.match(String(created.new_value.from), /Document estimator draft 12345678-1234-4123-8123-123456789abc, revision 3/);
    assert.equal((await leadRow()).stage, "New Lead");

    // The same record delivered again: nothing more.
    const writes = [...qboWrites];
    await syncCrm(documentRecord(), "p5-draft-key-1");
    await site.siteEstimatesSettled();
    assert.deepEqual(qboWrites, writes);
    assert.equal((await projects()).length, 1);

    // A record whose customer was shown no price makes a lead and no estimate.
    await syncCrm(documentRecord({ draftId: "22345678-1234-4123-8123-123456789abc", contact: { name: "Noel Noprice", email: "noel@example.com", phone: "" }, customer: { summary: "Held for review" } }), "p5-draft-key-2");
    await site.siteEstimatesSettled();
    assert.equal(estimates.size, 1);
    assert.equal((await projects()).length, 1);
  });

  test("a QA record from the document estimator never reaches QuickBooks", async () => {
    await syncCrm(documentRecord({ contact: { name: "[QA] Acceptance", email: "qa@example.invalid", phone: "" } }), "p5-draft-key-qa");
    await site.siteEstimatesSettled();
    assert.deepEqual(qboRequests, []);
    assert.deepEqual(await projects(), []);
    // Even asked directly, a test lead is refused.
    const outcome = await site.createSiteEstimateFromDocument(documentRecord({ contact: { name: "[QA] Acceptance", email: "qa@example.invalid", phone: "" } }), 1);
    assert.equal(outcome.status, "skipped");
    assert.match(outcome.reason!, /test lead is never written to QuickBooks/);
    assert.deepEqual(qboRequests, []);
  });

  // ---- beside the guided estimator, the stage rules and the deletion rules -----

  /** A guided-estimator estimate for the lead, exactly as the online estimator leaves it. */
  async function guidedEstimateFor(leadId: number, qboEstimateId: string, customerId: string): Promise<number> {
    const [project] = await query<{ id: number }>("INSERT INTO scope_project (title, qbo_customer_id, qbo_customer_name) VALUES ('Guided estimate',$1,'Test customer') RETURNING id::int AS id", [customerId]);
    const [version] = await query<{ id: number }>("INSERT INTO scope_version (project_id, version_no, source, doc) VALUES ($1,1,'online-estimator','{}'::jsonb) RETURNING id::int AS id", [project.id]);
    await query("UPDATE scope_project SET current_version_id=$2 WHERE id=$1", [project.id, version.id]);
    const lines: Line[] = [{ DetailType: "SalesItemLineDetail", Description: "Cabinets", Amount: 1000, SalesItemLineDetail: { ItemRef: { value: "701" }, Qty: 1, UnitPrice: 1000 } }];
    const live: Estimate = { Id: qboEstimateId, SyncToken: "0", TxnStatus: "Pending", EmailStatus: "NotSet", TotalAmt: 1000, DocNumber: `10${qboEstimateId}`, CustomerRef: { value: customerId }, Line: lines };
    estimates.set(qboEstimateId, live);
    await query(
      `INSERT INTO scope_estimate (project_id, version_id, qbo_estimate_id, doc_number, sync_token, txn_status, email_status, total, sent_payload, qbo_snapshot)
       VALUES ($1,$2,$3,$4,'0','Pending','NotSet',1000,$5::jsonb,$6::jsonb)`,
      [project.id, version.id, qboEstimateId, live.DocNumber, JSON.stringify({ Line: lines }), JSON.stringify(live)],
    );
    await query(
      `INSERT INTO guided_estimate (token, brand, client_key, project, tier, answers, first_name, last_name, email, phone,
         estimate_class, total, customer_view, internal_report, rules_version, cost_book_version, scope_project_id, scope_version_id, lead_deal_id)
       VALUES ($1,'remodeling',$1,'kitchen-remodel','mid','{}'::jsonb,'Pat','Example','pat@example.com','2085550142',
         'preliminary',1000,'{}'::jsonb,'{}'::jsonb,'r','c',$2,$3,$4)`,
      [`token-${qboEstimateId}-${"x".repeat(24)}`, project.id, version.id, leadId],
    );
    return project.id;
  }

  test("a lead that already has a guided estimate gets its site estimate as a separate project", async () => {
    await (await post(request())).finish();
    customers.set("34", { Id: "34", SyncToken: "0", Active: true, Balance: 0, DisplayName: "Pat Example", PrimaryEmailAddr: { Address: "pat@example.com" } });
    const guided = await guidedEstimateFor(1, "90", "34");
    const estimate = (await import("../app/lib/leads/intakeContract.ts")).readSiteEstimate(RANGE).estimate!;
    const outcome = await site.createSiteEstimate({ dealId: 1, brand: "Boise Remodeling Co", estimate });
    assert.equal(outcome.status, "created");
    assert.notEqual(outcome.projectId, guided);
    assert.equal(estimates.size, 2, "they are different estimates");
    assert.equal(estimates.get("90")!.TotalAmt, 1000, "the guided estimate is not touched");
    assert.equal(estimates.get(outcome.qboEstimateId!)!.CustomerRef.value, "34", "on the same QuickBooks customer, matched by email");
    assert.equal(customers.size, 1);
    assert.deepEqual(await links.projectsForLead(1), [guided, outcome.projectId].sort((a, b) => a! - b!));
    assert.deepEqual((await links.estimatesForLead(1)).map((e) => e.source), ["online-estimator", "site-estimate"]);
    assert.equal((await leadRow()).stage, "New Lead");
    // A lead won with two open estimates writes nothing and asks a person, as the stage rules say.
    await query("UPDATE deal SET stage='Closed Won', closed_at=now() WHERE id=1");
    const closed = await alignment.alignQuickBooksWithClosedLead(1);
    assert.deepEqual(closed.set, []);
    assert.equal((await audits("quickbooks_estimate_choice_needed")).length, 1);
  });

  test("stage alignment reaches a site estimate: created moves nothing, sent and accepted move the lead", async () => {
    await (await post(request({ estimate: RANGE }))).finish();
    await inHubSpot();
    const estimate = only(estimates.values());
    assert.equal((await leadRow()).stage, "New Lead");
    // QuickBooks reports the estimate again, unchanged (the daily sync): still nothing.
    await sync.upsertTxn("Estimate", estimate as never);
    await alignment.stageAlignmentSettled();
    assert.equal((await leadRow()).stage, "New Lead");
    assert.deepEqual(await audits("stage_aligned_with_quickbooks"), []);
    // A person sends it from QuickBooks, then the customer accepts.
    await quickBooksChanges(estimate.Id, { EmailStatus: "EmailSent" });
    assert.equal((await leadRow()).stage, "Estimate Sent");
    await quickBooksChanges(estimate.Id, { TxnStatus: "Accepted" });
    assert.equal((await leadRow()).stage, "Closed Won");
  });

  test("a lead closed as lost rejects its open site estimate in QuickBooks", async () => {
    await (await post(request({ estimate: RANGE }))).finish();
    const estimate = only(estimates.values());
    await query("UPDATE deal SET stage='Closed Lost', closed_lost_reason='Went elsewhere', closed_at=now() WHERE id=1");
    const outcome = await alignment.alignQuickBooksWithClosedLead(1);
    assert.equal(outcome.pending, null);
    assert.equal(estimate.TxnStatus, "Rejected");
  });

  test("the HubSpot deal deleted: the site estimate is deleted in QuickBooks and its unused customer retired", async () => {
    await (await post(request({ estimate: RANGE }))).finish();
    await inHubSpot();
    const estimate = only(estimates.values());
    const customer = only(customers.values());
    hubDeals.get("100")!.archived = true;
    await pull(new Date());
    assert.equal((await leadRow()).closed_lost_reason, "Removed in HubSpot");
    assert.equal(estimate.deleted, true);
    assert.equal(customer.Active, false);
    assert.deepEqual(qboWrites.slice(-2), [`DELETE estimate/${estimate.Id}`, `UPDATE customer/${customer.Id} Active=false`]);
    assert.ok(only(await projects()).deleted_at, "the scope project leaves the list");
    assert.equal((await audits("quickbooks_removed_with_hubspot_deal")).length, 1);
    assert.deepEqual(hubWrites, [], "nothing is written back to HubSpot");
    // The same figures arriving again do not bring it back: the lead is closed.
    const again = await site.createSiteEstimate({ dealId: 1, estimate: (await import("../app/lib/leads/intakeContract.ts")).readSiteEstimate(RANGE).estimate! });
    assert.equal(again.status, "skipped");
    assert.equal([...estimates.values()].filter((e) => !e.deleted).length, 0);
  });

  test("the site estimate deleted in QuickBooks: an untouched lead's HubSpot deal is removed", async () => {
    await (await post(request({ estimate: RANGE }))).finish();
    await inHubSpot();
    const estimate = only(estimates.values());
    estimate.deleted = true;
    await scopes.onEstimateDeleted(estimate.Id);
    assert.deepEqual(hubWrites, ["DELETE deals/100", "DELETE contacts/200"]);
    const lead = await leadRow();
    assert.deepEqual([lead.stage, lead.closed_lost_reason], ["Closed Lost", "Removed in QuickBooks"]);
    assert.ok(only(await projects()).deleted_at);
    assert.equal(only(customers.values()).Active, false, "the customer it made is retired too");
  });

  test("a site estimate deleted in QuickBooks on a lead someone is working leaves HubSpot alone", async () => {
    await (await post(request({ estimate: RANGE }))).finish();
    await inHubSpot();
    await query("UPDATE deal SET stage='Contacting', first_attempt_at=now() WHERE id=1");
    const estimate = only(estimates.values());
    estimate.deleted = true;
    await scopes.onEstimateDeleted(estimate.Id);
    assert.deepEqual(hubWrites, []);
    assert.equal((await leadRow()).stage, "Contacting");
    assert.equal(only(await projects()).deleted_at, null);
  });
});
