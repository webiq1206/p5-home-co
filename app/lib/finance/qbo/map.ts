/**
 * P5 -> QuickBooks payload mapping, and the idempotency keys that protect it.
 *
 * Pure on purpose. These functions decide what P5 will post into the company's
 * books, so they are the part that most needs to be testable without a network
 * or a database. Everything that talks to Intuit lives in write.ts.
 */

import { createHash } from "node:crypto";

export type QboRef = { value: string; name?: string };

/**
 * What makes each write unique in P5's own terms.
 *
 * These feed idempotencyKey, so they are the duplicate defence. Every one is
 * derived from durable P5 row ids and reference numbers - never a clock, a
 * sequence, or anything a caller could regenerate differently on retry.
 */
export const naturalKeys = {
  customer: (p5CustomerId: number | string): string => `customer:${p5CustomerId}`,
  project: (p5ProjectId: number | string): string => `project:${p5ProjectId}`,
  vendor: (p5VendorId: number | string): string => `vendor:${p5VendorId}`,
  /** A draw is unique per project; re-submitting draw 3 must not bill twice. */
  invoice: (p5ProjectId: number | string, drawNumber: number | string): string =>
    `invoice:project:${p5ProjectId}:draw:${drawNumber}`,
  /** A commitment is unique per project, vendor and P5 reference. */
  purchaseOrder: (
    p5ProjectId: number | string,
    p5VendorId: number | string,
    reference: string,
  ): string => `po:project:${p5ProjectId}:vendor:${p5VendorId}:ref:${reference}`,
  /** A vendor's own invoice number is the thing that must never post twice. */
  bill: (p5VendorId: number | string, vendorInvoiceNumber: string): string =>
    `bill:vendor:${p5VendorId}:ref:${vendorInvoiceNumber}`,
};

/**
 * The duplicate guard.
 *
 * Deterministic from the logical intent, never from a clock or a random value:
 * a retry after a timeout MUST produce the same key, otherwise the unique index
 * on qbo_write_intent cannot stop a second write. The natural key is whatever
 * makes the intent unique in P5's own terms - a project id, a bill's vendor and
 * reference, an invoice's draw number.
 */
export function idempotencyKey(
  entity: string,
  operation: "create" | "update",
  naturalKey: string,
): string {
  const canonical = `${entity}:${operation}:${naturalKey.trim().toLowerCase()}`;
  return createHash("sha256").update(canonical).digest("hex").slice(0, 40);
}

/**
 * Intuit accepts a request id on mutating calls and collapses repeats of the
 * same id. That is a second, independent layer of protection with a shorter
 * memory than our ledger - useful for the narrow window where our write
 * succeeded but our own commit did not.
 */
export function requestId(key: string): string {
  // Intuit caps this; the hash prefix is comfortably unique for our volume.
  return key.slice(0, 36);
}

// ---------------------------------------------------------------------------
// Name records
// ---------------------------------------------------------------------------

export type CustomerInput = {
  displayName: string;
  email?: string | null;
  phone?: string | null;
  /** Set to make this a sub-customer, which is how QBO models a project. */
  parentQboId?: string | null;
  isProject?: boolean;
  billingAddress?: {
    line1?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
  } | null;
};

export function customerPayload(input: CustomerInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    DisplayName: input.displayName.trim(),
  };
  if (input.email) payload.PrimaryEmailAddr = { Address: input.email.trim() };
  if (input.phone) payload.PrimaryPhone = { FreeFormNumber: input.phone.trim() };

  if (input.parentQboId) {
    // A QBO "project" is a sub-customer with job costing enabled. Both flags
    // are required: ParentRef alone makes an ordinary sub-customer.
    payload.ParentRef = { value: input.parentQboId };
    payload.Job = true;
    payload.BillWithParent = false;
    if (input.isProject) payload.IsProject = true;
  }

  const addr = input.billingAddress;
  if (addr && (addr.line1 || addr.city || addr.state || addr.postalCode)) {
    payload.BillAddr = {
      ...(addr.line1 ? { Line1: addr.line1 } : {}),
      ...(addr.city ? { City: addr.city } : {}),
      ...(addr.state ? { CountrySubDivisionCode: addr.state } : {}),
      ...(addr.postalCode ? { PostalCode: addr.postalCode } : {}),
    };
  }
  return payload;
}

