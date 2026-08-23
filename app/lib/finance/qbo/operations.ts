/**
 * Business-level QuickBooks writes.
 *
 * write.ts knows how to post a record safely; this knows *what P5 means* by
 * each write and, crucially, what the natural key is. The natural key is the
 * whole duplicate defence: it must identify the intent in P5's own terms and
 * stay identical across retries, so it is always derived from P5 row ids and
 * reference numbers - never from a clock, a sequence, or anything the caller
 * might regenerate.
 *
 * Every operation also links the resulting QBO id back onto the P5 row, so the
 * second call short-circuits before it ever reaches Intuit.
 */

import { query, queryOne } from "../../db.ts";
import {
  billPayload,
  customerPayload,
  invoicePayload,
  purchaseOrderPayload,
  vendorPayload,
  naturalKeys,
  type LineInput,
} from "./map.ts";
import { qboWrite } from "./write.ts";

export { naturalKeys } from "./map.ts";


// ---------------------------------------------------------------------------
// Name records
// ---------------------------------------------------------------------------

export type EnsureResult = { qboId: string; created: boolean };

/**
 * Put a P5 project into QuickBooks as a sub-customer of its client, and record
 * the id on the P5 row. Idempotent twice over: the stored id short-circuits,
 * and the intent ledger catches anything that slipped past it.
 */
export async function ensureProjectInQbo(
  p5ProjectId: number,
  options: { parentCustomerQboId: string; requestedBy?: number | null },
): Promise<EnsureResult> {
  const project = await queryOne<{
    id: string;
    p5_id: string;
    name: string;
    qbo_customer_id: string | null;
    property_address: string | null;
  }>(
    `SELECT id, p5_id, name, qbo_customer_id, property_address
       FROM p5_project WHERE id = $1`,
    [p5ProjectId],
  );
  if (!project) throw new Error(`Project ${p5ProjectId} not found.`);
  if (project.qbo_customer_id) {
    return { qboId: project.qbo_customer_id, created: false };
  }

  const result = await qboWrite({
    entity: "Customer",
    naturalKey: naturalKeys.project(project.id),
    requestedBy: options.requestedBy ?? null,
    payload: customerPayload({
      // QBO sub-customer names must be unique under the parent; the P5 id is
      // what guarantees that without depending on the human-facing name.
      displayName: `${project.p5_id} ${project.name}`.trim(),
      parentQboId: options.parentCustomerQboId,
      isProject: true,
    }),
  });

  await query(`UPDATE p5_project SET qbo_customer_id = $2, updated_at = now() WHERE id = $1`, [
    p5ProjectId,
    result.qboId,
  ]);
  return { qboId: result.qboId, created: !result.reused };
}

/** Put a P5 vendor into QuickBooks and record the id on vendor_profile. */
export async function ensureVendorInQbo(
  p5VendorId: number,
  options: { requestedBy?: number | null } = {},
): Promise<EnsureResult> {
  const vendor = await queryOne<{
    id: string;
    display_name: string;
    qbo_vendor_id: string | null;
  }>(
    `SELECT id, display_name, qbo_vendor_id FROM vendor_profile WHERE id = $1`,
    [p5VendorId],
  );
  if (!vendor) throw new Error(`Vendor ${p5VendorId} not found.`);
  if (vendor.qbo_vendor_id) return { qboId: vendor.qbo_vendor_id, created: false };

  // The portal contact holds the email; a vendor may have none on file yet,
  // which is not a reason to refuse to create them in QuickBooks.
  const contact = await queryOne<{ email: string }>(
    `SELECT email FROM portal_contact
      WHERE vendor_id = $1 AND is_active ORDER BY id LIMIT 1`,
    [p5VendorId],
  );

  const result = await qboWrite({
    entity: "Vendor",
    naturalKey: naturalKeys.vendor(vendor.id),
    requestedBy: options.requestedBy ?? null,
    payload: vendorPayload({
      displayName: vendor.display_name,
      email: contact?.email ?? null,
      // 1099 status is a tax determination, not a guess. Left unset here so
      // QBO keeps its own default until the W-9 is on file (S113 territory).
    }),
  });

  await query(`UPDATE vendor_profile SET qbo_vendor_id = $2 WHERE id = $1`, [
    p5VendorId,
    result.qboId,
  ]);
  return { qboId: result.qboId, created: !result.reused };
}

