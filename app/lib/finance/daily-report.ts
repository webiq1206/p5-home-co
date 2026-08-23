/**
 * The daily financial report: one assembled snapshot of the company and
 * every active project, persisted per day so "what changed since yesterday"
 * is a diff of two stored reports, not a re-derivation of history.
 *
 * Accuracy rules (S139, S17 of the report brief):
 *  - every number comes from the synced QBO read model + the P5 registry;
 *  - a number that cannot be computed is reported as missing WITH the
 *    reason, never guessed (e.g. "No budget set");
 *  - overdue AR is never treated as cash;
 *  - when QBO is not connected the report says so instead of mailing
 *    stale figures as fresh.
 *
 * assembleDailyReport does the database work; the diff and health logic are
 * pure and unit-tested.
 */

import { query, queryOne } from "../db.ts";
import { forecastToComplete, marginHealth } from "./engines.ts";
import { isQboConnected } from "./qbo/oauth.ts";
import { classifyInflows, openBills, openInvoices, cashPosition } from "./reporting.ts";
import { buildMoneyRun } from "./money-run.ts";
import type { FinanceSettings } from "./settings.ts";

// ---------------------------------------------------------------------------
// Types (persisted as the daily_report payload - keep them JSON-plain)
// ---------------------------------------------------------------------------

export type HealthLabel = "ON TRACK" | "WATCH" | "ACTION REQUIRED";

export type ReportTxn = {
  id: string;         // "Bill:123"
  type: string;
  date: string | null;
  total: number;
  counterparty: string | null;
};

export type ProjectCard = {
  p5Id: string;
  name: string;
  division: string;
  customer: string | null;
  qboCustomerId: string | null;
  status: string;
  contractValue: number;        // original + approved COs
  originalBudget: number;
  currentBudget: number;
  committed: number;            // open PO balances
  actualCost: number;           // bills + purchases on the project
  remainingBudget: number | null;   // null when no budget is set
  budgetUsedPct: number | null;
  invoiced: number;
  paymentsReceived: number;
  customerBalance: number;      // contractValue - paymentsReceived
  outstandingInvoices: number;  // open AR on the project
  outstandingBills: number;     // open AP on the project
  projectedGrossProfit: number;
  projectedMarginPct: number | null;
  targetMarginPct: number;
  health: HealthLabel;
  healthReasons: string[];
  problems: string[];           // data problems: "No budget set", etc.
};

export type AttentionSummary = {
  critical: number;
  urgent: number;
  warning: number;
  items: {
    severity: string;
    title: string;
    amount: number | null;
    dueOn: string | null;
    recommendedAction: string | null;
  }[];
};

export type CompanySnapshot = {
  cash: {
    operating: number;
    taxReserve: number;
    operatingReserve: number;
    undeposited: number;
    total: number;
  };
  safeCash: number;
  safeCashProvisional: boolean;
  ar: { total: number; overdue: number; overdueCount: number; count: number };
  ap: { total: number; dueSoon: number; dueSoonCount: number; count: number };
  activity: {
    today: PeriodActivity;
    mtd: PeriodActivity;
    ytd: PeriodActivity;
  };
};

export type PeriodActivity = {
  invoiced: number;
  collected: number;
  billsEntered: number;
  billsPaid: number;
};

export type UpcomingItem = {
  kind: "bill" | "invoice";
  counterparty: string | null;
  docNumber: string | null;
  dueDate: string | null;
  amount: number;
};

export type DailyReport = {
  coversDate: string;           // ISO date
  generatedAt: string;          // ISO datetime
  qboConnected: boolean;
  lastSyncAt: string | null;
  company: CompanySnapshot | null;
  attention: AttentionSummary;
  projects: ProjectCard[];
  upcoming: UpcomingItem[];
  /** Numbers we could not compute, with reasons - honesty over guessing. */
  limitations: string[];
  /** Raw open/recent transactions, kept so tomorrow's diff needs no history query. */
  txns: ReportTxn[];
};

export type ReportChange = { text: string; amount: number | null };

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

