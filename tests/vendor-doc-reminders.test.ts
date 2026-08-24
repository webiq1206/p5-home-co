import { test } from "node:test";
import assert from "node:assert/strict";

import {
  cycleTokenFor,
  friendlyDate,
  reminderStageFor,
  renderVendorDocumentReminder,
} from "../app/lib/finance/vendor-reminders.ts";

const LADDER = [30, 14, 7, 0];
// Local-time dates on purpose: daysUntil compares calendar days in local time.
const TODAY = new Date(2026, 7, 24); // 24 Aug 2026
const on = (m: number, d: number) => new Date(2026, m, d);

// ---------------------------------------------------------------------------
// reminderStageFor: which band a document sits in
// ---------------------------------------------------------------------------

test("missing and requested documents always remind, with no day count", () => {
  assert.deepEqual(reminderStageFor("missing", null, TODAY, LADDER), { stage: "missing", days: null });
  assert.deepEqual(reminderStageFor("requested", null, TODAY, LADDER), { stage: "missing", days: null });
});

test("a waived document never reminds", () => {
  assert.equal(reminderStageFor("waived", on(7, 25), TODAY, LADDER), null);
});

test("expired by status or by a past date reports the 'expired' band", () => {
  assert.deepEqual(reminderStageFor("expired", null, TODAY, LADDER), { stage: "expired", days: null });
  // Verified but the certificate date is already 4 days in the past.
  assert.deepEqual(reminderStageFor("verified", on(7, 20), TODAY, LADDER), { stage: "expired", days: -4 });
});

test("expiring documents fall into the tightest ladder rung they have reached", () => {
  assert.deepEqual(reminderStageFor("verified", on(8, 13), TODAY, LADDER), { stage: "t30", days: 20 });
  assert.deepEqual(reminderStageFor("verified", on(8, 5), TODAY, LADDER), { stage: "t14", days: 12 });
  assert.deepEqual(reminderStageFor("verified", on(7, 30), TODAY, LADDER), { stage: "t7", days: 6 });
  assert.deepEqual(reminderStageFor("verified", on(7, 24), TODAY, LADDER), { stage: "t0", days: 0 });
});

test("a document further out than the widest rung does not remind yet", () => {
  assert.equal(reminderStageFor("verified", on(9, 10), TODAY, LADDER), null); // ~47 days out
});

test("a received-but-unverified document still reminds when it is expiring", () => {
  assert.deepEqual(reminderStageFor("received", on(7, 29), TODAY, LADDER), { stage: "t7", days: 5 });
});

// ---------------------------------------------------------------------------
// cycleTokenFor: renewing a certificate reopens the ladder
// ---------------------------------------------------------------------------

test("cycle token is stable per state and resets meaning across renewals", () => {
  assert.equal(cycleTokenFor("missing", null), "missing");
  assert.equal(cycleTokenFor("requested", on(8, 1)), "missing");
  assert.equal(cycleTokenFor("verified", null), "none");
  assert.match(cycleTokenFor("verified", on(8, 13)), /^\d{4}-\d{2}-\d{2}$/);
});

// ---------------------------------------------------------------------------
// friendlyDate
// ---------------------------------------------------------------------------

test("friendlyDate formats an ISO date without drifting a day", () => {
  assert.equal(friendlyDate("2026-09-05"), "September 5, 2026");
  assert.equal(friendlyDate("2026-01-31"), "January 31, 2026");
});

// ---------------------------------------------------------------------------
// renderVendorDocumentReminder: wording
// ---------------------------------------------------------------------------

const base = {
  vendorName: "Ada Plumbing LLC",
  contactName: "Bob Vila",
  replyTo: "accounting@p5homeco.com",
};

test("missing reminder names the document and asks for it", () => {
  const m = renderVendorDocumentReminder({
    ...base,
    docType: "W-9",
    stage: "missing",
    days: null,
    expiresOn: null,
  });
  assert.match(m.subject, /we need your W-9/);
  assert.match(m.text, /^Hi Bob,/);
  assert.match(m.text, /do not currently have your W-9/);
  assert.match(m.text, /accounting@p5homeco\.com/);
});

test("expired reminder states payments are on hold and gives the date", () => {
  const m = renderVendorDocumentReminder({
    ...base,
    docType: "General Liability",
    stage: "expired",
    days: -3,
    expiresOn: "2026-08-21",
  });
  assert.match(m.subject, /has expired/);
  assert.match(m.text, /expired on August 21, 2026/);
  assert.match(m.text, /payments to you are on hold/);
});

test("expiring reminder gives the day count and the expiry date, singular at 1", () => {
  const many = renderVendorDocumentReminder({
    ...base,
    docType: "Workers Comp",
    stage: "t14",
    days: 12,
    expiresOn: "2026-09-05",
  });
  assert.match(many.subject, /expires in 12 days/);
  assert.match(many.text, /September 5, 2026/);

  const one = renderVendorDocumentReminder({
    ...base,
    docType: "Workers Comp",
    stage: "t0",
    days: 1,
    expiresOn: "2026-08-25",
  });
  assert.match(one.subject, /expires in 1 day\b/);
});

test("an empty contact name falls back to a safe greeting", () => {
  const m = renderVendorDocumentReminder({
    ...base,
    contactName: "",
    docType: "W-9",
    stage: "missing",
    days: null,
    expiresOn: null,
  });
  assert.match(m.text, /^Hi there,/);
});

test("reminders contain no em dashes or en dashes", () => {
  const stages: { stage: string; days: number | null; expiresOn: string | null }[] = [
    { stage: "missing", days: null, expiresOn: null },
    { stage: "expired", days: -2, expiresOn: "2026-08-22" },
    { stage: "t7", days: 5, expiresOn: "2026-08-29" },
  ];
  for (const s of stages) {
    const m = renderVendorDocumentReminder({ ...base, docType: "Umbrella", ...s });
    for (const part of [m.subject, m.text, m.html]) {
      assert.equal(part.includes("—"), false, "no em dash");
      assert.equal(part.includes("–"), false, "no en dash");
    }
  }
});
