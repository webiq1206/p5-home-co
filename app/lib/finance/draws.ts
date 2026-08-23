/**
 * Lender draws (S77): lifecycle, submission readiness, and automatic package
 * assembly.
 *
 * The state machine and readiness evaluation are pure and unit-tested; a draw
 * cannot be submitted while a lender requirement is unmet, and every blocker
 * names itself (same fail-with-reasons contract as the payment gate, S105).
 * The package is assembled from data the system already holds - project,
 * invoices, bills, commitments, waivers, draw history - and frozen as a JSONB
 * snapshot at submission so the record of what the lender received is
 * immutable (S183 spirit: history is protected).
 */

import { query, queryOne } from "../db.ts";

// ---------------------------------------------------------------------------
// Lifecycle (pure).
// ---------------------------------------------------------------------------

export type DrawStatus = "draft" | "submitted" | "approved" | "funded" | "rejected";

const DRAW_TRANSITIONS: Record<DrawStatus, DrawStatus[]> = {
  draft: ["submitted", "rejected"],
  submitted: ["approved", "rejected"],
  approved: ["funded", "rejected"],
  funded: [],                      // terminal: money moved
  rejected: ["draft"],             // rework and resubmit as the same draw
};

export function canTransitionDraw(from: DrawStatus, to: DrawStatus): boolean {
  return DRAW_TRANSITIONS[from]?.includes(to) ?? false;
}

// ---------------------------------------------------------------------------
// Submission readiness (pure).
// ---------------------------------------------------------------------------

export type LenderRequirements = {
  requiresInspection: boolean;
  requiresLienWaivers: boolean;
  requiresInvoices: boolean;
  requiresPhotos: boolean;
};

export type DrawFacts = {
  inspectionStatus: "not_required" | "pending" | "scheduled" | "passed" | "failed";
  /** Conditional waivers accepted for every project vendor with billed work. */
  waiversSatisfied: boolean;
  /** At least one invoice/pay application exists on the project. */
  hasInvoices: boolean;
  photosProvided: boolean;
  amountRequested: number;
  /** Remaining loan budget (approved budget minus prior funded draws); null = no cap configured. */
  remainingLoanBudget: number | null;
};

export type DrawReadiness = { ready: boolean; blockers: string[] };

export function evaluateDrawReadiness(
  req: LenderRequirements,
  facts: DrawFacts,
): DrawReadiness {
  const blockers: string[] = [];
  if (req.requiresInspection && facts.inspectionStatus !== "passed") {
    blockers.push(
      facts.inspectionStatus === "failed"
        ? "Inspection failed - resolve and re-inspect before submitting."
        : "Lender requires a passed inspection for every draw.",
    );
  }
  if (req.requiresLienWaivers && !facts.waiversSatisfied) {
    blockers.push("Lender requires current lien waivers from project vendors.");
  }
  if (req.requiresInvoices && !facts.hasInvoices) {
    blockers.push("Lender requires the invoice/pay application in the package.");
  }
  if (req.requiresPhotos && !facts.photosProvided) {
    blockers.push("Lender requires progress photos with every draw.");
  }
  if (facts.amountRequested <= 0) {
    blockers.push("Draw amount must be greater than zero.");
  }
  if (
    facts.remainingLoanBudget !== null &&
    facts.amountRequested > facts.remainingLoanBudget
  ) {
    blockers.push(
      `Requested amount exceeds the remaining approved loan budget ($${facts.remainingLoanBudget.toLocaleString()}).`,
    );
  }
  return { ready: blockers.length === 0, blockers };
}

// ---------------------------------------------------------------------------
// Package assembly (S77: generate automatically where possible).
// ---------------------------------------------------------------------------

export type DrawPackage = {
  generatedAt: string;
  draw: { number: number; amountRequested: number; inspectionStatus: string; photosRef: string | null };
  lender: { name: string; loanNumber: string | null; contact: string | null };
  project: {
    p5Id: string;
    name: string;
    address: string | null;
    contractAmount: number;
    approvedChangeOrders: number;
    revisedContract: number;
  };
  financial: {
    invoicedToDate: number;
    collectedToDate: number;
    billedCostToDate: number;
    openCommitments: number;
    priorDrawsFunded: number;
    remainingLoanBudget: number | null;
  };
  invoices: { number: string; date: string | null; amount: number; open: number }[];
  vendors: { name: string; billed: number; committed: number }[];
  lienWaivers: { vendor: string; type: string; status: string; throughDate: string | null }[];
  priorDraws: { number: number; status: string; requested: number; funded: number | null; fundedAt: string | null }[];
};

