import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PIPELINE_ID,
  STAGE_BY_ID,
  STAGE_IDS,
  contactProperties,
  dealProperties,
  stageIdFor,
  type DealSyncInput,
} from "../app/lib/integrations/hubspot-map.ts";
import { DEAL_STAGES, type DealStage } from "../app/lib/leads/types.ts";

// --- The stage-id trap ------------------------------------------------------

test("every P5 stage has a HubSpot id", () => {
  for (const stage of DEAL_STAGES) {
    assert.ok(STAGE_IDS[stage], `no id mapped for "${stage}"`);
  }
  assert.equal(Object.keys(STAGE_IDS).length, DEAL_STAGES.length);
});

test("renamed stages keep HubSpot's original ids, which do NOT match the labels", () => {
  // This is the whole reason the map exists. If someone "tidies" these to
  // match the labels, every new lead files under the wrong stage.
  assert.equal(stageIdFor("New Lead"), "appointmentscheduled");
  assert.equal(stageIdFor("Contacting"), "qualifiedtobuy");
  assert.equal(stageIdFor("Appointment Scheduled"), "presentationscheduled");
  assert.equal(stageIdFor("Estimate in Progress"), "decisionmakerboughtin");
  assert.equal(stageIdFor("Estimate Sent"), "contractsent");
});

test("Decision Pending is the one stage created fresh, so it has a numeric id", () => {
  assert.match(stageIdFor("Decision Pending"), /^\d+$/);
});

test("the closed stages keep HubSpot's own ids", () => {
  assert.equal(stageIdFor("Closed Won"), "closedwon");
  assert.equal(stageIdFor("Closed Lost"), "closedlost");
});

test("stage ids are unique, so no two stages collide", () => {
  const ids = Object.values(STAGE_IDS);
  assert.equal(new Set(ids).size, ids.length);
});

test("the reverse map round-trips every stage", () => {
  for (const stage of DEAL_STAGES) {
    assert.equal(STAGE_BY_ID[STAGE_IDS[stage]], stage);
  }
});

test("an unmapped stage throws rather than silently filing the deal wrong", () => {
  assert.throws(() => stageIdFor("Nonsense" as DealStage), /No HubSpot stage id/);
});

// --- Contacts ---------------------------------------------------------------

test("contact properties map to HubSpot's own field names", () => {
  assert.deepEqual(
    contactProperties({
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@example.com",
      phone: "+12085550177",
    }),
    { firstname: "Jane", lastname: "Doe", email: "jane@example.com", phone: "+12085550177" },
  );
});

test("null contact fields are omitted, never sent as empty strings", () => {
  const props = contactProperties({
    firstName: "Jane", lastName: null, email: null, phone: "+12085550177",
  });
  assert.deepEqual(Object.keys(props).sort(), ["firstname", "phone"]);
});

// --- Deals ------------------------------------------------------------------

function deal(overrides: Partial<DealSyncInput> = {}): DealSyncInput {
  return {
    name: "Doe | Boise Remodeling Co | Kitchen remodel | Boise",
    brand: "Boise Remodeling Co",
    stage: "New Lead",
    leadSource: "Organic Website",
    leadSourceDetail: null,
    projectType: "Kitchen remodel",
    propertyAddress: "123 N Main St",
    propertyCity: "Boise",
    serviceArea: "Boise",
    summary: "Wants the kitchen opened up.",
    estimatedValue: null,
    assignedTeamMember: "Dana Coordinator",
    hubspotOwnerId: null,
    receivedAt: new Date("2026-08-21T16:00:00Z"),
    slaDeadline: new Date("2026-08-21T16:05:00Z"),
    slaStatus: "on_track",
    firstAttemptAt: null,
    firstTwoWayAt: null,
    nextAction: "Make first contact",
    nextActionAt: new Date("2026-08-21T16:05:00Z"),
    appointmentAt: null,
    externalLeadId: null,
    facebookLeadId: null,
    originalForm: "matcher",
    originalCampaign: null,
    closedLostReason: null,
    ...overrides,
  };
}

test("a deal maps onto the pipeline and the correct stage id", () => {
  const p = dealProperties(deal());
  assert.equal(p.pipeline, PIPELINE_ID);
  assert.equal(p.dealstage, "appointmentscheduled");
  assert.equal(p.dealname, "Doe | Boise Remodeling Co | Kitchen remodel | Boise");
});

test("P5 custom properties use the p5_ prefix the setup script creates", () => {
  const p = dealProperties(deal());
  assert.equal(p.p5_brand, "Boise Remodeling Co");
  assert.equal(p.p5_lead_source, "Organic Website");
  assert.equal(p.p5_project_type, "Kitchen remodel");
  assert.equal(p.p5_property_city, "Boise");
  assert.equal(p.p5_assigned_team_member, "Dana Coordinator");
  assert.equal(p.p5_original_form, "matcher");
});

test("null fields are omitted entirely, so a sync cannot blank a human's entry", () => {
  // HubSpot reads "" as "clear this field". Sending every key on every sync
  // would erase anything typed in HubSpot that P5 does not track.
  const p = dealProperties(deal({ summary: null, projectType: null, nextAction: null }));
  assert.ok(!("description" in p));
  assert.ok(!("p5_project_type" in p));
  assert.ok(!("p5_next_action" in p));
  assert.ok(Object.values(p).every((v) => v !== ""), "no empty-string values");
});

test("datetimes are epoch milliseconds, which is what HubSpot expects", () => {
  const p = dealProperties(deal());
  assert.equal(p.p5_sla_deadline, String(new Date("2026-08-21T16:05:00Z").getTime()));
  assert.match(p.p5_sla_deadline, /^\d+$/);
});

test("SLA status maps to the configured option labels, not the raw enum", () => {
  assert.equal(dealProperties(deal({ slaStatus: "on_track" })).p5_sla_status, "On track");
  assert.equal(dealProperties(deal({ slaStatus: "breached" })).p5_sla_status, "Breached");
  assert.equal(dealProperties(deal({ slaStatus: "after_hours" })).p5_sla_status, "After hours");
});

test("an unrecognised SLA status is omitted rather than sent as garbage", () => {
  const p = dealProperties(deal({ slaStatus: "invented" }));
  assert.ok(!("p5_sla_status" in p));
});

test("amount is only sent when there is a real figure", () => {
  assert.ok(!("amount" in dealProperties(deal({ estimatedValue: null }))));
  assert.equal(dealProperties(deal({ estimatedValue: 42500 })).amount, "42500");
});

test("a closed-lost deal carries its reason to HubSpot's own property", () => {
  const p = dealProperties(deal({ stage: "Closed Lost", closedLostReason: "Price" }));
  assert.equal(p.dealstage, "closedlost");
  assert.equal(p.closed_lost_reason, "Price");
});

test("every brand maps through without throwing", () => {
  for (const brand of [
    "P5 Home Co", "Boise Construction Co", "Boise Remodeling Co",
    "Boise Handyman Co", "Boise ADU Co", "Boise Cabinet Co",
  ] as const) {
    assert.equal(dealProperties(deal({ brand })).p5_brand, brand);
  }
});
