import { test } from "node:test";
import assert from "node:assert/strict";

import {
  allRules,
  auditQbo,
  findingKey,
  nameKey,
  qboEnforceableRules,
  summariseFindings,
  type AuditSnapshot,
  type CustomerRecord,
  type ProjectRecord,
  type SubcontractRecord,
  type TxnRecord,
  type VendorRecord,
} from "../app/lib/finance/qbo/audit.ts";

// ---------------------------------------------------------------------------
// Builders. Every field defaults to CORRECT, so each test states only the one
// thing that is wrong - which is also what makes a passing test meaningful.
// ---------------------------------------------------------------------------

function customer(over: Partial<CustomerRecord> = {}): CustomerRecord {
  return {
    qboId: "c1",
    displayName: "Smith Residence",
    parentQboId: null,
    isProject: false,
    billWithParent: false,
    active: true,
    balance: 0,
    email: "smith@example.com",
    billingAddress: "1 Main St, Boise ID",
    ...over,
  };
}

function vendor(over: Partial<VendorRecord> = {}): VendorRecord {
  return {
    qboId: "v1",
    displayName: "ABC Plumbing",
    active: true,
    balance: 0,
    vendor1099: true,
    email: "abc@example.com",
    w9OnFile: true,
    taxClassification: "Sole proprietor",
    paidThisYear: 0,
    trackedInP5: true,
    paymentHold: false,
    ...over,
  };
}

function txn(over: Partial<TxnRecord> = {}): TxnRecord {
  return {
    qboId: "t1",
    docNumber: "1001",
    txnDate: "2026-08-01",
    dueDate: "2026-08-31",
    total: 1000,
    balance: 0,
    customerQboId: "c1",
    vendorQboId: null,
    hasBillableLine: false,
    hasUncategorizedLine: false,
    hasCommitment: true,
    ...over,
  };
}

function project(over: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: "1",
    p5Id: "P5-2026-0001",
    name: "Smith Kitchen",
    status: "Active",
    qboCustomerId: "c2",
    contractAmount: 100_000,
    approvedChangeOrders: 0,
    ...over,
  };
}

function subcontract(over: Partial<SubcontractRecord> = {}): SubcontractRecord {
  return {
    id: "1",
    reference: "SC-001",
    projectP5Id: "P5-2026-0001",
    vendorName: "ABC Plumbing",
    status: "in_progress",
    originalAmount: 20_000,
    approvedChanges: 0,
    billedToDate: 0,
    qboPurchaseOrderId: "po1",
    executedOn: "2026-07-01",
    ...over,
  };
}

function snapshot(over: Partial<AuditSnapshot> = {}): AuditSnapshot {
  return {
    today: "2026-08-23",
    form1099Threshold: 600,
    commitmentThreshold: 5_000,
    staleSyncHours: 24,
    customers: [],
    vendors: [],
    invoices: [],
    bills: [],
    purchaseOrders: [],
    projects: [],
    subcontracts: [],
    hoursSinceSync: 1,
    unresolvedWrites: [],
    ...over,
  };
}

/** All rule codes raised by a scan. */
function codes(snap: AuditSnapshot): string[] {
  return auditQbo(snap).map((f) => f.rule.code);
}

// ---------------------------------------------------------------------------
// A correct file is silent. If this fails, every other test here is suspect.
// ---------------------------------------------------------------------------

test("a correctly set up file produces no findings at all", () => {
  const parent = customer({ qboId: "c1" });
  const job = customer({
    qboId: "c2",
    displayName: "Smith Kitchen",
    parentQboId: "c1",
    isProject: true,
  });
  const findings = auditQbo(
    snapshot({
      customers: [parent, job],
      vendors: [vendor()],
      projects: [project()],
      invoices: [txn({ customerQboId: "c2", total: 50_000 })],
      bills: [txn({ qboId: "b1", customerQboId: "c2", vendorQboId: "v1", total: 1_000 })],
      subcontracts: [subcontract()],
    }),
  );
  assert.deepEqual(findings, [], `unexpected: ${findings.map((f) => f.rule.code).join(", ")}`);
});

