/**
 * QBO -> read model sync (S155).
 *
 * Pull-only. Every write is an idempotent upsert keyed by QBO id, so a retry
 * can never duplicate a record. Each run writes a qbo_sync_run row and updates
 * integration_health('quickbooks') so failures are visible, never silent
 * (S176). Full pull per entity: this tenant's volumes are small; incremental
 * cursors can arrive later without changing callers.
 */

import { query, queryOne } from "../../db.ts";
import { qboQueryAll } from "./client.ts";

type QboRef = { value: string; name?: string };
type QboRow = Record<string, unknown> & {
  Id: string;
  MetaData?: { LastUpdatedTime?: string };
};

const TXN_ENTITIES = [
  "Invoice",
  "Payment",
  "Bill",
  "BillPayment",
  "PurchaseOrder",
  "Estimate",
  "CreditMemo",
  "VendorCredit",
  "Purchase",
  "Deposit",
  "JournalEntry",
  "Transfer",
] as const;

function str(v: unknown): string | null {
  return typeof v === "string" && v.length ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}
function bool(v: unknown): boolean {
  return v === true;
}
function ref(v: unknown): string | null {
  return v && typeof v === "object" ? str((v as QboRef).value) : null;
}

async function syncAccounts(): Promise<number> {
  const rows = await qboQueryAll<QboRow>("Account");
  for (const r of rows) {
    await query(
      `INSERT INTO qbo_account (qbo_id, name, acct_num, account_type, sub_type, classification, current_balance, active, raw, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb, now())
       ON CONFLICT (qbo_id) DO UPDATE SET
         name=EXCLUDED.name, acct_num=EXCLUDED.acct_num, account_type=EXCLUDED.account_type,
         sub_type=EXCLUDED.sub_type, classification=EXCLUDED.classification,
         current_balance=EXCLUDED.current_balance, active=EXCLUDED.active,
         raw=EXCLUDED.raw, synced_at=now()`,
      [
        r.Id,
        str(r.Name) ?? "",
        str(r.AcctNum),
        str(r.AccountType) ?? "",
        str(r.AccountSubType),
        str(r.Classification),
        num(r.CurrentBalance),
        r.Active !== false,
        JSON.stringify(r),
      ],
    );
  }
  return rows.length;
}

async function syncClasses(): Promise<number> {
  const rows = await qboQueryAll<QboRow>("Class");
  for (const r of rows) {
    await query(
      `INSERT INTO qbo_class (qbo_id, name, active, raw, synced_at)
       VALUES ($1,$2,$3,$4::jsonb, now())
       ON CONFLICT (qbo_id) DO UPDATE SET
         name=EXCLUDED.name, active=EXCLUDED.active, raw=EXCLUDED.raw, synced_at=now()`,
      [r.Id, str(r.Name) ?? "", r.Active !== false, JSON.stringify(r)],
    );
  }
  return rows.length;
}

async function syncCustomers(): Promise<number> {
  const rows = await qboQueryAll<QboRow>("Customer");
  for (const r of rows) {
    await query(
      `INSERT INTO qbo_customer (qbo_id, display_name, parent_qbo_id, is_project, active, balance, raw, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb, now())
       ON CONFLICT (qbo_id) DO UPDATE SET
         display_name=EXCLUDED.display_name, parent_qbo_id=EXCLUDED.parent_qbo_id,
         is_project=EXCLUDED.is_project, active=EXCLUDED.active,
         balance=EXCLUDED.balance, raw=EXCLUDED.raw, synced_at=now()`,
      [
        r.Id,
        str(r.DisplayName) ?? "",
        ref(r.ParentRef),
        bool(r.IsProject),
        r.Active !== false,
        num(r.Balance),
        JSON.stringify(r),
      ],
    );
  }
  return rows.length;
}

