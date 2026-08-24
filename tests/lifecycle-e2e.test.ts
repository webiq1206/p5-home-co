/**
 * One job, start to finish, through every module that touches it (S218).
 *
 * Every other test file here checks one module in isolation. This one runs a
 * single project through the whole lifecycle - setup, funding, commitment,
 * billing, change order, waivers, WIP, closeout - and asserts that the pieces
 * COMPOSE. That is a different class of bug: each module can be individually
 * correct while the handoff between two of them is wrong, and per-module tests
 * cannot see that by construction.
 *
 * ON TEST DATA
 *
 * Every record below exists only inside this process and is gone when it
 * exits. Nothing is written to QuickBooks, to the database, or anywhere else,
 * which is the point - a test that creates real records in a production
 * accounting file is not a test, it is a cleanup problem. QuickBooks in
 * particular cannot truly delete: customers and vendors only go inactive, and
 * deleted transactions stay in the audit log permanently.
 *
 * So the lifecycle is exercised through the real engines with synthetic
 * inputs. What that genuinely proves is the arithmetic and the decisions -
 * which is where money is actually lost. What it cannot prove is that
 * QuickBooks accepts a payload, and that gap is stated rather than papered
 * over.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { auditQbo, type AuditSnapshot } from "../app/lib/finance/qbo/audit.ts";
import { customerPayload, idempotencyKey, naturalKeys, vendorPayload } from "../app/lib/finance/qbo/map.ts";
import { projectFunding } from "../app/lib/finance/engines.ts";
import { wipRow, wipTotals } from "../app/lib/finance/wip.ts";
import { agingBucket, summariseAging } from "../app/lib/finance/aging.ts";
import { chooseWaiver } from "../app/lib/contracts/lien-waivers.ts";
import { renderDocument } from "../app/lib/contracts/render.ts";
import { changeOrder, subcontractWorkOrder } from "../app/lib/contracts/agreements.ts";

// ---------------------------------------------------------------------------
// The job. One fixed-price kitchen, and every number below traces back here.
// ---------------------------------------------------------------------------

const JOB = {
  p5Id: "P5-2026-0042",
  customer: "Fernandez Residence",
  customerQboId: "C-100",
  jobQboId: "C-101",
  jobName: "Fernandez Residence - Kitchen",
  contract: 120_000,
  budget: 78_000,
  vendorQboId: "V-200",
  vendorName: "ABC Plumbing",
};

/** A snapshot with nothing wrong in it. Each stage below mutates a copy. */
function cleanSnapshot(over: Partial<AuditSnapshot> = {}): AuditSnapshot {
  return {
    today: "2026-08-23",
    form1099Threshold: 600,
    commitmentThreshold: 2_500,
    staleSyncHours: 24,
    hoursSinceSync: 1,
    unresolvedWrites: [],
    customers: [
      {
        qboId: JOB.customerQboId,
        displayName: JOB.customer,
        parentQboId: null,
        isProject: false,
        billWithParent: false,
        active: true,
        balance: 0,
        email: "fernandez@example.com",
        billingAddress: "12 Meander Ln, Boise ID",
      },
      {
        qboId: JOB.jobQboId,
        displayName: JOB.jobName,
        parentQboId: JOB.customerQboId,
        isProject: true,
        billWithParent: false,
        active: true,
        balance: 0,
        email: null,
        billingAddress: null,
      },
    ],
    vendors: [
      {
        qboId: JOB.vendorQboId,
        displayName: JOB.vendorName,
        active: true,
        balance: 0,
        vendor1099: true,
        email: "abc@example.com",
        w9OnFile: true,
        taxClassification: "Sole proprietor",
        paidThisYear: 0,
        trackedInP5: true,
        paymentHold: false,
      },
    ],
    projects: [
      {
        id: "42",
        p5Id: JOB.p5Id,
        name: JOB.jobName,
        status: "Active",
        qboCustomerId: JOB.jobQboId,
        contractAmount: JOB.contract,
        approvedChangeOrders: 0,
      },
    ],
    invoices: [],
    bills: [],
    purchaseOrders: [],
    subcontracts: [],
    ...over,
  };
}

