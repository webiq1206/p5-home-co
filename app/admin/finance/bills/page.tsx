/**
 * Bills & Payments (S99-S111): open AP, aged, with holds shown where they
 * apply. A held vendor's bills are still real payables - they are simply not
 * payable yet, and hiding the hold would invite someone to pay them.
 */

import { checkDatabase } from "../../../lib/db.ts";
import { AGING_BUCKETS } from "../../../lib/finance/aging.ts";
import { apBoard } from "../modules.ts";
import { money } from "../queries.ts";

export const dynamic = "force-dynamic";

export default async function BillsPage() {
  const db = await checkDatabase();
  if (!db.ok) {
    return (
      <main className="admin-main">
        <h1 className="admin-h1">Bills &amp; Payments</h1>
        <div className="admin-notice admin-notice-error">
          <strong>Database unavailable</strong>
          {db.detail}
        </div>
      </main>
    );
  }

  const { vendors, aging, heldTotal, asOf } = await apBoard();

  return (
    <main className="admin-main">
      <h1 className="admin-h1">Bills &amp; Payments</h1>
      <p className="admin-sub">
        Open payables from QuickBooks as of {asOf}. What P5 owes, what is overdue, and
        what cannot be paid yet.
      </p>

      <div className="fin-hero">
        <div className="admin-stat">
          <span>Total AP</span>
          <b>{money(aging.total)}</b>
        </div>
        <div className={`admin-stat ${aging.overdue > 0 ? "fin-negative" : ""}`}>
          <span>Overdue</span>
          <b>{money(aging.overdue)}</b>
        </div>
        <div className={`admin-stat ${heldTotal > 0 ? "fin-negative" : ""}`}>
          <span>On hold</span>
          <b>{money(heldTotal)}</b>
        </div>
      </div>

      {heldTotal > 0 && (
        <div className="admin-notice">
          <strong>{money(heldTotal)} is on payment hold</strong>
          These bills are genuine payables but are blocked by a compliance or manual
          hold. Releasing a hold is done on the vendor, with a reason.
        </div>
      )}

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
        <h2>By vendor</h2>
        {vendors.length === 0 ? (
          <div className="admin-empty">
            <h2>Nothing owed</h2>
            <p>No open vendor bills in QuickBooks.</p>
          </div>
        ) : (
          vendors.map((v) => (
            <article
              key={v.name}
              className={v.onHold ? "lead-card lead-card-critical" : "lead-card"}
            >
              <div className="lead-top">
                <h3 className="lead-name">{v.name}</h3>
                <span className="fin-chip">{money(v.openBalance)}</span>
              </div>
              <div className="lead-tags">
                {v.onHold && <span className="fin-chip fin-chip-critical">PAYMENT HOLD</span>}
                {v.oldestDays > 0 && (
                  <span className="lead-tag">Oldest {v.oldestDays} days past due</span>
                )}
              </div>
              {v.onHold && (
                <p className="lead-why lead-why-critical">
                  {v.holdReason ?? "Compliance requirements are not met, so payment is blocked."}
                </p>
              )}
              <div className="fin-table-wrap">
                <table className="fin-table">
                  <thead>
                    <tr><th>Bill</th><th>Date</th><th>Due</th><th>Open</th><th>Age</th></tr>
                  </thead>
                  <tbody>
                    {v.bills.map((b) => (
                      <tr key={b.qboId}>
                        <td>{b.docNumber ?? b.qboId}</td>
                        <td>{b.txnDate ?? "—"}</td>
                        <td>{b.dueDate ?? "—"}</td>
                        <td>{money(b.openBalance)}</td>
                        <td className={b.daysOverdue > 0 ? "fin-negative" : ""}>
                          {b.daysOverdue > 0 ? `${b.daysOverdue}d overdue` : "current"}
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
