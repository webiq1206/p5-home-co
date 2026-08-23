/**
 * Running the QuickBooks data-quality inspection (S214).
 *
 * Three jobs, in order:
 *
 *   1. Gather. Build an AuditSnapshot from the read model - the mirror of
 *      QuickBooks that the sync maintains - plus P5's own records.
 *   2. Judge. Hand it to the pure engine in audit.ts. No decisions are made
 *      here; this file only fetches and files.
 *   3. File. Push findings into attention_item, which already dedupes by
 *      (kind, subject_key), auto-resolves conditions that stop, and drives both
 *      the Today page and the daily email. Nothing here maintains a second
 *      parallel list of problems.
 *
 * A finding therefore has exactly one life cycle: it appears the morning the
 * condition starts, updates while it persists, and closes itself the morning
 * somebody fixes it. Nobody has to remember to clear anything.
 */

import { query, queryOne } from "../../db.ts";
import type { FinanceSettings } from "../settings.ts";
import {
  auditQbo,
  findingKey,
  summariseFindings,
  type AuditFinding,
  type AuditSnapshot,
  type CustomerRecord,
  type ProjectRecord,
  type SubcontractRecord,
  type TxnRecord,
  type VendorRecord,
} from "./audit.ts";
import { allRules } from "./audit-rules.ts";

/** A sync older than this makes every number on the screen suspect. */
const STALE_SYNC_HOURS = 30;

/** Bills at or above this are expected to have had a price agreed first. */
const COMMITMENT_THRESHOLD = 2_500;

/** Accounts that mean "nobody has decided what this is yet". */
const CATCH_ALL_ACCOUNTS = [
  "uncategorized expense",
  "uncategorized income",
  "uncategorized asset",
  "ask my accountant",
  "miscellaneous",
];

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

// ---------------------------------------------------------------------------
// Gathering
// ---------------------------------------------------------------------------

async function loadCustomers(): Promise<CustomerRecord[]> {
  // Email and address live inside the raw payload rather than in dedicated
  // columns, because the read model stores what QuickBooks returned verbatim
  // and promotes only the fields the sync itself needs to index.
  const rows = await query<{
    qbo_id: string;
    display_name: string;
    parent_qbo_id: string | null;
    is_project: boolean;
    active: boolean;
    balance: string | null;
    email: string | null;
    bill_with_parent: boolean | null;
    billing_address: string | null;
  }>(
    `SELECT qbo_id, display_name, parent_qbo_id, is_project, active, balance,
            raw #>> '{PrimaryEmailAddr,Address}'          AS email,
            (raw ->> 'BillWithParent')::boolean           AS bill_with_parent,
            raw #>> '{BillAddr,Line1}'                    AS billing_address
     FROM qbo_customer`,
  );
  return rows.map((r) => ({
    qboId: r.qbo_id,
    displayName: r.display_name,
    parentQboId: r.parent_qbo_id,
    isProject: r.is_project,
    billWithParent: r.bill_with_parent === true,
    active: r.active,
    balance: num(r.balance),
    email: r.email,
    billingAddress: r.billing_address,
  }));
}

async function loadVendors(): Promise<VendorRecord[]> {
  // Payments this year drive the 1099 threshold, so they are summed from the
  // transactions rather than trusted from a cached total that can drift.
  const rows = await query<{
    qbo_id: string;
    display_name: string;
    active: boolean;
    balance: string | null;
    vendor_1099: boolean | null;
    email: string | null;
    tracked_in_p5: boolean;
    payment_hold: boolean | null;
    w9_on_file: boolean;
    w9_tax_classification: string | null;
    paid_this_year: string | null;
  }>(
    `SELECT v.qbo_id, v.display_name, v.active, v.balance, v.vendor_1099,
            v.raw #>> '{PrimaryEmailAddr,Address}' AS email,
            (p.id IS NOT NULL)                     AS tracked_in_p5,
            p.payment_hold,
            p.w9_tax_classification,
            COALESCE(d.status IN ('received','verified'), FALSE) AS w9_on_file,
            COALESCE((
              SELECT SUM(t.total) FROM qbo_txn t
              WHERE t.vendor_qbo_id = v.qbo_id
                AND t.txn_type IN ('BillPayment','Purchase')
                AND t.txn_date >= date_trunc('year', CURRENT_DATE)
            ), 0) AS paid_this_year
     FROM qbo_vendor v
     LEFT JOIN vendor_profile p ON p.qbo_vendor_id = v.qbo_id
     LEFT JOIN vendor_document d ON d.vendor_id = p.id AND d.doc_type = 'W-9'`,
  );
  return rows.map((r) => ({
    qboId: r.qbo_id,
    displayName: r.display_name,
    active: r.active,
    balance: num(r.balance),
    vendor1099: r.vendor_1099,
    email: r.email,
    w9OnFile: r.w9_on_file,
    taxClassification: r.w9_tax_classification,
    paidThisYear: num(r.paid_this_year),
    trackedInP5: r.tracked_in_p5,
    paymentHold: r.payment_hold === true,
  }));
}

