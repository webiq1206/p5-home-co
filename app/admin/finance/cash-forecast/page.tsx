/**
 * Cash Forecast (S141): eight weeks of expected movement, carried forward from
 * today's operating cash.
 *
 * Deliberately modest about what it knows. It forecasts from things that
 * already exist - open invoices, open bills, known renewals - and says plainly
 * when movements could not be scheduled, rather than presenting a tidy line
 * that quietly omits them.
 */

import { checkDatabase } from "../../../lib/db.ts";
import { cashForecast } from "../modules.ts";
import { money } from "../queries.ts";

export const dynamic = "force-dynamic";

export default async function CashForecastPage() {
  const db = await checkDatabase();
  if (!db.ok) {
    return (
      <main className="admin-main">
        <h1 className="admin-h1">Cash Forecast</h1>
        <div className="admin-notice admin-notice-error">
          <strong>Database unavailable</strong>
          {db.detail}
        </div>
      </main>
    );
  }

  const forecast = await cashForecast(8);
  const undated = forecast.undatedInflows + forecast.undatedOutflows;

  return (
    <main className="admin-main">
      <h1 className="admin-h1">Cash Forecast</h1>
      <p className="admin-sub">
        Eight weeks from today&rsquo;s operating cash, using open invoices, open bills and
        known renewals. Weeks begin Monday.
      </p>

      <div className="fin-hero">
        <div className="admin-stat">
          <span>Opening cash</span>
          <b>{money(forecast.openingCash)}</b>
        </div>
        <div className={`admin-stat ${forecast.shortfallWeek ? "fin-negative" : ""}`}>
          <span>First shortfall</span>
          <b>{forecast.shortfallWeek ?? "None"}</b>
        </div>
        <div className="admin-stat">
          <span>Week 8 closing</span>
          <b>{money(forecast.weeks[forecast.weeks.length - 1]?.closing ?? 0)}</b>
        </div>
      </div>

      {forecast.shortfallWeek && (
        <div className="admin-notice admin-notice-error">
          <strong>Projected to run negative in the week of {forecast.shortfallWeek}</strong>
          On current timing, outflows overtake cash on hand. Collecting overdue AR or
          rescheduling payables both move this date.
        </div>
      )}

      {undated > 0 && (
        <div className="admin-notice">
          <strong>{money(undated)} could not be scheduled</strong>
          Some open items carry no due date, so they are excluded from the weeks below
          rather than guessed into one. The forecast is understated by that amount.
        </div>
      )}

      <section className="fin-section">
        <h2>By week</h2>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th>Week of</th><th>Expected in</th><th>Expected out</th>
                <th>Net</th><th>Closing cash</th>
              </tr>
            </thead>
            <tbody>
              {forecast.weeks.map((w) => (
                <tr key={w.weekStart}>
                  <td>{w.weekStart}</td>
                  <td>{w.inflow ? money(w.inflow) : "—"}</td>
                  <td>{w.outflow ? money(w.outflow) : "—"}</td>
                  <td className={w.net < 0 ? "fin-negative" : ""}>{money(w.net)}</td>
                  <td className={w.closing < 0 ? "fin-negative" : ""}>
                    <strong>{money(w.closing)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="fin-footnote">
          Expected inflows are open invoices at their due date; overdue items are shown
          in the first week rather than dropped, because money already late is the most
          real money in the forecast.
        </p>
      </section>
    </main>
  );
}
