import assert from "node:assert/strict";
import test from "node:test";

import { leadDatabase } from "./fixtures/lead-db.ts";

// One team email per request from a brand site (owner, 17 November 2026).
// The brand site asks the intake to confirm its team email went
// (`team_alert: "confirm"`) and sends its own only when it did not. These
// tests hold the intake's half of that: it waits, it tells the truth, and a
// caller that does not ask sees no change at all.

process.env.SESSION_SECRET ||= "synthetic-secret-for-tests";
delete process.env.HUBSPOT_TOKEN;
delete process.env.SMTP_HOST;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASSWORD;

const db = await leadDatabase();
await db.exec(
  `INSERT INTO app_user (email, full_name, role) VALUES ('coord@example.invalid','Coordinator One','lead_coordinator')`,
);

const { handleIntake } = await import("../app/api/leads/intake/handler.ts");
const { readTeamNotes, MAX_TEAM_NOTES, MAX_TEAM_NOTE_LENGTH } = await import("../app/lib/leads/intakeContract.ts");
const { classify } = await import("../app/lib/integrations/inbox-policy.ts");

type Json = Record<string, unknown>;
type Sent = { to: string; subject: string; text: string; html: string };
let ip = 0;
let sent: Sent[] = [];
let afterTasks: (() => Promise<void>)[] = [];
let delivering: "ok" | "refused" | "slow" = "ok";

const transport = {
  name: "test",
  async send(to: string, message: { subject: string; text: string; html: string }) {
    if (delivering === "slow") await new Promise((resolve) => setTimeout(resolve, 150));
    if (delivering === "refused") return { ok: false as const, error: "mailbox refused" };
    sent.push({ to, ...message });
    return { ok: true as const };
  },
};

async function post(body: Json, deps: Json = {}): Promise<{ status: number; json: Json }> {
  const response = await handleIntake(
    new Request("https://p5homeco.com/api/leads/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": `198.51.100.${++ip}` },
      body: JSON.stringify(body),
    }),
    (task) => afterTasks.push(task),
    { alertTransport: transport, ...deps },
  );
  return { status: response.status, json: (await response.json()) as Json };
}

const request = (id: string, extra: Json = {}): Json => ({
  brand: "Boise Cabinet Co",
  name: `Pat Example ${id}`,
  form: "Cabinet consultation",
  source: "Organic Website",
  projectType: "Kitchen cabinets",
  email: `pat${id}@example.com`,
  // A number of its own per request: the intake limits repeats from one person.
  phone: `(208) 55${id}-0142`,
  summary: "New uppers and a pantry.",
  external_id: `boisecabinet-consultation:${id}`,
  submission_kind: "initial",
  ...extra,
});

test.beforeEach(() => { sent = []; afterTasks = []; delivering = "ok"; });

test("a caller that does not ask is answered exactly as before, and the email goes after the response", async () => {
  const { status, json } = await post(request("1"));
  assert.equal(status, 201);
  assert.deepEqual(Object.keys(json).sort(), ["accepted", "duplicate", "message", "ok"]);
  assert.equal(sent.length, 0, "nothing is sent before the response");
  assert.equal(afterTasks.length, 1);
  await afterTasks[0]();
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /^New lead: /);
});

test("a caller that asks is told the team email went, and it has gone by the time it is told", async () => {
  const { status, json } = await post(request("2", { team_alert: "confirm" }));
  assert.equal(status, 201);
  assert.equal(json.alert, "sent");
  assert.equal(json.accepted, true);
  assert.equal(sent.length, 1, "sent before the response, not after it");
  assert.equal(afterTasks.length, 0, "and not sent a second time afterwards");
});

test("a caller that asks is told when the team email did not go, so it can send its own", async () => {
  delivering = "refused";
  const { status, json } = await post(request("3", { team_alert: "confirm" }));
  assert.equal(status, 201, "the lead is still accepted");
  assert.equal(json.alert, "failed");
  assert.equal(sent.length, 0);
});