/** A standalone customer, for clients that are not yet projects. */
export async function createCustomerInQbo(
  input: {
    p5Key: string;
    displayName: string;
    email?: string | null;
    phone?: string | null;
  },
  requestedBy?: number | null,
): Promise<EnsureResult> {
  const result = await qboWrite({
    entity: "Customer",
    naturalKey: naturalKeys.customer(input.p5Key),
    requestedBy: requestedBy ?? null,
    payload: customerPayload({
      displayName: input.displayName,
      email: input.email,
      phone: input.phone,
    }),
  });
  return { qboId: result.qboId, created: !result.reused };
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export type DrawInput = {
  p5ProjectId: number;
  drawNumber: number;
  lines: LineInput[];
  txnDate?: string | null;
  dueDate?: string | null;
  memo?: string | null;
};

/**
 * Bill a client draw against a project.
 *
 * Keyed by project + draw number: submitting draw 3 twice returns the first
 * invoice rather than billing the client again.
 */
export async function createProjectDrawInvoice(
  input: DrawInput,
  requestedBy?: number | null,
): Promise<{ qboId: string; reused: boolean }> {
  const project = await queryOne<{ id: string; qbo_customer_id: string | null }>(
    `SELECT id, qbo_customer_id FROM p5_project WHERE id = $1`,
    [input.p5ProjectId],
  );
  if (!project) throw new Error(`Project ${input.p5ProjectId} not found.`);
  if (!project.qbo_customer_id) {
    throw new Error("This project is not in QuickBooks yet; create it there first.");
  }

  const result = await qboWrite({
    entity: "Invoice",
    naturalKey: naturalKeys.invoice(project.id, input.drawNumber),
    requestedBy: requestedBy ?? null,
    payload: invoicePayload({
      customerQboId: project.qbo_customer_id,
      lines: input.lines,
      txnDate: input.txnDate,
      dueDate: input.dueDate,
      customerMemo: input.memo,
    }),
  });
  return { qboId: result.qboId, reused: result.reused };
}

export type CommitmentInput = {
  p5ProjectId: number;
  p5VendorId: number;
  reference: string;
  lines: LineInput[];
  txnDate?: string | null;
  memo?: string | null;
};

/** Raise a commitment (purchase order) against a project and vendor. */
export async function createCommitment(
  input: CommitmentInput,
  requestedBy?: number | null,
): Promise<{ qboId: string; reused: boolean }> {
  const [project, vendor] = await Promise.all([
    queryOne<{ id: string; qbo_customer_id: string | null }>(
      `SELECT id, qbo_customer_id FROM p5_project WHERE id = $1`,
      [input.p5ProjectId],
    ),
    queryOne<{ id: string; qbo_vendor_id: string | null }>(
      `SELECT id, qbo_vendor_id FROM vendor_profile WHERE id = $1`,
      [input.p5VendorId],
    ),
  ]);
  if (!project?.qbo_customer_id) {
    throw new Error("This project is not in QuickBooks yet; create it there first.");
  }
  if (!vendor?.qbo_vendor_id) {
    throw new Error("This vendor is not in QuickBooks yet; create them there first.");
  }

  const result = await qboWrite({
    entity: "PurchaseOrder",
    naturalKey: naturalKeys.purchaseOrder(project.id, vendor.id, input.reference),
    requestedBy: requestedBy ?? null,
    payload: purchaseOrderPayload({
      vendorQboId: vendor.qbo_vendor_id,
      customerQboId: project.qbo_customer_id,
      lines: input.lines,
      txnDate: input.txnDate,
      memo: input.memo,
    }),
  });
  return { qboId: result.qboId, reused: result.reused };
}

export type VendorBillInput = {
  p5VendorId: number;
  vendorInvoiceNumber: string;
  lines: LineInput[];
  p5ProjectId?: number | null;
  txnDate?: string | null;
  dueDate?: string | null;
  linkedPurchaseOrderId?: string | null;
  memo?: string | null;
};

/**
 * Post a vendor bill.
 *
 * Keyed by vendor + their invoice number, which is the pair that must never
 * post twice - that is the duplicate that becomes a duplicate payment.
 */
export async function createVendorBill(
  input: VendorBillInput,
  requestedBy?: number | null,
): Promise<{ qboId: string; reused: boolean }> {
  const vendor = await queryOne<{ id: string; qbo_vendor_id: string | null }>(
    `SELECT id, qbo_vendor_id FROM vendor_profile WHERE id = $1`,
    [input.p5VendorId],
  );
  if (!vendor?.qbo_vendor_id) {
    throw new Error("This vendor is not in QuickBooks yet; create them there first.");
  }
  if (!input.vendorInvoiceNumber.trim()) {
    throw new Error("A vendor invoice number is required; it is the duplicate guard.");
  }

  let customerQboId: string | null = null;
  if (input.p5ProjectId) {
    const project = await queryOne<{ qbo_customer_id: string | null }>(
      `SELECT qbo_customer_id FROM p5_project WHERE id = $1`,
      [input.p5ProjectId],
    );
    customerQboId = project?.qbo_customer_id ?? null;
  }

  const result = await qboWrite({
    entity: "Bill",
    naturalKey: naturalKeys.bill(vendor.id, input.vendorInvoiceNumber),
    requestedBy: requestedBy ?? null,
    payload: billPayload({
      vendorQboId: vendor.qbo_vendor_id,
      customerQboId,
      lines: input.lines,
      txnDate: input.txnDate,
      dueDate: input.dueDate,
      docNumber: input.vendorInvoiceNumber.trim(),
      linkedPurchaseOrderId: input.linkedPurchaseOrderId,
      memo: input.memo,
    }),
  });
  return { qboId: result.qboId, reused: result.reused };
}