/**
 * Transactions of one type, with the line-level facts the rules need.
 *
 * QuickBooks puts billable status and the expense account on each line, so
 * these are computed in SQL rather than pulled into memory - a company file
 * with years of history should not have to be loaded to be checked.
 */
async function loadTxns(txnType: string): Promise<TxnRecord[]> {
  const catchAll = CATCH_ALL_ACCOUNTS.map((a) => `%${a}%`);
  const rows = await query<{
    qbo_id: string;
    doc_number: string | null;
    txn_date: string | null;
    due_date: string | null;
    total: string | null;
    balance: string | null;
    customer_qbo_id: string | null;
    vendor_qbo_id: string | null;
    po_status: string | null;
    vendor_doc_number: string | null;
    has_billable_line: boolean;
    has_uncategorized_line: boolean;
    has_commitment: boolean;
  }>(
    `SELECT t.qbo_id, t.doc_number, t.txn_date::text, t.due_date::text,
            t.total, t.balance, t.customer_qbo_id, t.vendor_qbo_id, t.po_status,
            t.raw ->> 'DocNumber' AS vendor_doc_number,

            -- Any line flagged to be re-billed to a customer. On a fixed-price
            -- job this is a double charge waiting to happen.
            COALESCE(EXISTS (
              SELECT 1 FROM jsonb_array_elements(COALESCE(t.raw -> 'Line', '[]'::jsonb)) l
              WHERE l #>> '{AccountBasedExpenseLineDetail,BillableStatus}' = 'Billable'
                 OR l #>> '{ItemBasedExpenseLineDetail,BillableStatus}'   = 'Billable'
            ), FALSE) AS has_billable_line,

            -- Any line parked in a catch-all account.
            COALESCE(EXISTS (
              SELECT 1 FROM jsonb_array_elements(COALESCE(t.raw -> 'Line', '[]'::jsonb)) l
              WHERE lower(COALESCE(
                      l #>> '{AccountBasedExpenseLineDetail,AccountRef,name}',
                      l #>> '{ItemBasedExpenseLineDetail,ItemRef,name}', '')) LIKE ANY($2::text[])
            ), FALSE) AS has_uncategorized_line,

            -- Linked back to a purchase order, which is what makes the spend
            -- something we agreed to in advance rather than discovered.
            COALESCE(EXISTS (
              SELECT 1 FROM jsonb_array_elements(COALESCE(t.raw -> 'LinkedTxn', '[]'::jsonb)) k
              WHERE k ->> 'TxnType' = 'PurchaseOrder'
            ), FALSE) AS has_commitment
     FROM qbo_txn t
     WHERE t.txn_type = $1`,
    [txnType, catchAll],
  );

  return rows.map((r) => ({
    qboId: r.qbo_id,
    docNumber: r.doc_number,
    txnDate: r.txn_date,
    dueDate: r.due_date,
    total: num(r.total),
    balance: num(r.balance),
    customerQboId: r.customer_qbo_id,
    vendorQboId: r.vendor_qbo_id,
    poStatus: r.po_status,
    vendorDocNumber: r.vendor_doc_number,
    hasBillableLine: r.has_billable_line,
    hasUncategorizedLine: r.has_uncategorized_line,
    hasCommitment: r.has_commitment,
  }));
}

async function loadProjects(): Promise<ProjectRecord[]> {
  const rows = await query<{
    id: string;
    p5_id: string;
    name: string;
    status: string;
    qbo_customer_id: string | null;
    contract_amount: string;
    approved_change_orders: string;
  }>(
    `SELECT id::text, p5_id, name, status, qbo_customer_id,
            contract_amount, approved_change_orders
     FROM p5_project
     WHERE status <> 'Cancelled'`,
  );
  return rows.map((r) => ({
    id: r.id,
    p5Id: r.p5_id,
    name: r.name,
    status: r.status,
    qboCustomerId: r.qbo_customer_id,
    contractAmount: num(r.contract_amount),
    approvedChangeOrders: num(r.approved_change_orders),
  }));
}

