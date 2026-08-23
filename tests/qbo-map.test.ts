import { test } from "node:test";
import assert from "node:assert/strict";

import {
  billPayload,
  customerPayload,
  idempotencyKey,
  invoicePayload,
  purchaseOrderPayload,
  vendorPayload,
  withUpdateEnvelope,
} from "../app/lib/finance/qbo/map.ts";

// ---------------------------------------------------------------------------
// Idempotency: the property the whole write layer rests on.
// ---------------------------------------------------------------------------

test("the same intent always produces the same key", () => {
  const a = idempotencyKey("Bill", "create", "vendor-7/INV-1042");
  const b = idempotencyKey("Bill", "create", "vendor-7/INV-1042");
  assert.equal(a, b);
  // Case and surrounding whitespace are not meaningful differences; treating
  // them as different keys would let a retry duplicate a bill.
  assert.equal(idempotencyKey("Bill", "create", "  Vendor-7/inv-1042 "), a);
});

test("different intents never collide", () => {
  const bill = idempotencyKey("Bill", "create", "vendor-7/INV-1042");
  assert.notEqual(bill, idempotencyKey("Bill", "create", "vendor-7/INV-1043"));
  assert.notEqual(bill, idempotencyKey("Bill", "update", "vendor-7/INV-1042"));
  assert.notEqual(bill, idempotencyKey("PurchaseOrder", "create", "vendor-7/INV-1042"));
});

// ---------------------------------------------------------------------------
// Name records
// ---------------------------------------------------------------------------

test("a plain customer carries no parent or job flags", () => {
  const payload = customerPayload({ displayName: "  Smith Residence  ", email: "a@b.com" });
  assert.equal(payload.DisplayName, "Smith Residence");
  assert.deepEqual(payload.PrimaryEmailAddr, { Address: "a@b.com" });
  assert.equal(payload.ParentRef, undefined);
  assert.equal(payload.Job, undefined);
});

test("a project is a sub-customer with job costing, not just a child", () => {
  const payload = customerPayload({
    displayName: "P5-2026-0001 Kitchen",
    parentQboId: "42",
    isProject: true,
  });
  assert.deepEqual(payload.ParentRef, { value: "42" });
  assert.equal(payload.Job, true);
  assert.equal(payload.IsProject, true);
  // Billing with the parent would roll the project's invoices up to the
  // customer and defeat project-level AR.
  assert.equal(payload.BillWithParent, false);
});

test("vendor 1099 tracking distinguishes false from unspecified", () => {
  assert.equal(vendorPayload({ displayName: "Acme" }).Vendor1099, undefined);
  assert.equal(vendorPayload({ displayName: "Acme", track1099: false }).Vendor1099, false);
  assert.equal(vendorPayload({ displayName: "Acme", track1099: true }).Vendor1099, true);
});

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

test("an invoice line carries item, class and rounded money", () => {
  const payload = invoicePayload({
    customerQboId: "9",
    lines: [
      { description: "Progress draw 1", amount: 5937.505, itemQboId: "3", classQboId: "5" },
    ],
    docNumber: "1001",
  });
  const line = (payload.Line as Record<string, unknown>[])[0];
  assert.equal(line.Amount, 5937.51);
  assert.equal(line.DetailType, "SalesItemLineDetail");
  const detail = line.SalesItemLineDetail as Record<string, unknown>;
  assert.deepEqual(detail.ItemRef, { value: "3" });
  assert.deepEqual(detail.ClassRef, { value: "5" });
  assert.deepEqual(payload.CustomerRef, { value: "9" });
});

test("an invoice with no lines is refused rather than posted empty", () => {
  assert.throws(() => invoicePayload({ customerQboId: "9", lines: [] }), /at least one line/);
  assert.throws(() => billPayload({ vendorQboId: "1", lines: [] }), /at least one line/);
  assert.throws(
    () => purchaseOrderPayload({ vendorQboId: "1", lines: [] }),
    /at least one line/,
  );
});

