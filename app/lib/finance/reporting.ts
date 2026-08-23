/**
 * Read-model queries that turn the QBO cache into engine inputs.
 *
 * Everything here is derived from synced QBO data - the source of truth -
 * plus P5 operational tables. Every dashboard figure these queries feed can
 * name its source and drill down to QBO records (S157).
 */

import { query, queryOne } from "../db.ts";
import type { FinanceSettings } from "./settings.ts";

// ---------------------------------------------------------------------------
// Cash (S139)
// ---------------------------------------------------------------------------

export type CashPosition = {
  operating: number;      // bank accounts other than the reserve accounts
  taxReserve: number;     // account 1030
  operatingReserve: number; // account 1040
  undeposited: number;    // processor/undeposited funds
  asOf: Date | null;
};

export async function cashPosition(): Promise<CashPosition> {
  const rows = await query<{
    acct_num: string | null;
    name: string;
    sub_type: string | null;
    account_type: string;
    current_balance: string | null;
    synced_at: Date;
  }>(
    `SELECT acct_num, name, sub_type, account_type, current_balance, synced_at
     FROM qbo_account
     WHERE active AND (account_type = 'Bank' OR sub_type = 'UndepositedFunds')`,
  );
  const pos: CashPosition = {
    operating: 0,
    taxReserve: 0,
    operatingReserve: 0,
    undeposited: 0,
    asOf: null,
  };
  for (const r of rows) {
    const bal = Number(r.current_balance ?? 0);
    if (r.sub_type === "UndepositedFunds") pos.undeposited += bal;
    else if (r.acct_num === "1030") pos.taxReserve += bal;
    else if (r.acct_num === "1040") pos.operatingReserve += bal;
    else pos.operating += bal;
    if (!pos.asOf || r.synced_at > pos.asOf) pos.asOf = r.synced_at;
  }
  return pos;
}

// ---------------------------------------------------------------------------
// AR / AP (S139-S141)
// ---------------------------------------------------------------------------

export type OpenTxn = {
  qboId: string;
  docNumber: string | null;
  counterparty: string | null;
  txnDate: string | null;
  dueDate: string | null;
  total: number;
  openBalance: number;
};

export async function openInvoices(): Promise<OpenTxn[]> {
  const rows = await query<{
    qbo_id: string;
    doc_number: string | null;
    display_name: string | null;
    txn_date: string | null;
    due_date: string | null;
    total: string | null;
    balance: string | null;
  }>(
    `SELECT t.qbo_id, t.doc_number, c.display_name, t.txn_date::text, t.due_date::text, t.total, t.balance
     FROM qbo_txn t LEFT JOIN qbo_customer c ON c.qbo_id = t.customer_qbo_id
     WHERE t.txn_type = 'Invoice' AND COALESCE(t.balance, 0) > 0
     ORDER BY t.due_date NULLS LAST`,
  );
  return rows.map((r) => ({
    qboId: r.qbo_id,
    docNumber: r.doc_number,
    counterparty: r.display_name,
    txnDate: r.txn_date,
    dueDate: r.due_date,
    total: Number(r.total ?? 0),
    openBalance: Number(r.balance ?? 0),
  }));
}

export async function openBills(): Promise<OpenTxn[]> {
  const rows = await query<{
    qbo_id: string;
    doc_number: string | null;
    display_name: string | null;
    txn_date: string | null;
    due_date: string | null;
    total: string | null;
    balance: string | null;
  }>(
    `SELECT t.qbo_id, t.doc_number, v.display_name, t.txn_date::text, t.due_date::text, t.total, t.balance
     FROM qbo_txn t LEFT JOIN qbo_vendor v ON v.qbo_id = t.vendor_qbo_id
     WHERE t.txn_type = 'Bill' AND COALESCE(t.balance, 0) > 0
     ORDER BY t.due_date NULLS LAST`,
  );
  return rows.map((r) => ({
    qboId: r.qbo_id,
    docNumber: r.doc_number,
    counterparty: r.display_name,
    txnDate: r.txn_date,
    dueDate: r.due_date,
    total: Number(r.total ?? 0),
    openBalance: Number(r.balance ?? 0),
  }));
}

