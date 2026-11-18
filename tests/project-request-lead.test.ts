/**
 * The document estimator on p5homeco.com and the lead system (owner decision, 18 November 2026).
 *
 * A visitor's unpriced project request ("Send project request") becomes a P5 lead in this process:
 * the `crm` channel of lib/p5/intakeDeliveryRuntime.ts. The estimate the team later publishes for it
 * (lib/p5/deliveryAdapter.ts, `syncCrm`) joins that same lead. The canonical review receiver is not
 * part of this and stays gated. No network: the database is PGlite and nothing here sends mail.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { leadDatabase } from "./fixtures/lead-db.ts";

process.env.SESSION_SECRET ||= "synthetic-secret-for-tests";
for (const name of ["HUBSPOT_TOKEN", "SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "P5_CRM_DELIVERY", "P5_REQUEST_LEADS_SINCE", "SYNTHETIC_QA_EMAIL_ALLOWLIST"]) delete process.env[name];

const db = await leadDatabase();
await db.exec(`INSERT INTO app_user (email, full_name, role) VALUES ('coord@example.invalid','Coordinator One','lead_coordinator')`);

const { runtimeIntakeTransports } = await import("../lib/p5/intakeDeliveryRuntime.ts");
const { syncCrm } = await import("../lib/p5/deliveryAdapter.ts");
const { intakeDeliveryEnvelope, intakeLeadKey } = await import("../lib/p5/intakeDeliveryPayload.ts");
const { INTAKE_RUNTIME_PROOF } = await import("../lib/p5/intakeDeliveryPolicy.ts");
const { P5_LEAD_RETRY_WINDOW_MS } = await import("../lib/p5/p5LeadIntake.ts");
const { routeIntake } = await import("../lib/p5/intakePolicy.ts");
const { emptyIntakeDetails } = await import("../lib/p5/intakeContract.ts");
const { siteEstimatesSettled } = await import("../app/lib/leads/site-estimate.ts");

type Json = Record<string, unknown>;
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const uuid = (n: number) => `${String(n).padStart(8, "0")}-1234-4234-8234-123456789abc`;

function snapshot(n: number, service: string, extra: Json = {}) {
  return {
    schema: 1, projectId: `p5:${uuid(n)}`, reference: `P5-REQ${n}`, originSite: "p5", currentSite: "p5", draftId: uuid(n), revision: 1, contextVersion: 0,
    savedAt: "2099-01-02T12:00:00.000Z",
    contact: { name: `Riley Request ${n}`, email: `riley${n}@example.com`, phone: `(208) 555-02${n}`, preferredContact: "phone" },
    details: { ...emptyIntakeDetails(), desiredOutcome: "A new primary bathroom", attribution: { utm_source: "google", utm_medium: "cpc", utm_campaign: "bathrooms", gclid: "click-123" } },
    scope: { text: "Gut and rebuild the primary bathroom.", answers: { service, address: `${n} E Bannock St`, location: "Boise" }, extraction: null, uploads: [{ id: uuid(900 + n), name: "plan.pdf", type: "application/pdf", size: 10, sha256: "a".repeat(64), status: "stored" }] },
    routing: routeIntake("p5", service), unresolved: [], ...extra,
  };
}
const envelope = (request: ReturnType<typeof snapshot>) => intakeDeliveryEnvelope(request as never, "crm", "e".repeat(64));
/** The estimate the team published for a project, as the outbox holds it. */
const published = (n: number, extra: Json = {}): Json => ({
  draftId: uuid(n), revision: 2, projectId: `p5:${uuid(n)}`, brand: "P5 Home Co", estimator: "p5-policy",
  contact: { name: `Riley Request ${n}`, email: `riley${n}@example.com`, phone: `(208) 555-02${n}` },
  attribution: {},
  scope: { answers: { service: "bathroom", address: `${n} E Bannock St`, location: "Boise" } },
  customer: { summary: "Rebuild the primary bathroom", range: { low: 30000, high: 36000 } },
  internal: { contractPrice: 33000, lines: [{ description: "Rebuild the primary bathroom", quantity: 1, unit: "LS", trade: "Tile", sellingAmount: 33000, cost: 21000 }] },
  ...extra,
});
const deals = () => db.rows<{ id: number; brand: string; stage: string; original_form: string | null; external_lead_id: string | null; lead_source: string; lead_source_detail: string | null; project_type: string | null; summary: string; integration_sync_status: string; request_kind: string | null; contact_preference: string | null; utm: Json | null }>(
  "SELECT id::int AS id, brand, stage, original_form, external_lead_id, lead_source, lead_source_detail, project_type, summary, integration_sync_status, request_kind, contact_preference, utm FROM deal ORDER BY id");
const pendingEstimates = () => db.rows<{ record_id: string; new_value: Json }>("SELECT record_id, new_value FROM audit_log WHERE action = 'site_estimate_pending' ORDER BY id");