test("expense lines choose item-based or account-based, never both", () => {
  const itemised = purchaseOrderPayload({
    vendorQboId: "7",
    lines: [{ description: "Framing labour", amount: 8000, itemQboId: "11" }],
  });
  const itemLine = (itemised.Line as Record<string, unknown>[])[0];
  assert.equal(itemLine.DetailType, "ItemBasedExpenseLineDetail");
  assert.equal(itemLine.AccountBasedExpenseLineDetail, undefined);

  const accounted = purchaseOrderPayload({
    vendorQboId: "7",
    lines: [{ description: "Permit", amount: 450, accountQboId: "88" }],
  });
  const acctLine = (accounted.Line as Record<string, unknown>[])[0];
  assert.equal(acctLine.DetailType, "AccountBasedExpenseLineDetail");
  assert.equal(acctLine.ItemBasedExpenseLineDetail, undefined);
});

test("the project lands on the expense line, which is what costs the job", () => {
  const po = purchaseOrderPayload({
    vendorQboId: "7",
    customerQboId: "55",
    lines: [{ description: "Cabinets", amount: 12000, itemQboId: "11" }],
  });
  const detail = (po.Line as Record<string, unknown>[])[0]
    .ItemBasedExpenseLineDetail as Record<string, unknown>;
  assert.deepEqual(detail.CustomerRef, { value: "55" });

  // Without a project it stays a company-level commitment rather than
  // silently costing some default job.
  const companyPo = purchaseOrderPayload({
    vendorQboId: "7",
    lines: [{ description: "Office chair", amount: 300, accountQboId: "88" }],
  });
  const companyDetail = (companyPo.Line as Record<string, unknown>[])[0]
    .AccountBasedExpenseLineDetail as Record<string, unknown>;
  assert.equal(companyDetail.CustomerRef, undefined);
});

test("project costs on bills are never marked billable", () => {
  // Billable would re-invoice the client for a cost already inside the
  // contract, which is how a job gets double-charged.
  const bill = billPayload({
    vendorQboId: "7",
    customerQboId: "55",
    lines: [{ description: "Plumbing rough-in", amount: 8000, itemQboId: "11" }],
  });
  const detail = (bill.Line as Record<string, unknown>[])[0]
    .ItemBasedExpenseLineDetail as Record<string, unknown>;
  assert.equal(detail.BillableStatus, "NotBillable");
});

test("a bill can draw down the commitment it belongs to", () => {
  const bill = billPayload({
    vendorQboId: "7",
    lines: [{ description: "Plumbing rough-in", amount: 8000, accountQboId: "88" }],
    linkedPurchaseOrderId: "1001",
  });
  assert.deepEqual(bill.LinkedTxn, [{ TxnId: "1001", TxnType: "PurchaseOrder" }]);
});

test("the P5 project id rides along only when the custom field is configured", () => {
  const withField = invoicePayload({
    customerQboId: "9",
    lines: [{ description: "Draw", amount: 100 }],
    p5ProjectId: "P5-2026-0001",
    projectCustomFieldId: "1",
  });
  assert.deepEqual(withField.CustomField, [
    { DefinitionId: "1", Type: "StringType", StringValue: "P5-2026-0001" },
  ]);

  const withoutField = invoicePayload({
    customerQboId: "9",
    lines: [{ description: "Draw", amount: 100 }],
    p5ProjectId: "P5-2026-0001",
  });
  assert.equal(withoutField.CustomField, undefined);
});

// ---------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------

test("updates carry the concurrency token so a stale write fails loudly", () => {
  const envelope = withUpdateEnvelope({ DisplayName: "Renamed" }, "42", "3");
  assert.equal(envelope.Id, "42");
  assert.equal(envelope.SyncToken, "3");
  assert.equal(envelope.sparse, true);
  assert.equal(envelope.DisplayName, "Renamed");
});