// ---------------------------------------------------------------------------
// Job structure: a job is a folder inside the customer's drawer.
// ---------------------------------------------------------------------------

test("a job created at the top level instead of under its customer is critical", () => {
  const found = codes(
    snapshot({
      customers: [customer({ qboId: "c2", displayName: "Smith Kitchen", parentQboId: null })],
      projects: [project()],
    }),
  );
  assert.ok(found.includes("project_not_sub_customer"));
});

test("a job set to bill with its parent is caught", () => {
  const found = codes(
    snapshot({
      customers: [
        customer({ qboId: "c1" }),
        customer({ qboId: "c2", parentQboId: "c1", billWithParent: true }),
      ],
      projects: [project()],
    }),
  );
  assert.ok(found.includes("project_bills_with_parent"));
});

test("a project with no QuickBooks record at all is reported once, not repeatedly", () => {
  // Without the early continue, an unlinked project would also trip every
  // downstream job-structure rule and bury the one finding that matters.
  const found = codes(snapshot({ projects: [project({ qboCustomerId: null })] }));
  assert.deepEqual(found, ["project_not_linked"]);
});

test("a job created straight in QuickBooks is flagged as untracked", () => {
  const found = codes(
    snapshot({
      customers: [
        customer({ qboId: "c1" }),
        customer({ qboId: "c9", displayName: "Rogue Job", parentQboId: "c1", isProject: true }),
      ],
      projects: [],
    }),
  );
  assert.ok(found.includes("qbo_project_not_in_p5"));
});

// ---------------------------------------------------------------------------
// Over-billing: the finding that protects the customer relationship.
// ---------------------------------------------------------------------------

test("billing past contract plus approved change orders is critical", () => {
  const findings = auditQbo(
    snapshot({
      customers: [customer({ qboId: "c1" }), customer({ qboId: "c2", parentQboId: "c1" })],
      projects: [project({ contractAmount: 100_000, approvedChangeOrders: 5_000 })],
      invoices: [txn({ customerQboId: "c2", total: 110_000 })],
    }),
  );
  const over = findings.find((f) => f.rule.code === "invoice_exceeds_contract");
  assert.ok(over, "expected an over-billing finding");
  assert.equal(over.rule.severity, "critical");
  // The amount is the overage, not the total billed - that is what has to be fixed.
  assert.equal(over.amount, 5_000);
});

test("billing exactly to the contract value is not over-billing", () => {
  const found = codes(
    snapshot({
      customers: [customer({ qboId: "c1" }), customer({ qboId: "c2", parentQboId: "c1" })],
      projects: [project({ contractAmount: 100_000 })],
      invoices: [txn({ customerQboId: "c2", total: 100_000 })],
    }),
  );
  assert.ok(!found.includes("invoice_exceeds_contract"));
});

// ---------------------------------------------------------------------------
// Duplicates: QuickBooks blocks the exact matches, so only near-misses survive.
// ---------------------------------------------------------------------------

test("company suffixes and punctuation do not hide a duplicate", () => {
  assert.equal(nameKey("ABC Plumbing"), nameKey("ABC Plumbing, LLC"));
  assert.equal(nameKey("Smith Residence"), nameKey("Smith Residence Inc."));
  assert.notEqual(nameKey("ABC Plumbing"), nameKey("ABC Electric"));
});

test("two near-identical vendors are both flagged so either can be merged into the other", () => {
  const findings = auditQbo(
    snapshot({
      vendors: [
        vendor({ qboId: "v1", displayName: "ABC Plumbing" }),
        vendor({ qboId: "v2", displayName: "ABC Plumbing LLC" }),
      ],
    }),
  );
  const dupes = findings.filter((f) => f.rule.code === "vendor_possible_duplicate");
  assert.equal(dupes.length, 2);
});

