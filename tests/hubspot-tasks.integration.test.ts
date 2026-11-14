import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe("HubSpot lead alert task lifecycle", { skip: TEST_DB ? false : "TEST_DATABASE_URL not set" }, () => {
  let pending: typeof import("../app/lib/integrations/hubspot.ts").syncPendingDeals;
  let push: typeof import("../app/lib/integrations/hubspot.ts").syncDealToHubSpot;
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
  let mode: "normal" | "lost_response" | "forbidden" | "invalid_email" | "archived_contact" | "successful_push";
  let searchHidden: boolean;
  let missingDeal: boolean;
  let missingTask: boolean;
  let archivedDeal: boolean;
  let archivedTask: boolean;
  let archivedReads: number;
  let providerRequests: number;
  let errorProperty: string;
  let legacyValidation: boolean;
  let writes: { method: string; url: string; body: unknown }[];

  before(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.HUBSPOT_TOKEN = "isolated-test-token";
    delete process.env.P5_LEAD_ALERT_EMAILS_ENABLED;
    ({ syncDealToHubSpot: push, syncPendingDeals: pending } = await import("../app/lib/integrations/hubspot.ts"));
    ({ query, getPool } = await import("../app/lib/db.ts"));
    ({ runWatchdog: watchdog } = await import("../app/lib/leads/watchdog.ts"));
    ({ syncHubSpotAlertTasks: sync } = await import("../app/lib/integrations/hubspot-tasks.ts"));
    globalThis.fetch = async (input, init) => {
      providerRequests++;
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
      if (mode==="successful_push" && url.includes("/contacts/200")) return json({id:"200",archived:false,properties:{hubspot_owner_id:"55"}});
      if (mode==="successful_push" && url.endsWith("/deals/100") && method==="PATCH") return json({id:"100"});
      if (mode==="successful_push" && url.includes("/associations/contacts/200") && method==="PUT") return json({});
      if (url.includes("/crm/v3/properties/deals")) return json({results:[]});
      if (url.includes("/contacts/search")) return json({total:0,results:[]});
      if (url.endsWith("/contacts") && method === "POST" && mode === "invalid_email") return json(legacyValidation ? {message:'Property values were not valid: '+JSON.stringify([{isValid:false,error:"INVALID_EMAIL",name:errorProperty,message:"Redacted fixture",details:[]}])} : {errors:[{code:"INVALID_EMAIL",context:{propertyName:[errorProperty]}}]},400);
      if (url.includes("/contacts/200") && mode === "archived_contact") return url.includes("archived=true") ? json({id:"200",archived:true}) : json({},404);
      if (url.includes("/account-info/v3/details")) return json({ portalId: 247066159 });
      if (url.includes("/crm/v3/owners/")) return json({ results: [{ id: "55", email: "hello@p5homeco.com", archived: false }] });
      if (url.includes("/labels")) return json({ results: [{ category: "HUBSPOT_DEFINED", label: null, typeId: url.includes("/deals/") ? 216 : 204 }] });
      if (url.includes("/tasks/search")) {
        const subject = body.filterGroups[0].filters[0].value;
        const found = searchHidden ? [] : tasks.filter((t) => t.properties.hs_task_subject === subject);
        return json({ total: found.length, results: found });
      }
      if (/\/deals\/\d+\?/.test(url)) {
        if (url.includes("archived=true")) { archivedReads++; return archivedDeal ? json({ archived: true, properties: remote }) : json({}, 404); }
        return missingDeal ? json({}, 404) : json({ archived: false, properties: remote });
      }
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
      if (task && method === "GET") {
        if (url.includes("archived=true")) { archivedReads++; return archivedTask ? json({ ...task, archived: true }) : json({}, 404); }
        return missingTask ? json({}, 404) : json({ ...task, archived: false });
      }
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
    missingDeal = false; missingTask = false; archivedDeal = false; archivedTask = false; archivedReads = 0; providerRequests = 0; errorProperty = "email"; legacyValidation = false;
    tasks = []; creates = 0; mode = "normal"; searchHidden = false; writes = [];
    remote = { dealstage: "appointmentscheduled", hubspot_owner_id: "55" };
    await query("TRUNCATE hubspot_lead_review,lead_hubspot_retry,hubspot_archive_review,deal,contact,app_user,alert,lead_alert_incident,task,activity,audit_log,job_run,job_lock,setting RESTART IDENTITY CASCADE");
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

  test("provider-confirmed invalid email holds exact rejected input without losing lead", async () => {
    mode = "invalid_email";
    await query("UPDATE contact SET hubspot_contact_id=NULL");
    await query("UPDATE deal SET hubspot_deal_id=NULL,integration_sync_status='pending'");
    const first=await push(1);
    assert.equal(first.status,"failed");
    const [review]=await query("SELECT * FROM hubspot_lead_review");
    assert.equal(review.reason,"invalid_email");
    assert.equal(review.input_fingerprint.includes("test@example.com"),false);
    const requests=providerRequests;
    assert.equal((await push(1)).status,"skipped");
    assert.equal(providerRequests,requests);
    const [contact]=await query("SELECT email FROM contact WHERE id=1");
    assert.equal(contact.email,"test@example.com");
    await query("UPDATE contact SET email='corrected@example.com' WHERE id=1");
    assert.equal((await push(1)).status,"failed"); // Fake provider rejects again, creating a new evidence-backed hold.
    assert.ok(providerRequests>requests);
    const [newReview]=await query("SELECT input_fingerprint FROM hubspot_lead_review");
    assert.notEqual(newReview.input_fingerprint,review.input_fingerprint);
  });

  test("confirmed archived contact holds delivery without PATCH, replacement or reference clearing", async () => {
    mode="archived_contact";
    await query("UPDATE deal SET hubspot_deal_id=NULL,integration_sync_status='pending'");
    assert.equal((await push(1)).status,"failed");
    const [review]=await query("SELECT reason,remote_contact_id FROM hubspot_lead_review");
    assert.equal(review.reason,"archived_contact");
    assert.equal(review.remote_contact_id,"200");
    const requests=providerRequests;
    assert.equal((await push(1)).status,"skipped");
    assert.equal(providerRequests,requests);
    const [contact]=await query("SELECT hubspot_contact_id FROM contact WHERE id=1");
    assert.equal(contact.hubspot_contact_id,"200");
    assert.equal(writes.length,0);
  });

  test("review queue stays non-green when all pending leads are held; unchanged input cannot release", async () => {
    const {holdLeadReview,HubSpotLeadReviewError,heldLeadReview}=await import("../app/lib/integrations/hubspot-lead-review.ts");
    await query("UPDATE deal SET integration_sync_status='failed'");
    await holdLeadReview(1,new HubSpotLeadReviewError("invalid_email"),"test@example.com");
    const requests=providerRequests;
    await pending();
    assert.equal(providerRequests,requests);
    const [health]=await query("SELECT state,last_error FROM integration_health WHERE name='hubspot'");
    assert.equal(health.state,"failed");
    assert.match(health.last_error,/require review/);
    assert.equal(await heldLeadReview(1,null),true);
    assert.equal(await heldLeadReview(1,"still-invalid"),true);
    assert.equal(await heldLeadReview(1,"test@example.com"),true);
  });

  test("archived contact restores only on verified active read and retains original references", async () => {
    const {holdLeadReview,HubSpotLeadReviewError,recheckLeadReviews}=await import("../app/lib/integrations/hubspot-lead-review.ts");
    await holdLeadReview(1,new HubSpotLeadReviewError("archived_contact","200"),"test@example.com");
    await query("UPDATE hubspot_lead_review SET next_check_at=now()-interval '1 second'");
    let reads=0;
    await recheckLeadReviews(async()=>{ reads++; throw new Error('unavailable'); });
    assert.equal(reads,1);
    await recheckLeadReviews(async()=>{ reads++; return {archived:false}; });
    assert.equal(reads,1); // backoff after uncertain lookup
    const [held]=await query("SELECT released_at FROM hubspot_lead_review");
    assert.equal(held.released_at,null);
    await query("UPDATE hubspot_lead_review SET next_check_at=now()-interval '1 second'");
    await recheckLeadReviews(async()=>({archived:false}));
    const [released]=await query("SELECT released_at FROM hubspot_lead_review");
    assert.ok(released.released_at);
    const [contact]=await query("SELECT hubspot_contact_id FROM contact WHERE id=1");
    assert.equal(contact.hubspot_contact_id,"200");
    assert.equal(writes.length,0);
  });

  test("INVALID_EMAIL code for an unverified property does not create a validation hold", async () => {
    mode="invalid_email"; errorProperty="other_property";
    await query("UPDATE contact SET hubspot_contact_id=NULL");
    await query("UPDATE deal SET hubspot_deal_id=NULL,integration_sync_status='pending'");
    assert.equal((await push(1)).status,"failed");
    assert.equal((await query("SELECT * FROM hubspot_lead_review")).length,0);
  });

  test("backoff-skipped rows do not overwrite existing failed health as connected", async () => {
    await query("UPDATE deal SET integration_sync_status='failed'");
    await query("INSERT INTO lead_hubspot_retry(deal_id,next_attempt_at) VALUES(1,now()+interval '1 hour')");
    await query("INSERT INTO integration_health(name,state,last_error) VALUES('hubspot','failed','Existing failure') ON CONFLICT(name) DO UPDATE SET state='failed',last_error='Existing failure'");
    const result=await pending();
    assert.equal(result.skipped,1);
    assert.equal(providerRequests,0);
    const [health]=await query("SELECT state,last_error FROM integration_health WHERE name='hubspot'");
    assert.equal(health.state,"failed");
    assert.equal(health.last_error,"Existing failure");
  });

  test("shared archived contact is rechecked once and independently releases each associated lead hold", async () => {
    const {holdLeadReview,HubSpotLeadReviewError,recheckLeadReviews}=await import("../app/lib/integrations/hubspot-lead-review.ts");
    await query(`INSERT INTO deal(contact_id,name,brand,lead_source,stage,received_at,next_action,next_action_at)
      VALUES(1,'Second fixture','P5 Home Co','Organic Website','New Lead',$1,'Call',$1)`,[received]);
    await holdLeadReview(1,new HubSpotLeadReviewError("archived_contact","200"),"test@example.com");
    await holdLeadReview(2,new HubSpotLeadReviewError("archived_contact","200"),"test@example.com");
    await query("UPDATE hubspot_lead_review SET next_check_at=now()-interval '1 second'");
    // Additive migration rerun preserves both review entries.
    await query(readFileSync(new URL('../migrations/031_hubspot_lead_review.sql',import.meta.url),'utf8'));
    let reads=0;
    await recheckLeadReviews(async(id)=>{ assert.equal(id,"200"); reads++; return {archived:false}; });
    assert.equal(reads,1);
    const reviews=await query("SELECT released_at FROM hubspot_lead_review");
    assert.equal(reviews.length,2);
    assert.ok(reviews.every(row=>row.released_at));
    assert.equal(writes.length,0);
  });

  test("observed structured legacy email-validation body creates a hold, never substring matches", async () => {
    mode="invalid_email"; legacyValidation=true;
    await query("UPDATE contact SET hubspot_contact_id=NULL");
    await query("UPDATE deal SET hubspot_deal_id=NULL,integration_sync_status='pending'");
    assert.equal((await push(1)).status,"failed");
    const [review]=await query("SELECT reason FROM hubspot_lead_review");
    assert.equal(review.reason,"invalid_email");
    const {providerRejectedEmail}=await import("../app/lib/integrations/hubspot-lead-review.ts");
    for (const body of [
      {message:'INVALID_EMAIL email'},
      {message:'Property values were not valid: [{"error":"INVALID_EMAIL","name":"email"'},
      {message:'Property values were not valid: [{"isValid":false,"error":"INVALID_EMAIL","name":"other"}]'},
      {message:'Property values were not valid: [{"isValid":true,"error":"INVALID_EMAIL","name":"email"}]'},
      {errors:[null,{code:'INVALID_EMAIL',context:{propertyName:'email'}}]},
    ]) assert.equal(providerRejectedEmail(body),false);
  });

  test("review release rolls back if resetting retry backoff fails", async () => {
    const {holdLeadReview,HubSpotLeadReviewError,heldLeadReview}=await import("../app/lib/integrations/hubspot-lead-review.ts");
    await holdLeadReview(1,new HubSpotLeadReviewError("invalid_email"),"test@example.com");
    await query("UPDATE contact SET email='corrected@example.com' WHERE id=1");
    await query("INSERT INTO lead_hubspot_retry(deal_id,next_attempt_at) VALUES(1,now()+interval '1 hour')");
    const [before]=await query("SELECT next_attempt_at FROM lead_hubspot_retry WHERE deal_id=1");
    await query("CREATE FUNCTION offline_fail_backoff() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'offline injected failure'; END $$");
    await query("CREATE TRIGGER offline_fail_backoff BEFORE UPDATE ON lead_hubspot_retry FOR EACH ROW EXECUTE FUNCTION offline_fail_backoff()");
    try {
      await assert.rejects(heldLeadReview(1,"corrected@example.com"),/offline injected failure/);
      const [review]=await query("SELECT released_at FROM hubspot_lead_review WHERE deal_id=1");
      assert.equal(review.released_at,null);
      const [retry]=await query("SELECT next_attempt_at FROM lead_hubspot_retry WHERE deal_id=1");
      assert.deepEqual(retry.next_attempt_at,before.next_attempt_at);
    } finally {
      await query("DROP TRIGGER offline_fail_backoff ON lead_hubspot_retry");
      await query("DROP FUNCTION offline_fail_backoff()");
    }
  });

  test("restoration of an old contact cannot release a relinked lead hold", async () => {
    const {holdLeadReview,HubSpotLeadReviewError,recheckLeadReviews}=await import("../app/lib/integrations/hubspot-lead-review.ts");
    await holdLeadReview(1,new HubSpotLeadReviewError("archived_contact","200"),"test@example.com");
    await query("UPDATE contact SET hubspot_contact_id='different-contact' WHERE id=1");
    await query("UPDATE hubspot_lead_review SET next_check_at=now()-interval '1 second'");
    await recheckLeadReviews(async()=>({archived:false}));
    const [review]=await query("SELECT released_at,remote_contact_id FROM hubspot_lead_review WHERE deal_id=1");
    assert.equal(review.released_at,null);
    assert.equal(review.remote_contact_id,"200");
    assert.equal(writes.length,0);
  });

  test("successful limited batch cannot report connected with an unprocessed pending lead", async () => {
    mode="successful_push";
    await query("UPDATE deal SET integration_sync_status='pending'");
    await query(`INSERT INTO deal(contact_id,name,brand,lead_source,stage,received_at,next_action,next_action_at,integration_sync_status)
      VALUES(1,'Later fixture','P5 Home Co','Organic Website','New Lead',$1,'Call',$1,'pending')`,[now]);
    const result=await pending(1);
    assert.equal(result.synced,1);
    assert.equal(result.failed,0);
    const [health]=await query("SELECT state,last_error FROM integration_health WHERE name='hubspot'");
    assert.equal(health.state,"failed");
    assert.match(health.last_error,/1 delivery record.*remain pending/);
  });

  for (const kind of ["task", "deal"] as const) {
    test(`verified archived ${kind} requires review and preserves business state`, async () => {
      await watchdog(now);
      const [before] = await query("SELECT hubspot_task_id,create_attempted_at FROM lead_alert_incident");
      const previousWrites = writes.length;
      if (kind === "task") { missingTask = true; archivedTask = true; }
      else { missingDeal = true; archivedDeal = true; }
      await sync(now);
      const [incident] = await query("SELECT * FROM lead_alert_incident");
      assert.equal(incident.last_error, `${kind}_read:archived_record_review_required`);
      assert.equal(incident.hubspot_task_id, before.hubspot_task_id);
      assert.deepEqual(incident.create_attempted_at, before.create_attempted_at);
      assert.equal(incident.task_completed_at, null);
      assert.equal(incident.resolved_at, null);
      assert.equal(incident.acknowledged_at, null);
      const [deal] = await query("SELECT stage,closed_at FROM deal WHERE id=1");
      assert.equal(deal.stage, "New Lead");
      assert.equal(deal.closed_at, null);
      assert.equal(creates, 1);
      assert.equal(writes.length, previousWrites);
      assert.equal(archivedReads, 1);
    });
  }

  test("archived deal without task is held for review, never mapped to a closed local stage", async () => {
    missingDeal = true; archivedDeal = true;
    remote.dealstage = "closedlost";
    await watchdog(now);
    const [incident] = await query("SELECT last_error,hubspot_task_id,create_attempted_at FROM lead_alert_incident");
    assert.equal(incident.last_error, "deal_read:archived_record_review_required");
    assert.equal(incident.hubspot_task_id, null);
    assert.equal(incident.create_attempted_at, null);
    const [health] = await query("SELECT state,last_error FROM integration_health WHERE name='hubspot_actions'");
    assert.equal(health.state, "failed");
    assert.match(health.last_error, /deal_read:archived_record_review_required=1/);
    const [deal] = await query("SELECT stage,closed_at FROM deal WHERE id=1");
    assert.equal(deal.stage, "New Lead");
    assert.equal(deal.closed_at, null);
    assert.equal(creates, 0);
    assert.equal(writes.length, 0);
  });

  test("durable archive holds avoid repeat reads and recover only after verified restoration", async () => {
    await watchdog(now);
    missingDeal = true; archivedDeal = true;
    await sync(now);
    const reads = archivedReads;
    await sync(now);
    assert.equal(archivedReads, reads);
    await query("UPDATE hubspot_archive_review SET next_check_at=now()-interval '1 second'");
    missingDeal = false; archivedDeal = false;
    await sync(now);
    const [review] = await query("SELECT restored_at FROM hubspot_archive_review");
    assert.ok(review.restored_at);
    assert.equal(creates, 1);
    const [incident] = await query("SELECT task_completed_at,last_error FROM lead_alert_incident");
    assert.equal(incident.task_completed_at, null);
    assert.equal(incident.last_error, null);
  });

  test("open archive review stays visible during an empty batch and does not block active leads", async () => {
    await query("INSERT INTO hubspot_archive_review(object_type,remote_id) VALUES('deals','unrelated-archived-id')");
    await watchdog(now);
    assert.equal(creates, 1);
    await sync(now, 0);
    const [health] = await query("SELECT state,last_error FROM integration_health WHERE name='hubspot_tasks'");
    assert.equal(health.state, "failed");
    assert.match(health.last_error, /archived HubSpot reference/);
  });

  test("missing review migration permits active sync but never publishes all-clear", async () => {
    await query("ALTER TABLE hubspot_archive_review RENAME TO offline_review_hidden");
    try {
      await watchdog(now);
      assert.equal(creates, 1);
      const health = await query("SELECT state,last_error FROM integration_health WHERE name IN ('hubspot_tasks','hubspot_actions')");
      assert.equal(health.length, 2);
      for (const row of health) {
        assert.equal(row.state, "failed");
        assert.match(row.last_error, /Archive review unavailable/);
      }
    } finally { await query("ALTER TABLE offline_review_hidden RENAME TO hubspot_archive_review"); }
  });

  test("restoration is detected independently after source incidents leave selection", async () => {
    await watchdog(now);
    missingDeal = true; archivedDeal = true;
    await sync(now);
    await query("UPDATE lead_alert_incident SET task_completed_at=now()");
    await query("UPDATE hubspot_archive_review SET next_check_at=now()-interval '1 second'");
    missingDeal = false; archivedDeal = false;
    const previousWrites = writes.length;
    await sync(now, 0);
    const [review] = await query("SELECT restored_at FROM hubspot_archive_review");
    assert.ok(review.restored_at);
    assert.equal(writes.length, previousWrites);
    assert.equal(creates, 1);
  });

  test("due rechecks are bounded and unknown missing does not erase archive evidence", async () => {
    for (let i=901;i<=906;i++) await query("INSERT INTO hubspot_archive_review(object_type,remote_id,next_check_at) VALUES('deals',$1,now()-interval '1 day')", [String(i)]);
    missingDeal = true;
    await sync(now, 0);
    const [first] = await query("SELECT count(*)::int AS count FROM hubspot_archive_review WHERE next_check_at>now() AND restored_at IS NULL");
    assert.equal(first.count, 5);
    await sync(now, 0);
    const [second] = await query("SELECT count(*)::int AS count FROM hubspot_archive_review WHERE next_check_at>now() AND restored_at IS NULL");
    assert.equal(second.count, 6);
    assert.equal(creates, 0);
    assert.equal(writes.length, 0);
  });

  for (const existingTask of [false, true]) {
    test(`held deal skips task reads/searches (existing task: ${existingTask})`, async () => {
      if (existingTask) await watchdog(now);
      missingDeal = true; archivedDeal = true;
      if (existingTask) await sync(now); else await watchdog(now);
      const requests = providerRequests;
      await sync(now);
      assert.equal(providerRequests, requests);
      const [incident] = await query("SELECT last_error,task_completed_at FROM lead_alert_incident");
      assert.equal(incident.last_error, "deal_read:archived_record_review_required");
      assert.equal(incident.task_completed_at, null);
      assert.equal(creates, existingTask ? 1 : 0);
    });
  }

  test("healthy objects never trigger an archived lookup", async () => {
    await watchdog(now);
    await sync(now);
    assert.equal(archivedReads, 0);
  });

  test("missing existing task is diagnosed without replacement or completion", async () => {
    await watchdog(now);
    const taskId = tasks[0].id;
    const previousWrites = writes.length;
    missingTask = true;
    await sync(now);
    await sync(now);
    const [incident] = await query("SELECT hubspot_task_id,last_error,task_completed_at FROM lead_alert_incident");
    assert.equal(incident.hubspot_task_id, taskId);
    assert.equal(incident.last_error, "task_read:http_404");
    assert.equal((await query("SELECT * FROM hubspot_archive_review")).length, 0);
    assert.equal(incident.task_completed_at, null);
    assert.equal(creates, 1);
    assert.equal(writes.length, previousWrites);
  });

  test("missing associated deal is distinct even when the existing task is readable", async () => {
    await watchdog(now);
    const previousWrites = writes.length;
    missingDeal = true;
    await sync(now);
    await sync(now);
    const [incident] = await query("SELECT last_error,task_completed_at FROM lead_alert_incident");
    assert.equal(incident.last_error, "deal_read:http_404");
    assert.equal(incident.task_completed_at, null);
    assert.equal(creates, 1);
    assert.equal(writes.length, previousWrites);
  });

  test("missing deal with no existing task never attempts creation", async () => {
    missingDeal = true;
    await watchdog(now);
    await sync(now);
    const [incident] = await query("SELECT last_error,create_attempted_at,hubspot_task_id FROM lead_alert_incident");
    assert.equal(incident.last_error, "deal_read:http_404");
    assert.equal(incident.create_attempted_at, null);
    assert.equal(incident.hubspot_task_id, null);
    assert.equal(creates, 0);
    assert.equal(writes.length, 0);
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
    const [uncertainIncident] = await query("SELECT last_error FROM lead_alert_incident");
    assert.equal(uncertainIncident.last_error, "uncertain_task_creation");
    const [uncertainHealth] = await query("SELECT last_error FROM integration_health WHERE name='hubspot_tasks'");
    assert.match(uncertainHealth.last_error, /uncertain_task_creation=1/);
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
    const [failedIncident] = await query("SELECT last_error,create_attempted_at FROM lead_alert_incident");
    assert.equal(failedIncident.last_error, "task_create:http_403");
    assert.equal(failedIncident.create_attempted_at, null);
    const [failedHealth] = await query("SELECT last_error FROM integration_health WHERE name='hubspot_tasks'");
    assert.match(failedHealth.last_error, /task_create:http_403=1/);
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
