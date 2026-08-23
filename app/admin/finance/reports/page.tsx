/**
 * Reports (S177-S190): the WIP schedule, backlog, aging, and what the
 * scheduler has actually produced.
 *
 * The status table deliberately reports what RAN, not what is configured. A
 * report that is scheduled but has never produced anything is the failure this
 * page exists to make visible.
 */

import { checkDatabase } from "../../../lib/db.ts";
import { apBoard, arBoard, scheduledReportStatus, wipSchedule } from "../modules.ts";
import { money } from "../queries.ts";

export const dynamic = "force-dynamic";

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

export default async function ReportsPage() {
  const db = await checkDatabase();
  if (!db.ok) {
    return (
      <main className="admin-main">
        <h1 className="admin-h1">Reports</h1>
        <div className="admin-notice admin-notice-error">
          <strong>Database unavailable</strong>
          {db.detail}
        </div>
      </main>
    );
  }

  const [wip, ar, ap, schedules] = await Promise.all([
    wipSchedule(),
    arBoard(),
    apBoard(),
    scheduledReportStatus(),
  ]);

  const neverRun = schedules.filter((s) => !s.lastRun);

  return (
    <main className="admin-main">
      <h1 className="admin-h1">Reports</h1>
      <p className="admin-sub">
        Work in progress, backlog and aging, plus what the scheduler has actually
        produced.
      </p>

      <div className="fin-hero">
        <div className="admin-stat">
          <span>Backlog</span>
          <b>{money(wip.backlogValue)}</b>
        </div>
        <div className={`admin-stat ${wip.totals.overbilled > 0 ? "fin-negative" : ""}`}>
          <span>Overbilled</span>
          <b>{money(wip.totals.overbilled)}</b>
        </div>
        <div className={`admin-stat ${wip.totals.underbilled > 0 ? "fin-negative" : ""}`}>
          <span>Underbilled</span>
          <b>{money(wip.totals.underbilled)}</b>
        </div>
        <div className="admin-stat">
          <span>Projected GP</span>
          <b>{money(wip.totals.projectedGrossProfit)}</b>
        </div>
      </div>

      {(wip.totals.overbilled > 0 || wip.totals.underbilled > 0) && (
        <div className="admin-notice">
          <strong>Over- and under-billing are reported separately, never netted</strong>
          Overbilling is money billed beyond what has been earned — a liability, not
          profit. Underbilling means P5 has earned more than it has billed and is
          carrying the difference. A portfolio with both has two problems, not none.
        </div>
      )}

      {neverRun.length > 0 && (
        <div className="admin-notice admin-notice-error">
          <strong>
            {neverRun.length} scheduled report{neverRun.length === 1 ? " has" : "s have"} never
            produced anything
          </strong>
          {neverRun.map((s) => s.name).join(", ")}. Scheduled is not the same as working.
        </div>
      )}

      <section className="fin-section">
        <h2>Work in progress</h2>
        {wip.rows.length === 0 ? (
          <div className="admin-empty">
            <h2>No projects yet</h2>
            <p>The WIP schedule appears once projects exist with a contract and a forecast.</p>
          </div>
        ) : (
          <>
            <div className="fin-table-wrap">
              <table className="fin-table">
                <thead>
                  <tr>
                    <th>Project</th><th>Division</th><th>Contract</th>
                    <th>Cost to date</th><th>Projected cost</th><th>%</th>
                    <th>Earned</th><th>Billed</th><th>Over</th><th>Under</th><th>GP%</th>
                  </tr>
                </thead>
                <tbody>
                  {wip.rows.map((r) => (
                    <tr key={r.p5Id}>
                      <td>
                        {r.p5Id} · {r.name}
                        {r.forecastStale && (
                          <span className="fin-chip fin-chip-warning" style={{ marginLeft: 6 }}>
                            stale ETC
                          </span>
                        )}
                      </td>
                      <td>{r.division}</td>
                      <td>{money(r.revisedContract)}</td>
                      <td>{money(r.costToDate)}</td>
                      <td>{money(r.projectedFinalCost)}</td>
                      <td>{pct(r.percentComplete)}</td>
                      <td>{money(r.earnedRevenue)}</td>
                      <td>{money(r.billedToDate)}</td>
                      <td className={r.overbilled ? "fin-negative" : ""}>
                        {r.overbilled ? money(r.overbilled) : "—"}
                      </td>
                      <td className={r.underbilled ? "fin-negative" : ""}>
                        {r.underbilled ? money(r.underbilled) : "—"}
                      </td>
                      <td>{r.projectedGrossMarginPct}%</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={2}><strong>Total</strong></td>
                    <td><strong>{money(wip.totals.revisedContract)}</strong></td>
                    <td><strong>{money(wip.totals.costToDate)}</strong></td>
                    <td><strong>{money(wip.totals.projectedFinalCost)}</strong></td>
                    <td>—</td>
                    <td><strong>{money(wip.totals.earnedRevenue)}</strong></td>
                    <td><strong>{money(wip.totals.billedToDate)}</strong></td>
                    <td><strong>{money(wip.totals.overbilled)}</strong></td>
                    <td><strong>{money(wip.totals.underbilled)}</strong></td>
                    <td>—</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="fin-footnote">
              Percent complete is cost based — cost to date over projected final cost — not
              an estimate of how finished the work looks.
              {wip.staleCount > 0 &&
                ` ${wip.staleCount} project${wip.staleCount === 1 ? " has" : "s have"} a stale estimate to complete, so those rows are only as good as their last forecast.`}
            </p>
          </>
        )}
      </section>

      <section className="fin-section">
        <h2>Aging summary</h2>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr><th></th><th>Current</th><th>1-30</th><th>31-60</th><th>61-90</th><th>90+</th><th>Total</th></tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Receivable</strong></td>
                <td>{money(ar.aging.buckets.current)}</td>
                <td>{money(ar.aging.buckets["1-30"])}</td>
                <td>{money(ar.aging.buckets["31-60"])}</td>
                <td>{money(ar.aging.buckets["61-90"])}</td>
                <td>{money(ar.aging.buckets["90+"])}</td>
                <td><strong>{money(ar.aging.total)}</strong></td>
              </tr>
              <tr>
                <td><strong>Payable</strong></td>
                <td>{money(ap.aging.buckets.current)}</td>
                <td>{money(ap.aging.buckets["1-30"])}</td>
                <td>{money(ap.aging.buckets["31-60"])}</td>
                <td>{money(ap.aging.buckets["61-90"])}</td>
                <td>{money(ap.aging.buckets["90+"])}</td>
                <td><strong>{money(ap.aging.total)}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="fin-section">
        <h2>Scheduled reports</h2>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr><th>Report</th><th>Cadence</th><th>Last produced</th><th>Status</th><th>Detail</th></tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.name}>
                  <td>{s.name}</td>
                  <td>{s.cadence}</td>
                  <td>{s.lastRun ?? "—"}</td>
                  <td>
                    <span
                      className={`fin-chip ${
                        s.status === "succeeded" || s.status === "recorded"
                          ? "fin-chip-green"
                          : s.status === "never run"
                            ? "fin-chip-warning"
                            : "fin-chip-critical"
                      }`}
                    >
                      {s.status}
                    </span>
                  </td>
                  <td>{s.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="fin-footnote">
          This table reports what actually ran, not what is configured to run. Monthly
          statements — P&amp;L, balance sheet, cash flow — are produced in QuickBooks,
          which holds the posted truth.
        </p>
      </section>
    </main>
  );
}