test("an email that is still sending is reported as not confirmed, and is left to finish", async () => {
  delivering = "slow";
  const { json } = await post(request("4", { team_alert: "confirm" }), { confirmAlertTimeoutMs: 20 });
  assert.equal(json.alert, "failed");
  assert.equal(afterTasks.length, 1, "the send is kept alive after the response");
  await afterTasks[0]();
  assert.equal(sent.length, 1);
});

test("an exact repeat produces no email and says so", async () => {
  await post(request("5", { team_alert: "confirm" }));
  sent = [];
  const { status, json } = await post(request("5", { team_alert: "confirm" }));
  assert.equal(status, 200);
  assert.equal(json.duplicate, true);
  assert.equal(json.alert, "none");
  assert.equal(sent.length, 0);
});

test("Step 2 details: the follow-up email is confirmed the same way", async () => {
  await post(request("6", { team_alert: "confirm" }));
  sent = [];
  const { status, json } = await post({
    brand: "Boise Cabinet Co",
    name: "Pat Example 6",
    external_id: "boisecabinet-consultation:6",
    submission_kind: "details",
    address: "123 N Main St",
    city: "Boise",
    timeline: "1 to 3 months",
    team_alert: "confirm",
  });
  assert.equal(status, 200);
  assert.equal(json.merged, true);
  assert.equal(json.alert, "sent");
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /^Details added: /);
});

test("team notes are printed in the email only: not stored on the lead, not among the submitted fields", async () => {
  const notes = ["Planning range: $18,000 to $24,000", "Parcel: R1234567", "Lead dashboard: https://boisecabinet.co/admin/leads/77"];
  const { json } = await post(request("7", { team_alert: "confirm", team_notes: notes }));
  assert.equal(json.alert, "sent");
  const [mail] = sent;
  assert.match(mail.text, /From the website:\n  Planning range: \$18,000 to \$24,000\n  Parcel: R1234567/);
  assert.match(mail.html, /From the website/);
  assert.match(mail.html, /Planning range<\/td>/);
  assert.doesNotMatch(mail.text, /Team notes|Team alert/i, "the instruction itself is not a submitted field");
  assert.doesNotMatch(mail.html, /Team notes|Team alert/i);
  const [deal] = await db.rows<{ summary: string }>("SELECT summary FROM deal WHERE name LIKE $1", ["%Example 7%"]);
  assert.ok(deal, "the lead was created");
  assert.doesNotMatch(deal.summary ?? "", /Planning range|Parcel/);
  const fields = await db.rows<{ fields: unknown }>("SELECT fields FROM lead_intake_submission");
  assert.doesNotMatch(JSON.stringify(fields), /Planning range|R1234567|team_notes|team_alert/);
  // The inbox sync reads exactly one Name, Email and Phone line.
  for (const label of ["Name", "Email", "Phone"]) {
    assert.equal(mail.text.split("\n").filter((line) => line.startsWith(`${label}:`)).length, 1, label);
  }
});

test("a team note that names a cost or a margin never reaches the email, which HubSpot copies", async () => {
  const notes = [
    "Planning range: $18,000 to $24,000",
    "Our cost: $11,200",
    "Gross margin: 38%",
    "Contingency: $900",
    "Markup 1.6x",
    "Kitchen: $14,500 to $19,000",
  ];
  assert.deepEqual(readTeamNotes(notes), [
    "Planning range: $18,000 to $24,000",
    "Kitchen: $14,500 to $19,000",
    "Withheld: 4 internal lines (not emailed; see the site's own record)",
  ]);
  const { json } = await post(request("8", { team_alert: "confirm", team_notes: notes }));
  assert.equal(json.alert, "sent");
  const [mail] = sent;
  for (const secret of ["11,200", "38%", "$900", "1.6x"]) {
    assert.ok(!mail.text.includes(secret) && !mail.html.includes(secret), secret);
  }
  assert.match(mail.text, /Withheld: 4 internal lines/);
});

