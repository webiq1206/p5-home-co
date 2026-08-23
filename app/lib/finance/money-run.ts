/**
 * Weekly Money Run (S139-S143): assemble the owner's primary cash screen.
 *
 * Composition, per the spec: cash by bucket; inflows classified with
 * uncertain AR never treated as cash; required vs optional vs on-hold
 * payments; protected cash; Safe Cash; and the headline "P5 recommends
 * paying $X". Persisted per (kind, date) so a re-run replaces rather than
 * duplicates, and history stays for trend reporting (S195).
 */

import { query } from "../db.ts";
import { safeCash, taxReserveRequirement, type SafeCash } from "./engines.ts";
import { cashPosition, classifyInflows, openBills, openInvoices, ytdNetIncomeApprox, type CashPosition, type OpenTxn } from "./reporting.ts";
import type { FinanceSettings } from "./settings.ts";

export type MoneyRun = {
  coversDate: string;
  cash: CashPosition;
  inflows: { highConfidence: number; uncertain: number; overdue: number };
  required: { bills: OpenTxn[]; total: number };
  onHold: { bills: OpenTxn[]; total: number };
  protectedCash: {
    taxReserveRequirement: number;
    minimumOperatingReserve: number;
    otherProtectedReserves: number;
  };
  safeCash: SafeCash;
  headline: string;
};

export async function buildMoneyRun(
  settings: FinanceSettings,
  today: Date = new Date(),
): Promise<MoneyRun> {
  const cash = await cashPosition();
  const invoices = await openInvoices();
  const inflows = classifyInflows(invoices, today, settings);

  // Required payments: open bills due within the pay horizon (next 7 days).
  // A vendor on payment hold moves its bills to On Hold, never Required
  // (S105: a payment cannot reach Ready to Pay while the gate fails).
  const bills = await openBills();
  const holds = await query<{ display_name: string }>(
    `SELECT v.display_name
     FROM vendor_profile p JOIN qbo_vendor v ON v.qbo_id = p.qbo_vendor_id
     WHERE p.payment_hold OR p.compliance_status IN ('Payment Hold','Onboarding Required')`,
  );
  const heldNames = new Set(holds.map((h) => h.display_name));
  const horizon = today.getTime() + 7 * 86_400_000;

  const requiredBills: OpenTxn[] = [];
  const heldBills: OpenTxn[] = [];
  for (const bill of bills) {
    const due = bill.dueDate ? new Date(bill.dueDate).getTime() : horizon;
    if (bill.counterparty && heldNames.has(bill.counterparty)) heldBills.push(bill);
    else if (due <= horizon) requiredBills.push(bill);
  }
  const requiredTotal = requiredBills.reduce((s, b) => s + b.openBalance, 0);
  const heldTotal = heldBills.reduce((s, b) => s + b.openBalance, 0);

  // Tax reserve requirement from the (possibly provisional) CPA rate (S125).
  const ytd = await ytdNetIncomeApprox(today.getFullYear());
  const taxRequired = Math.max(
    0,
    taxReserveRequirement(ytd, settings) - cash.taxReserve,
  );

  const sc = safeCash(
    {
      unrestrictedClearedOperatingCash: cash.operating,
      highConfidenceInflows: inflows.highConfidence,
      requiredOutflowsNotReflected: requiredTotal,
      taxReserveRequirement: taxRequired,
      minimumOperatingReserve: settings.reserves.minimumOperatingReserve,
      approvedUnfundedProjectExposure: 0,
      otherProtectedReserves: settings.reserves.otherProtectedReserves,
    },
    {
      provisional:
        !settings.reserves.minimumOperatingReserveConfirmed ||
        !settings.taxReserve.rateConfirmedByCpa,
    },
  );

  return {
    coversDate: today.toISOString().slice(0, 10),
    cash,
    inflows,
    required: { bills: requiredBills, total: requiredTotal },
    onHold: { bills: heldBills, total: heldTotal },
    protectedCash: {
      taxReserveRequirement: taxRequired,
      minimumOperatingReserve: settings.reserves.minimumOperatingReserve,
      otherProtectedReserves: settings.reserves.otherProtectedReserves,
    },
    safeCash: sc,
    headline: `P5 recommends paying $${requiredTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })} this run.`,
  };
}

export async function persistMoneyRun(
  run: MoneyRun,
  kind: "preliminary" | "final" | "adhoc",
  userId: number | null,
): Promise<void> {
  await query(
    `INSERT INTO money_run (run_kind, covers_date, payload, safe_cash, required_total, created_by)
     VALUES ($1,$2,$3::jsonb,$4,$5,$6)
     ON CONFLICT (run_kind, covers_date) DO UPDATE SET
       payload=EXCLUDED.payload, safe_cash=EXCLUDED.safe_cash,
       required_total=EXCLUDED.required_total, created_by=EXCLUDED.created_by`,
    [
      kind,
      run.coversDate,
      JSON.stringify(run),
      run.safeCash.safeCashAvailable,
      run.required.total,
      userId,
    ],
  );
}
