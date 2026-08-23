/**
 * Queries for the finance modules that read QuickBooks rather than P5's own
 * registries: Customers & AR, Bills & Payments, Cash Forecast, Tax Center and
 * Client Funding.
 *
 * Kept out of queries.ts only for size. Same rules apply: every figure is
 * derived from the synced read model, and anything the data cannot support is
 * reported as unknown rather than defaulted to a comfortable number.
 */

import { query } from "../../lib/db.ts";
import {
  summariseAging,
  forecastWeeks,
  firstShortfall,
  daysOverdue,
  type AgingSummary,
  type ForecastWeek,
} from "../../lib/finance/aging.ts";
import { projectFunding, roundMoney } from "../../lib/finance/engines.ts";
import {
  cashPosition,
  openBills,
  openInvoices,
  type OpenTxn,
} from "../../lib/finance/reporting.ts";
import { loadFinanceSettings } from "../../lib/finance/settings.ts";

// ---------------------------------------------------------------------------
// Customers & AR
// ---------------------------------------------------------------------------

export type CustomerAr = {
  name: string;
  openBalance: number;
  oldestDays: number;
  invoices: (OpenTxn & { daysOverdue: number })[];
};

export type ArBoard = {
  customers: CustomerAr[];
  aging: AgingSummary;
  asOf: string;
};

export async function arBoard(): Promise<ArBoard> {
  const asOf = new Date();
  const invoices = await openInvoices();

  const byCustomer = new Map<string, CustomerAr>();
  for (const inv of invoices) {
    const name = inv.counterparty ?? "Unassigned";
    const entry = byCustomer.get(name) ?? {
      name,
      openBalance: 0,
      oldestDays: 0,
      invoices: [],
    };
    const days = daysOverdue(inv.dueDate, asOf);
    entry.openBalance = roundMoney(entry.openBalance + inv.openBalance);
    entry.oldestDays = Math.max(entry.oldestDays, days);
    entry.invoices.push({ ...inv, daysOverdue: days });
    byCustomer.set(name, entry);
  }

  return {
    // Worst first: the point of the page is who to chase.
    customers: [...byCustomer.values()].sort((a, b) => b.oldestDays - a.oldestDays),
    aging: summariseAging(invoices, asOf),
    asOf: asOf.toISOString().slice(0, 10),
  };
}

// ---------------------------------------------------------------------------
// Bills & Payments (AP)
// ---------------------------------------------------------------------------

export type VendorAp = {
  name: string;
  openBalance: number;
  oldestDays: number;
  onHold: boolean;
  holdReason: string | null;
  bills: (OpenTxn & { daysOverdue: number })[];
};

export type ApBoard = {
  vendors: VendorAp[];
  aging: AgingSummary;
  heldTotal: number;
  asOf: string;
};

export async function apBoard(): Promise<ApBoard> {
  const asOf = new Date();
  const bills = await openBills();

  // A held vendor's bills are still real AP; they are simply not payable yet.
  // Showing them without the hold would invite someone to pay them.
  const holds = await query<{
    display_name: string;
    payment_hold: boolean;
    compliance_status: string;
    payment_hold_reason: string | null;
  }>(
    `SELECT display_name, payment_hold, compliance_status, payment_hold_reason
       FROM vendor_profile WHERE active`,
  );
  const holdByName = new Map(holds.map((h) => [h.display_name, h]));

  const byVendor = new Map<string, VendorAp>();
  for (const bill of bills) {
    const name = bill.counterparty ?? "Unassigned";
    const hold = holdByName.get(name);
    const onHold = Boolean(hold && (hold.payment_hold || hold.compliance_status === "Payment Hold"));
    const entry = byVendor.get(name) ?? {
      name,
      openBalance: 0,
      oldestDays: 0,
      onHold,
      holdReason: hold?.payment_hold_reason ?? null,
      bills: [],
    };
    const days = daysOverdue(bill.dueDate, asOf);
    entry.openBalance = roundMoney(entry.openBalance + bill.openBalance);
    entry.oldestDays = Math.max(entry.oldestDays, days);
    entry.bills.push({ ...bill, daysOverdue: days });
    byVendor.set(name, entry);
  }

  const vendors = [...byVendor.values()].sort((a, b) => b.oldestDays - a.oldestDays);
  return {
    vendors,
    aging: summariseAging(bills, asOf),
    heldTotal: roundMoney(
      vendors.filter((v) => v.onHold).reduce((sum, v) => sum + v.openBalance, 0),
    ),
    asOf: asOf.toISOString().slice(0, 10),
  };
}