async function loadSubcontracts(): Promise<SubcontractRecord[]> {
  // Billed-to-date comes from the bills that link back to this subcontract's
  // purchase order - the same trail an auditor would follow.
  const rows = await query<{
    id: string;
    reference: string;
    p5_id: string;
    vendor_name: string;
    status: string;
    original_amount: string;
    approved_changes: string;
    qbo_purchase_order_id: string | null;
    executed_on: string | null;
    billed_to_date: string | null;
  }>(
    `SELECT s.id::text, s.reference, pr.p5_id, v.display_name AS vendor_name,
            s.status, s.original_amount, s.approved_changes,
            s.qbo_purchase_order_id, s.executed_on::text,
            COALESCE((
              SELECT SUM(b.total) FROM qbo_txn b
              WHERE b.txn_type = 'Bill'
                AND s.qbo_purchase_order_id IS NOT NULL
                AND EXISTS (
                  SELECT 1 FROM jsonb_array_elements(COALESCE(b.raw -> 'Line', '[]'::jsonb)) l,
                       jsonb_array_elements(COALESCE(l -> 'LinkedTxn', '[]'::jsonb)) k
                  WHERE k ->> 'TxnType' = 'PurchaseOrder'
                    AND k ->> 'TxnId'   = s.qbo_purchase_order_id
                )
            ), 0) AS billed_to_date
     FROM subcontract s
     JOIN p5_project pr    ON pr.id = s.project_id
     JOIN vendor_profile v ON v.id  = s.vendor_id
     WHERE s.status <> 'terminated'`,
  );
  return rows.map((r) => ({
    id: r.id,
    reference: r.reference,
    projectP5Id: r.p5_id,
    vendorName: r.vendor_name,
    status: r.status,
    originalAmount: num(r.original_amount),
    approvedChanges: num(r.approved_changes),
    billedToDate: num(r.billed_to_date),
    qboPurchaseOrderId: r.qbo_purchase_order_id,
    executedOn: r.executed_on,
  }));
}

async function loadSyncAge(): Promise<number | null> {
  const row = await queryOne<{ hours: string | null }>(
    `SELECT EXTRACT(EPOCH FROM (now() - MAX(finished_at))) / 3600 AS hours
     FROM qbo_sync_run WHERE status = 'succeeded'`,
  );
  if (!row || row.hours === null) return null;
  return num(row.hours);
}

async function loadUnresolvedWrites(): Promise<
  { id: string; entity: string; reason: string }[]
> {
  const rows = await query<{ id: string; entity: string; reason: string | null }>(
    `SELECT id::text, entity, last_error AS reason
     FROM qbo_write_intent
     WHERE status = 'needs_review'
     ORDER BY created_at DESC
     LIMIT 50`,
  );
  return rows.map((r) => ({
    id: r.id,
    entity: r.entity,
    reason: r.reason ?? "no reason recorded",
  }));
}

/** Everything the rules need, read once. */
export async function buildSnapshot(settings: FinanceSettings): Promise<AuditSnapshot> {
  const [
    customers,
    vendors,
    invoices,
    bills,
    purchaseOrders,
    projects,
    subcontracts,
    hoursSinceSync,
    unresolvedWrites,
  ] = await Promise.all([
    loadCustomers(),
    loadVendors(),
    loadTxns("Invoice"),
    loadTxns("Bill"),
    loadTxns("PurchaseOrder"),
    loadProjects(),
    loadSubcontracts(),
    loadSyncAge(),
    loadUnresolvedWrites(),
  ]);

  return {
    today: new Date().toISOString().slice(0, 10),
    form1099Threshold: settings.form1099Threshold,
    commitmentThreshold: COMMITMENT_THRESHOLD,
    staleSyncHours: STALE_SYNC_HOURS,
    customers,
    vendors,
    invoices,
    bills,
    purchaseOrders,
    projects,
    subcontracts,
    hoursSinceSync,
    unresolvedWrites,
  };
}

// ---------------------------------------------------------------------------
// Filing
// ---------------------------------------------------------------------------

/**
 * The attention_item text for a finding.
 *
 * The detail carries the specific instance first, then the plain-language
 * explanation of why it matters. Somebody reading this on a phone at 6am has to
 * understand the problem without opening anything else.
 */
function detailText(finding: AuditFinding): string {
  return `${finding.detail}\n\nWhat this means: ${finding.rule.plain}\n\nWhy it matters: ${finding.rule.consequence}`;
}

async function fileFinding(finding: AuditFinding): Promise<void> {
  await query(
    `INSERT INTO attention_item
       (kind, subject_key, severity, title, detail, amount, entity_url, recommended_action)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (kind, subject_key) WHERE resolved_at IS NULL
     DO UPDATE SET severity=EXCLUDED.severity, title=EXCLUDED.title,
       detail=EXCLUDED.detail, amount=EXCLUDED.amount,
       entity_url=EXCLUDED.entity_url,
       recommended_action=EXCLUDED.recommended_action, updated_at=now()`,
    [
      finding.rule.code,
      findingKey(finding),
      finding.rule.severity,
      `${finding.rule.label}: ${finding.entityName}`,
      detailText(finding),
      finding.amount ?? null,
      finding.entityUrl ?? null,
      finding.rule.fix,
    ],
  );
}

