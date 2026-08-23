/**
 * Scoped data access for the portals. Every query takes the signed-in
 * contact's vendor_id or project_id and filters at the SQL level - scoping is
 * not left to the rendering layer (S151/S152).
 */

import { query, queryOne } from "../db.ts";
import {
  clientInvoiceView,
  clientProjectView,
  vendorPaymentView,
  type ClientInvoiceView,
  type ClientProjectView,
  type VendorPaymentView,
} from "./views.ts";

// ---------------------------------------------------------------------------
// Vendor portal (S151)
// ---------------------------------------------------------------------------

export type VendorPortalData = {
  displayName: string;
  complianceStatus: string;
  paymentHold: boolean;
  docs: { docType: string; status: string; expiresOn: string | null }[];
  actionRequired: string[];
  payments: VendorPaymentView[];
  waivers: { id: number; type: string; status: string; project: string; amount: number | null }[];
  projects: string[];
};

export async function vendorPortalData(vendorId: number): Promise<VendorPortalData | null> {
  const vendor = await queryOne<{
    display_name: string;
    compliance_status: string;
    payment_hold: boolean;
    qbo_vendor_id: string | null;
  }>(
    `SELECT display_name, compliance_status, payment_hold, qbo_vendor_id
     FROM vendor_profile WHERE id = $1 AND active`,
    [vendorId],
  );
  if (!vendor) return null;

  const docs = await query<{
    doc_type: string;
    status: string;
    expires_on: string | null;
    required: boolean;
  }>(
    `SELECT doc_type, status, expires_on::text, required
     FROM vendor_document WHERE vendor_id = $1 ORDER BY doc_type`,
    [vendorId],
  );

  // Action Required: the vendor's own blockers, stated plainly (S151).
  const actionRequired: string[] = [];
  for (const d of docs) {
    if (!d.required || d.status === "waived") continue;
    if (d.status === "missing" || d.status === "requested") {
      actionRequired.push(`Send your ${d.doc_type} to P5.`);
    } else if (d.status === "expired") {
      actionRequired.push(`Your ${d.doc_type} has expired - send the renewal.`);
    }
  }

  const waivers = await query<{
    id: string;
    waiver_type: string;
    status: string;
    p5_id: string;
    name: string;
    amount: string | null;
  }>(
    `SELECT w.id, w.waiver_type, w.status, p.p5_id, p.name, w.amount
     FROM lien_waiver w JOIN p5_project p ON p.id = w.project_id
     WHERE w.vendor_id = $1 AND w.status NOT IN ('accepted','rejected')
     ORDER BY w.created_at DESC`,
    [vendorId],
  );
  for (const w of waivers) {
    if (w.status === "required" || w.status === "requested") {
      actionRequired.push(
        `Sign and return the ${w.waiver_type} lien waiver for ${w.p5_id}.`,
      );
    }
  }

  // Payments: this vendor's bills only, joined by their QBO vendor id.
  let payments: VendorPaymentView[] = [];
  let projects: string[] = [];
  if (vendor.qbo_vendor_id) {
    const bills = await query<{
      doc_number: string | null;
      txn_date: string | null;
      due_date: string | null;
      total: string | null;
      balance: string | null;
    }>(
      `SELECT doc_number, txn_date::text, due_date::text, total, balance
       FROM qbo_txn WHERE txn_type = 'Bill' AND vendor_qbo_id = $1
       ORDER BY txn_date DESC LIMIT 50`,
      [vendor.qbo_vendor_id],
    );
    payments = bills.map((b) =>
      vendorPaymentView({
        docNumber: b.doc_number,
        txnDate: b.txn_date,
        dueDate: b.due_date,
        total: Number(b.total ?? 0),
        openBalance: Number(b.balance ?? 0),
        vendorOnHold: vendor.payment_hold || vendor.compliance_status === "Payment Hold",
      }),
    );

    // Awarded projects: the P5 projects this vendor has POs or bills on.
    const rows = await query<{ p5_id: string; name: string }>(
      `SELECT DISTINCT p.p5_id, p.name
       FROM qbo_txn t
       JOIN p5_project p ON p.qbo_customer_id = t.customer_qbo_id
       WHERE t.vendor_qbo_id = $1 AND t.txn_type IN ('Bill','PurchaseOrder')`,
      [vendor.qbo_vendor_id],
    );
    projects = rows.map((r) => `${r.p5_id} · ${r.name}`);
  }

  return {
    displayName: vendor.display_name,
    complianceStatus: vendor.compliance_status,
    paymentHold: vendor.payment_hold,
    docs: docs.map((d) => ({
      docType: d.doc_type,
      status: d.status,
      expiresOn: d.expires_on,
    })),
    actionRequired,
    payments,
    waivers: waivers.map((w) => ({
      id: Number(w.id),
      type: w.waiver_type,
      status: w.status,
      project: `${w.p5_id} · ${w.name}`,
      amount: w.amount === null ? null : Number(w.amount),
    })),
    projects,
  };
}

// ---------------------------------------------------------------------------
// Client portal (S152)
// ---------------------------------------------------------------------------

export type ClientPortalData = {
  project: ClientProjectView;
  invoices: ClientInvoiceView[];
};

export async function clientPortalData(projectId: number): Promise<ClientPortalData | null> {
  const project = await queryOne<{
    p5_id: string;
    name: string;
    status: string;
    contract_amount: string;
    approved_change_orders: string;
    qbo_customer_id: string | null;
  }>(
    `SELECT p5_id, name, status, contract_amount, approved_change_orders, qbo_customer_id
     FROM p5_project WHERE id = $1`,
    [projectId],
  );
  if (!project) return null;

  let invoiced = 0;
  let arOpen = 0;
  let invoices: ClientInvoiceView[] = [];
  if (project.qbo_customer_id) {
    const rows = await query<{
      doc_number: string | null;
      txn_date: string | null;
      due_date: string | null;
      total: string | null;
      balance: string | null;
    }>(
      `SELECT doc_number, txn_date::text, due_date::text, total, balance
       FROM qbo_txn WHERE txn_type = 'Invoice' AND customer_qbo_id = $1
       ORDER BY txn_date DESC`,
      [project.qbo_customer_id],
    );
    invoices = rows.map((r) =>
      clientInvoiceView({
        docNumber: r.doc_number,
        txnDate: r.txn_date,
        dueDate: r.due_date,
        total: Number(r.total ?? 0),
        openBalance: Number(r.balance ?? 0),
      }),
    );
    invoiced = rows.reduce((s, r) => s + Number(r.total ?? 0), 0);
    arOpen = rows.reduce((s, r) => s + Number(r.balance ?? 0), 0);
  }

  return {
    project: clientProjectView({
      p5Id: project.p5_id,
      name: project.name,
      status: project.status,
      contractAmount: Number(project.contract_amount),
      approvedChangeOrders: Number(project.approved_change_orders),
      invoiced,
      arOpen,
    }),
    invoices,
  };
}