const codes = (s: AuditSnapshot) => auditQbo(s).map((f) => f.rule.code);

// ---------------------------------------------------------------------------
// Stage 6: the job is created in QuickBooks
// ---------------------------------------------------------------------------

test("lifecycle: the job is created as a sub-customer, not a customer of its own", () => {
  const payload = customerPayload({
    displayName: JOB.jobName,
    parentQboId: JOB.customerQboId,
    isProject: true,
  });

  // All three flags together are what makes QuickBooks treat it as a job.
  // ParentRef alone produces an ordinary sub-customer, which costs and income
  // attach to differently.
  assert.deepEqual(payload.ParentRef, { value: JOB.customerQboId });
  assert.equal(payload.Job, true);
  assert.equal(payload.IsProject, true);
  assert.equal(payload.BillWithParent, false);
});

test("lifecycle: creating the same job twice cannot produce two jobs", () => {
  // The key is derived from P5's own identity for the project - not from the
  // name, and not from a clock - so a retry after a timeout computes the same
  // value and the unique index refuses the second write. A random key would
  // defeat the guard entirely.
  const first = idempotencyKey("Customer", "create", naturalKeys.project(42));
  const second = idempotencyKey("Customer", "create", naturalKeys.project(42));
  assert.equal(first, second, "a retry must land on the same key");

  // A different project on the same customer is a different write.
  assert.notEqual(first, idempotencyKey("Customer", "create", naturalKeys.project(43)));

  // Renaming the job does not make it a new job. This is why the key is built
  // from the id rather than the display name.
  assert.equal(first, idempotencyKey("Customer", "create", naturalKeys.project("42")));
});

test("lifecycle: re-submitting the same draw cannot bill the customer twice", () => {
  const draw3 = idempotencyKey("Invoice", "create", naturalKeys.invoice(42, 3));
  assert.equal(draw3, idempotencyKey("Invoice", "create", naturalKeys.invoice(42, 3)));
  assert.notEqual(draw3, idempotencyKey("Invoice", "create", naturalKeys.invoice(42, 4)));
});

test("lifecycle: the same vendor invoice cannot post twice, even from two people", () => {
  const bill = idempotencyKey("Bill", "create", naturalKeys.bill(JOB.vendorQboId, "ABC-77"));
  assert.equal(bill, idempotencyKey("Bill", "create", naturalKeys.bill(JOB.vendorQboId, "ABC-77")));
  // Same reference from a different vendor is a genuinely different bill.
  assert.notEqual(bill, idempotencyKey("Bill", "create", naturalKeys.bill("V-999", "ABC-77")));
});

test("lifecycle: a correctly created job raises nothing on the morning check", () => {
  assert.deepEqual(codes(cleanSnapshot()), []);
});

// ---------------------------------------------------------------------------
// Stage 7-10: funding before the work starts
// ---------------------------------------------------------------------------

test("lifecycle: with no deposit collected, the job is red and P5 is financing it", () => {
  const funding = projectFunding({
    clearedClientPayments: 0,
    clearedProjectOutflows: 0,
    commitmentsDueInHorizon: 24_000, // plumbing + electrical committed
    plannedUncommittedPurchases: 0,
    expectedLabor: 0,
    otherKnownOutflows: 0,
    etcInHorizonNotCommitted: 0,
    requiredProjectBuffer: 0,
    desiredPostDrawBuffer: 5_000,
    remainingContractBillable: JOB.contract,
  });

  assert.equal(funding.status, "red", "no cash against real commitments is the definition of financing it");
  assert.equal(funding.projectCashHeld, 0);
  assert.equal(funding.recommendedDraw, 29_000, "commitments plus the buffer");
  assert.equal(funding.contractStructureReview, false, "the contract can carry this");
});

