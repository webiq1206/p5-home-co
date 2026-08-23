/**
 * Portal projections: pure functions that decide exactly what an external
 * viewer may see.
 *
 * These are the confidentiality boundary of the portals and are unit-tested
 * as such. A vendor must never see other vendors or P5 margin (S151); a
 * client must never see internal cost, vendor pricing, GP or forecasts
 * (S152). Pages render ONLY what these projections return - if a field is not
 * produced here, it cannot leak.
 */

// ---------------------------------------------------------------------------
// Vendor payment status (S104/S111): collapse ledger state + operational
// holds into the statuses a vendor is shown.
// ---------------------------------------------------------------------------

export type VendorBillFacts = {
  docNumber: string | null;
  txnDate: string | null;
  dueDate: string | null;
  total: number;
  openBalance: number;
  vendorOnHold: boolean;
};

export type VendorPaymentView = {
  reference: string;
  received: string | null;
  due: string | null;
  amount: number;
  status: "received" | "on hold" | "approved for payment" | "paid";
};

export function vendorPaymentView(bill: VendorBillFacts): VendorPaymentView {
  let status: VendorPaymentView["status"];
  if (bill.openBalance <= 0) status = "paid";
  else if (bill.vendorOnHold) status = "on hold";
  // An open bill inside terms reads as approved-for-payment scheduling;
  // freshly received otherwise. Finer states (scheduled/processing) arrive
  // with Bill Pay data and slot in here without changing the page.
  else if (bill.dueDate) status = "approved for payment";
  else status = "received";

  return {
    reference: bill.docNumber ?? "(no number)",
    received: bill.txnDate,
    due: bill.dueDate,
    amount: bill.total,
    status,
  };
}

// ---------------------------------------------------------------------------
// Client project view (S152): the revenue-side projection.
// ---------------------------------------------------------------------------

/** Everything the client page is allowed to know about the project. */
export type ClientProjectView = {
  p5Id: string;
  name: string;
  status: string;
  contractAmount: number;
  approvedChangeOrders: number;
  revisedContract: number;
  invoicedToDate: number;
  paidToDate: number;
  outstandingBalance: number;
};

/**
 * Fields that must NEVER appear in a client projection (S152). The unit test
 * walks the projection output and fails if any of these keys ever show up -
 * a structural guarantee, not a review habit.
 */
export const CLIENT_FORBIDDEN_KEYS = [
  "billed",
  "billsOpen",
  "openCommitments",
  "actualCost",
  "etcAmount",
  "projectedFinalCost",
  "projectedGrossProfit",
  "projectedGpPct",
  "targetGpPct",
  "currentBudget",
  "originalBudget",
  "contingency",
  "vendor",
  "margin",
] as const;

export type ClientProjectFacts = {
  p5Id: string;
  name: string;
  status: string;
  contractAmount: number;
  approvedChangeOrders: number;
  invoiced: number;
  arOpen: number;
};

export function clientProjectView(facts: ClientProjectFacts): ClientProjectView {
  return {
    p5Id: facts.p5Id,
    name: facts.name,
    status: facts.status,
    contractAmount: facts.contractAmount,
    approvedChangeOrders: facts.approvedChangeOrders,
    revisedContract: facts.contractAmount + facts.approvedChangeOrders,
    invoicedToDate: facts.invoiced,
    paidToDate: facts.invoiced - facts.arOpen,
    outstandingBalance: facts.arOpen,
  };
}

export type ClientInvoiceView = {
  number: string;
  date: string | null;
  due: string | null;
  amount: number;
  openBalance: number;
  status: "paid" | "partially paid" | "open";
};

export function clientInvoiceView(facts: {
  docNumber: string | null;
  txnDate: string | null;
  dueDate: string | null;
  total: number;
  openBalance: number;
}): ClientInvoiceView {
  return {
    number: facts.docNumber ?? "(no number)",
    date: facts.txnDate,
    due: facts.dueDate,
    amount: facts.total,
    openBalance: facts.openBalance,
    status:
      facts.openBalance <= 0
        ? "paid"
        : facts.openBalance < facts.total
          ? "partially paid"
          : "open",
  };
}
