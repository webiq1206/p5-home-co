import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CLIENT_FORBIDDEN_KEYS,
  clientInvoiceView,
  clientProjectView,
  vendorPaymentView,
} from "../app/lib/portal/views.ts";

// ---------------------------------------------------------------------------
// S152: the confidentiality invariant. The client projection is the ONLY
// source the client page renders from; if a forbidden key cannot appear in
// its output, it cannot leak. This test is the structural guarantee.
// ---------------------------------------------------------------------------

test("client projection never contains cost, margin or vendor fields", () => {
  const view = clientProjectView({
    p5Id: "P5-2026-0001",
    name: "Smith Residence",
    status: "Active",
    contractAmount: 100_000,
    approvedChangeOrders: 10_000,
    invoiced: 55_000,
    arOpen: 5_000,
  });
  const keys = Object.keys(view);
  for (const forbidden of CLIENT_FORBIDDEN_KEYS) {
    assert.ok(
      !keys.some((k) => k.toLowerCase().includes(forbidden.toLowerCase())),
      `client view leaked forbidden field: ${forbidden}`,
    );
  }
});

test("client projection: revenue math is consistent", () => {
  const view = clientProjectView({
    p5Id: "P5-2026-0001",
    name: "Smith Residence",
    status: "Active",
    contractAmount: 100_000,
    approvedChangeOrders: 10_000,
    invoiced: 55_000,
    arOpen: 5_000,
  });
  assert.equal(view.revisedContract, 110_000);
  assert.equal(view.paidToDate, 50_000);
  assert.equal(view.outstandingBalance, 5_000);
});

test("client invoice status: paid, partially paid, open", () => {
  const base = { docNumber: "1001", txnDate: "2026-08-22", dueDate: "2026-09-21" };
  assert.equal(clientInvoiceView({ ...base, total: 100, openBalance: 0 }).status, "paid");
  assert.equal(clientInvoiceView({ ...base, total: 100, openBalance: 40 }).status, "partially paid");
  assert.equal(clientInvoiceView({ ...base, total: 100, openBalance: 100 }).status, "open");
});

// ---------------------------------------------------------------------------
// S151/S111: vendor payment status mapping.
// ---------------------------------------------------------------------------

test("vendor payment view: paid beats hold; holds beat everything else", () => {
  const base = {
    docNumber: "INV-1",
    txnDate: "2026-08-01",
    dueDate: "2026-08-31",
    total: 8_000,
  };
  assert.equal(
    vendorPaymentView({ ...base, openBalance: 0, vendorOnHold: true }).status,
    "paid",
  );
  assert.equal(
    vendorPaymentView({ ...base, openBalance: 8_000, vendorOnHold: true }).status,
    "on hold",
  );
  assert.equal(
    vendorPaymentView({ ...base, openBalance: 8_000, vendorOnHold: false }).status,
    "approved for payment",
  );
  assert.equal(
    vendorPaymentView({ ...base, dueDate: null, openBalance: 8_000, vendorOnHold: false }).status,
    "received",
  );
});

test("vendor payment view exposes no project economics", () => {
  const view = vendorPaymentView({
    docNumber: "INV-1",
    txnDate: "2026-08-01",
    dueDate: "2026-08-31",
    total: 8_000,
    openBalance: 8_000,
    vendorOnHold: false,
  });
  // The vendor sees their own invoice amounts and nothing else - no margin,
  // no customer pricing, no other vendors (S151).
  assert.deepEqual(Object.keys(view).sort(), [
    "amount",
    "due",
    "received",
    "reference",
    "status",
  ]);
});