test("a job is never compared against its parent for duplicate names", () => {
  // "Smith Residence" and its job "Smith Residence - Kitchen" are not duplicates.
  const found = codes(
    snapshot({
      customers: [
        customer({ qboId: "c1", displayName: "Smith Residence" }),
        customer({ qboId: "c2", displayName: "Smith Residence", parentQboId: "c1" }),
      ],
      projects: [project()],
    }),
  );
  assert.ok(!found.includes("customer_possible_duplicate"));
});

// ---------------------------------------------------------------------------
// 1099s: the rules that cost money in January.
// ---------------------------------------------------------------------------

test("a paid vendor with the 1099 question never answered is urgent", () => {
  const findings = auditQbo(
    snapshot({ vendors: [vendor({ vendor1099: null, paidThisYear: 100, w9OnFile: false })] }),
  );
  const undecided = findings.find((f) => f.rule.code === "vendor_1099_undecided");
  assert.ok(undecided);
  assert.equal(undecided.rule.severity, "urgent");
});

test("crossing the threshold without a W-9 is caught", () => {
  const found = codes(
    snapshot({ vendors: [vendor({ paidThisYear: 5_000, w9OnFile: false })] }),
  );
  assert.ok(found.includes("vendor_1099_no_w9"));
});

test("a vendor explicitly marked not-1099 is not chased for a W-9", () => {
  // A corporation over the threshold is not a reporting failure, so raising it
  // would be pure noise - and noise is what makes people ignore the whole list.
  const found = codes(
    snapshot({
      vendors: [vendor({ vendor1099: false, paidThisYear: 50_000, w9OnFile: false })],
    }),
  );
  assert.ok(!found.includes("vendor_1099_no_w9"));
});

test("a corporation flagged for 1099 is caught, but an LLC is not", () => {
  const corp = codes(
    snapshot({ vendors: [vendor({ vendor1099: true, taxClassification: "S Corporation" })] }),
  );
  assert.ok(corp.includes("vendor_1099_on_corporation"));

  // An LLC taxed as a sole proprietor DOES get a 1099, and the word "LLC" must
  // not be mistaken for "corporation".
  const llc = codes(
    snapshot({
      vendors: [vendor({ vendor1099: true, taxClassification: "LLC (sole proprietor)" })],
    }),
  );
  assert.ok(!llc.includes("vendor_1099_on_corporation"));
});

// ---------------------------------------------------------------------------
// Bills: double payment, double billing, and costs with no home.
// ---------------------------------------------------------------------------

test("the same vendor invoice number twice is flagged on both bills", () => {
  const findings = auditQbo(
    snapshot({
      vendors: [vendor({ qboId: "v1" })],
      bills: [
        txn({ qboId: "b1", vendorQboId: "v1", vendorDocNumber: "INV-77" }),
        txn({ qboId: "b2", vendorQboId: "v1", vendorDocNumber: "inv-77 " }),
      ],
    }),
  );
  const dupes = findings.filter((f) => f.rule.code === "bill_duplicate_number");
  assert.equal(dupes.length, 2, "both copies must be flagged, since either could be the keeper");
});

test("the same invoice number from different vendors is not a duplicate", () => {
  const found = codes(
    snapshot({
      vendors: [vendor({ qboId: "v1" }), vendor({ qboId: "v2", displayName: "XYZ Electric" })],
      bills: [
        txn({ qboId: "b1", vendorQboId: "v1", vendorDocNumber: "1001" }),
        txn({ qboId: "b2", vendorQboId: "v2", vendorDocNumber: "1001" }),
      ],
    }),
  );
  assert.ok(!found.includes("bill_duplicate_number"));
});

test("a job cost marked billable is critical, because the customer pays twice", () => {
  const findings = auditQbo(
    snapshot({
      customers: [customer({ qboId: "c1" })],
      bills: [txn({ qboId: "b1", customerQboId: "c1", hasBillableLine: true })],
    }),
  );
  const billable = findings.find((f) => f.rule.code === "bill_marked_billable");
  assert.ok(billable);
  assert.equal(billable.rule.severity, "critical");
});

