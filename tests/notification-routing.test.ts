import { test } from "node:test";
import assert from "node:assert/strict";

import {
  bundleByRecipient,
  isUrgent,
  recipientsFor,
  shouldSendNow,
  type Notifiable,
  type Recipient,
} from "../app/lib/notifications/routing.ts";
import { P5_CALENDAR, fromZonedParts } from "../app/lib/leads/time.ts";

const CAL = P5_CALENDAR;
const TZ = CAL.timeZone;
const boise = (y: number, mo: number, d: number, h: number, mi = 0) =>
  fromZonedParts({ year: y, month: mo, day: d, hour: h, minute: mi }, TZ);

const OWNER: Recipient = { userId: 1, email: "dana@p5homeco.com", name: "Dana" };
const MANAGERS: Recipient[] = [{ userId: 2, email: "mgr@p5homeco.com", name: "Manager" }];
const ADMINS: Recipient[] = [{ userId: 3, email: "hello@p5homeco.com", name: "Client Services" }];

function item(overrides: Partial<Notifiable> = {}): Notifiable {
  return {
    alertId: 1, dealId: 1, kind: "sla_breach", tier: "owner",
    reason: "No one has contacted this lead yet.",
    clientName: "Maria Alvarez", brand: "Boise Remodeling Co",
    raisedAt: boise(2026, 8, 21, 10), receivedAt: boise(2026, 8, 21, 10), lastNotifiedAt: null,
    ownerEmail: OWNER.email, ownerName: OWNER.name, ownerUserId: 1,
    ...overrides,
  };
}

// --- Cooldown: the difference between useful and spam ----------------------

test("an alert already sent recently is not sent again", () => {
  const now = boise(2026, 8, 21, 10, 30);
  const r = shouldSendNow(item({ lastNotifiedAt: boise(2026, 8, 21, 10, 20) }), now, CAL, 30);
  assert.equal(r.send, false);
  if (!r.send) assert.match(r.because, /notified/);
});

test("once the cooldown has passed it goes out again", () => {
  const now = boise(2026, 8, 21, 11, 30);
  assert.equal(shouldSendNow(item({ lastNotifiedAt: boise(2026, 8, 21, 10, 30) }), now, CAL, 30).send, true);
});

// --- Quiet hours: what may wake someone up ---------------------------------

test("routine alerts wait for business hours instead of arriving overnight", () => {
  // 2am Saturday. A nudge here trains people to mute the system.
  const r = shouldSendNow(item({ tier: "owner" }), boise(2026, 8, 22, 2), CAL, 30);
  assert.equal(r.send, false);
  if (!r.send) assert.match(r.because, /outside business hours/);
});

test("the wall-clock ceiling breach goes out whatever the hour", () => {
  // Somebody has been waiting eight hours. Holding this until morning would
  // make the system complicit in the delay it exists to prevent.
  assert.equal(
    shouldSendNow(item({ kind: "response_ceiling_breached", tier: "administrator" }), boise(2026, 8, 22, 2), CAL, 30).send,
    true,
  );
});

test("Critical goes out overnight too, but an owner-tier nudge does not", () => {
  const twoAM = boise(2026, 8, 22, 2);
  assert.equal(shouldSendNow(item({ tier: "critical" }), twoAM, CAL, 30).send, true);
  assert.equal(shouldSendNow(item({ tier: "owner" }), twoAM, CAL, 30).send, false);
});

test("routine alerts do send during the working day", () => {
  assert.equal(shouldSendNow(item({ tier: "owner" }), boise(2026, 8, 21, 10), CAL, 30).send, true);
});

test("urgency is about the ceiling and the top tiers, nothing else", () => {
  assert.equal(isUrgent(item({ tier: "owner" })), false);
  assert.equal(isUrgent(item({ tier: "owner_manager" })), false);
  assert.equal(isUrgent(item({ tier: "critical" })), true);
  assert.equal(isUrgent(item({ tier: "administrator" })), true);
  assert.equal(isUrgent(item({ kind: "response_ceiling_breached", tier: "none" })), true);
});

// --- Who hears about it -----------------------------------------------------

test("an owner-tier alert reaches only the owner", () => {
  assert.deepEqual(
    recipientsFor(item({ tier: "owner" }), MANAGERS, ADMINS).map((r) => r.email),
    ["dana@p5homeco.com"],
  );
});

test("escalation pulls in the manager, then administrators", () => {
  assert.deepEqual(
    recipientsFor(item({ tier: "owner_manager" }), MANAGERS, ADMINS).map((r) => r.email),
    ["dana@p5homeco.com", "mgr@p5homeco.com"],
  );
  assert.deepEqual(
    recipientsFor(item({ tier: "administrator" }), MANAGERS, ADMINS).map((r) => r.email),
    ["dana@p5homeco.com", "mgr@p5homeco.com", "hello@p5homeco.com"],
  );
});

test("an unowned lead goes to whoever can assign it, not into the void", () => {
  const r = recipientsFor(
    item({ kind: "missing_owner", tier: "owner_manager", ownerEmail: null, ownerName: null, ownerUserId: null }),
    MANAGERS, ADMINS,
  );
  assert.deepEqual(r.map((x) => x.email), ["mgr@p5homeco.com"]);
});

test("nobody is mailed twice for being both owner and manager", () => {
  // Small team: the same person wears both hats.
  const both: Recipient[] = [{ userId: 1, email: "Dana@P5HomeCo.com", name: "Dana" }];
  const r = recipientsFor(item({ tier: "administrator" }), both, both);
  assert.equal(r.length, 1);
});

// --- Bundling: one message, not five ---------------------------------------

test("alerts are grouped into one message per person", () => {
  const bundles = bundleByRecipient([
    { item: item({ alertId: 1, dealId: 1 }), recipients: [OWNER] },
    { item: item({ alertId: 2, dealId: 2 }), recipients: [OWNER] },
    { item: item({ alertId: 3, dealId: 3 }), recipients: [OWNER, ...MANAGERS] },
  ]);
  assert.equal(bundles.length, 2);
  const dana = bundles.find((b) => b.recipient.email === OWNER.email);
  assert.equal(dana?.items.length, 3, "one message listing three leads, not three messages");
});

test("within a message the worst comes first, then the longest waiting", () => {
  const bundles = bundleByRecipient([
    { item: item({ alertId: 1, tier: "owner", raisedAt: boise(2026, 8, 21, 9) }), recipients: [OWNER] },
    { item: item({ alertId: 2, tier: "administrator", raisedAt: boise(2026, 8, 21, 11) }), recipients: [OWNER] },
    { item: item({ alertId: 3, tier: "owner", raisedAt: boise(2026, 8, 21, 8) }), recipients: [OWNER] },
  ]);
  assert.deepEqual(bundles[0].items.map((i) => i.alertId), [2, 3, 1]);
});

test("no recipients means no bundle, rather than an empty message", () => {
  assert.deepEqual(bundleByRecipient([{ item: item(), recipients: [] }]), []);
});