export type VendorInput = {
  displayName: string;
  email?: string | null;
  phone?: string | null;
  /** Drives 1099 eligibility in QBO; false is not the same as unknown. */
  track1099?: boolean;
};

export function vendorPayload(input: VendorInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    DisplayName: input.displayName.trim(),
  };
  if (input.email) payload.PrimaryEmailAddr = { Address: input.email.trim() };
  if (input.phone) payload.PrimaryPhone = { FreeFormNumber: input.phone.trim() };
  if (input.track1099 !== undefined) payload.Vendor1099 = input.track1099;
  return payload;
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export type LineInput = {
  description: string;
  amount: number;
  itemQboId?: string | null;
  accountQboId?: string | null;
  classQboId?: string | null;
  /** QBO stores the P5 phase on the line as a custom-ish description prefix. */
  quantity?: number | null;
  unitPrice?: number | null;
};

function money(n: number): number {
  // QBO rejects more than two decimals; the engines work in whole cents, so
  // this is a formatting step rather than a rounding decision.
  return Math.round(n * 100) / 100;
}

function salesLine(line: LineInput, index: number): Record<string, unknown> {
  const detail: Record<string, unknown> = {};
  if (line.itemQboId) detail.ItemRef = { value: line.itemQboId };
  if (line.classQboId) detail.ClassRef = { value: line.classQboId };
  if (line.quantity != null) detail.Qty = line.quantity;
  if (line.unitPrice != null) detail.UnitPrice = money(line.unitPrice);

  return {
    LineNum: index + 1,
    Description: line.description,
    Amount: money(line.amount),
    DetailType: "SalesItemLineDetail",
    SalesItemLineDetail: detail,
  };
}

function expenseLine(line: LineInput, index: number): Record<string, unknown> {
  // Item-based when we know the item (so cost group follows), account-based
  // otherwise. Mixing the two on one line is what QBO rejects.
  if (line.itemQboId) {
    const detail: Record<string, unknown> = { ItemRef: { value: line.itemQboId } };
    if (line.classQboId) detail.ClassRef = { value: line.classQboId };
    if (line.quantity != null) detail.Qty = line.quantity;
    if (line.unitPrice != null) detail.UnitPrice = money(line.unitPrice);
    return {
      LineNum: index + 1,
      Description: line.description,
      Amount: money(line.amount),
      DetailType: "ItemBasedExpenseLineDetail",
      ItemBasedExpenseLineDetail: detail,
    };
  }

  const detail: Record<string, unknown> = {};
  if (line.accountQboId) detail.AccountRef = { value: line.accountQboId };
  if (line.classQboId) detail.ClassRef = { value: line.classQboId };
  return {
    LineNum: index + 1,
    Description: line.description,
    Amount: money(line.amount),
    DetailType: "AccountBasedExpenseLineDetail",
    AccountBasedExpenseLineDetail: detail,
  };
}

export type InvoiceInput = {
  customerQboId: string;
  lines: LineInput[];
  txnDate?: string | null;
  dueDate?: string | null;
  docNumber?: string | null;
  customerMemo?: string | null;
  /** P5 project id, written to the custom transaction field when configured. */
  p5ProjectId?: string | null;
  projectCustomFieldId?: string | null;
};