test("the CRM channel is this site's lead system, on only with the CRM setting and only for requests since it began", async () => {
  const { crm, team, customer } = await runtimeIntakeTransports();
  const recent = snapshot(10, "bathroom");
  assert.equal(await crm.readiness(recent as never), "crm-disabled", "off unless P5_CRM_DELIVERY is on");
  process.env.P5_CRM_DELIVERY = "on";
  assert.equal(await crm.readiness(recent as never), null);
  assert.equal(await crm.readiness(snapshot(10, "bathroom", { savedAt: "2026-10-20T15:00:00.000Z" }) as never), "crm-disabled", "a request the team answered weeks ago does not become a new lead");
  process.env.P5_REQUEST_LEADS_SINCE = "2026-10-01T00:00:00Z";
  assert.equal(await crm.readiness(snapshot(10, "bathroom", { savedAt: "2026-10-20T15:00:00.000Z" }) as never), null, "unless the owner brings older requests in on purpose");
  delete process.env.P5_REQUEST_LEADS_SINCE;
  assert.equal(crm.retryWindowMs, P5_LEAD_RETRY_WINDOW_MS);
  assert.ok(crm.retryWindowMs > 0, "a repeat is a duplicate here, so a retry is safe");
  assert.equal(crm.identityScope, "p5-lead-system-in-process-v1");
  assert.equal(team, customer, "the mail channels are unchanged");
  // validate reads the envelope only.
  assert.equal(crm.validate!(envelope(recent)), null);
  assert.equal(crm.validate!(envelope(snapshot(10, "bathroom", { contact: { name: "[QA] Acceptance", email: "qa@example.invalid", phone: "", preferredContact: "either" } }))), "synthetic-suppressed");
  assert.equal(crm.validate!(envelope(snapshot(10, "bathroom", { contact: { name: "Riley Request", email: "riley@example.com", phone: "1234567890", preferredContact: "either" } }))), "contact-review");
  assert.equal(crm.validate!(envelope(snapshot(10, "bathroom", { contact: { name: "Riley Request", email: "", phone: "", preferredContact: "either" } }))), "contact-review");
  assert.deepEqual(await deals(), [], "none of that saved anything");

  // The canonical review receiver is not activated: its gate is as it was, and this runtime does not use it.
  assert.deepEqual(INTAKE_RUNTIME_PROOF, { email: "fleet-release-2026-10-08", crm: null });
  const runtime = read("lib/p5/intakeDeliveryRuntime.ts");
  assert.doesNotMatch(runtime, /canonicalReviewTransport|P5_CANONICAL_REVIEW_TOKEN/);
  assert.match(read("lib/p5/canonicalReviewTransport.ts"), /!config\.proof\?'crm-contract-pending'/);
  // Saving a lead in process sends no email: the request's own team channel is the one team email.
  assert.doesNotMatch(runtime, /notifyLead|lead-created/);
  for (const file of ["lib/p5/intakeDeliveryRuntime.ts", "lib/p5/intakeCrmValidation.ts", "lib/p5/deliveryAdapter.ts", "tests/project-request-lead.test.ts"]) assert.ok(!read(file).includes(String.fromCharCode(8212)), `${file} has an em dash`);
});

test("a project request becomes one lead under its primary team, with no price, and a repeat changes nothing", async () => {
  process.env.P5_CRM_DELIVERY = "on";
  const { crm } = await runtimeIntakeTransports();
  const request = snapshot(11, "bathroom");
  const providerId = await crm.send(envelope(request));
  const [deal] = await deals();
  assert.equal(providerId, `p5-lead:${deal.id}`);
  assert.deepEqual(
    [deal.brand, deal.stage, deal.original_form, deal.external_lead_id, deal.project_type, deal.lead_source, deal.lead_source_detail, deal.request_kind, deal.contact_preference],
    ["Boise Remodeling Co", "New Lead", "p5-project-request", intakeLeadKey(`p5:${uuid(11)}`), "bathroom", "Paid Search", `p5-project-request:${uuid(11)}`, "quote", "call"],
  );
  assert.equal(deal.integration_sync_status, "pending", "the existing HubSpot sync will send it to the first stage");
  assert.equal(deal.utm?.utm_campaign, "bathrooms");
  assert.match(deal.summary, /^Project request P5-REQ11, revision 1, sent from p5homeco\.com\. No price has been given\./);
  assert.match(deal.summary, /Files attached: 1/);
  assert.doesNotMatch(deal.summary, /plan\.pdf|aaaaaaaa|\$\d/);
  const refs = await db.rows<{ brand: string; external_id: string }>("SELECT brand, external_id FROM lead_external_ref WHERE deal_id = $1", [deal.id]);
  assert.deepEqual(refs, [{ brand: "Boise Remodeling Co", external_id: intakeLeadKey(`p5:${uuid(11)}`) }]);
  assert.deepEqual(await pendingEstimates(), [], "nothing for QuickBooks: there is no price");

  // The worker sends again after a lost answer, and the visitor sends a revised request: still one lead.
  assert.equal(await crm.send(envelope(request)), providerId);
  assert.equal(await crm.send(envelope(snapshot(11, "bathroom", { revision: 2 }))), providerId);
  assert.equal((await deals()).length, 1);
});