export function projectHealth(
  card: Pick<
    ProjectCard,
    "projectedMarginPct" | "targetMarginPct" | "remainingBudget" | "projectedGrossProfit"
  > & {
    /** False when a data gap (no budget, no QBO link) makes the figures
     *  unreliable. A project we cannot measure is never reported healthy. */
    dataComplete?: boolean;
  },
  settings: FinanceSettings,
): { health: HealthLabel; reasons: string[] } {
  const reasons: string[] = [];

  // Honesty gate (report brief S17): an unmeasurable project must not wear a
  // green label. "ON TRACK" on a project with no budget is worse than no
  // label at all - it is a number nobody checked, presented as reassurance.
  if (card.dataComplete === false) {
    return {
      health: "ACTION REQUIRED",
      reasons: ["Financial health cannot be assessed - see the data notes on this project"],
    };
  }

  const color = marginHealth(card.projectedMarginPct, card.targetMarginPct, settings, {
    projectedLoss: card.projectedGrossProfit < 0,
  });

  if (card.projectedGrossProfit < 0) reasons.push("Projected loss");
  else if (card.projectedMarginPct !== null) {
    const below = card.targetMarginPct - card.projectedMarginPct;
    if (below > settings.marginBands.redBelow) {
      reasons.push(`Margin ${below.toFixed(1)} pts below the ${card.targetMarginPct}% goal`);
    } else if (below > settings.marginBands.yellowBelow) {
      reasons.push(`Margin ${below.toFixed(1)} pts below goal`);
    }
  }

  let overBudget = false;
  if (card.remainingBudget !== null) {
    if (card.remainingBudget < 0) {
      overBudget = true;
      reasons.push("Over budget (including commitments)");
    } else if (card.remainingBudget === 0) {
      reasons.push("Budget fully consumed");
    }
  }

  const health: HealthLabel =
    color === "red" || overBudget ? "ACTION REQUIRED" : color === "yellow" ? "WATCH" : "ON TRACK";
  if (health === "ON TRACK" && reasons.length === 0) reasons.push("Budget and margin within limits");
  return { health, reasons };
}

/**
 * Meaningful changes between yesterday's report and today's. Pure: feeds on
 * two stored payloads. New transactions are detected by id-set difference,
 * so a re-synced (unchanged) transaction can never appear as new.
 */
export function diffReports(previous: DailyReport | null, current: DailyReport): ReportChange[] {
  const changes: ReportChange[] = [];
  if (!previous) return changes;

  const prevIds = new Set(previous.txns.map((t) => t.id));
  const fmtWho = (t: ReportTxn) => (t.counterparty ? ` - ${t.counterparty}` : "");

  for (const t of current.txns) {
    if (prevIds.has(t.id)) continue;
    if (t.type === "Bill") changes.push({ text: `New vendor bill${fmtWho(t)}`, amount: t.total });
    else if (t.type === "Payment")
      changes.push({ text: `Customer payment received${fmtWho(t)}`, amount: t.total });
    else if (t.type === "Invoice")
      changes.push({ text: `Invoice sent${fmtWho(t)}`, amount: t.total });
    else if (t.type === "BillPayment")
      changes.push({ text: `Vendor payment made${fmtWho(t)}`, amount: t.total });
    else if (t.type === "Estimate")
      changes.push({ text: `Estimate created${fmtWho(t)}`, amount: t.total });
  }

  const prevProjects = new Map(previous.projects.map((p) => [p.p5Id, p]));
  for (const p of current.projects) {
    const before = prevProjects.get(p.p5Id);
    if (!before) {
      changes.push({ text: `New project added: ${p.p5Id} ${p.name}`, amount: p.contractValue });
      continue;
    }
    if (before.health !== p.health) {
      changes.push({
        text: `${p.p5Id} ${p.name}: ${before.health} -> ${p.health}`,
        amount: null,
      });
    }
    const spent = p.actualCost - before.actualCost;
    if (Math.abs(spent) >= 0.01) {
      changes.push({
        text: `${p.p5Id} ${p.name}: costs ${spent > 0 ? "+" : ""}${spent.toFixed(2)} since yesterday`,
        amount: null,
      });
    }
    if (before.currentBudget !== p.currentBudget) {
      changes.push({
        text: `${p.p5Id} ${p.name}: budget revised ${before.currentBudget.toFixed(2)} -> ${p.currentBudget.toFixed(2)}`,
        amount: null,
      });
    }
  }

  if (previous.company && current.company) {
    const overdueDelta = current.company.ar.overdue - previous.company.ar.overdue;
    if (overdueDelta > 0.01) {
      changes.push({ text: "Overdue receivables increased", amount: overdueDelta });
    }
  }

  return changes;
}

// ---------------------------------------------------------------------------
// Assembly (database)
// ---------------------------------------------------------------------------