/**
 * Close items whose condition has stopped.
 *
 * Scoped to the rule codes this scanner owns, so it can never resolve an item
 * raised by a different scanner that simply happened to run less recently.
 */
async function resolveFixed(liveKeysByCode: Map<string, string[]>): Promise<number> {
  const ownCodes = allRules().map((r) => r.code);
  let resolved = 0;
  for (const code of ownCodes) {
    const live = liveKeysByCode.get(code) ?? [];
    const rows = await query<{ id: string }>(
      `UPDATE attention_item
       SET resolved_at = now(),
           resolution = 'Fixed in QuickBooks - the daily check no longer sees this problem.'
       WHERE kind = $1 AND resolved_at IS NULL AND NOT (subject_key = ANY($2::text[]))
       RETURNING id::text`,
      [code, live],
    );
    resolved += rows.length;
  }
  return resolved;
}

export type AuditRunResult = {
  findings: AuditFinding[];
  counts: ReturnType<typeof summariseFindings>;
  opened: number;
  resolved: number;
};

/**
 * Run the inspection end to end.
 *
 * `opened` counts findings that were not already on the list. That is the
 * number worth alerting on: a steady count of known problems is not news, and
 * treating it as news is how a useful alert becomes one people filter away.
 */
export async function runQboAudit(
  settings: FinanceSettings,
  trigger: "manual" | "daily" = "manual",
): Promise<AuditRunResult> {
  const run = await queryOne<{ id: string }>(
    `INSERT INTO qbo_audit_run (trigger) VALUES ($1) RETURNING id::text`,
    [trigger],
  );

  try {
    const snapshot = await buildSnapshot(settings);
    const findings = auditQbo(snapshot);

    // Which of these are new? Asked before filing, or every one looks new.
    const keys = findings.map((f) => `${f.rule.code}::${findingKey(f)}`);
    const existing = new Set(
      (
        await query<{ k: string }>(
          `SELECT kind || '::' || subject_key AS k FROM attention_item
           WHERE resolved_at IS NULL AND kind = ANY($1::text[])`,
          [allRules().map((r) => r.code)],
        )
      ).map((r) => r.k),
    );
    const opened = keys.filter((k) => !existing.has(k)).length;

    for (const finding of findings) await fileFinding(finding);

    const liveKeysByCode = new Map<string, string[]>();
    for (const finding of findings) {
      const list = liveKeysByCode.get(finding.rule.code) ?? [];
      list.push(findingKey(finding));
      liveKeysByCode.set(finding.rule.code, list);
    }
    const resolved = await resolveFixed(liveKeysByCode);

    const counts = summariseFindings(findings);
    await query(
      `UPDATE qbo_audit_run
       SET finished_at = now(), status = 'succeeded',
           critical_count=$2, urgent_count=$3, warning_count=$4, info_count=$5,
           opened_count=$6, resolved_count=$7
       WHERE id = $1`,
      [
        run?.id,
        counts.critical,
        counts.urgent,
        counts.warning,
        counts.info,
        opened,
        resolved,
      ],
    );

    return { findings, counts, opened, resolved };
  } catch (error) {
    await query(
      `UPDATE qbo_audit_run SET finished_at = now(), status = 'failed', error = $2
       WHERE id = $1`,
      [run?.id, error instanceof Error ? error.message : String(error)],
    );
    throw error;
  }
}

/** The last inspection, for the audit page header and system health. */
export async function lastAuditRun(): Promise<{
  startedAt: string;
  status: string;
  critical: number;
  urgent: number;
  warning: number;
  info: number;
  opened: number;
  resolved: number;
  error: string | null;
} | null> {
  const row = await queryOne<{
    started_at: string;
    status: string;
    critical_count: number;
    urgent_count: number;
    warning_count: number;
    info_count: number;
    opened_count: number;
    resolved_count: number;
    error: string | null;
  }>(
    `SELECT started_at::text, status, critical_count, urgent_count, warning_count,
            info_count, opened_count, resolved_count, error
     FROM qbo_audit_run ORDER BY started_at DESC LIMIT 1`,
  );
  if (!row) return null;
  return {
    startedAt: row.started_at,
    status: row.status,
    critical: row.critical_count,
    urgent: row.urgent_count,
    warning: row.warning_count,
    info: row.info_count,
    opened: row.opened_count,
    resolved: row.resolved_count,
    error: row.error,
  };
}