// ---------------------------------------------------------------------------
// Cash forecast
// ---------------------------------------------------------------------------

export type CashForecast = {
  weeks: ForecastWeek[];
  openingCash: number;
  shortfallWeek: string | null;
  /** Movements we could not schedule, so the page can admit the gap. */
  undatedInflows: number;
  undatedOutflows: number;
};

export async function cashForecast(weeks = 8): Promise<CashForecast> {
  const asOf = new Date();
  const [cash, invoices, bills] = await Promise.all([
    cashPosition(),
    openInvoices(),
    openBills(),
  ]);

  const inflows = invoices.map((i) => ({
    date: i.dueDate,
    amount: i.openBalance,
    label: `Invoice ${i.docNumber ?? i.qboId}`,
  }));
  const outflows = bills.map((b) => ({
    date: b.dueDate,
    amount: b.openBalance,
    label: `Bill ${b.docNumber ?? b.qboId}`,
  }));

  // Known recurring commitments are real outflows even though QuickBooks has
  // no bill for them yet; leaving them out would flatter the forecast.
  const subs = await query<{ amount: string; cadence: string; next_renewal: string | null }>(
    `SELECT amount, cadence, next_renewal::text FROM subscription_registry WHERE active`,
  );
  for (const s of subs) {
    outflows.push({
      date: s.next_renewal,
      amount: Number(s.amount ?? 0),
      label: "Subscription renewal",
    });
  }
  const policies = await query<{ premium: string; expires_on: string | null }>(
    `SELECT premium, expires_on::text FROM insurance_policy WHERE active`,
  );
  for (const p of policies) {
    outflows.push({
      date: p.expires_on,
      amount: Number(p.premium ?? 0),
      label: "Insurance renewal",
    });
  }

  const openingCash = cash.operating;
  const projected = forecastWeeks(openingCash, inflows, outflows, weeks, asOf);

  return {
    weeks: projected,
    openingCash,
    shortfallWeek: firstShortfall(projected)?.weekStart ?? null,
    undatedInflows: roundMoney(
      inflows.filter((i) => !i.date).reduce((s, i) => s + i.amount, 0),
    ),
    undatedOutflows: roundMoney(
      outflows.filter((o) => !o.date).reduce((s, o) => s + o.amount, 0),
    ),
  };
}

// ---------------------------------------------------------------------------
// Tax Center
// ---------------------------------------------------------------------------

export type Vendor1099Row = {
  name: string;
  paidYtd: number;
  hasW9: boolean;
  reportable: boolean;
};

export type TaxCenter = {
  reserveBalance: number;
  rate: number;
  rateConfirmedByCpa: boolean;
  threshold: number;
  candidates: Vendor1099Row[];
  missingW9Count: number;
  year: number;
};

export async function taxCenter(): Promise<TaxCenter> {
  const year = new Date().getUTCFullYear();
  const [cash, settings] = await Promise.all([cashPosition(), loadFinanceSettings()]);

  // Payments actually made to each vendor this calendar year. 1099 reporting
  // follows cash paid, not bills posted, which is why this reads payments.
  const paid = await query<{ display_name: string | null; paid: string }>(
    `SELECT v.display_name, SUM(t.total) AS paid
       FROM qbo_txn t
       LEFT JOIN qbo_vendor v ON v.qbo_id = t.vendor_qbo_id
      WHERE t.txn_type IN ('BillPayment','Purchase')
        AND t.txn_date >= make_date($1, 1, 1)
        AND t.txn_date <  make_date($1 + 1, 1, 1)
      GROUP BY v.display_name`,
    [year],
  );

  const w9 = await query<{ display_name: string }>(
    `SELECT p.display_name
       FROM vendor_profile p
       JOIN vendor_document d ON d.vendor_id = p.id
      WHERE d.doc_type = 'W-9' AND d.status IN ('received','verified')`,
  );
  const withW9 = new Set(w9.map((r) => r.display_name));

  const candidates: Vendor1099Row[] = paid
    .filter((r) => r.display_name)
    .map((r) => {
      const paidYtd = roundMoney(Number(r.paid ?? 0));
      return {
        name: r.display_name as string,
        paidYtd,
        hasW9: withW9.has(r.display_name as string),
        // Reportability also depends on tax classification, which is a CPA
        // determination; this flags who to look at, not who to file for.
        reportable: paidYtd >= settings.form1099Threshold,
      };
    })
    .sort((a, b) => b.paidYtd - a.paidYtd);

  return {
    reserveBalance: cash.taxReserve,
    rate: settings.taxReserve.rate,
    rateConfirmedByCpa: settings.taxReserve.rateConfirmedByCpa,
    threshold: settings.form1099Threshold,
    candidates,
    missingW9Count: candidates.filter((c) => c.reportable && !c.hasW9).length,
    year,
  };
}