test("lifecycle: once the deposit clears, the same job is green", () => {
  const funding = projectFunding({
    clearedClientPayments: 36_000, // 30% deposit
    clearedProjectOutflows: 0,
    commitmentsDueInHorizon: 24_000,
    plannedUncommittedPurchases: 0,
    expectedLabor: 0,
    otherKnownOutflows: 0,
    etcInHorizonNotCommitted: 0,
    requiredProjectBuffer: 0,
    desiredPostDrawBuffer: 5_000,
    remainingContractBillable: JOB.contract - 36_000,
  });

  assert.equal(funding.status, "green");
  assert.equal(funding.recommendedDraw, 0, "nothing to request while the job is funded ahead");
});

test("lifecycle: a draw is never recommended beyond what the contract permits", () => {
  // The ceiling is the whole point of S56. A job can genuinely need more cash
  // than the customer has agreed to pay - that is a contract problem, and
  // raising a bigger draw does not fix it.
  const funding = projectFunding({
    clearedClientPayments: 115_000,
    clearedProjectOutflows: 110_000,
    commitmentsDueInHorizon: 40_000,
    plannedUncommittedPurchases: 0,
    expectedLabor: 0,
    otherKnownOutflows: 0,
    etcInHorizonNotCommitted: 0,
    requiredProjectBuffer: 0,
    desiredPostDrawBuffer: 5_000,
    remainingContractBillable: JOB.contract - 115_000, // only 5,000 left
  });

  assert.equal(funding.recommendedDraw, 5_000, "capped at the contract ceiling");
  assert.ok(funding.rawRecommendedDraw > 5_000, "the real need is larger");
  assert.equal(funding.contractStructureReview, true, "and that gap is surfaced, not hidden");
});

// ---------------------------------------------------------------------------
// Stage 14-15: the subcontract and its commitment
// ---------------------------------------------------------------------------

test("lifecycle: the work order carries the master agreement onto the job", () => {
  const doc = renderDocument(subcontractWorkOrder, {
    work_order_number: "SC-001",
    sub_legal_name: JOB.vendorName,
    master_date: "2026-07-01",
    job_reference: JOB.p5Id,
    property_address: "12 Meander Ln, Boise ID",
    scope: "Rough and finish plumbing per plan.",
    contract_amount: 24_000,
    retainage_pct: 10,
    start_date: "2026-09-01",
    completion_date: "2026-10-15",
  });

  assert.match(doc.clauses[0].body, /Master Subcontractor Agreement/);
  assert.match(doc.title, /SC-001/);
  // Accepted by the owner pending review, so no draft watermark on the page.
  // That no attorney reviewed it is recorded in the register instead.
  assert.equal(doc.draftWatermark, null);
});

test("lifecycle: a subcontract under way with no signature and no PO raises both problems", () => {
  const found = codes(
    cleanSnapshot({
      subcontracts: [
        {
          id: "1",
          reference: "SC-001",
          projectP5Id: JOB.p5Id,
          vendorName: JOB.vendorName,
          status: "in_progress",
          originalAmount: 24_000,
          approvedChanges: 0,
          billedToDate: 0,
          qboPurchaseOrderId: null,
          executedOn: null,
        },
      ],
    }),
  );

  assert.ok(found.includes("subcontract_unexecuted"), "a crew on site with nothing signed");
  assert.ok(found.includes("subcontract_no_po"), "a commitment invisible to the job budget");
});

// ---------------------------------------------------------------------------
// Stage 17-19: costs arrive
// ---------------------------------------------------------------------------

test("lifecycle: a job cost wrongly marked billable is the worst finding on a fixed-price job", () => {
  const findings = auditQbo(
    cleanSnapshot({
      bills: [
        {
          qboId: "B-1",
          docNumber: "1001",
          txnDate: "2026-09-10",
          dueDate: "2026-10-10",
          total: 12_000,
          balance: 12_000,
          customerQboId: JOB.jobQboId,
          vendorQboId: JOB.vendorQboId,
          hasBillableLine: true, // the customer would be charged twice
          hasUncategorizedLine: false,
          hasCommitment: true,
          vendorDocNumber: "ABC-77",
        },
      ],
    }),
  );

  assert.equal(findings[0].rule.code, "bill_marked_billable", "sorted to the top as critical");
  assert.equal(findings[0].rule.severity, "critical");
});

