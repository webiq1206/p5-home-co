import { test } from "node:test";
import assert from "node:assert/strict";

import {
  canTransitionDraw,
  evaluateDrawReadiness,
  type DrawFacts,
  type LenderRequirements,
} from "../app/lib/finance/draws.ts";

// ---------------------------------------------------------------------------
// S77 lifecycle: draft -> submitted -> approved -> funded, rejection reworks.
// ---------------------------------------------------------------------------

test("draw lifecycle: the funding path is legal end to end", () => {
  assert.ok(canTransitionDraw("draft", "submitted"));
  assert.ok(canTransitionDraw("submitted", "approved"));
  assert.ok(canTransitionDraw("approved", "funded"));
});

test("draw lifecycle: funded is terminal; no skipping approval", () => {
  assert.equal(canTransitionDraw("funded", "draft"), false);
  assert.equal(canTransitionDraw("funded", "rejected"), false);
  assert.equal(canTransitionDraw("draft", "approved"), false);
  assert.equal(canTransitionDraw("draft", "funded"), false);
  assert.equal(canTransitionDraw("submitted", "funded"), false);
});

test("draw lifecycle: a rejection can be reworked back to draft", () => {
  assert.ok(canTransitionDraw("submitted", "rejected"));
  assert.ok(canTransitionDraw("approved", "rejected"));
  assert.ok(canTransitionDraw("rejected", "draft"));
});

// ---------------------------------------------------------------------------
// Readiness: every unmet lender requirement blocks and names itself.
// ---------------------------------------------------------------------------

const ALL_REQUIRED: LenderRequirements = {
  requiresInspection: true,
  requiresLienWaivers: true,
  requiresInvoices: true,
  requiresPhotos: true,
};

function facts(overrides: Partial<DrawFacts> = {}): DrawFacts {
  return {
    inspectionStatus: "passed",
    waiversSatisfied: true,
    hasInvoices: true,
    photosProvided: true,
    amountRequested: 50_000,
    remainingLoanBudget: 200_000,
    ...overrides,
  };
}

test("readiness: everything satisfied is ready with no blockers", () => {
  const r = evaluateDrawReadiness(ALL_REQUIRED, facts());
  assert.equal(r.ready, true);
  assert.deepEqual(r.blockers, []);
});

test("readiness: each unmet requirement produces its own named blocker", () => {
  const r = evaluateDrawReadiness(ALL_REQUIRED, facts({
    inspectionStatus: "pending",
    waiversSatisfied: false,
    hasInvoices: false,
    photosProvided: false,
  }));
  assert.equal(r.ready, false);
  assert.equal(r.blockers.length, 4);
  assert.ok(r.blockers.some((b) => b.includes("inspection")));
  assert.ok(r.blockers.some((b) => b.includes("lien waivers")));
  assert.ok(r.blockers.some((b) => b.includes("invoice")));
  assert.ok(r.blockers.some((b) => b.includes("photos")));
});

test("readiness: a failed inspection reads differently from a missing one", () => {
  const r = evaluateDrawReadiness(ALL_REQUIRED, facts({ inspectionStatus: "failed" }));
  assert.ok(r.blockers[0].includes("failed"));
});

test("readiness: lenient lenders skip their unrequired checks", () => {
  const lenient: LenderRequirements = {
    requiresInspection: false,
    requiresLienWaivers: false,
    requiresInvoices: false,
    requiresPhotos: false,
  };
  const r = evaluateDrawReadiness(lenient, facts({
    inspectionStatus: "not_required",
    waiversSatisfied: false,
    hasInvoices: false,
    photosProvided: false,
  }));
  assert.equal(r.ready, true);
});

test("readiness: the draw cannot exceed the remaining loan budget", () => {
  const r = evaluateDrawReadiness(ALL_REQUIRED, facts({
    amountRequested: 250_000,
    remainingLoanBudget: 200_000,
  }));
  assert.equal(r.ready, false);
  assert.ok(r.blockers[0].includes("remaining approved loan budget"));
});

test("readiness: no configured loan budget means no budget cap", () => {
  const r = evaluateDrawReadiness(ALL_REQUIRED, facts({
    amountRequested: 1_000_000,
    remainingLoanBudget: null,
  }));
  assert.equal(r.ready, true);
});

test("readiness: zero or negative amounts are blocked", () => {
  const r = evaluateDrawReadiness(ALL_REQUIRED, facts({ amountRequested: 0 }));
  assert.equal(r.ready, false);
  assert.ok(r.blockers[0].includes("greater than zero"));
});
