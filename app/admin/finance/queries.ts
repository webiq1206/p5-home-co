/**
 * Read queries for the finance pages. Server-only, mirroring admin/queries.ts.
 */

import { query, queryOne } from "../../lib/db.ts";

export function money(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

// ---------------------------------------------------------------------------
// Attention board (S149)
// ---------------------------------------------------------------------------

export type AttentionRow = {
  id: number;
  kind: string;
  severity: "info" | "warning" | "urgent" | "critical";
  title: string;
  detail: string;
  amount: number | null;
  entityUrl: string | null;
  dueOn: string | null;
  recommendedAction: string | null;
};

export async function openAttention(): Promise<AttentionRow[]> {
  const rows = await query<{
    id: string; kind: string; severity: AttentionRow["severity"];
    title: string; detail: string; amount: string | null;
    entity_url: string | null; due_on: string | null; recommended_action: string | null;
  }>(
    `SELECT id, kind, severity, title, detail, amount, entity_url, due_on::text, recommended_action
     FROM attention_item WHERE resolved_at IS NULL
     ORDER BY CASE severity
       WHEN 'critical' THEN 0 WHEN 'urgent' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,
       due_on NULLS LAST, created_at`,
  );
  return rows.map((r) => ({
    id: Number(r.id),
    kind: r.kind,
    severity: r.severity,
    title: r.title,
    detail: r.detail,
    amount: r.amount === null ? null : Number(r.amount),
    entityUrl: r.entity_url,
    dueOn: r.due_on,
    recommendedAction: r.recommended_action,
  }));
}

// ---------------------------------------------------------------------------
// Vendors (S81-S89)
// ---------------------------------------------------------------------------

export type VendorRow = {
  id: number;
  displayName: string;
  vendorType: string;
  complianceStatus: string;
  paymentHold: boolean;
  paymentHoldReason: string | null;
  openBalance: number;
  docs: { docType: string; status: string; expiresOn: string | null }[];
};

export async function vendorBoard(): Promise<VendorRow[]> {
  const vendors = await query<{
    id: string; display_name: string; vendor_type: string;
    compliance_status: string; payment_hold: boolean; payment_hold_reason: string | null;
    balance: string | null;
  }>(
    `SELECT p.id, p.display_name, p.vendor_type, p.compliance_status,
            p.payment_hold, p.payment_hold_reason, v.balance
     FROM vendor_profile p
     LEFT JOIN qbo_vendor v ON v.qbo_id = p.qbo_vendor_id
     WHERE p.active
     ORDER BY p.display_name`,
  );
  const docs = await query<{
    vendor_id: string; doc_type: string; status: string; expires_on: string | null;
  }>(
    `SELECT vendor_id, doc_type, status, expires_on::text
     FROM vendor_document ORDER BY doc_type`,
  );
  const byVendor = new Map<string, VendorRow["docs"]>();
  for (const d of docs) {
    const list = byVendor.get(d.vendor_id) ?? [];
    list.push({ docType: d.doc_type, status: d.status, expiresOn: d.expires_on });
    byVendor.set(d.vendor_id, list);
  }
  return vendors.map((v) => ({
    id: Number(v.id),
    displayName: v.display_name,
    vendorType: v.vendor_type,
    complianceStatus: v.compliance_status,
    paymentHold: v.payment_hold,
    paymentHoldReason: v.payment_hold_reason,
    openBalance: Number(v.balance ?? 0),
    docs: byVendor.get(v.id) ?? [],
  }));
}

// ---------------------------------------------------------------------------
// Projects (S150)
// ---------------------------------------------------------------------------

export type ProjectRow = {
  id: number;
  p5Id: string;
  name: string;
  division: string;
  projectType: string;
  status: string;
  contractAmount: number;
  approvedCos: number;
  currentBudget: number;
  etcAmount: number;
  etcUpdatedAt: string | null;
  targetGpPct: number;
  qboCustomerId: string | null;
};

export async function projectBoard(): Promise<ProjectRow[]> {
  const rows = await query<{
    id: string; p5_id: string; name: string; division: string; project_type: string;
    status: string; contract_amount: string; approved_change_orders: string;
    current_budget: string; etc_amount: string; etc_updated_at: Date | null;
    target_gp_pct: string; qbo_customer_id: string | null;
  }>(
    `SELECT id, p5_id, name, division, project_type, status, contract_amount,
            approved_change_orders, current_budget, etc_amount, etc_updated_at,
            target_gp_pct, qbo_customer_id
     FROM p5_project
     ORDER BY (status = 'Active') DESC, p5_id`,
  );
  return rows.map((r) => ({
    id: Number(r.id),
    p5Id: r.p5_id,
    name: r.name,
    division: r.division,
    projectType: r.project_type,
    status: r.status,
    contractAmount: Number(r.contract_amount),
    approvedCos: Number(r.approved_change_orders),
    currentBudget: Number(r.current_budget),
    etcAmount: Number(r.etc_amount),
    etcUpdatedAt: r.etc_updated_at ? new Date(r.etc_updated_at).toISOString() : null,
    targetGpPct: Number(r.target_gp_pct),
    qboCustomerId: r.qbo_customer_id,
  }));
}

// ---------------------------------------------------------------------------
// Registries (S127, S130, S135)
// ---------------------------------------------------------------------------

export async function registryBoard() {
  const subscriptions = await query<{
    id: string; vendor_name: string; product: string; amount: string;
    cadence: string; next_renewal: string | null; auto_renew: boolean;
  }>(
    `SELECT id, vendor_name, product, amount, cadence, next_renewal::text, auto_renew
     FROM subscription_registry WHERE active ORDER BY next_renewal NULLS LAST`,
  );
  const insurance = await query<{
    id: string; policy_type: string; carrier: string; expires_on: string; premium: string | null;
  }>(
    `SELECT id, policy_type, carrier, expires_on::text, premium
     FROM insurance_policy WHERE active ORDER BY expires_on`,
  );
  const obligations = await query<{
    id: string; name: string; category: string; due_on: string; recurrence: string;
  }>(
    `SELECT id, name, category, due_on::text, recurrence
     FROM corporate_obligation WHERE completed_at IS NULL ORDER BY due_on`,
  );
  return { subscriptions, insurance, obligations };
}

// ---------------------------------------------------------------------------
// Owners (S193)
// ---------------------------------------------------------------------------

export async function ownerBoard() {
  const owners = await query<{
    id: string; label: string; ownership_pct: string; distribution_pct: string;
    weekly_compensation: string;
  }>(
    `SELECT id, label, ownership_pct, distribution_pct, weekly_compensation
     FROM owner_record WHERE effective_to IS NULL ORDER BY id`,
  );
  const reimbursements = await query<{
    id: string; owner_label: string; vendor_name: string; amount: string;
    status: string; spent_on: string;
  }>(
    `SELECT r.id, o.label AS owner_label, r.vendor_name, r.amount, r.status, r.spent_on::text
     FROM owner_reimbursement r JOIN owner_record o ON o.id = r.owner_id
     WHERE r.status NOT IN ('paid','rejected')
     ORDER BY r.created_at DESC`,
  );
  return { owners, reimbursements };
}

// ---------------------------------------------------------------------------
// Health (S176)
// ---------------------------------------------------------------------------

export async function healthBoard() {
  const integrations = await query<{
    name: string; state: string; last_success_at: Date | null;
    last_attempt_at: Date | null; last_error: string | null; records_processed: number;
  }>(`SELECT * FROM integration_health ORDER BY name`);
  const syncRuns = await query<{
    id: string; started_at: Date; finished_at: Date | null; status: string;
    trigger: string; error: string | null;
  }>(
    `SELECT id, started_at, finished_at, status, trigger, error
     FROM qbo_sync_run ORDER BY started_at DESC LIMIT 10`,
  );
  const connection = await queryOne<{ realm_id: string; refresh_expires_at: Date }>(
    `SELECT realm_id, refresh_expires_at FROM qbo_connection WHERE id = 1`,
  );
  return { integrations, syncRuns, connection };
}