test("a bill with no job on it is caught", () => {
  const found = codes(snapshot({ bills: [txn({ qboId: "b1", customerQboId: null })] }));
  assert.ok(found.includes("bill_no_project"));
});

test("a large bill with no commitment behind it is flagged, a small one is not", () => {
  const big = codes(
    snapshot({
      customers: [customer()],
      bills: [txn({ qboId: "b1", total: 20_000, hasCommitment: false })],
    }),
  );
  assert.ok(big.includes("bill_no_commitment"));

  const small = codes(
    snapshot({
      customers: [customer()],
      bills: [txn({ qboId: "b1", total: 200, hasCommitment: false })],
    }),
  );
  assert.ok(!small.includes("bill_no_commitment"));
});

test("an open bill to a vendor on payment hold is surfaced", () => {
  const found = codes(
    snapshot({
      customers: [customer()],
      vendors: [vendor({ qboId: "v1", paymentHold: true })],
      bills: [txn({ qboId: "b1", vendorQboId: "v1", balance: 4_000 })],
    }),
  );
  assert.ok(found.includes("bill_vendor_on_hold"));
});

// ---------------------------------------------------------------------------
// Invoices.
// ---------------------------------------------------------------------------

test("an invoice billed to the parent when jobs exist beneath it is caught", () => {
  const found = codes(
    snapshot({
      customers: [customer({ qboId: "c1" }), customer({ qboId: "c2", parentQboId: "c1" })],
      projects: [project()],
      invoices: [txn({ customerQboId: "c1" })],
    }),
  );
  assert.ok(found.includes("invoice_on_parent_customer"));
});

test("an invoice to a customer with no jobs beneath them is fine", () => {
  const found = codes(
    snapshot({ customers: [customer({ qboId: "c1" })], invoices: [txn({ customerQboId: "c1" })] }),
  );
  assert.ok(!found.includes("invoice_on_parent_customer"));
});

test("an open invoice with no due date can never be chased, so it is flagged", () => {
  const found = codes(
    snapshot({
      customers: [customer()],
      invoices: [txn({ dueDate: null, balance: 5_000 })],
    }),
  );
  assert.ok(found.includes("invoice_no_due_date"));
});

test("a paid invoice with no due date is not worth raising", () => {
  const found = codes(
    snapshot({ customers: [customer()], invoices: [txn({ dueDate: null, balance: 0 })] }),
  );
  assert.ok(!found.includes("invoice_no_due_date"));
});

// ---------------------------------------------------------------------------
// Subcontracts.
// ---------------------------------------------------------------------------

test("a crew working on an unsigned subcontract is urgent", () => {
  const found = codes(
    snapshot({ subcontracts: [subcontract({ status: "in_progress", executedOn: null })] }),
  );
  assert.ok(found.includes("subcontract_unexecuted"));
});

test("a draft subcontract does not need a purchase order yet", () => {
  const found = codes(
    snapshot({ subcontracts: [subcontract({ status: "draft", qboPurchaseOrderId: null })] }),
  );
  assert.ok(!found.includes("subcontract_no_po"));
});

test("an issued subcontract with no purchase order is an invisible commitment", () => {
  const found = codes(
    snapshot({ subcontracts: [subcontract({ status: "issued", qboPurchaseOrderId: null })] }),
  );
  assert.ok(found.includes("subcontract_no_po"));
});

test("a subcontractor billing past their commitment is critical, and approved changes count", () => {
  const over = auditQbo(
    snapshot({ subcontracts: [subcontract({ originalAmount: 20_000, billedToDate: 25_000 })] }),
  ).find((f) => f.rule.code === "bill_exceeds_commitment");
  assert.ok(over);
  assert.equal(over.rule.severity, "critical");
  assert.equal(over.amount, 5_000);

  // Once the change order is approved, the same billing is legitimate.
  const withChange = codes(
    snapshot({
      subcontracts: [
        subcontract({ originalAmount: 20_000, approvedChanges: 5_000, billedToDate: 25_000 }),
      ],
    }),
  );
  assert.ok(!withChange.includes("bill_exceeds_commitment"));
});