async function syncVendors(): Promise<number> {
  const rows = await qboQueryAll<QboRow>("Vendor");
  for (const r of rows) {
    await query(
      `INSERT INTO qbo_vendor (qbo_id, display_name, active, balance, vendor_1099, raw, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb, now())
       ON CONFLICT (qbo_id) DO UPDATE SET
         display_name=EXCLUDED.display_name, active=EXCLUDED.active,
         balance=EXCLUDED.balance, vendor_1099=EXCLUDED.vendor_1099,
         raw=EXCLUDED.raw, synced_at=now()`,
      [
        r.Id,
        str(r.DisplayName) ?? "",
        r.Active !== false,
        num(r.Balance),
        typeof r.Vendor1099 === "boolean" ? r.Vendor1099 : null,
        JSON.stringify(r),
      ],
    );
    // Mirror into the operational vendor profile so compliance can attach
    // without waiting for manual setup (upsert keeps existing operational data).
    await query(
      `INSERT INTO vendor_profile (qbo_vendor_id, display_name)
       VALUES ($1, $2)
       ON CONFLICT (qbo_vendor_id) DO UPDATE SET
         display_name = EXCLUDED.display_name, updated_at = now()`,
      [r.Id, str(r.DisplayName) ?? ""],
    );
  }
  return rows.length;
}

async function syncTxnEntity(entity: (typeof TXN_ENTITIES)[number]): Promise<number> {
  const rows = await qboQueryAll<QboRow>(entity);
  for (const r of rows) {
    await query(
      `INSERT INTO qbo_txn (qbo_id, txn_type, txn_date, due_date, total, balance,
                            customer_qbo_id, vendor_qbo_id, doc_number, po_status, raw, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb, now())
       ON CONFLICT (txn_type, qbo_id) DO UPDATE SET
         txn_date=EXCLUDED.txn_date, due_date=EXCLUDED.due_date, total=EXCLUDED.total,
         balance=EXCLUDED.balance, customer_qbo_id=EXCLUDED.customer_qbo_id,
         vendor_qbo_id=EXCLUDED.vendor_qbo_id, doc_number=EXCLUDED.doc_number,
         po_status=EXCLUDED.po_status, raw=EXCLUDED.raw, synced_at=now()`,
      [
        r.Id,
        entity,
        str(r.TxnDate),
        str(r.DueDate),
        num(r.TotalAmt),
        num(r.Balance),
        ref(r.CustomerRef),
        ref(r.VendorRef) ?? ref(r.EntityRef),
        str(r.DocNumber),
        entity === "PurchaseOrder" ? (str(r.POStatus) ?? "Open") : null,
        JSON.stringify(r),
      ],
    );
  }
  return rows.length;
}

export type SyncSummary = {
  status: "succeeded" | "failed";
  counts: Record<string, number>;
  error?: string;
};

export async function runQboSync(
  trigger: "manual" | "daily" | "webhook" = "manual",
): Promise<SyncSummary> {
  const run = await queryOne<{ id: string }>(
    `INSERT INTO qbo_sync_run (trigger) VALUES ($1) RETURNING id`,
    [trigger],
  );
  const counts: Record<string, number> = {};
  try {
    counts.Account = await syncAccounts();
    counts.Class = await syncClasses();
    counts.Customer = await syncCustomers();
    counts.Vendor = await syncVendors();
    for (const entity of TXN_ENTITIES) {
      counts[entity] = await syncTxnEntity(entity);
    }

    const processed = Object.values(counts).reduce((a, b) => a + b, 0);
    await query(
      `UPDATE qbo_sync_run SET status='succeeded', finished_at=now(), entities=$2::jsonb WHERE id=$1`,
      [run?.id, JSON.stringify(counts)],
    );
    await query(
      `INSERT INTO integration_health (name, state, last_success_at, last_attempt_at, records_processed)
       VALUES ('quickbooks','connected', now(), now(), $1)
       ON CONFLICT (name) DO UPDATE SET
         state='connected', last_success_at=now(), last_attempt_at=now(),
         last_error=NULL, records_processed=$1, updated_at=now()`,
      [processed],
    );
    return { status: "succeeded", counts };
  } catch (error) {
    const message = (error as Error).message;
    await query(
      `UPDATE qbo_sync_run SET status='failed', finished_at=now(), entities=$2::jsonb, error=$3 WHERE id=$1`,
      [run?.id, JSON.stringify(counts), message],
    );
    await query(
      `INSERT INTO integration_health (name, state, last_attempt_at, last_error)
       VALUES ('quickbooks','degraded', now(), $1)
       ON CONFLICT (name) DO UPDATE SET
         state='degraded', last_attempt_at=now(), last_error=$1, updated_at=now()`,
      [message],
    );
    return { status: "failed", counts, error: message };
  }
}