export async function assembleDrawPackage(drawId: number): Promise<DrawPackage | null> {
  const draw = await queryOne<{
    id: string; project_id: string; draw_number: number; amount_requested: string;
    inspection_status: string; photos_ref: string | null;
  }>(
    `SELECT id, project_id, draw_number, amount_requested, inspection_status, photos_ref
     FROM lender_draw WHERE id = $1`,
    [drawId],
  );
  if (!draw) return null;

  const project = await queryOne<{
    p5_id: string; name: string; property_address: string | null;
    contract_amount: string; approved_change_orders: string; qbo_customer_id: string | null;
  }>(
    `SELECT p5_id, name, property_address, contract_amount, approved_change_orders, qbo_customer_id
     FROM p5_project WHERE id = $1`,
    [draw.project_id],
  );
  const lender = await queryOne<{
    lender_name: string; loan_number: string | null; contact_name: string | null;
    contact_email: string | null; approved_loan_budget: string | null;
  }>(`SELECT * FROM project_lender WHERE project_id = $1`, [draw.project_id]);
  if (!project || !lender) return null;

  // Financial rollup + supporting schedules from the QBO read model.
  let invoices: DrawPackage["invoices"] = [];
  let vendors: DrawPackage["vendors"] = [];
  let invoicedToDate = 0;
  let arOpen = 0;
  let billedCost = 0;
  let openCommitments = 0;
  if (project.qbo_customer_id) {
    const invRows = await query<{
      doc_number: string | null; txn_date: string | null; total: string | null; balance: string | null;
    }>(
      `SELECT doc_number, txn_date::text, total, balance
       FROM qbo_txn WHERE txn_type = 'Invoice' AND customer_qbo_id = $1
       ORDER BY txn_date`,
      [project.qbo_customer_id],
    );
    invoices = invRows.map((r) => ({
      number: r.doc_number ?? "(no number)",
      date: r.txn_date,
      amount: Number(r.total ?? 0),
      open: Number(r.balance ?? 0),
    }));
    invoicedToDate = invoices.reduce((s, i) => s + i.amount, 0);
    arOpen = invoices.reduce((s, i) => s + i.open, 0);

    const vendorRows = await query<{
      name: string; billed: string; committed: string;
    }>(
      `SELECT v.display_name AS name,
              COALESCE(SUM(t.total) FILTER (WHERE t.txn_type = 'Bill'), 0) AS billed,
              COALESCE(SUM(t.total) FILTER (WHERE t.txn_type = 'PurchaseOrder' AND t.po_status = 'Open'), 0) AS committed
       FROM qbo_txn t JOIN qbo_vendor v ON v.qbo_id = t.vendor_qbo_id
       WHERE t.customer_qbo_id = $1 AND t.txn_type IN ('Bill','PurchaseOrder')
       GROUP BY v.display_name ORDER BY v.display_name`,
      [project.qbo_customer_id],
    );
    vendors = vendorRows.map((r) => ({
      name: r.name,
      billed: Number(r.billed),
      committed: Number(r.committed),
    }));
    billedCost = vendors.reduce((s, v) => s + v.billed, 0);
    openCommitments = vendors.reduce((s, v) => s + v.committed, 0);
  }

  const waivers = await query<{
    vendor: string; waiver_type: string; status: string; through_date: string | null;
  }>(
    `SELECT vp.display_name AS vendor, w.waiver_type, w.status, w.through_date::text
     FROM lien_waiver w JOIN vendor_profile vp ON vp.id = w.vendor_id
     WHERE w.project_id = $1 ORDER BY vp.display_name, w.created_at`,
    [draw.project_id],
  );

  const prior = await query<{
    draw_number: number; status: string; amount_requested: string;
    amount_funded: string | null; funded_at: Date | null;
  }>(
    `SELECT draw_number, status, amount_requested, amount_funded, funded_at
     FROM lender_draw WHERE project_id = $1 AND id <> $2 ORDER BY draw_number`,
    [draw.project_id, drawId],
  );
  const priorFunded = prior.reduce((s, d) => s + Number(d.amount_funded ?? 0), 0);
  const loanBudget = lender.approved_loan_budget === null ? null : Number(lender.approved_loan_budget);

  return {
    generatedAt: new Date().toISOString(),
    draw: {
      number: draw.draw_number,
      amountRequested: Number(draw.amount_requested),
      inspectionStatus: draw.inspection_status,
      photosRef: draw.photos_ref,
    },
    lender: {
      name: lender.lender_name,
      loanNumber: lender.loan_number,
      contact: lender.contact_name
        ? `${lender.contact_name}${lender.contact_email ? ` <${lender.contact_email}>` : ""}`
        : null,
    },
    project: {
      p5Id: project.p5_id,
      name: project.name,
      address: project.property_address,
      contractAmount: Number(project.contract_amount),
      approvedChangeOrders: Number(project.approved_change_orders),
      revisedContract: Number(project.contract_amount) + Number(project.approved_change_orders),
    },
    financial: {
      invoicedToDate,
      collectedToDate: invoicedToDate - arOpen,
      billedCostToDate: billedCost,
      openCommitments,
      priorDrawsFunded: priorFunded,
      remainingLoanBudget: loanBudget === null ? null : loanBudget - priorFunded,
    },
    invoices,
    vendors,
    lienWaivers: waivers.map((w) => ({
      vendor: w.vendor,
      type: w.waiver_type,
      status: w.status,
      throughDate: w.through_date,
    })),
    priorDraws: prior.map((d) => ({
      number: d.draw_number,
      status: d.status,
      requested: Number(d.amount_requested),
      funded: d.amount_funded === null ? null : Number(d.amount_funded),
      fundedAt: d.funded_at ? new Date(d.funded_at).toISOString().slice(0, 10) : null,
    })),
  };
}

/** Facts for readiness, derived from the same data the package shows. */
export async function drawFacts(drawId: number): Promise<DrawFacts | null> {
  const pkg = await assembleDrawPackage(drawId);
  if (!pkg) return null;
  // Waivers satisfied = every vendor with billed work has at least one
  // accepted waiver on this project (the lender-facing bar; the per-payment
  // gate is stricter and lives in compliance.ts).
  const billedVendors = pkg.vendors.filter((v) => v.billed > 0).map((v) => v.name);
  const accepted = new Set(
    pkg.lienWaivers.filter((w) => w.status === "accepted").map((w) => w.vendor),
  );
  const waiversSatisfied = billedVendors.every((v) => accepted.has(v));
  return {
    inspectionStatus: pkg.draw.inspectionStatus as DrawFacts["inspectionStatus"],
    waiversSatisfied,
    hasInvoices: pkg.invoices.length > 0,
    photosProvided: Boolean(pkg.draw.photosRef),
    amountRequested: pkg.draw.amountRequested,
    remainingLoanBudget: pkg.financial.remainingLoanBudget,
  };
}