export function invoicePayload(input: InvoiceInput): Record<string, unknown> {
  if (!input.lines.length) {
    throw new Error("An invoice needs at least one line.");
  }
  const payload: Record<string, unknown> = {
    CustomerRef: { value: input.customerQboId },
    Line: input.lines.map(salesLine),
  };
  if (input.txnDate) payload.TxnDate = input.txnDate;
  if (input.dueDate) payload.DueDate = input.dueDate;
  if (input.docNumber) payload.DocNumber = input.docNumber;
  if (input.customerMemo) payload.CustomerMemo = { value: input.customerMemo };
  if (input.p5ProjectId && input.projectCustomFieldId) {
    payload.CustomField = [
      {
        DefinitionId: input.projectCustomFieldId,
        Type: "StringType",
        StringValue: input.p5ProjectId,
      },
    ];
  }
  return payload;
}

export type PurchaseOrderInput = {
  vendorQboId: string;
  lines: LineInput[];
  txnDate?: string | null;
  docNumber?: string | null;
  /** The project the commitment belongs to, as a QBO customer/sub-customer. */
  customerQboId?: string | null;
  memo?: string | null;
};

export function purchaseOrderPayload(input: PurchaseOrderInput): Record<string, unknown> {
  if (!input.lines.length) {
    throw new Error("A purchase order needs at least one line.");
  }
  const lines = input.lines.map(expenseLine).map((line) => {
    // The customer on the line is what makes the commitment land on the
    // project; a PO without it is a company-level commitment.
    if (!input.customerQboId) return line;
    const key = line.DetailType === "ItemBasedExpenseLineDetail"
      ? "ItemBasedExpenseLineDetail"
      : "AccountBasedExpenseLineDetail";
    const detail = line[key] as Record<string, unknown>;
    return { ...line, [key]: { ...detail, CustomerRef: { value: input.customerQboId } } };
  });

  const payload: Record<string, unknown> = {
    VendorRef: { value: input.vendorQboId },
    Line: lines,
  };
  if (input.txnDate) payload.TxnDate = input.txnDate;
  if (input.docNumber) payload.DocNumber = input.docNumber;
  if (input.memo) payload.Memo = input.memo;
  return payload;
}

export type BillInput = {
  vendorQboId: string;
  lines: LineInput[];
  txnDate?: string | null;
  dueDate?: string | null;
  docNumber?: string | null;
  customerQboId?: string | null;
  /** Links the bill to the commitment it draws down. */
  linkedPurchaseOrderId?: string | null;
  memo?: string | null;
};

export function billPayload(input: BillInput): Record<string, unknown> {
  if (!input.lines.length) {
    throw new Error("A bill needs at least one line.");
  }
  const lines = input.lines.map(expenseLine).map((line) => {
    if (!input.customerQboId) return line;
    const key = line.DetailType === "ItemBasedExpenseLineDetail"
      ? "ItemBasedExpenseLineDetail"
      : "AccountBasedExpenseLineDetail";
    const detail = line[key] as Record<string, unknown>;
    return {
      ...line,
      [key]: {
        ...detail,
        CustomerRef: { value: input.customerQboId },
        BillableStatus: "NotBillable",
      },
    };
  });

  const payload: Record<string, unknown> = {
    VendorRef: { value: input.vendorQboId },
    Line: lines,
  };
  if (input.txnDate) payload.TxnDate = input.txnDate;
  if (input.dueDate) payload.DueDate = input.dueDate;
  if (input.docNumber) payload.DocNumber = input.docNumber;
  if (input.memo) payload.Memo = input.memo;
  if (input.linkedPurchaseOrderId) {
    payload.LinkedTxn = [{ TxnId: input.linkedPurchaseOrderId, TxnType: "PurchaseOrder" }];
  }
  return payload;
}

/**
 * QBO updates are optimistic-concurrency controlled: the SyncToken we hold must
 * match the current one or the write is rejected. Sending a stale token is far
 * better than not sending one - it fails loudly instead of overwriting someone
 * else's change.
 */
export function withUpdateEnvelope(
  payload: Record<string, unknown>,
  qboId: string,
  syncToken: string,
  sparse = true,
): Record<string, unknown> {
  return { ...payload, Id: qboId, SyncToken: syncToken, sparse };
}
