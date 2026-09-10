import { test } from "node:test";
import assert from "node:assert/strict";
import { actionResolvesIncident, planIncidents } from "../app/lib/notifications/incidents.ts";
import { evaluateDeal, type DealSnapshot } from "../app/lib/leads/rules.ts";
import { DEFAULT_SETTINGS } from "../app/lib/leads/settings.ts";

const received = new Date("2026-08-21T16:00:00Z");
const now = new Date("2026-08-25T18:00:00Z");
const deal: DealSnapshot = {
  id: 1, stage: "New Lead", ownerUserId: 1, receivedAt: received,
  firstAttemptAt: null, firstTwoWayAt: null, nextAction: "Make first contact",
  nextActionAt: new Date(received.getTime() + 300_000), appointmentAt: null,
  snoozedUntil: null, closedLostReason: null, lastActivityAt: null, clientWaitingSince: null,
};
const plans = (d: DealSnapshot, at = now) => planIncidents(evaluateDeal(d, DEFAULT_SETTINGS, at), d);

test("the alternating urgent subjects, first overdue action and stale lead share one task", () => {
  const p = plans(deal);
  assert.equal(p.length, 1);
  assert.equal(p[0].family, "first_response");
  assert.ok(p[0].kinds.includes("sla_breach"));
  assert.ok(p[0].kinds.includes("response_ceiling_breached"));
  assert.ok(p[0].kinds.includes("next_action_overdue"));
  assert.ok(p[0].kinds.includes("stale_deal"));
});

test("elapsed time and escalating severity preserve the first-response occurrence", () => {
  const first = plans(deal, new Date(received.getTime() + 6 * 60_000))[0];
  const later = plans(deal)[0];
  assert.equal(first.family, later.family);
  assert.equal(first.anchor, later.anchor);
});

test("a different missed follow-up or new unanswered message has a different occurrence", () => {
  const contacted = { ...deal, firstAttemptAt: received };
  const first = plans(contacted).find((p) => p.family === "next_action")!;
  const next = plans({ ...contacted, nextActionAt: new Date("2026-08-24T18:00:00Z") }).find((p) => p.family === "next_action")!;
  assert.notEqual(first.anchor, next.anchor);
});

test("explicit HubSpot actions resolve only their applicable issue", () => {
  assert.equal(actionResolvesIncident("first_response", received.toISOString(), { p5_first_attempt_at: received.toISOString() }, now), true);
  assert.equal(actionResolvesIncident("first_response", received.toISOString(), { p5_first_attempt_at: "invalid" }, now), false);
  assert.equal(actionResolvesIncident("first_response", received.toISOString(), { p5_first_attempt_at: "2030-01-01" }, now), false);
  assert.equal(actionResolvesIncident("first_response", received.toISOString(), { hubspot_owner_id: "1" }, now), false);
  assert.equal(actionResolvesIncident("next_action", "x", { p5_next_action: "Call", p5_next_action_at: "2026-08-26T18:00:00Z" }, now), true);
  assert.equal(actionResolvesIncident("next_action", "x", { p5_next_action: "Call", p5_next_action_at: "2026-08-24T18:00:00Z" }, now), false);
  assert.equal(actionResolvesIncident("first_response", "x", { dealstage: "closedlost" }, now), true);
  assert.equal(actionResolvesIncident("closed_lost_missing_reason", "x", { dealstage: "closedlost" }, now), false);
});