test("internal pricing travels in its own field, and that email is one the inbox sync does not copy into HubSpot", async () => {
  const internal = ["Our cost: $11,200", "Gross margin: 38%", "Pricing check: margin trimmed from 30% to 28%"];
  const { json } = await post(request("9", {
    team_alert: "confirm",
    team_notes: ["Planning range: $18,000 to $24,000"],
    team_internal_notes: internal,
  }));
  assert.equal(json.alert, "sent");
  const [mail] = sent;
  assert.match(mail.subject, /^Lead and pricing: Boise Cabinet Co \| Kitchen cabinets \| Pat Example 9/);
  assert.match(mail.text, /Internal pricing \(this email is not copied into HubSpot\):\n  Our cost: \$11,200\n  Gross margin: 38%/);
  assert.match(mail.html, /Internal pricing/);
  assert.match(mail.html, /This email is not copied into HubSpot/);
  assert.match(mail.text, /From the website:\n  Planning range: \$18,000 to \$24,000/);
  assert.doesNotMatch(JSON.stringify(await db.rows("SELECT fields FROM lead_intake_submission")), /11,200|team_internal_notes/);
  const [deal] = await db.rows<{ summary: string }>("SELECT summary FROM deal WHERE name LIKE $1", ["%Example 9%"]);
  assert.doesNotMatch(deal.summary ?? "", /11,200|margin/i);

  // The inbox sync's own rule, not a copy of it: the same message as Gmail
  // files it (sent by our address to our inbox) is ignored with internal
  // pricing and picked up as a website notification without.
  const asMail = (subject: string) => ({
    messageId: "<m1@p5homeco.com>", subject, receivedAt: new Date().toISOString(), sentAt: new Date().toISOString(),
    from: [{ email: "hello@p5homeco.com", name: "P5 Home Co" }], to: [{ email: "hello@p5homeco.com", name: "" }], cc: [],
    text: mail.text, html: mail.html, headers: [], attachments: [], labels: ["\\Sent", "\\Inbox"],
  });
  assert.deepEqual(classify(asMail(mail.subject)), { status: "ignored", reason: "internal-or-logging-sent" });
  assert.notEqual(classify(asMail(mail.subject.replace(/^Lead and pricing/, "New lead"))).status, "ignored");
  // Without internal pricing the subject is unchanged.
  sent = [];
  await post(request("0", { team_alert: "confirm" }));
  assert.match(sent[0].subject, /^New lead: /);
  assert.doesNotMatch(sent[0].html, /Internal pricing/);
});

test("team notes are plain single lines, capped in number and length", () => {
  assert.deepEqual(readTeamNotes("not a list"), []);
  assert.deepEqual(readTeamNotes(["  a  b ", 7, "", "line\nbreak\tand tab", null]), ["a b", "line break and tab"]);
  assert.equal(readTeamNotes(Array.from({ length: 100 }, (_, i) => `note ${i}`)).length, MAX_TEAM_NOTES);
  assert.equal(readTeamNotes(["x".repeat(5000)])[0].length, MAX_TEAM_NOTE_LENGTH);
});

// ---------------------------------------------------------------------------
// team_alert: "site" (owner, 17 and 18 November 2026). The document estimator
// on a brand site emails the team itself, then posts here: its visitor's
// project request (form p5-project-request) and the estimate the team later
// publishes for it (form p5-estimator, with the figures). No second email is
// sent from here for those two, and only for those two.
// ---------------------------------------------------------------------------

const { estimateIntakeBody, forwardEstimateToP5, projectRequestIntakeBody } = await import("../lib/p5/p5LeadIntake.ts");
const { intakeDeliveryEnvelope, intakeLeadKey } = await import("../lib/p5/intakeDeliveryPayload.ts");
const { routeIntake } = await import("../lib/p5/intakePolicy.ts");
const { emptyIntakeDetails } = await import("../lib/p5/intakeContract.ts");
const { siteSentTeamEmail, readSiteEstimate, readIntakeExtras } = await import("../app/lib/leads/intakeContract.ts");

