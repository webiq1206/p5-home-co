/**
 * Aggregates for the /admin dashboard.
 *
 * The dashboard summarises two systems that are otherwise separate - the lead
 * manager and finance - so it reads in aggregate rather than reusing the
 * per-row loaders those sections use. Nothing here mutates.
 *
 * Two rules the whole file follows, taken from the finance brief and applied
 * to leads as well:
 *
 *  - a figure that cannot be computed is reported as missing WITH the reason,
 *    never guessed or silently shown as zero;
 *  - a section whose table has not been migrated yet degrades to "unavailable"
 *    instead of taking the whole page down with it.
 */

import { describeSchemaError, query, queryOne } from "../lib/db.ts";
import { forecastToComplete, marginHealth, type MarginHealth } from "../lib/finance/engines.ts";
import { loadFinanceSettings } from "../lib/finance/settings.ts";
import { isQboConnected } from "../lib/finance/qbo/oauth.ts";
import { DEAL_STAGES, type DealStage } from "../lib/leads/types.ts";

export type Unavailable = { problem: string; detail: string };

/**
 * Project statuses that mean work is in flight, so their money is live.
 * Draft/Proposal have no committed cost yet; Closed/Cancelled are history.
 */
export const IN_FLIGHT_PROJECT_STATUSES = [
  "Ready to Start",
  "Active",
  "On Hold",
  "Substantial Completion",
  "Closeout",
] as const;

/**
 * Run a dashboard section's loader, converting a failure into a message the
 * panel can render. One missing table must not blank the dashboard.
 */
async function section<T>(load: () => Promise<T>): Promise<T | Unavailable> {
  try {
    return await load();
  } catch (error) {
    return describeSchemaError(error);
  }
}

