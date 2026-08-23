import { test } from "node:test";
import assert from "node:assert/strict";

import {
  canTransitionWaiver,
  deriveComplianceStatus,
  evaluatePaymentGate,
  nextWaiverNeeded,
  type PaymentGateInput,
  type VendorDoc,
} from "../app/lib/finance/compliance.ts";

const TODAY = new Date(2026, 7, 22);
const REMINDERS = [30, 14, 7, 0];

function doc(overrides: Partial<VendorDoc> = {}): VendorDoc {
  return {
    docType: "General Liability",
    required: true,
    status: "verified",
    expiresOn: new Date(2027, 7, 1),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// S88: compliance status derivation
// ---------------------------------------------------------------------------

test("compliance: all verified and far from expiry is Compliant", () => {
  assert.equal(deriveComplianceStatus([doc()], TODAY, REMINDERS), "Compliant");
});

test("compliance: any expired required document is a Payment Hold", () => {
  const docs = [doc(), doc({ docType: "Workers Comp", expiresOn: new Date(2026, 6, 1) })];
  assert.equal(deriveComplianceStatus(docs, TODAY, REMINDERS), "Payment Hold");
});

test("compliance: missing required document means Onboarding Required", () => {
  const docs = [doc({ status: "missing", expiresOn: null })];
  assert.equal(deriveComplianceStatus(docs, TODAY, REMINDERS), "Onboarding Required");
});

test("compliance: received-but-unverified sits in Compliance Review", () => {
  const docs = [doc({ status: "received" })];
  assert.equal(deriveComplianceStatus(docs, TODAY, REMINDERS), "Compliance Review");
});

test("compliance: verified but expiring within the reminder window is Expiring Soon", () => {
  const docs = [doc({ expiresOn: new Date(2026, 8, 10) })]; // 19 days out
  assert.equal(deriveComplianceStatus(docs, TODAY, REMINDERS), "Expiring Soon");
});

test("compliance: waived documents do not block; inactive vendors read Inactive", () => {
  const docs = [doc({ status: "waived", expiresOn: null })];
  assert.equal(deriveComplianceStatus(docs, TODAY, REMINDERS), "Compliant");
  assert.equal(deriveComplianceStatus(docs, TODAY, REMINDERS, false), "Inactive");
});

// ---------------------------------------------------------------------------
// S105: the payment hard gate
// ---------------------------------------------------------------------------

function gate(overrides: Partial<PaymentGateInput> = {}): PaymentGateInput {
  return {
    vendorActive: true,
    complianceStatus: "Compliant",
    manualHold: false,
    manualHoldReason: null,
    billFullyCoded: true,
    duplicateReviewed: true,
    workVerified: true,
    withinAuthorizedAmount: true,
    lienWaiverSatisfied: true,
    lienWaiverRequired: true,
    approvalsSatisfied: true,
    ...overrides,
  };
}

test("gate: everything satisfied is Ready to Pay with no hold reasons", () => {
  const r = evaluatePaymentGate(gate());
  assert.equal(r.readyToPay, true);
  assert.deepEqual(r.holdReasons, []);
});

test("gate: every failing check blocks and names its exact reason", () => {
  const r = evaluatePaymentGate(
    gate({
      complianceStatus: "Payment Hold",
      billFullyCoded: false,
      lienWaiverSatisfied: false,
    }),
  );
  assert.equal(r.readyToPay, false);
  assert.equal(r.holdReasons.length, 3);
  assert.ok(r.holdReasons.some((m) => m.includes("Payment Hold")));
  assert.ok(r.holdReasons.some((m) => m.includes("coding")));
  assert.ok(r.holdReasons.some((m) => m.includes("lien waiver")));
});

test("gate: manual hold reason is surfaced verbatim", () => {
  const r = evaluatePaymentGate(
    gate({ manualHold: true, manualHoldReason: "Bank change pending verification (S109)" }),
  );
  assert.equal(r.readyToPay, false);
  assert.ok(r.holdReasons[0].includes("Bank change pending verification"));
});

test("gate: vendors without a lien-waiver requirement are not blocked by one", () => {
  const r = evaluatePaymentGate(
    gate({ lienWaiverRequired: false, lienWaiverSatisfied: false }),
  );
  assert.equal(r.readyToPay, true);
});

test("gate: Expiring Soon still pays; expiry becomes a hold only when it lapses", () => {
  assert.equal(evaluatePaymentGate(gate({ complianceStatus: "Expiring Soon" })).readyToPay, true);
  assert.equal(evaluatePaymentGate(gate({ complianceStatus: "Payment Hold" })).readyToPay, false);
});

// ---------------------------------------------------------------------------
// S94-S97: lien waiver lifecycle
// ---------------------------------------------------------------------------

test("waiver lifecycle: the happy path is legal end to end", () => {
  assert.ok(canTransitionWaiver("required", "requested"));
  assert.ok(canTransitionWaiver("requested", "received"));
  assert.ok(canTransitionWaiver("received", "signed"));
  assert.ok(canTransitionWaiver("signed", "reviewed"));
  assert.ok(canTransitionWaiver("reviewed", "accepted"));
});

test("waiver lifecycle: skipping review or resurrecting accepted waivers is illegal", () => {
  assert.equal(canTransitionWaiver("received", "accepted"), false);
  assert.equal(canTransitionWaiver("accepted", "requested"), false);
  assert.equal(canTransitionWaiver("required", "accepted"), false);
});

test("waiver lifecycle: a rejection can be re-requested", () => {
  assert.ok(canTransitionWaiver("rejected", "requested"));
});

test("next waiver: conditional before payment, unconditional after clearing (S96/S97)", () => {
  assert.equal(nextWaiverNeeded(false, false), "Conditional Progress");
  assert.equal(nextWaiverNeeded(false, true), "Unconditional Progress");
  assert.equal(nextWaiverNeeded(true, false), "Conditional Final");
  assert.equal(nextWaiverNeeded(true, true), "Unconditional Final");
});