const uuid = (n: number) => `${String(n).padStart(8, "0")}-1234-4234-8234-123456789abc`;
/** A published document estimate as the outbox holds it: customer view, internal lines, the project it answers. */
const published = (n: number, extra: Json = {}): Json => ({
  draftId: uuid(n),
  revision: 2,
  projectId: `remodeling:${uuid(n)}`,
  brand: "Boise Remodeling Co",
  contact: { name: `Dana Document ${n}`, email: `dana${n}@example.com`, phone: `(208) 555-01${n}` },
  scope: { answers: { service: "kitchen", address: `${n} W Idaho St`, location: "Boise" } },
  customer: { summary: "Install 120 LF of trim and paint it", range: { low: 3000, high: 3600 } },
  internal: {
    contractPrice: 3333.335,
    directCost: 2100,
    lines: [
      { description: "Install owner-supplied trim", quantity: 120, unit: "LF", trade: "Trim & Finish Carpentry", sellingAmount: 1111.1117, cost: 700, operatingProfit: 120, overheadRecovery: 200, contingency: 70 },
      { description: "Paint new trim", quantity: 1, unit: "LS", trade: "Painting", sellingAmount: 2222.2233, cost: 1400, operatingProfit: 240 },
    ],
  },
  ...extra,
});
/** A visitor's unpriced project request, as the request delivery freezes it for the CRM channel. */
function projectRequest(n: number, site: "p5" | "construction" | "remodeling" | "handyman" | "cabinet", service: string, extra: Json = {}) {
  const snapshot = {
    schema: 1, projectId: `${site}:${uuid(n)}`, reference: `REQ-${n}`, originSite: site, currentSite: site, draftId: uuid(n), revision: 1, contextVersion: 0,
    savedAt: "2099-01-02T12:00:00.000Z",
    contact: { name: `Dana Document ${n}`, email: `dana${n}@example.com`, phone: `(208) 555-01${n}`, preferredContact: "email" },
    details: { ...emptyIntakeDetails(), desiredOutcome: "New trim through the main floor" },
    scope: { text: "Replace the trim and paint it.", answers: { service, address: `${n} W Idaho St`, location: "Boise" }, extraction: null, uploads: [] },
    routing: routeIntake(site, service), unresolved: [], ...extra,
  };
  return projectRequestIntakeBody(intakeDeliveryEnvelope(snapshot as never, "crm", "e".repeat(64)));
}
const deals = () => db.rows<{ id: number; brand: string; stage: string; original_form: string | null; name: string }>("SELECT id::int AS id, brand, stage, original_form, name FROM deal ORDER BY id");
const auditsOf = (action: string) => db.rows<{ record_id: string; new_value: Json }>("SELECT record_id, new_value FROM audit_log WHERE action = $1 ORDER BY id", [action]);
/** Run what the intake left for after the response, in order. */
async function finish(): Promise<void> {
  for (const task of afterTasks.splice(0)) await task();
  const { siteEstimatesSettled } = await import("../app/lib/leads/site-estimate.ts");
  await siteEstimatesSettled();
}

test("site: a published document estimate sends no email from here, says so, and its QuickBooks estimate is still queued", async () => {
  const body = estimateIntakeBody(published(11), "outbox-key", { brand: "Boise Remodeling Co" });
  assert.equal(body.team_alert, "site");
  const { status, json } = await post(body);
  assert.equal(status, 201);
  assert.equal(json.accepted, true);
  assert.equal(json.alert, "none", "the answer says no team email was sent from here");
  assert.equal(sent.length, 0);
  assert.equal(afterTasks.length, 1, "only the QuickBooks work is left for after the response");
  await finish();
  assert.equal(sent.length, 0, "and none is sent afterwards: not New lead, not Details added, not Request added");
  const [deal] = await db.rows<{ id: number; brand: string; stage: string; original_form: string }>("SELECT id::int AS id, brand, stage, original_form FROM deal WHERE name LIKE '%Document 11%'");
  assert.deepEqual([deal.brand, deal.stage, deal.original_form], ["Boise Remodeling Co", "New Lead", "p5-estimator"], "the lead is saved in the first stage");
  // The estimate reached the site-estimate code for this lead (QuickBooks is not connected in this test, so it waits).
  const pending = (await auditsOf("site_estimate_pending")).filter((row) => row.record_id === String(deal.id));
  assert.equal(pending.length, 1);
  assert.equal((pending[0].new_value.input as { estimate: { kind: string; base: number } }).estimate.kind, "document");
  assert.equal((pending[0].new_value.input as { estimate: { kind: string; base: number } }).estimate.base, 3333.34);
  // Neither instruction is a submitted field, and no internal figure travelled.
  const fields = JSON.stringify(await db.rows("SELECT fields FROM lead_intake_submission WHERE deal_id = $1", [deal.id]));
  assert.doesNotMatch(fields, /team_alert|Team alert|request_external_id|Request external id|p5-intake-|sellingAmount|1400|"Estimate"/);
});