test("lifecycle: the same vendor invoice entered twice is caught before it is paid twice", () => {
  const bill = {
    docNumber: "1001",
    txnDate: "2026-09-10",
    dueDate: "2026-10-10",
    total: 12_000,
    balance: 12_000,
    customerQboId: JOB.jobQboId,
    vendorQboId: JOB.vendorQboId,
    hasBillableLine: false,
    hasUncategorizedLine: false,
    hasCommitment: true,
    vendorDocNumber: "ABC-77",
  };
  const found = codes(
    cleanSnapshot({
      bills: [
        { ...bill, qboId: "B-1" },
        { ...bill, qboId: "B-2" }, // re-keyed by somebody else
      ],
    }),
  );
  assert.ok(found.includes("bill_duplicate_number"));
});

// ---------------------------------------------------------------------------
// Stage 20: waivers, at each payment
// ---------------------------------------------------------------------------

test("lifecycle: waiver type follows the money at every payment in the job", () => {
  // Progress payment being sent - not cleared yet.
  assert.match(chooseWaiver({ isFinalPayment: false, paymentHasCleared: false }).template.key, /conditional_progress/);
  // Same payment, a week later, cleared.
  assert.match(chooseWaiver({ isFinalPayment: false, paymentHasCleared: true }).template.key, /unconditional_progress/);
  // Closeout.
  assert.match(chooseWaiver({ isFinalPayment: true, paymentHasCleared: false }).template.key, /conditional_final/);
  assert.match(chooseWaiver({ isFinalPayment: true, paymentHasCleared: true }).template.key, /unconditional_final/);
});

test("lifecycle: no sequence of events produces an unconditional waiver against uncleared money", () => {
  // The trap this whole area exists to close, checked exhaustively rather than
  // by example.
  for (const isFinalPayment of [true, false]) {
    const { template } = chooseWaiver({ isFinalPayment, paymentHasCleared: false });
    assert.doesNotMatch(template.key, /^waiver_unconditional/);
  }
});

// ---------------------------------------------------------------------------
// Stage 22: the change order, and what it unlocks
// ---------------------------------------------------------------------------

test("lifecycle: billing past the contract is critical UNTIL the change order is entered", () => {
  // The customer approved 15,000 of extra work. Before it is recorded, a
  // legitimate invoice looks like over-billing.
  const overBilled = cleanSnapshot({
    invoices: [
      {
        qboId: "I-1",
        docNumber: "2001",
        txnDate: "2026-10-01",
        dueDate: "2026-10-31",
        total: 130_000,
        balance: 0,
        customerQboId: JOB.jobQboId,
        vendorQboId: null,
      },
    ],
  });
  assert.ok(codes(overBilled).includes("invoice_exceeds_contract"));

  // Enter the approved change order, and the same billing is fine.
  const withChangeOrder: AuditSnapshot = {
    ...overBilled,
    projects: [{ ...overBilled.projects[0], approvedChangeOrders: 15_000 }],
  };
  assert.ok(!codes(withChangeOrder).includes("invoice_exceeds_contract"));
});

test("lifecycle: the change order document states price AND schedule effect", () => {
  const doc = renderDocument(changeOrder, {
    change_order_number: "CO-001",
    // A change order has to name the agreement it amends, or the chain from
    // contract to change is unprovable a year later.
    original_agreement_title: "Residential Construction Agreement",
    original_agreement_date: "2026-08-15",
    job_reference: JOB.p5Id,
    property_address: "12 Meander Ln, Boise ID",
    counterparty_name: JOB.customer,
    change_date: "2026-09-28",
    reason: "Concealed rot discovered in the north wall.",
    description: "Replace 12ft of sill plate and two studs.",
    price_change: 15_000,
    prior_contract_amount: JOB.contract,
    new_contract_amount: JOB.contract + 15_000,
    schedule_days: 7, // silence here is how a builder eats a delay
  });

  const schedule = doc.clauses.find((c) => c.heading === "Effect on the schedule");
  assert.match(schedule!.body, /7/);
  const price = doc.clauses.find((c) => c.heading === "Effect on the price");
  assert.match(price!.body, /\$135,000\.00/);
});

