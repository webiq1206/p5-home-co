import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe("HubSpot lead alert task lifecycle", { skip: TEST_DB ? false : "TEST_DATABASE_URL not set" }, () => {
  let query: typeof import("../app/lib/db.ts").query;
  let getPool: typeof import("../app/lib/db.ts").getPool;
  let watchdog: typeof import("../app/lib/leads/watchdog.ts").runWatchdog;
  let sync: typeof import("../app/lib/integrations/hubspot-tasks.ts").syncHubSpotAlertTasks;
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.HUBSPOT_TOKEN;
  const originalEmails = process.env.P5_LEAD_ALERT_EMAILS_ENABLED;
  const now = new Date("2026-09-07T21:00:00Z");
  const received = new Date("2026-09-04T16:00:00Z");
  let remote: Record<string, string>;
  let tasks: { id: string; properties: Record<string, string>; associations: unknown[] }[];
  let creates: number;
  let mode: "normal" | "lost_response" | "forbidden";
  let searchHidden: boolean;
  let writes: { method: string; url: string; body: unknown }[];

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.HUBSPOT_TOKEN = "isolated-test-token";
    delete process.env.P5_LEAD_ALERT_EMAILS_ENABLED;
    ({ query, getPool } = await import("../app/lib/db.ts"));
    ({ runWatchdog: watchdog } = await import("../app/lib/leads/watchdog.ts"));
    ({ syncHubSpotAlertTasks: sync } = await import("../app/lib/integrations/hubspot-tasks.ts"));
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
      if (url.includes("/crm/v3/owners/")) return json({ results: [{ id: "55", email: "hello@p5homeco.com", archived: false }] });
      if (url.includes("/labels")) return json({ results: [{ category: "HUBSPOT_DEFINED", label: null, typeId: url.includes("/deals/") ? 216 : 204 }] });
      if (url.includes("/tasks/search")) {
        const subject = body.filterGroups[0].filters[0].value;
        const found = searchHidden ? [] : tasks.filter((t) => t.properties.hs_task_subject === subject);
        return json({ total: found.length, results: found });
      }
      if (/\/deals\/\d+\?/.test(url)) return json({ properties: remote });
      if (method === "POST" && url.endsWith("/tasks")) {
        creates++;
        if (mode === "forbidden") return json({}, 403);
        const task = { id: String(1000 + creates), ...body };
        tasks.push(task);
        writes.push({ method, url, body });
        if (mode === "lost_response") throw new Error("connection lost after provider accepted task");
        return json(task);
      }
      const id = /\/tasks\/(\d+)/.exec(url)?.[1];
      const task = tasks.find((t) => t.id === id);
      if (task && method === "GET") return json(task);
      if (task && method === "PATCH") {
        writes.push({ method, url, body });
        Object.assign(task.properties, body.properties);
        return json(task);
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
    tasks = []; creates = 0; mode = "normal"; searchHidden = false; writes = [];
    remote = { dealstage: "appointmentscheduled", hubspot_owner_id: "55" };
    await query("TRUNCATE deal,contact,app_user,alert,lead_alert_incident,task,activity,audit_log,job_run,job_lock,setting RESTART IDENTITY CASCADE");
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

  test("unchanged issues and repeated passes create one associated manager task, without emails", async () => {
    const first = await watchdog(now);
    assert.equal(first.status, "succeeded", first.error);
    assert.equal(first.hubspotTasksCreated, 1);
    for (let i = 1; i <= 6; i++) {
      const again = await watchdog(new Date(now.getTime() + i * 1_800_000));
      assert.equal(again.hubspotTasksCreated, 0);
      assert.equal(again.notificationsSent, 0);
    }
    assert.equal(creates, 1);
    assert.equal(tasks[0].properties.hubspot_owner_id, "55");
    assert.equal(tasks[0].associations.length, 2);
    assert.equal(tasks[0].properties.hs_task_reminders, undefined);
  });

  test("HubSpot completion acknowledges all related alerts without fabricating contact", async () => {
    await watchdog(now);
    tasks[0].properties.hs_task_status = "COMPLETED";
    await watchdog(new Date(now.getTime() + 300_000));
    await watchdog(new Date(now.getTime() + 3_600_000));
    assert.equal(creates, 1);
    const open = await query("SELECT id FROM alert WHERE resolved_at IS NULL AND acknowledged_at IS NULL");
    assert.equal(open.length, 0);
    const [d] = await query("SELECT first_attempt_at FROM deal WHERE id=1");
    assert.equal(d.first_attempt_at, null);
    assert.equal(writes.filter((w) => w.method === "PATCH").length, 0);
  });

  test("a real local outcome completes the task and a genuinely new overdue commitment creates another", async () => {
    await watchdog(now);
    const next = new Date(now.getTime() + 3_600_000);
    await query("UPDATE deal SET first_attempt_at=$1,next_action='Send estimate',next_action_at=$2 WHERE id=1", [now, next]);
    await query("INSERT INTO activity (deal_id,kind,occurred_at,is_human_attempt) VALUES (1,'call',$1,TRUE)", [now]);
    await watchdog(new Date(now.getTime() + 300_000));
    assert.equal(tasks[0].properties.hs_task_status, "COMPLETED");
    await watchdog(new Date(next.getTime() + 300_000));
    assert.equal(creates, 2);
  });

  test("closing the deal with a reason in HubSpot stops tasks and updates local state", async () => {
    await watchdog(now);
    remote.dealstage = "closedlost";
    remote.closed_lost_reason = "Project cancelled";
    await watchdog(new Date(now.getTime() + 300_000));
    await watchdog(new Date(now.getTime() + 3_600_000));
    assert.equal(creates, 1);
    assert.equal(tasks[0].properties.hs_task_status, "COMPLETED");
  });

  test("a lost creation response never causes a duplicate, including while search indexing lags", async () => {
    mode = "lost_response";
    await watchdog(now);
    assert.equal(creates, 1);
    mode = "normal"; searchHidden = true;
    const uncertain = await sync(now);
    assert.equal(uncertain.failed, 1);
    assert.equal(creates, 1);
    searchHidden = false;
    await sync(now);
    assert.equal(creates, 1);
    const [incident] = await query("SELECT hubspot_task_id,last_error FROM lead_alert_incident");
    assert.equal(incident.hubspot_task_id, tasks[0].id);
    assert.equal(incident.last_error, null);
  });

  test("a definitive permission rejection can retry after access is fixed", async () => {
    mode = "forbidden";
    const first = await watchdog(now);
    assert.equal(first.hubspotTasksFailed, 1);
    assert.equal(tasks.length, 0);
    mode = "normal";
    await sync(now);
    assert.equal(tasks.length, 1);
  });

  test("all five websites use the same task lifecycle", async () => {
    const brands = ["Boise Construction Co", "Boise Remodeling Co", "Boise Cabinet Co", "Boise Handyman Co"];
    for (const [i, brand] of brands.entries()) {
      await query(
        `INSERT INTO deal (contact_id,name,brand,lead_source,stage,owner_user_id,received_at,
         next_action,next_action_at,hubspot_deal_id,integration_sync_status)
         VALUES (1,$1,$2,'Organic Website','New Lead',1,$3,'Make first contact',$3::timestamptz+interval '5 minutes',$4,'synced')`,
        [`${brand} inquiry`, brand, received, String(101 + i)],
      );
    }
    await watchdog(now);
    await watchdog(now);
    assert.equal(creates, 5);
    assert.equal(new Set(tasks.map((t) => t.properties.hs_task_subject)).size, 5);
  });

  test("overlapping task sync workers cannot both claim a create", async () => {
    mode = "forbidden";
    await watchdog(now);
    mode = "normal";
    const before = creates;
    await Promise.all([sync(now), sync(now)]);
    assert.equal(creates - before, 1);
    assert.equal(tasks.length, 1);
  });

  test("HubSpot follow-up changes are read before evaluating a new missed deadline", async () => {
    await watchdog(now);
    const due = new Date(now.getTime() + 3_600_000);
    remote.p5_first_attempt_at = now.toISOString();
    remote.p5_next_action = "Call with estimate";
    remote.p5_next_action_at = due.toISOString();
    remote.dealstage = "qualifiedtobuy";
    await watchdog(new Date(now.getTime() + 300_000));
    assert.equal(tasks[0].properties.hs_task_status, "COMPLETED");
    const [d] = await query("SELECT stage,next_action FROM deal WHERE id=1");
    assert.equal(d.stage, "Contacting");
    assert.equal(d.next_action, "Call with estimate");
    await watchdog(new Date(due.getTime() + 300_000));
    assert.equal(creates, 2);
  });
});