test("site: a repeat of the same estimate is one lead and still no email", async () => {
  const body = estimateIntakeBody(published(12), "outbox-key", { brand: "Boise Remodeling Co" });
  await post(body);
  await finish();
  const before = (await deals()).length;
  const { status, json } = await post(body);
  assert.equal(status, 200);
  assert.deepEqual([json.duplicate, json.accepted, json.alert], [true, false, "none"]);
  await finish();
  assert.equal((await deals()).length, before);
  assert.equal(sent.length, 0);
});

test("site is ignored without the document estimator's own evidence: the email goes exactly as today", async () => {
  const whole = estimateIntakeBody(published(13), "k", { brand: "Boise Remodeling Co" });
  const cases: [string, Json][] = [
    ["an estimate post with no figures", { ...whole, name: "Dana Document 131", email: "d131@example.com", phone: "(208) 551-3101", external_id: "p5-estimator:131", estimate: undefined }],
    ["figures that cannot be read", { ...whole, name: "Dana Document 132", email: "d132@example.com", phone: "(208) 551-3102", external_id: "p5-estimator:132", estimate: { kind: "document", low: 9, high: 3 } }],
    ["a planning range", { ...whole, name: "Dana Document 133", email: "d133@example.com", phone: "(208) 551-3103", external_id: "p5-estimator:133", estimate: { kind: "planning-range", low: 3000, high: 3600, verified: true } }],
    ["a document estimate from some other form", { ...whole, name: "Dana Document 134", email: "d134@example.com", phone: "(208) 551-3104", external_id: "p5-estimator:134", form: "Consultation request" }],
    ["a plain request form that says site", request("135", { team_alert: "site", phone: "(208) 551-3105" })],
  ];
  for (const [name, body] of cases) {
    sent = []; afterTasks = [];
    const { status, json } = await post(body);
    assert.equal(status, 201, name);
    assert.equal("alert" in json, false, `${name}: answered exactly as a caller that did not ask`);
    assert.equal(sent.length, 0, `${name}: nothing before the response`);
    await finish();
    assert.equal(sent.length, 1, `${name}: the New lead email is sent`);
    assert.match(sent[0].subject, /^New lead: /, name);
  }
  // The rule itself, as a pure function.
  const estimate = readSiteEstimate(whole.estimate);
  const site = readIntakeExtras({ team_alert: "site" });
  assert.equal(siteSentTeamEmail("p5-estimator", site, estimate), true);
  assert.equal(siteSentTeamEmail("p5-project-request", site, { estimate: null }), true);
  assert.equal(siteSentTeamEmail("p5-estimator", site, { estimate: null }), false);
  assert.equal(siteSentTeamEmail("p5-estimator", readIntakeExtras({ team_alert: "confirm" }), estimate), false);
  assert.equal(siteSentTeamEmail("p5-estimator", readIntakeExtras({}), estimate), false);
  assert.equal(siteSentTeamEmail("Quote Landing Page", site, estimate), false);
  assert.equal(siteSentTeamEmail(undefined, site, estimate), false);
  assert.equal(readIntakeExtras({ teamAlert: "site" }).siteAlert, true, "the camelCase spelling is read too");
  assert.equal(readIntakeExtras({ team_alert: "SITE" }).siteAlert, false);
});

