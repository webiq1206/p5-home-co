import { test } from "node:test";
import assert from "node:assert/strict";

import { renderBundle, subjectFor, waitingFor } from "../app/lib/notifications/render.ts";
import type { Bundle, Notifiable } from "../app/lib/notifications/routing.ts";

const NOW = new Date("2026-08-21T18:00:00Z");

function item(o: Partial<Notifiable> = {}): Notifiable {
  return {
    alertId: 1, dealId: 42, kind: "sla_breach", tier: "owner",
    reason: "No one has contacted this lead yet.",
    clientName: "Maria Alvarez", brand: "Boise Remodeling Co",
    raisedAt: new Date("2026-08-21T17:00:00Z"), receivedAt: new Date("2026-08-21T17:00:00Z"), lastNotifiedAt: null,
    ownerEmail: "dana@p5homeco.com", ownerName: "Dana", ownerUserId: 1, ...o,
  };
}
const bundle = (items: Notifiable[]): Bundle => ({
  recipient: { userId: 1, email: "dana@p5homeco.com", name: "Dana Coordinator" },
  items,
});

test("waiting time reads in the largest sensible unit", () => {
  assert.equal(waitingFor(item({ receivedAt: new Date("2026-08-21T17:35:00Z") }), NOW), "25 minutes");
  assert.equal(waitingFor(item({ receivedAt: new Date("2026-08-21T09:00:00Z") }), NOW), "9 hours");
  assert.equal(waitingFor(item({ receivedAt: new Date("2026-08-19T18:00:00Z") }), NOW), "2 days");
});

test("the subject names the customer and the wait, not a generic count", () => {
  // "3 leads need attention" is indistinguishable from noise.
  const s = subjectFor(
    bundle([item({ kind: "response_ceiling_breached", receivedAt: new Date("2026-08-21T09:00:00Z") })]),
    NOW,
  );
  assert.match(s, /URGENT/);
  assert.match(s, /Maria Alvarez/);
  assert.match(s, /9 hours/);
});

test("critical reads as urgent, routine does not", () => {
  assert.match(subjectFor(bundle([item({ tier: "critical" })]), NOW), /URGENT/);
  assert.doesNotMatch(subjectFor(bundle([item({ tier: "owner" })]), NOW), /URGENT/);
});

test("extra leads are counted in the subject rather than hidden", () => {
  assert.match(subjectFor(bundle([item(), item({ alertId: 2 }), item({ alertId: 3 })]), NOW), /\+2 more/);
});

test("an unowned lead and an overdue promise get their own wording", () => {
  assert.match(subjectFor(bundle([item({ kind: "missing_owner" })]), NOW), /has no owner/);
  assert.match(subjectFor(bundle([item({ kind: "next_action_overdue" })]), NOW), /follow-up overdue/);
});

test("the body carries a direct link to each lead, so acting is one tap", () => {
  const m = renderBundle(bundle([item({ dealId: 42 })]), "https://p5homeco.com", NOW);
  assert.match(m.text, /https:\/\/p5homeco\.com\/admin\/lead\/42/);
  assert.match(m.html, /https:\/\/p5homeco\.com\/admin\/lead\/42/);
});

test("every lead in a bundle appears in both plain text and html", () => {
  const m = renderBundle(
    bundle([item({ dealId: 1, clientName: "Maria Alvarez" }), item({ dealId: 2, clientName: "Bob Stone" })]),
    "https://p5homeco.com", NOW,
  );
  for (const body of [m.text, m.html]) {
    assert.match(body, /Maria Alvarez/);
    assert.match(body, /Bob Stone/);
  }
  assert.match(m.text, /2 leads need you/);
});

test("html is escaped, so a name cannot inject markup into the email", () => {
  const m = renderBundle(
    bundle([item({ clientName: '<img src=x onerror="alert(1)">' })]),
    "https://p5homeco.com", NOW,
  );
  assert.ok(!m.html.includes("<img src=x"), "raw tag must not survive into the html");
  assert.match(m.html, /&lt;img/);
});

test("the reason is repeated verbatim, so the email says why", () => {
  const m = renderBundle(
    bundle([item({ reason: "Promised follow-up is 90 business minutes late: Call Maria back." })]),
    "https://p5homeco.com", NOW,
  );
  assert.match(m.text, /Promised follow-up is 90 business minutes late/);
});

test("the wait is the customer's, not the alert's age", () => {
  // The bug this guards: an alert raised seconds ago on a lead that arrived
  // nine hours earlier reported "0 minutes", undercutting its own urgency.
  const justFired = item({
    kind: "response_ceiling_breached",
    raisedAt: new Date("2026-08-21T17:59:30Z"),
    receivedAt: new Date("2026-08-21T09:00:00Z"),
  });
  assert.equal(waitingFor(justFired, NOW), "9 hours");
  assert.match(subjectFor(bundle([justFired]), NOW), /9 hours/);
});
