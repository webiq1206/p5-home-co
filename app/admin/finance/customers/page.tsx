/**
 * Customers & AR (S72, S75): who owes P5, how old it is, and who to chase.
 */

import { checkDatabase } from "../../../lib/db.ts";
import { AGING_BUCKETS } from "../../../lib/finance/aging.ts";
import { arBoard } from "../modules.ts";
import { money } from "../queries.ts";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const db = await checkDatabase();
  if (!db.ok) {
    return (
      <main className="admin-main">
        <h1 className="admin-h1">Customers &amp; AR</h1>
        <div className="admin-notice admin-notice-error">
          <strong>Database unavailable</strong>
          {db.detail}
        </div>
      </main>
    );
  }

  const { customers, aging, asOf } = await arBoard();

  return (
    <main className="admin-main">
      <h1 className="admin-h1">Customers &amp; AR</h1>
      <p className="admin-sub">
        Open receivables from QuickBooks as of {asOf}. Overdue money is listed first,
        because that is what needs a call.
      </p>

      <div className="fin-hero">
        <div className="admin-stat">
          <span>Total AR</span>
          <b>{money(aging.total)}</b>
        </div>
        <div className={`admin-stat ${aging.overdue > 0 ? "fin-negative" : ""}`}>
          <span>Overdue</span>
          <b>{money(aging.overdue)}</b>
        </div>
        <div className="admin-stat">
          <span>Oldest</span>
          <b>{aging.oldestDays > 0 ? `${aging.oldestDays} days` : "—"}</b>
        </div>
      </div>

      <section className="fin-section">
        <h2>Aging</h2>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr>{AGING_BUCKETS.map((b) => <th key={b}>{b === "current" ? "Current" : `${b} days`}</th>)}</tr>
            </thead>
            <tbody>
              <tr>
                {AGING_BUCKETS.map((b) => (
                  <td key={b} className={b !== "current" && aging.buckets[b] > 0 ? "fin-negative" : ""}>
                    {money(aging.buckets[b])}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="fin-section">
        <h2>By customer</h2>
        {customers.length === 0 ? (
          <div className="admin-empty">
            <h2>Nothing outstanding</h2>
            <p>No open customer invoices. Either everything is collected, or nothing has been billed yet.</p>
          </div>
        ) : (
          customers.map((c) => (
            <article
              key={c.name}
              className={c.oldestDays > 30 ? "lead-card lead-card-critical" : "lead-card"}
            >
              <div className="lead-top">
                <h3 className="lead-name">{c.name}</h3>
                <span className={`fin-chip ${c.oldestDays > 0 ? "fin-chip-critical" : "fin-chip-green"}`}>
                  {money(c.openBalance)}
                </span>
              </div>
              {c.oldestDays > 0 && (
                <p className="lead-why lead-why-critical">
                  Oldest invoice is {c.oldestDays} days past due.
                </p>
              )}
              <div className="fin-table-wrap">
                <table className="fin-table">
                  <thead>
                    <tr><th>Invoice</th><th>Date</th><th>Due</th><th>Open</th><th>Age</th></tr>
                  </thead>
                  <tbody>
                    {c.invoices.map((i) => (
                      <tr key={i.qboId}>
                        <td>{i.docNumber ?? i.qboId}</td>
                        <td>{i.txnDate ?? "—"}</td>
                        <td>{i.dueDate ?? "—"}</td>
                        <td>{money(i.openBalance)}</td>
                        <td className={i.daysOverdue > 0 ? "fin-negative" : ""}>
                          {i.daysOverdue > 0 ? `${i.daysOverdue}d overdue` : "current"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          ))
        )}
      </section>
    </main>
  );
}