test("a synthetic QA request never becomes a lead", async () => {
  process.env.P5_CRM_DELIVERY = "on";
  const { crm } = await runtimeIntakeTransports();
  const before = (await deals()).length;
  await assert.rejects(crm.send(envelope(snapshot(12, "bathroom", { contact: { name: "[QA] Acceptance", email: "qa@example.invalid", phone: "", preferredContact: "either" } }))), /synthetic-suppressed/);
  await assert.rejects(crm.send(envelope(snapshot(12, "bathroom", { scope: { text: "QA", answers: { service: "bathroom", projectName: "[QA] bathroom" }, extraction: null, uploads: [] } }))), /synthetic-suppressed/);
  delete process.env.P5_CRM_DELIVERY;
  await assert.rejects(crm.send(envelope(snapshot(12, "bathroom"))), /crm-disabled/);
  assert.equal((await deals()).length, before);
});

test("one lead per project: the estimate published for a request joins the request's lead, and gets its QuickBooks estimate", async () => {
  process.env.P5_CRM_DELIVERY = "on";
  const { crm } = await runtimeIntakeTransports();
  await crm.send(envelope(snapshot(13, "bathroom")));
  const lead = (await deals()).at(-1)!;
  assert.equal(lead.brand, "Boise Remodeling Co");
  const count = (await deals()).length;

  // The team prices it and publishes. The record names the project; its address was corrected on the way.
  const dealId = Number(await syncCrm(published(13, { scope: { answers: { service: "bathroom", address: "13 East Bannock Street", location: "Boise" } } }), "p5-outbox-key-13"));
  await siteEstimatesSettled();
  assert.equal(dealId, lead.id, "the request's lead");
  assert.equal((await deals()).length, count, "no second lead");
  const queued = (await pendingEstimates()).filter((row) => row.record_id === String(lead.id));
  assert.equal(queued.length, 1, "the estimate is queued for QuickBooks on that lead");
  assert.equal((queued[0].new_value.input as { estimate: { kind: string; base: number } }).estimate.base, 33000);

  // A record published before the project id was stamped: the project that began on this site is still found.
  await crm.send(envelope(snapshot(14, "bathroom")));
  const second = (await deals()).at(-1)!;
  const unstamped = published(14);
  delete unstamped.projectId;
  assert.equal(Number(await syncCrm(unstamped, "p5-outbox-key-14")), second.id);
  await siteEstimatesSettled();

  // An estimate with no request behind it is a lead of its own, exactly as before.
  const lone = Number(await syncCrm(published(15), "p5-outbox-key-15"));
  await siteEstimatesSettled();
  const made = (await deals()).find((deal) => deal.id === lone)!;
  assert.deepEqual([made.original_form, made.external_lead_id, made.brand], ["p5-estimator", "p5-outbox-key-15", "P5 Home Co"]);
  assert.equal((await deals()).length, count + 2);
});

test("another project from the same person is a new lead, never swallowed by a closed one", async () => {
  process.env.P5_CRM_DELIVERY = "on";
  const { crm } = await runtimeIntakeTransports();
  await crm.send(envelope(snapshot(16, "bathroom")));
  const first = (await deals()).at(-1)!;
  await db.exec(`UPDATE deal SET stage = 'Closed Lost', closed_lost_reason = 'Chose another contractor' WHERE id = ${first.id}`);

  // The same person, address and kind of work: a new project, so a new key.
  const again = snapshot(17, "bathroom", {
    contact: { name: "Riley Request 16", email: "riley16@example.com", phone: "(208) 555-0216", preferredContact: "phone" },
    scope: { text: "A second bathroom this time.", answers: { service: "bathroom", address: "16 E Bannock St", location: "Boise" }, extraction: null, uploads: [] },
  });
  await crm.send(envelope(again));
  const second = (await deals()).at(-1)!;
  assert.notEqual(second.id, first.id);
  assert.equal(second.stage, "New Lead");
  // Its estimate joins the new lead.
  const dealId = Number(await syncCrm(published(17, { contact: { name: "Riley Request 16", email: "riley16@example.com", phone: "(208) 555-0216" } }), "p5-outbox-key-17"));
  await siteEstimatesSettled();
  assert.equal(dealId, second.id);
  assert.equal((await deals()).find((deal) => deal.id === first.id)!.stage, "Closed Lost");
});