// ---------------------------------------------------------------------------
// Stage 18 + 29: WIP, and the arithmetic that has to tie
// ---------------------------------------------------------------------------

test("lifecycle: WIP earns revenue on cost progress, and over-billing is a liability", () => {
  const row = wipRow({
    revisedContract: 135_000, // contract + the approved change order
    costToDate: 45_000,
    estimateToComplete: 45_000, // half done by cost
    billedToDate: 80_000, // billed ahead of the work, as intended
  });

  assert.equal(row.projectedFinalCost, 90_000);
  assert.equal(row.percentComplete, 0.5);
  assert.equal(row.earnedRevenue, 67_500, "half the revised contract");
  assert.equal(row.overbilled, 12_500, "billed 80,000 against 67,500 earned");
  assert.equal(row.underbilled, 0);
  assert.equal(row.projectedGrossProfit, 45_000);
});

test("lifecycle: over and under billing are never netted across jobs", () => {
  // Netting them would hide both. One is money owed to customers, the other is
  // money P5 has fronted; a single combined figure describes neither.
  const totals = wipTotals([
    wipRow({ revisedContract: 135_000, costToDate: 45_000, estimateToComplete: 45_000, billedToDate: 80_000 }),
    wipRow({ revisedContract: 100_000, costToDate: 60_000, estimateToComplete: 20_000, billedToDate: 40_000 }),
  ]);

  assert.ok(totals.overbilled > 0);
  assert.ok(totals.underbilled > 0);
  assert.notEqual(totals.overbilled, totals.underbilled);
});

// ---------------------------------------------------------------------------
// Stage 28: getting paid, and chasing it
// ---------------------------------------------------------------------------

test("lifecycle: the final invoice ages into the right bucket as it goes unpaid", () => {
  const due = "2026-10-31";
  assert.equal(agingBucket(due, new Date("2026-10-25T12:00:00Z")), "current");
  assert.equal(agingBucket(due, new Date("2026-11-15T12:00:00Z")), "1-30");
  assert.equal(agingBucket(due, new Date("2026-12-15T12:00:00Z")), "31-60");
  assert.equal(agingBucket(due, new Date("2027-03-01T12:00:00Z")), "90+");
});

test("lifecycle: an invoice with no due date can never be chased, and is flagged for it", () => {
  const found = codes(
    cleanSnapshot({
      invoices: [
        {
          qboId: "I-9",
          docNumber: "2009",
          txnDate: "2026-10-01",
          dueDate: null,
          total: 20_000,
          balance: 20_000, // still open
          customerQboId: JOB.jobQboId,
          vendorQboId: null,
        },
      ],
    }),
  );
  assert.ok(found.includes("invoice_no_due_date"));

  const summary = summariseAging([{ dueDate: null, openBalance: 20_000 }], new Date("2027-01-01T12:00:00Z"));
  assert.equal(summary.total, 20_000, "it is still money owed, whatever the bucket");
});

// ---------------------------------------------------------------------------
// Stage 32: closeout, and the vendor's tax form
// ---------------------------------------------------------------------------

test("lifecycle: a purchase order left open on a finished job is raised at closeout", () => {
  const snapshot = cleanSnapshot({
    purchaseOrders: [
      {
        qboId: "PO-1",
        docNumber: "PO-1",
        txnDate: "2026-09-01",
        dueDate: null,
        total: 24_000,
        balance: 0,
        customerQboId: JOB.jobQboId,
        vendorQboId: JOB.vendorQboId,
        poStatus: "Open",
      },
    ],
  });
  snapshot.projects[0].status = "Closeout";

  assert.ok(codes(snapshot).includes("po_open_on_closed_job"));
});

