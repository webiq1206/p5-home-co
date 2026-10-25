import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  HUBSPOT_PROJECT_TYPES,
  PIPELINE_ID,
  STAGE_BY_ID,
  STAGE_IDS,
  contactProperties,
  dealProperties,
  hubspotProjectType,
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

test("attribution maps only to verified dedicated HubSpot fields", () => {
  const input = deal({ attribution: { gclid: "click-id", utm_campaign: "spring" } });
  const p = dealProperties(input, new Set(["p5_gclid"]));
  assert.equal(p.p5_gclid, "click-id");
  assert.ok(!("p5_utm_campaign" in p));
  assert.ok(!("gclid" in p));
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

test("quote project labels map to HubSpot options, and unsafe labels are omitted", () => {
  const cases: Array<[string | null | undefined, string | undefined]> = [
    ["Accessory dwelling unit (ADU)", "Detached ADU"],
    ["  Accessory dwelling unit (ADU)  ", "Detached ADU"],
    ["Home addition", "Addition, ADU, or basement"],
    ["Basement finishing", "Basement or interior unit"],
    ["New custom home", "Custom home"],
    ["Custom cabinets or built-ins", "Built-ins or storage"],
    ["Home repairs or handyman work", "handyman"],
    ["Something else, or I am not sure", undefined],
    ["Kitchen remodel", "Kitchen remodel"],
    ["Bathroom remodel", "Bathroom remodel"],
    ["Whole-home remodel", "Whole-home remodel"],
    ["Build on land I own", "Build on land I own"],
    ["Garage conversion", "Garage conversion"],
    ["Bathroom vanity", "Bathroom vanity"],
    ["handyman", "handyman"],
    ["re10", "re10"],
    ["cabinet-product", "cabinet-product"],
    ["cabinet-install", "cabinet-install"],
    ["kitchen", "kitchen"],
    ["adu", "adu"],
    ["new-construction", "new-construction"],
    ["Not a real project", undefined],
    ["", undefined],
    ["   ", undefined],
    [null, undefined],
    [undefined, undefined],
  ];
  for (const [input, expected] of cases) {
    assert.equal(hubspotProjectType(input), expected, String(input));
  }
});

test("the project type allowlist matches the portal options that do not 400", () => {
  // Portal 247066159 enumeration, including setup-script labels and later slugs.
  const portal = [
    "Custom home",
    "Semi-custom home",
    "Build on land I own",
    "Home plans or lot evaluation",
    "Kitchen remodel",
    "Bathroom remodel",
    "Whole-home remodel",
    "Addition, ADU, or basement",
    "Detached ADU",
    "Garage conversion",
    "Basement or interior unit",
    "Feasibility and permits",
    "Drywall or trim repair",
    "Mounting or installation",
    "Deck or exterior repair",
    "A multi-item home list",
    "Kitchen cabinets",
    "Bathroom vanity",
    "Built-ins or storage",
    "Whole-home cabinetry",
    "handyman",
    "re10",
    "cabinet-product",
    "cabinet-install",
    "kitchen",
    "bathroom",
    "remodel",
    "whole-home",
    "addition",
    "adu",
    "new-construction",
    "change-order",
    "rush",
  ];
  assert.equal(HUBSPOT_PROJECT_TYPES.size, portal.length);
  for (const value of portal) {
    assert.equal(HUBSPOT_PROJECT_TYPES.has(value), true, value);
  }
});

test("every public quote option is either a HubSpot value or explicitly omitted", () => {
  const source = readFileSync(new URL("../app/quote/options.ts", import.meta.url), "utf8");
  const block = source.slice(source.indexOf("export const PROJECT_OPTIONS"), source.indexOf("] as const;"));
  const values = [...block.matchAll(/value:\s*"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(values, [
    "Kitchen remodel",
    "Bathroom remodel",
    "Whole-home remodel",
    "Home addition",
    "Basement finishing",
    "New custom home",
    "Build on land I own",
    "Accessory dwelling unit (ADU)",
    "Garage conversion",
    "Custom cabinets or built-ins",
    "Bathroom vanity",
    "Home repairs or handyman work",
    "Something else, or I am not sure",
  ]);
  for (const value of values) {
    const mapped = hubspotProjectType(value);
    if (value === "Something else, or I am not sure") {
      assert.equal(mapped, undefined);
    } else {
      assert.equal(HUBSPOT_PROJECT_TYPES.has(mapped ?? ""), true, value);
    }
  }
});

test("deal sync sends the mapped project type and drops values HubSpot would reject", () => {
  assert.equal(
    dealProperties(deal({ projectType: "Accessory dwelling unit (ADU)" })).p5_project_type,
    "Detached ADU",
  );
  assert.equal(
    dealProperties(deal({ projectType: "Home repairs or handyman work" })).p5_project_type,
    "handyman",
  );
  const unsure = dealProperties(deal({ projectType: "Something else, or I am not sure" }));
  assert.equal("p5_project_type" in unsure, false);
  const unknown = dealProperties(deal({ projectType: "Solar panels on the shop" }));
  assert.equal("p5_project_type" in unknown, false);
  assert.equal(unknown.p5_brand, "Boise Remodeling Co");
  assert.equal(unknown.dealstage, "appointmentscheduled");
});

test("every brand maps through without throwing", () => {
  for (const brand of [
    "P5 Home Co", "Boise Construction Co", "Boise Remodeling Co",
    "Boise Handyman Co", "Boise ADU Co", "Boise Cabinet Co",
  ] as const) {
    assert.equal(dealProperties(deal({ brand })).p5_brand, brand);
  }
});