/**
 * Split expected AR into high-confidence vs uncertain per S139/S140: only
 * invoices due within the configured window (or already due) count as
 * high-confidence inflows; everything else is never treated as cash.
 */
export function classifyInflows(
  invoices: OpenTxn[],
  today: Date,
  settings: FinanceSettings,
): { highConfidence: number; uncertain: number; overdue: number } {
  let highConfidence = 0;
  let uncertain = 0;
  let overdue = 0;
  const horizon = today.getTime() + settings.highConfidenceArDays * 86_400_000;
  for (const inv of invoices) {
    const due = inv.dueDate ? new Date(inv.dueDate).getTime() : null;
    if (due !== null && due < today.getTime()) {
      overdue += inv.openBalance;    // overdue is chased, not counted as cash
      uncertain += inv.openBalance;
    } else if (due !== null && due <= horizon) {
      highConfidence += inv.openBalance;
    } else {
      uncertain += inv.openBalance;
    }
  }
  return { highConfidence, uncertain, overdue };
}

// ---------------------------------------------------------------------------
// Project rollups (S47, S150)
// ---------------------------------------------------------------------------

export type ProjectRollup = {
  qboCustomerId: string;
  invoiced: number;
  collected: number;       // invoiced minus open balance
  arOpen: number;
  billed: number;          // vendor bills (actual cost, cash basis of record)
  billsOpen: number;
  openCommitments: number; // open PO balances (S47)
  estimateTotal: number;
};

export async function projectRollup(qboCustomerId: string): Promise<ProjectRollup> {
  const row = await queryOne<{
    invoiced: string;
    ar_open: string;
    billed: string;
    bills_open: string;
    open_pos: string;
    estimates: string;
  }>(
    `SELECT
       COALESCE(SUM(total)    FILTER (WHERE txn_type='Invoice'), 0) AS invoiced,
       COALESCE(SUM(balance)  FILTER (WHERE txn_type='Invoice'), 0) AS ar_open,
       COALESCE(SUM(total)    FILTER (WHERE txn_type='Bill'), 0)    AS billed,
       COALESCE(SUM(balance)  FILTER (WHERE txn_type='Bill'), 0)    AS bills_open,
       COALESCE(SUM(total)    FILTER (WHERE txn_type='PurchaseOrder' AND po_status='Open'), 0) AS open_pos,
       COALESCE(SUM(total)    FILTER (WHERE txn_type='Estimate'), 0) AS estimates
     FROM qbo_txn WHERE customer_qbo_id = $1`,
    [qboCustomerId],
  );
  const invoiced = Number(row?.invoiced ?? 0);
  const arOpen = Number(row?.ar_open ?? 0);
  return {
    qboCustomerId,
    invoiced,
    arOpen,
    collected: invoiced - arOpen,
    billed: Number(row?.billed ?? 0),
    billsOpen: Number(row?.bills_open ?? 0),
    openCommitments: Number(row?.open_pos ?? 0),
    estimateTotal: Number(row?.estimates ?? 0),
  };
}

// ---------------------------------------------------------------------------
// P&L basics for tax reserve (S125): YTD income and direct/expense totals
// from account balances is not reliable; use transaction sums instead.
// Cash-basis approximation: collected revenue minus paid bills/purchases.
// The CPA-confirmed methodology can replace this without touching callers.
// ---------------------------------------------------------------------------

export async function ytdNetIncomeApprox(year: number): Promise<number> {
  const row = await queryOne<{ collected: string; paid: string }>(
    `SELECT
       COALESCE(SUM(total) FILTER (WHERE txn_type='Payment'), 0)     AS collected,
       COALESCE(SUM(total) FILTER (WHERE txn_type='BillPayment' OR txn_type='Purchase'), 0) AS paid
     FROM qbo_txn
     WHERE txn_date >= make_date($1, 1, 1) AND txn_date <= make_date($1, 12, 31)`,
    [year],
  );
  return Number(row?.collected ?? 0) - Number(row?.paid ?? 0);
}