test("lifecycle: the vendor's 1099 obligation is settled from the W-9, not guessed", () => {
  const base = cleanSnapshot();

  // Paid over the threshold, W-9 on file, correctly flagged: nothing to raise.
  base.vendors[0].paidThisYear = 24_000;
  assert.deepEqual(codes(base), []);

  // Same payments, no W-9: a filing obligation P5 cannot meet.
  const noW9 = cleanSnapshot();
  noW9.vendors[0].paidThisYear = 24_000;
  noW9.vendors[0].w9OnFile = false;
  assert.ok(codes(noW9).includes("vendor_1099_no_w9"));

  // A corporation wrongly flagged: a filing that never existed.
  const corp = cleanSnapshot();
  corp.vendors[0].paidThisYear = 24_000;
  corp.vendors[0].taxClassification = "S Corporation";
  assert.ok(codes(corp).includes("vendor_1099_on_corporation"));
});

test("lifecycle: a vendor deactivated while still owed is not allowed to vanish quietly", () => {
  const snapshot = cleanSnapshot();
  snapshot.vendors[0].active = false;
  snapshot.vendors[0].balance = 2_400; // retainage never released
  assert.ok(codes(snapshot).includes("vendor_inactive_with_balance"));
});

// ---------------------------------------------------------------------------
// The whole job, run clean, one more time.
// ---------------------------------------------------------------------------

test("lifecycle: a job run correctly end to end is silent on every check", () => {
  // The most important assertion in the file. Without it, every test above
  // proves only that the checks can fire - not that they stay quiet when they
  // should, which is what makes the list worth reading at all.
  const finished = cleanSnapshot({
    invoices: [
      {
        qboId: "I-1",
        docNumber: "2001",
        txnDate: "2026-10-01",
        dueDate: "2026-10-31",
        total: 135_000,
        balance: 0,
        customerQboId: JOB.jobQboId,
        vendorQboId: null,
      },
    ],
    bills: [
      {
        qboId: "B-1",
        docNumber: "1001",
        txnDate: "2026-09-10",
        dueDate: "2026-10-10",
        total: 24_000,
        balance: 0,
        customerQboId: JOB.jobQboId,
        vendorQboId: JOB.vendorQboId,
        hasBillableLine: false,
        hasUncategorizedLine: false,
        hasCommitment: true,
        vendorDocNumber: "ABC-77",
      },
    ],
    purchaseOrders: [
      {
        qboId: "PO-1",
        docNumber: "PO-1",
        txnDate: "2026-09-01",
        dueDate: null,
        total: 24_000,
        balance: 0,
        customerQboId: JOB.jobQboId,
        vendorQboId: JOB.vendorQboId,
        poStatus: "Closed",
      },
    ],
    subcontracts: [
      {
        id: "1",
        reference: "SC-001",
        projectP5Id: JOB.p5Id,
        vendorName: JOB.vendorName,
        status: "complete",
        originalAmount: 24_000,
        approvedChanges: 0,
        billedToDate: 24_000,
        qboPurchaseOrderId: "PO-1",
        executedOn: "2026-08-25",
      },
    ],
  });
  finished.projects[0].approvedChangeOrders = 15_000;
  finished.vendors[0].paidThisYear = 24_000;

  const findings = auditQbo(finished);
  assert.deepEqual(
    findings.map((f) => `${f.rule.code}: ${f.entityName}`),
    [],
  );
});

// ---------------------------------------------------------------------------
// What this file does NOT prove.
// ---------------------------------------------------------------------------

test("the vendor payload still withholds the 1099 flag until a W-9 exists", () => {
  // Included here because it is the one place the lifecycle deliberately
  // refuses to decide. Unset is a real state, distinct from false.
  const noW9 = vendorPayload({ displayName: JOB.vendorName });
  assert.equal("Vendor1099" in noW9, false, "unset until the W-9 answers the question");

  const withW9 = vendorPayload({ displayName: JOB.vendorName, track1099: true });
  assert.equal(withW9.Vendor1099, true);
});