// ---------------------------------------------------------------------------
// Connection health.
// ---------------------------------------------------------------------------

test("a stale sync is reported, because every other number depends on it", () => {
  assert.ok(codes(snapshot({ hoursSinceSync: 100 })).includes("sync_stale"));
  assert.ok(codes(snapshot({ hoursSinceSync: null })).includes("sync_stale"));
  assert.ok(!codes(snapshot({ hoursSinceSync: 2 })).includes("sync_stale"));
});

test("a parked write is surfaced rather than retried blindly", () => {
  const found = codes(
    snapshot({
      unresolvedWrites: [{ id: "w1", entity: "Invoice", reason: "6240 Duplicate name exists" }],
    }),
  );
  assert.ok(found.includes("write_needs_review"));
});

// ---------------------------------------------------------------------------
// Contract of the rulebook itself.
// ---------------------------------------------------------------------------

test("findings come back with the most serious first", () => {
  const findings = auditQbo(
    snapshot({
      customers: [customer({ qboId: "c1", email: null })],
      bills: [txn({ qboId: "b1", customerQboId: "c1", hasBillableLine: true })],
    }),
  );
  assert.equal(findings[0].rule.severity, "critical");
});

test("every rule explains itself in plain language, not just a label", () => {
  for (const rule of allRules()) {
    assert.ok(rule.plain.length > 40, `${rule.code}: plain explanation is too thin`);
    assert.ok(rule.consequence.length > 40, `${rule.code}: consequence is too thin`);
    assert.ok(rule.fix.length > 20, `${rule.code}: fix is too thin`);
    // Jargon that means nothing to someone new. If one of these is genuinely
    // needed, explain it in the same sentence and add it to this allowance.
    assert.doesNotMatch(rule.plain, /\bWIP\b|\bAR\b|\bAP\b|\bGL\b|\bCOA\b/,
      `${rule.code}: plain language must not use bookkeeping shorthand`);
  }
});

test("every rule that QuickBooks can enforce names the exact setting", () => {
  for (const rule of qboEnforceableRules()) {
    assert.ok(
      rule.qboSetting && rule.qboSetting.includes(">"),
      `${rule.code}: must name the QuickBooks setting path that prevents it`,
    );
  }
});

test("rule codes are unique and stable-looking", () => {
  const seen = new Set<string>();
  for (const rule of allRules()) {
    assert.ok(!seen.has(rule.code), `duplicate rule code ${rule.code}`);
    seen.add(rule.code);
    assert.match(rule.code, /^[a-z0-9_]+$/, `${rule.code}: codes are attention_item kinds`);
  }
});

test("the dedupe key survives a change in the wording of the detail line", () => {
  const one = auditQbo(
    snapshot({ vendors: [vendor({ vendor1099: null, paidThisYear: 100 })] }),
  )[0];
  const two = auditQbo(
    snapshot({ vendors: [vendor({ vendor1099: null, paidThisYear: 999 })] }),
  )[0];
  assert.notEqual(one.detail, two.detail, "the detail should reflect the new amount");
  assert.equal(findingKey(one), findingKey(two), "but it is still the same open item");
});

test("the summary counts each severity and the total", () => {
  const findings = auditQbo(
    snapshot({
      customers: [customer({ qboId: "c1", email: null, billingAddress: null })],
      bills: [txn({ qboId: "b1", customerQboId: "c1", hasBillableLine: true })],
    }),
  );
  const counts = summariseFindings(findings);
  assert.equal(counts.critical, 1);
  assert.equal(counts.warning, 1);
  assert.equal(counts.info, 1);
  assert.equal(counts.total, findings.length);
});