test("site: a visitor's project request becomes a lead under its primary team, with no email from here and nothing for QuickBooks", async () => {
  const body = projectRequest(14, "construction", "kitchen");
  assert.deepEqual([body.brand, body.form, body.team_alert, body.external_id], ["Boise Remodeling Co", "p5-project-request", "site", intakeLeadKey(`construction:${uuid(14)}`)]);
  const { status, json } = await post(body);
  assert.equal(status, 201);
  assert.deepEqual([json.accepted, json.alert], [true, "none"]);
  assert.equal(afterTasks.length, 0, "no email and no QuickBooks work: a request has no price");
  assert.equal(sent.length, 0);
  const [deal] = await db.rows<{ id: number; brand: string; stage: string; original_form: string; summary: string; request_kind: string; contact_preference: string }>(
    "SELECT id::int AS id, brand, stage, original_form, summary, request_kind, contact_preference FROM deal WHERE name LIKE '%Document 14%'");
  assert.deepEqual([deal.brand, deal.stage, deal.original_form, deal.request_kind, deal.contact_preference], ["Boise Remodeling Co", "New Lead", "p5-project-request", "quote", "email"]);
  assert.match(deal.summary, /Project request REQ-14, revision 1, sent from boiseconstruction\.co\. No price has been given\./);

  // The delivery worker may send the same request again (a lost answer): one lead, no email, nothing new for HubSpot.
  await db.exec(`UPDATE deal SET integration_sync_status = 'synced' WHERE id = ${deal.id}`);
  const count = (await deals()).length;
  const again = await post(body);
  assert.equal(again.status, 200);
  assert.deepEqual([again.json.duplicate, again.json.accepted, again.json.alert], [true, false, "none"]);
  await finish();
  assert.equal((await deals()).length, count);
  assert.equal(sent.length, 0);
  const [after] = await db.rows<{ integration_sync_status: string; summary: string }>("SELECT integration_sync_status, summary FROM deal WHERE id = $1", [deal.id]);
  assert.equal(after.integration_sync_status, "synced", "an exact repeat queues nothing for HubSpot");
  assert.equal(after.summary, deal.summary, "and changes nothing on the lead");
});