// ---------------------------------------------------------------------------
// Client funding, per project
// ---------------------------------------------------------------------------

export type FundingRow = {
  id: number;
  p5Id: string;
  name: string;
  status: "green" | "yellow" | "red";
  collected: number;
  consumed: number;
  available: number;
  nearTermRequirement: number;
  recommendedDraw: number;
  contractStructureReview: boolean;
};

export async function fundingBoard(): Promise<FundingRow[]> {
  const settings = await loadFinanceSettings();
  const projects = await query<{
    id: string;
    p5_id: string;
    name: string;
    qbo_customer_id: string | null;
    contract_amount: string;
    approved_change_orders: string;
    funding_buffer: string;
    retainage_pct: string;
  }>(
    `SELECT id, p5_id, name, qbo_customer_id, contract_amount,
            approved_change_orders, funding_buffer, retainage_pct
       FROM p5_project
      WHERE status NOT IN ('closed','cancelled')
      ORDER BY p5_id`,
  );

  const rows: FundingRow[] = [];
  for (const p of projects) {
    // Without a QuickBooks link there is no cash history, so the honest
    // answer is zeros rather than a funding position we cannot evidence.
    let collected = 0;
    let consumed = 0;
    let commitments = 0;
    if (p.qbo_customer_id) {
      const [inflow, outflow, open] = await Promise.all([
        query<{ total: string | null }>(
          `SELECT SUM(total) AS total FROM qbo_txn
            WHERE txn_type = 'Payment' AND customer_qbo_id = $1`,
          [p.qbo_customer_id],
        ),
        query<{ total: string | null }>(
          `SELECT SUM(total) AS total FROM qbo_txn
            WHERE txn_type IN ('Bill','Purchase') AND customer_qbo_id = $1`,
          [p.qbo_customer_id],
        ),
        query<{ total: string | null }>(
          `SELECT SUM(COALESCE(balance, total)) AS total FROM qbo_txn
            WHERE txn_type = 'PurchaseOrder' AND customer_qbo_id = $1
              AND COALESCE(po_status, '') <> 'Closed'`,
          [p.qbo_customer_id],
        ),
      ]);
      collected = Number(inflow[0]?.total ?? 0);
      consumed = Number(outflow[0]?.total ?? 0);
      commitments = Number(open[0]?.total ?? 0);
    }

    const revisedContract =
      Number(p.contract_amount ?? 0) + Number(p.approved_change_orders ?? 0);

    const funding = projectFunding({
      clearedClientPayments: collected,
      clearedProjectOutflows: consumed,
      // Only open commitments are evidenced here. The other requirement
      // components exist in the engine so callers cannot double count; they
      // stay zero until P5 records planned purchases and labour, rather than
      // being guessed into the number people draw against.
      commitmentsDueInHorizon: commitments,
      plannedUncommittedPurchases: 0,
      expectedLabor: 0,
      otherKnownOutflows: 0,
      etcInHorizonNotCommitted: 0,
      requiredProjectBuffer: Number(p.funding_buffer ?? 0),
      desiredPostDrawBuffer:
        Number(p.funding_buffer ?? 0) || settings.defaultPostDrawBuffer,
      // The contract ceiling: never recommend billing more than the contract
      // still permits (S56).
      remainingContractBillable: roundMoney(revisedContract - collected),
    });

    rows.push({
      id: Number(p.id),
      p5Id: p.p5_id,
      name: p.name,
      status: funding.status,
      collected: roundMoney(collected),
      consumed: roundMoney(consumed),
      available: funding.projectCashHeld,
      nearTermRequirement: funding.nearTermRequirement,
      recommendedDraw: funding.recommendedDraw,
      contractStructureReview: funding.contractStructureReview,
    });
  }

  // Red first: this page exists to surface projects P5 is financing.
  const rank = { red: 0, yellow: 1, green: 2 } as const;
  return rows.sort((a, b) => rank[a.status] - rank[b.status]);
}