export function isUnavailable<T>(value: T | Unavailable): value is Unavailable {
  return typeof value === "object" && value !== null && "problem" in value && "detail" in value;
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export type LeadPulse = {
  totals: {
    open: number;
    unassigned: number;
    breached: number;
    dueToday: number;
    newToday: number;
    openAlerts: number;
  };
  /** Open pipeline by stage, in stage order. Closed stages are excluded. */
  stages: { stage: DealStage; count: number; value: number; valueKnown: number }[];
  /**
   * New leads per day for the last 14 days, oldest first. `weekday` is the
   * single letter the chart can fit under a column at phone width; the readable
   * forms are for the hover title and the range footnote beneath the chart.
   */
  daily: {
    date: string;
    weekday: string;
    weekdayLong: string;
    dateLabel: string;
    count: number;
  }[];
  /** Where the last 30 days of leads came from, biggest first. */
  sources: { source: string; count: number }[];
  /** First-response outcomes for leads received in the last 30 days. */
  response: {
    answeredInTarget: number;
    answeredLate: number;
    neverAnswered: number;
    noTargetSet: number;
    medianMinutes: number | null;
  };
  /** Closed outcomes over the last 30 days. */
  closed30: { won: number; wonValue: number; wonValueKnown: number; lost: number };
  /** Leads with no estimated value, so a pipeline total can say what it omits. */
  valueUnknownCount: number;
};

export async function leadPulse(
  restrictToUserId: number | null,
  timeZone: string,
): Promise<LeadPulse | Unavailable> {
  return section(async () => {
    const owner = restrictToUserId;

    const totalsRow = await queryOne<{
      open: number;
      unassigned: number;
      breached: number;
      due_today: number;
      new_today: number;
      value_unknown: number;
    }>(
      `SELECT
         count(*) FILTER (WHERE stage NOT IN ('Closed Won','Closed Lost'))::int AS open,
         count(*) FILTER (WHERE stage NOT IN ('Closed Won','Closed Lost')
                            AND owner_user_id IS NULL)::int AS unassigned,
         count(*) FILTER (WHERE stage NOT IN ('Closed Won','Closed Lost')
                            AND sla_status = 'breached')::int AS breached,
         count(*) FILTER (WHERE stage NOT IN ('Closed Won','Closed Lost')
                            AND next_action_at IS NOT NULL
                            AND (next_action_at AT TIME ZONE $2)::date
                                <= (now() AT TIME ZONE $2)::date)::int AS due_today,
         count(*) FILTER (WHERE (received_at AT TIME ZONE $2)::date
                                = (now() AT TIME ZONE $2)::date)::int AS new_today,
         count(*) FILTER (WHERE stage NOT IN ('Closed Won','Closed Lost')
                            AND estimated_value IS NULL)::int AS value_unknown
       FROM deal
       WHERE ($1::bigint IS NULL OR owner_user_id = $1::bigint)`,
      [owner, timeZone],
    );

    const alertRow = await queryOne<{ n: number }>(
      "SELECT count(*)::int AS n FROM alert WHERE resolved_at IS NULL",
    );

    const stageRows = await query<{ stage: DealStage; n: number; value: string; known: number }>(
      `SELECT stage, count(*)::int AS n,
              COALESCE(sum(estimated_value), 0) AS value,
              count(estimated_value)::int AS known
       FROM deal
       WHERE stage NOT IN ('Closed Won','Closed Lost')
         AND ($1::bigint IS NULL OR owner_user_id = $1::bigint)
       GROUP BY stage`,
      [owner],
    );
    const byStage = new Map(stageRows.map((r) => [r.stage, r]));
    const openStages = DEAL_STAGES.filter((s) => s !== "Closed Won" && s !== "Closed Lost");
    const stages = openStages.map((stage) => {
      const row = byStage.get(stage);
      return {
        stage,
        count: row?.n ?? 0,
        value: Number(row?.value ?? 0),
        valueKnown: row?.known ?? 0,
      };
    });

    // generate_series keeps days with no leads in the chart: a gap in the week
    // is information, and dropping empty days would hide it.
    const dailyRows = await query<{ day: string; n: number }>(
      `SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
              count(deal.id)::int AS n
       FROM generate_series(
              (now() AT TIME ZONE $2)::date - interval '13 days',
              (now() AT TIME ZONE $2)::date,
              interval '1 day') AS d(day)
       LEFT JOIN deal
         ON (deal.received_at AT TIME ZONE $2)::date = d.day::date
        AND ($1::bigint IS NULL OR deal.owner_user_id = $1::bigint)
       GROUP BY d.day
       ORDER BY d.day`,
      [owner, timeZone],
    );

    const sourceRows = await query<{ lead_source: string; n: number }>(
      `SELECT lead_source, count(*)::int AS n
       FROM deal
       WHERE received_at > now() - interval '30 days'
         AND ($1::bigint IS NULL OR owner_user_id = $1::bigint)
       GROUP BY lead_source
       ORDER BY n DESC`,
      [owner],
    );

    // Response is measured from the stored clocks, not from sla_status: the
    // status column tracks the live state of open leads, while this is a
    // record of what actually happened over the period.
    const responseRow = await queryOne<{
      in_target: number;
      late: number;
      never: number;
      no_target: number;
      median_minutes: string | null;
    }>(
      `WITH answered AS (
         SELECT sla_deadline,
                COALESCE(first_two_way_at, first_attempt_at) AS answered_at,
                received_at
         FROM deal
         WHERE received_at > now() - interval '30 days'
           AND ($1::bigint IS NULL OR owner_user_id = $1::bigint)
       )
       SELECT
         count(*) FILTER (WHERE sla_deadline IS NOT NULL AND answered_at IS NOT NULL
                            AND answered_at <= sla_deadline)::int AS in_target,
         count(*) FILTER (WHERE sla_deadline IS NOT NULL AND answered_at IS NOT NULL
                            AND answered_at > sla_deadline)::int AS late,
         count(*) FILTER (WHERE sla_deadline IS NOT NULL AND answered_at IS NULL)::int AS never,
         count(*) FILTER (WHERE sla_deadline IS NULL)::int AS no_target,
         percentile_cont(0.5) WITHIN GROUP (
           ORDER BY EXTRACT(EPOCH FROM (answered_at - received_at)) / 60
         ) FILTER (WHERE answered_at IS NOT NULL) AS median_minutes
       FROM answered`,
      [owner],
    );

    const closedRow = await queryOne<{
      won: number;
      won_value: string;
      won_known: number;
      lost: number;
    }>(
      `SELECT
         count(*) FILTER (WHERE stage = 'Closed Won')::int AS won,
         COALESCE(sum(estimated_value) FILTER (WHERE stage = 'Closed Won'), 0) AS won_value,
         count(estimated_value) FILTER (WHERE stage = 'Closed Won')::int AS won_known,
         count(*) FILTER (WHERE stage = 'Closed Lost')::int AS lost
       FROM deal
       WHERE closed_at > now() - interval '30 days'
         AND ($1::bigint IS NULL OR owner_user_id = $1::bigint)`,
      [owner],
    );

    // Formatted as UTC on purpose: the dates arrive as plain YYYY-MM-DD already
    // counted in the company's zone, so re-interpreting them would shift a day.
    const dayLetter = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "narrow" });
    const dayName = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" });
    const dayDate = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
    });

    return {
      totals: {
        open: totalsRow?.open ?? 0,
        unassigned: totalsRow?.unassigned ?? 0,
        breached: totalsRow?.breached ?? 0,
        dueToday: totalsRow?.due_today ?? 0,
        newToday: totalsRow?.new_today ?? 0,
        openAlerts: alertRow?.n ?? 0,
      },
      stages,
      daily: dailyRows.map((r) => {
        // The date arrives as a plain YYYY-MM-DD already in the company's zone;
        // reading it back as UTC keeps the label on the day it was counted.
        const at = new Date(`${r.day}T00:00:00Z`);
        return {
          date: r.day,
          weekday: dayLetter.format(at),
          weekdayLong: dayName.format(at),
          dateLabel: dayDate.format(at),
          count: r.n,
        };
      }),
      sources: sourceRows.map((r) => ({ source: r.lead_source, count: r.n })),
      response: {
        answeredInTarget: responseRow?.in_target ?? 0,
        answeredLate: responseRow?.late ?? 0,
        neverAnswered: responseRow?.never ?? 0,
        noTargetSet: responseRow?.no_target ?? 0,
        medianMinutes:
          responseRow?.median_minutes === null || responseRow?.median_minutes === undefined
            ? null
            : Math.round(Number(responseRow.median_minutes)),
      },
      closed30: {
        won: closedRow?.won ?? 0,
        wonValue: Number(closedRow?.won_value ?? 0),
        wonValueKnown: closedRow?.won_known ?? 0,
        lost: closedRow?.lost ?? 0,
      },
      valueUnknownCount: totalsRow?.value_unknown ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

export type FinancePulse = {
  qboConnected: boolean;
  lastSyncAt: string | null;
  cash: {
    operating: number;
    taxReserve: number;
    operatingReserve: number;
    undeposited: number;
    total: number;
    asOf: string | null;
    /** False when nothing has ever synced, so zero means "unknown", not "none". */
    hasData: boolean;
  };
  safeCash: { amount: number; provisional: boolean; requiredThisRun: number } | null;
  ar: {
    notYetDue: number;
    late1to30: number;
    late31to60: number;
    late61to90: number;
    late90plus: number;
    total: number;
    overdue: number;
    count: number;
  };
  ap: { total: number; dueIn7: number; dueIn14: number; overdue: number; count: number };
  attention: { critical: number; urgent: number; warning: number; info: number; total: number };
  projects: {
    active: number;
    green: number;
    yellow: number;
    red: number;
    unmeasurable: number;
    backlog: number;
    worst: {
      p5Id: string;
      name: string;
      health: MarginHealth | "unknown";
      projectedGpPct: number | null;
      targetGpPct: number;
      reason: string;
    }[];
  };
  /** Safe cash from the persisted money runs, oldest first. */
  safeCashTrend: { date: string; label: string; amount: number }[];
  draws: { open: number; requested: number };
  /** Figures that could not be computed, each with the reason. */
  limitations: string[];
};

export async function financePulse(): Promise<FinancePulse | Unavailable> {
  return section(async () => {
    const limitations: string[] = [];
    const settings = await loadFinanceSettings();
    const qboConnected = await isQboConnected().catch(() => false);

    const cashRow = await queryOne<{
      operating: string;
      tax_reserve: string;
      operating_reserve: string;
      undeposited: string;
      as_of: Date | null;
      n: number;
    }>(
      `SELECT
         COALESCE(sum(current_balance) FILTER (
           WHERE account_type = 'Bank' AND COALESCE(acct_num,'') NOT IN ('1030','1040')), 0) AS operating,
         COALESCE(sum(current_balance) FILTER (WHERE acct_num = '1030'), 0) AS tax_reserve,
         COALESCE(sum(current_balance) FILTER (WHERE acct_num = '1040'), 0) AS operating_reserve,
         COALESCE(sum(current_balance) FILTER (WHERE sub_type = 'UndepositedFunds'), 0) AS undeposited,
         max(synced_at) AS as_of,
         count(*)::int AS n
       FROM qbo_account
       WHERE active AND (account_type = 'Bank' OR sub_type = 'UndepositedFunds')`,
    );
    const operating = Number(cashRow?.operating ?? 0);
    const taxReserve = Number(cashRow?.tax_reserve ?? 0);
    const operatingReserve = Number(cashRow?.operating_reserve ?? 0);
    const undeposited = Number(cashRow?.undeposited ?? 0);
    const hasCashData = (cashRow?.n ?? 0) > 0;
    if (!hasCashData) {
      limitations.push(
        "Cash is unknown: no bank accounts have synced from QuickBooks yet, so it is shown as unavailable rather than as zero.",
      );
    }

    const arRow = await queryOne<{
      not_due: string; d1: string; d2: string; d3: string; d4: string; n: number;
    }>(
      `SELECT
         COALESCE(sum(balance) FILTER (WHERE due_date IS NULL OR due_date >= current_date), 0) AS not_due,
         COALESCE(sum(balance) FILTER (WHERE due_date <  current_date
                                         AND due_date >= current_date - 30), 0) AS d1,
         COALESCE(sum(balance) FILTER (WHERE due_date <  current_date - 30
                                         AND due_date >= current_date - 60), 0) AS d2,
         COALESCE(sum(balance) FILTER (WHERE due_date <  current_date - 60
                                         AND due_date >= current_date - 90), 0) AS d3,
         COALESCE(sum(balance) FILTER (WHERE due_date <  current_date - 90), 0) AS d4,
         count(*)::int AS n
       FROM qbo_txn
       WHERE txn_type = 'Invoice' AND COALESCE(balance, 0) > 0`,
    );
    const ar = {
      notYetDue: Number(arRow?.not_due ?? 0),
      late1to30: Number(arRow?.d1 ?? 0),
      late31to60: Number(arRow?.d2 ?? 0),
      late61to90: Number(arRow?.d3 ?? 0),
      late90plus: Number(arRow?.d4 ?? 0),
      total: 0,
      overdue: 0,
      count: arRow?.n ?? 0,
    };
    ar.overdue = ar.late1to30 + ar.late31to60 + ar.late61to90 + ar.late90plus;
    ar.total = ar.notYetDue + ar.overdue;

    const apRow = await queryOne<{
      total: string; due7: string; due14: string; overdue: string; n: number;
    }>(
      `SELECT
         COALESCE(sum(balance), 0) AS total,
         COALESCE(sum(balance) FILTER (WHERE due_date IS NOT NULL
                                         AND due_date >= current_date
                                         AND due_date <= current_date + 7), 0) AS due7,
         COALESCE(sum(balance) FILTER (WHERE due_date IS NOT NULL
                                         AND due_date >= current_date
                                         AND due_date <= current_date + 14), 0) AS due14,
         COALESCE(sum(balance) FILTER (WHERE due_date < current_date), 0) AS overdue,
         count(*)::int AS n
       FROM qbo_txn
       WHERE txn_type = 'Bill' AND COALESCE(balance, 0) > 0`,
    );
    const ap = {
      total: Number(apRow?.total ?? 0),
      dueIn7: Number(apRow?.due7 ?? 0),
      dueIn14: Number(apRow?.due14 ?? 0),
      overdue: Number(apRow?.overdue ?? 0),
      count: apRow?.n ?? 0,
    };

    const attentionRow = await queryOne<{
      critical: number; urgent: number; warning: number; info: number; total: number;
    }>(
      `SELECT
         count(*) FILTER (WHERE severity = 'critical')::int AS critical,
         count(*) FILTER (WHERE severity = 'urgent')::int   AS urgent,
         count(*) FILTER (WHERE severity = 'warning')::int  AS warning,
         count(*) FILTER (WHERE severity = 'info')::int     AS info,
         count(*)::int AS total
       FROM attention_item WHERE resolved_at IS NULL`,
    );

    // One pass over active projects rather than a rollup query per project:
    // the dashboard only needs the totals and the three worst.
    const projectRows = await query<{
      p5_id: string;
      name: string;
      contract_amount: string;
      approved_change_orders: string;
      etc_amount: string;
      target_gp_pct: string;
      qbo_customer_id: string | null;
      billed: string;
      open_pos: string;
      invoiced: string;
    }>(
      `SELECT p.p5_id, p.name, p.contract_amount, p.approved_change_orders,
              p.etc_amount, p.target_gp_pct, p.qbo_customer_id,
              COALESCE(t.billed, 0)   AS billed,
              COALESCE(t.open_pos, 0) AS open_pos,
              COALESCE(t.invoiced, 0) AS invoiced
       FROM p5_project p
       LEFT JOIN LATERAL (
         SELECT COALESCE(sum(total) FILTER (WHERE txn_type = 'Bill'), 0) AS billed,
                COALESCE(sum(total) FILTER (WHERE txn_type = 'PurchaseOrder'
                                              AND po_status = 'Open'), 0) AS open_pos,
                COALESCE(sum(total) FILTER (WHERE txn_type = 'Invoice'), 0) AS invoiced
         FROM qbo_txn WHERE customer_qbo_id = p.qbo_customer_id
       ) t ON p.qbo_customer_id IS NOT NULL
       WHERE p.status = ANY($1::text[])
       ORDER BY p.p5_id`,
      [IN_FLIGHT_PROJECT_STATUSES],
    );

    let green = 0;
    let yellow = 0;
    let red = 0;
    let unmeasurable = 0;
    let backlog = 0;
    const scored: FinancePulse["projects"]["worst"] = [];

    for (const row of projectRows) {
      const revised = Number(row.contract_amount) + Number(row.approved_change_orders);
      const invoiced = Number(row.invoiced);
      backlog += Math.max(0, revised - invoiced);

      if (!row.qbo_customer_id) {
        // Without the QBO link there are no actuals, so this project has no
        // measured margin. Counting it green would be a guess.
        unmeasurable += 1;
        scored.push({
          p5Id: row.p5_id,
          name: row.name,
          health: "unknown",
          projectedGpPct: null,
          targetGpPct: Number(row.target_gp_pct),
          reason: "Not linked to a QuickBooks project, so costs cannot be measured.",
        });
        continue;
      }

      const forecast = forecastToComplete({
        revisedContract: revised,
        actualCost: Number(row.billed),
        remainingCommitments: Number(row.open_pos),
        additionalEtc: Number(row.etc_amount),
      });
      const health = marginHealth(forecast.projectedGpPct, Number(row.target_gp_pct), settings, {
        projectedLoss: forecast.projectedGrossProfit < 0,
      });
      if (health === "green") green += 1;
      else if (health === "yellow") yellow += 1;
      else red += 1;

      scored.push({
        p5Id: row.p5_id,
        name: row.name,
        health,
        projectedGpPct: forecast.projectedGpPct,
        targetGpPct: Number(row.target_gp_pct),
        reason:
          forecast.projectedGpPct === null
            ? "No contract value set, so margin cannot be calculated."
            : `Projected ${forecast.projectedGpPct.toFixed(1)}% against a ${Number(row.target_gp_pct)}% target.`,
      });
    }

    if (unmeasurable > 0) {
      limitations.push(
        `${unmeasurable} active project${unmeasurable === 1 ? " is" : "s are"} not linked to QuickBooks, so their costs and margin are not included in the health counts.`,
      );
    }

    const rank: Record<MarginHealth | "unknown", number> = { red: 0, unknown: 1, yellow: 2, green: 3 };
    const worst = scored
      .sort((a, b) => {
        const byHealth = rank[a.health] - rank[b.health];
        if (byHealth !== 0) return byHealth;
        return (a.projectedGpPct ?? -Infinity) - (b.projectedGpPct ?? -Infinity);
      })
      .filter((p) => p.health !== "green")
      .slice(0, 4);

    const runRows = await query<{ covers_date: string; safe_cash: string; required_total: string }>(
      `SELECT covers_date::text, safe_cash, required_total
       FROM money_run
       WHERE run_kind IN ('final','preliminary')
       ORDER BY covers_date DESC LIMIT 10`,
    );
    const runLabel = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
    });
    const safeCashTrend = runRows
      .slice()
      .reverse()
      .map((r) => ({
        date: r.covers_date,
        label: runLabel.format(new Date(`${r.covers_date}T00:00:00Z`)),
        amount: Number(r.safe_cash),
      }));

    const latestRun = runRows[0] ?? null;
    const provisional =
      !settings.reserves.minimumOperatingReserveConfirmed || !settings.taxReserve.rateConfirmedByCpa;
    const safeCash = latestRun
      ? {
          amount: Number(latestRun.safe_cash),
          provisional,
          requiredThisRun: Number(latestRun.required_total),
        }
      : null;
    if (!latestRun) {
      limitations.push(
        "Safe cash is unknown: no money run has been saved yet. Open the Money Run page to compute and persist one.",
      );
    }
    if (latestRun && provisional) {
      limitations.push(
        "Safe cash is provisional: the minimum operating reserve or the CPA tax rate is still unconfirmed.",
      );
    }

    const drawRow = await queryOne<{ n: number; requested: string }>(
      `SELECT count(*)::int AS n, COALESCE(sum(amount_requested), 0) AS requested
       FROM lender_draw WHERE status IN ('draft','submitted','approved')`,
    );

    const syncRow = await queryOne<{ finished_at: Date | null }>(
      `SELECT finished_at FROM qbo_sync_run
       WHERE status = 'succeeded' ORDER BY started_at DESC LIMIT 1`,
    );
    if (!qboConnected) {
      limitations.push(
        "QuickBooks is not connected, so every financial figure here is as stale as the last successful sync.",
      );
    }

    return {
      qboConnected,
      lastSyncAt: syncRow?.finished_at ? new Date(syncRow.finished_at).toISOString() : null,
      cash: {
        operating,
        taxReserve,
        operatingReserve,
        undeposited,
        total: operating + taxReserve + operatingReserve + undeposited,
        asOf: cashRow?.as_of ? new Date(cashRow.as_of).toISOString() : null,
        hasData: hasCashData,
      },
      safeCash,
      ar,
      ap,
      attention: {
        critical: attentionRow?.critical ?? 0,
        urgent: attentionRow?.urgent ?? 0,
        warning: attentionRow?.warning ?? 0,
        info: attentionRow?.info ?? 0,
        total: attentionRow?.total ?? 0,
      },
      projects: {
        active: projectRows.length,
        green,
        yellow,
        red,
        unmeasurable,
        backlog,
        worst,
      },
      safeCashTrend,
      draws: { open: drawRow?.n ?? 0, requested: Number(drawRow?.requested ?? 0) },
      limitations,
    };
  });
}