test("one lead per project: the estimate published for a request joins the request's lead, whatever brand the site is", async () => {
  // The visitor asked on boiseconstruction.co for a kitchen: routed to, and filed under, Boise Remodeling Co.
  const asked = await post(projectRequest(15, "construction", "kitchen"));
  assert.equal(asked.status, 201);
  const [lead] = await db.rows<{ id: number; brand: string }>("SELECT id::int AS id, brand FROM deal WHERE name LIKE '%Document 15%'");
  assert.equal(lead.brand, "Boise Remodeling Co");

  // Weeks later the Boise Construction Co team prices it and publishes: the brand's adapter forwards the estimate.
  // The record carries the project the estimate answers; here the address was corrected and the service changed too.
  const record = published(15, { projectId: `construction:${uuid(15)}`, brand: "Boise Construction Co", scope: { answers: { service: "remodel", address: "15 West Idaho Street Unit B", location: "Boise" } } });
  const viaIntake = (async (_url: unknown, init?: RequestInit) => {
    const response = await handleIntake(
      new Request("https://p5homeco.com/api/leads/intake", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": `198.51.100.${++ip}` }, body: String(init?.body) }),
      (task) => afterTasks.push(task),
      { alertTransport: transport },
    );
    return response;
  }) as typeof fetch;
  const providerId = await forwardEstimateToP5(record, "outbox-key", { brand: "Boise Construction Co", fetch: viaIntake });
  assert.equal(providerId, `p5-intake:p5-estimator:${uuid(15)}`);
  await finish();
  const mine = (await deals()).filter((deal) => deal.name.includes("Document 15"));
  assert.equal(mine.length, 1, "one lead: the estimate did not make a second");
  assert.equal(mine[0].id, lead.id);
  assert.equal(mine[0].brand, "Boise Remodeling Co", "the lead stays with the team the request was routed to");
  assert.equal(sent.length, 0, "and still no email from here");
  const pending = (await auditsOf("site_estimate_pending")).filter((row) => row.record_id === String(lead.id));
  assert.equal(pending.length, 1, "the QuickBooks estimate is queued for the request's lead");
  assert.equal((pending[0].new_value.input as { brand: string }).brand, "Boise Construction Co");
  // Both ids now find the lead.
  const refs = await db.rows<{ brand: string; external_id: string }>("SELECT brand, external_id FROM lead_external_ref WHERE deal_id = $1 ORDER BY external_id", [lead.id]);
  assert.deepEqual(refs.map((ref) => [ref.brand, ref.external_id]), [
    ["Boise Construction Co", `p5-estimator:${uuid(15)}`],
    ["Boise Remodeling Co", intakeLeadKey(`construction:${uuid(15)}`)],
  ]);

  // The request had joined a lead that was already open (the same person had sent a quote form first):
  // the estimate still finds it, because the request's key was remembered on that lead.
  const first = await post(request("16", { brand: "Boise Handyman Co", projectType: "handyman", address: "16 W Idaho St", name: "Dana Document 16", email: "dana16@example.com", phone: "(208) 555-0116" }));
  assert.equal(first.status, 201);
  await finish();
  sent = [];
  const joined = await post(projectRequest(16, "handyman", "handyman"));
  assert.deepEqual([joined.status, joined.json.duplicate, joined.json.alert], [200, true, "none"]);
  await forwardEstimateToP5(published(16, { projectId: `handyman:${uuid(16)}`, scope: { answers: { service: "handyman", address: "somewhere else entirely", location: "Meridian" } } }), "k", { brand: "Boise Handyman Co", fetch: viaIntake });
  await finish();
  assert.equal((await deals()).filter((deal) => deal.name.includes("Document 16")).length, 1);
  assert.equal(sent.length, 0);
});

test("one lead per project, not one lead per person: another project is a new lead, never swallowed by a closed one", async () => {
  await post(projectRequest(17, "remodeling", "kitchen"));
  const [first] = await db.rows<{ id: number }>("SELECT id::int AS id FROM deal WHERE name LIKE '%Document 17%'");
  await db.exec(`UPDATE deal SET stage = 'Closed Lost', closed_lost_reason = 'Chose another contractor' WHERE id = ${first.id}`);

  // The same person, the same address and kind of work, a new project months later.
  const second = projectRequest(18, "remodeling", "kitchen", {
    contact: { name: "Dana Document 17", email: "dana17@example.com", phone: "(208) 555-0117", preferredContact: "email" },
    scope: { text: "A different project.", answers: { service: "kitchen", address: "17 W Idaho St", location: "Boise" }, extraction: null, uploads: [] },
  });
  const { status, json } = await post(second);
  assert.deepEqual([status, json.accepted, json.duplicate], [201, true, false]);
  const mine = (await deals()).filter((deal) => deal.name.includes("Document 17"));
  assert.deepEqual(mine.map((deal) => deal.stage), ["Closed Lost", "New Lead"]);

  // Its estimate joins the new lead, not the closed one.
  const record = published(18, { projectId: `remodeling:${uuid(18)}`, contact: { name: "Dana Document 17", email: "dana17@example.com", phone: "(208) 555-0117" } });
  const { status: estimateStatus, json: estimateJson } = await post(estimateIntakeBody(record, "k", { brand: "Boise Remodeling Co" }));
  assert.deepEqual([estimateStatus, estimateJson.duplicate], [200, true]);
  await finish();
  assert.equal((await deals()).filter((deal) => deal.name.includes("Document 17")).length, 2);
  assert.deepEqual((await auditsOf("site_estimate_pending")).filter((row) => [String(first.id), String(mine[1].id)].includes(row.record_id)).map((row) => row.record_id), [String(mine[1].id)]);

  // A key that is not a project request key attaches nothing, whoever sends it.
  const stray = await post(request("19", { phone: "(208) 551-3119", request_external_id: `p5-estimator:${uuid(15)}` }));
  assert.deepEqual([stray.status, stray.json.accepted], [201, true]);
  const guess = await post(request("20", { phone: "(208) 551-3120", request_external_id: "boisecabinet-consultation:19" }));
  assert.deepEqual([guess.status, guess.json.accepted], [201, true]);
});