async function periodActivity(from: string, to: string): Promise<PeriodActivity> {
  const row = await queryOne<{
    invoiced: string;
    collected: string;
    bills_entered: string;
    bills_paid: string;
  }>(
    `SELECT
       COALESCE(SUM(total) FILTER (WHERE txn_type = 'Invoice'), 0)     AS invoiced,
       COALESCE(SUM(total) FILTER (WHERE txn_type = 'Payment'), 0)     AS collected,
       COALESCE(SUM(total) FILTER (WHERE txn_type = 'Bill'), 0)        AS bills_entered,
       COALESCE(SUM(total) FILTER (WHERE txn_type = 'BillPayment'), 0) AS bills_paid
     FROM qbo_txn WHERE txn_date >= $1::date AND txn_date <= $2::date`,
    [from, to],
  );
  return {
    invoiced: Number(row?.invoiced ?? 0),
    collected: Number(row?.collected ?? 0),
    billsEntered: Number(row?.bills_entered ?? 0),
    billsPaid: Number(row?.bills_paid ?? 0),
  };
}

async function recentTxns(sinceDays: number, today: Date): Promise<ReportTxn[]> {
  const since = new Date(today.getTime() - sinceDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const rows = await query<{
    txn_type: string;
    qbo_id: string;
    txn_date: string | null;
    total: string | null;
    customer: string | null;
    vendor: string | null;
  }>(
    `SELECT t.txn_type, t.qbo_id, t.txn_date::text, t.total,
            c.display_name AS customer, v.display_name AS vendor
     FROM qbo_txn t
     LEFT JOIN qbo_customer c ON c.qbo_id = t.customer_qbo_id
     LEFT JOIN qbo_vendor v   ON v.qbo_id = t.vendor_qbo_id
     WHERE t.txn_date >= $1::date
       AND t.txn_type IN ('Invoice','Payment','Bill','BillPayment','Estimate')`,
    [since],
  );
  return rows.map((r) => ({
    id: `${r.txn_type}:${r.qbo_id}`,
    type: r.txn_type,
    date: r.txn_date,
    total: Number(r.total ?? 0),
    counterparty: r.customer ?? r.vendor,
  }));
}

async function projectCards(
  settings: FinanceSettings,
  limitations: string[],
): Promise<ProjectCard[]> {
  const projects = await query<{
    p5_id: string;
    name: string;
    division: string;
    status: string;
    qbo_customer_id: string | null;
    contract_amount: string;
    approved_change_orders: string;
    original_budget: string;
    current_budget: string;
    etc_amount: string;
    target_gp_pct: string;
  }>(
    `SELECT p5_id, name, division, status, qbo_customer_id, contract_amount,
            approved_change_orders, original_budget, current_budget, etc_amount, target_gp_pct
     FROM p5_project
     WHERE status IN ('Active','Ready to Start','On Hold','Substantial Completion','Closeout')
     ORDER BY p5_id`,
  );

  const cards: ProjectCard[] = [];
  for (const p of projects) {
    const contractValue =
      Number(p.contract_amount) + Number(p.approved_change_orders);
    const currentBudget = Number(p.current_budget);
    const problems: string[] = [];

    let invoiced = 0;
    let arOpen = 0;
    let actualCost = 0;
    let billsOpen = 0;
    let committed = 0;
    let customer: string | null = null;

    if (p.qbo_customer_id) {
      const row = await queryOne<{
        display_name: string | null;
        invoiced: string;
        ar_open: string;
        cost: string;
        bills_open: string;
        open_pos: string;
      }>(
        `SELECT
           (SELECT display_name FROM qbo_customer WHERE qbo_id = $1) AS display_name,
           COALESCE(SUM(total)   FILTER (WHERE txn_type = 'Invoice'), 0) AS invoiced,
           COALESCE(SUM(balance) FILTER (WHERE txn_type = 'Invoice'), 0) AS ar_open,
           COALESCE(SUM(total)   FILTER (WHERE txn_type IN ('Bill','Purchase')), 0) AS cost,
           COALESCE(SUM(balance) FILTER (WHERE txn_type = 'Bill'), 0)   AS bills_open,
           COALESCE(SUM(total)   FILTER (WHERE txn_type = 'PurchaseOrder' AND po_status = 'Open'), 0) AS open_pos
         FROM qbo_txn WHERE customer_qbo_id = $1`,
        [p.qbo_customer_id],
      );
      customer = row?.display_name ?? null;
      invoiced = Number(row?.invoiced ?? 0);
      arOpen = Number(row?.ar_open ?? 0);
      actualCost = Number(row?.cost ?? 0);
      billsOpen = Number(row?.bills_open ?? 0);
      committed = Number(row?.open_pos ?? 0);
    } else {
      problems.push("Not linked to a QuickBooks customer - money figures unavailable");
      limitations.push(`${p.p5_id}: not linked to QuickBooks; its card shows registry data only.`);
    }

    const hasBudget = currentBudget > 0;
    if (!hasBudget) problems.push("No budget set");

    const forecast = forecastToComplete({
      revisedContract: contractValue,
      actualCost,
      remainingCommitments: committed,
      additionalEtc: Number(p.etc_amount),
    });

    // Without a QBO link there is no cost side at all, so a "margin" derived
    // from zero cost would read as 100% - a confident-looking lie. Suppress
    // it and let the data problem speak instead.
    const hasCostBasis = p.qbo_customer_id !== null;
    const dataComplete = hasCostBasis && hasBudget;

    const base = {
      projectedMarginPct: hasCostBasis ? forecast.projectedGpPct : null,
      targetMarginPct: Number(p.target_gp_pct),
      remainingBudget: hasBudget ? currentBudget - actualCost - committed : null,
      projectedGrossProfit: forecast.projectedGrossProfit,
      dataComplete,
    };
    const { health, reasons } = projectHealth(base, settings);

    cards.push({
      p5Id: p.p5_id,
      name: p.name,
      division: p.division,
      customer,
      qboCustomerId: p.qbo_customer_id,
      status: p.status,
      contractValue,
      originalBudget: Number(p.original_budget),
      currentBudget,
      committed,
      actualCost,
      remainingBudget: base.remainingBudget,
      budgetUsedPct: hasBudget ? ((actualCost + committed) / currentBudget) * 100 : null,
      invoiced,
      paymentsReceived: invoiced - arOpen,
      customerBalance: contractValue - (invoiced - arOpen),
      outstandingInvoices: arOpen,
      outstandingBills: billsOpen,
      projectedGrossProfit: forecast.projectedGrossProfit,
      projectedMarginPct: base.projectedMarginPct,
      targetMarginPct: Number(p.target_gp_pct),
      health,
      healthReasons: reasons,
      problems,
    });
  }
  return cards;
}

export async function assembleDailyReport(
  settings: FinanceSettings,
  today: Date = new Date(),
): Promise<DailyReport> {
  const coversDate = today.toISOString().slice(0, 10);
  const limitations: string[] = [];

  const qboConnected = await isQboConnected().catch(() => false);
  const lastSync = await queryOne<{ finished_at: Date | null }>(
    `SELECT finished_at FROM qbo_sync_run WHERE status = 'succeeded'
     ORDER BY finished_at DESC NULLS LAST LIMIT 1`,
  ).catch(() => null);
  const lastSyncAt = lastSync?.finished_at
    ? new Date(lastSync.finished_at).toISOString()
    : null;

  // Attention summary always assembles - it does not depend on QBO.
  const attentionRows = await query<{
    severity: string;
    title: string;
    amount: string | null;
    due_on: string | null;
    recommended_action: string | null;
  }>(
    `SELECT severity, title, amount, due_on::text, recommended_action
     FROM attention_item WHERE resolved_at IS NULL
     ORDER BY CASE severity
       WHEN 'critical' THEN 0 WHEN 'urgent' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,
       due_on NULLS LAST LIMIT 12`,
  ).catch(() => []);
  const countRow = await queryOne<{ c: string; u: string; w: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE severity = 'critical')::text AS c,
       COUNT(*) FILTER (WHERE severity = 'urgent')::text   AS u,
       COUNT(*) FILTER (WHERE severity = 'warning')::text  AS w
     FROM attention_item WHERE resolved_at IS NULL`,
  ).catch(() => null);
  const attention: AttentionSummary = {
    critical: Number(countRow?.c ?? 0),
    urgent: Number(countRow?.u ?? 0),
    warning: Number(countRow?.w ?? 0),
    items: attentionRows.map((r) => ({
      severity: r.severity,
      title: r.title,
      amount: r.amount === null ? null : Number(r.amount),
      dueOn: r.due_on,
      recommendedAction: r.recommended_action,
    })),
  };

  const synced = lastSyncAt !== null;
  if (!qboConnected) {
    limitations.push("QuickBooks is not connected - no financial figures are available.");
  } else if (!synced) {
    limitations.push("QuickBooks has not completed a sync yet - figures will appear after the first sync.");
  }

  let company: CompanySnapshot | null = null;
  let projects: ProjectCard[] = [];
  let upcoming: UpcomingItem[] = [];
  let txns: ReportTxn[] = [];

  if (synced) {
    const [cash, invoices, bills, run] = await Promise.all([
      cashPosition(),
      openInvoices(),
      openBills(),
      buildMoneyRun(settings, today),
    ]);
    const inflows = classifyInflows(invoices, today, settings);
    const overdueCount = invoices.filter(
      (i) => i.dueDate && new Date(i.dueDate).getTime() < today.getTime(),
    ).length;

    const horizon = today.getTime() + 7 * 86_400_000;
    const dueSoonBills = bills.filter(
      (b) => b.dueDate && new Date(b.dueDate).getTime() <= horizon,
    );

    const monthStart = `${coversDate.slice(0, 7)}-01`;
    const yearStart = `${coversDate.slice(0, 4)}-01-01`;
    const [todayAct, mtd, ytd] = await Promise.all([
      periodActivity(coversDate, coversDate),
      periodActivity(monthStart, coversDate),
      periodActivity(yearStart, coversDate),
    ]);

    company = {
      cash: {
        operating: cash.operating,
        taxReserve: cash.taxReserve,
        operatingReserve: cash.operatingReserve,
        undeposited: cash.undeposited,
        total: cash.operating + cash.taxReserve + cash.operatingReserve + cash.undeposited,
      },
      safeCash: run.safeCash.safeCashAvailable,
      safeCashProvisional: run.safeCash.provisional,
      ar: {
        total: invoices.reduce((s, i) => s + i.openBalance, 0),
        overdue: inflows.overdue,
        overdueCount,
        count: invoices.length,
      },
      ap: {
        total: bills.reduce((s, b) => s + b.openBalance, 0),
        dueSoon: dueSoonBills.reduce((s, b) => s + b.openBalance, 0),
        dueSoonCount: dueSoonBills.length,
        count: bills.length,
      },
      activity: { today: todayAct, mtd, ytd },
    };

    if (run.safeCash.provisional) {
      limitations.push(
        "Safe Cash is provisional: the operating reserve and/or tax rate are not yet confirmed.",
      );
    }

    projects = await projectCards(settings, limitations);

    const fourteenDays = today.getTime() + 14 * 86_400_000;
    upcoming = [
      ...bills
        .filter((b) => b.dueDate && new Date(b.dueDate).getTime() <= fourteenDays)
        .map((b): UpcomingItem => ({
          kind: "bill",
          counterparty: b.counterparty,
          docNumber: b.docNumber,
          dueDate: b.dueDate,
          amount: b.openBalance,
        })),
      ...invoices
        .filter((i) => i.dueDate && new Date(i.dueDate).getTime() <= fourteenDays)
        .map((i): UpcomingItem => ({
          kind: "invoice",
          counterparty: i.counterparty,
          docNumber: i.docNumber,
          dueDate: i.dueDate,
          amount: i.openBalance,
        })),
    ].sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));

    txns = await recentTxns(45, today);
  } else {
    // Registry-only project list so the report still names active work.
    projects = await projectCards(settings, limitations).catch(() => []);
  }

  return {
    coversDate,
    generatedAt: today.toISOString(),
    qboConnected,
    lastSyncAt,
    company,
    attention,
    projects,
    upcoming,
    limitations,
    txns,
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export async function loadReport(coversDate: string): Promise<DailyReport | null> {
  const row = await queryOne<{ payload: DailyReport }>(
    `SELECT payload FROM daily_report WHERE covers_date = $1`,
    [coversDate],
  );
  return row?.payload ?? null;
}

export async function loadPreviousReport(before: string): Promise<DailyReport | null> {
  const row = await queryOne<{ payload: DailyReport }>(
    `SELECT payload FROM daily_report WHERE covers_date < $1
     ORDER BY covers_date DESC LIMIT 1`,
    [before],
  );
  return row?.payload ?? null;
}

export async function persistReport(
  report: DailyReport,
  emailedTo: string[] | null,
  emailStatus: string | null,
): Promise<void> {
  await query(
    `INSERT INTO daily_report (covers_date, payload, emailed_to, email_status)
     VALUES ($1, $2::jsonb, $3, $4)
     ON CONFLICT (covers_date) DO UPDATE SET
       payload = EXCLUDED.payload,
       emailed_to = COALESCE(EXCLUDED.emailed_to, daily_report.emailed_to),
       email_status = COALESCE(EXCLUDED.email_status, daily_report.email_status)`,
    [report.coversDate, JSON.stringify(report), emailedTo, emailStatus],
  );
}
