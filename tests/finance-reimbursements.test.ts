import { test } from "node:test";
import assert from "node:assert/strict";

import {
  canTransitionReimbursement,
  payability,
  statusOnSubmit,
} from "../app/lib/finance/reimbursements.ts";

// ---------------------------------------------------------------------------
// S117: a missing receipt changes the STATE, not just a warning label.
// ---------------------------------------------------------------------------

test("a claim without a receipt is held, not merely flagged", () => {
  assert.equal(statusOnSubmit(null), "hold_missing_receipt");
  assert.equal(statusOnSubmit(""), "hold_missing_receipt");
  assert.equal(statusOnSubmit("   "), "hold_missing_receipt");
  assert.equal(statusOnSubmit("drive://receipt-123"), "submitted");
});

test("a held claim cannot be approved without going back through submission", () => {
  // Approving straight from hold would let someone click past the receipt
  // requirement, turning a business expense into an unsupported owner draw.
  assert.equal(canTransitionReimbursement("hold_missing_receipt", "approved"), false);
  assert.equal(canTransitionReimbursement("hold_missing_receipt", "submitted"), true);
  assert.equal(canTransitionReimbursement("hold_missing_receipt", "rejected"), true);
});

// ---------------------------------------------------------------------------
// S118: the liability must be recorded before money moves, or the underlying
// expense gets counted twice.
// ---------------------------------------------------------------------------

test("nothing reaches paid without being recorded first", () => {
  assert.equal(canTransitionReimbursement("submitted", "paid"), false);
  assert.equal(canTransitionReimbursement("approved", "paid"), false);
  assert.equal(canTransitionReimbursement("hold_missing_receipt", "paid"), false);
  assert.equal(canTransitionReimbursement("recorded", "paid"), true);
});

test("the happy path is submitted, approved, recorded, paid", () => {
  assert.equal(canTransitionReimbursement("submitted", "approved"), true);
  assert.equal(canTransitionReimbursement("approved", "recorded"), true);
  assert.equal(canTransitionReimbursement("recorded", "paid"), true);
  // And paid is terminal.
  assert.equal(canTransitionReimbursement("paid", "recorded"), false);
  assert.equal(canTransitionReimbursement("paid", "approved"), false);
});

test("a rejected claim can be corrected and resubmitted", () => {
  assert.equal(canTransitionReimbursement("rejected", "submitted"), true);
  assert.equal(canTransitionReimbursement("rejected", "approved"), false);
});

// ---------------------------------------------------------------------------
// Payability always states a reason, never a bare no.
// ---------------------------------------------------------------------------

test("only a recorded claim is payable, and every refusal explains itself", () => {
  assert.equal(payability("recorded").payable, true);

  for (const status of [
    "submitted",
    "hold_missing_receipt",
    "approved",
    "paid",
    "rejected",
  ] as const) {
    const result = payability(status);
    assert.equal(result.payable, false, `${status} must not be payable`);
    assert.ok(result.reason.length > 10, `${status} must explain why not`);
  }
});

test("the approved-but-not-recorded refusal names the double-count risk", () => {
  // This is the one someone will try to override, so the reason has to say
  // what actually goes wrong.
  assert.match(payability("approved").reason, /counted twice/);
  assert.match(payability("hold_missing_receipt").reason, /receipt/i);
});
