/**
 * Owner Center (S193): ownership, compensation, reimbursement pipeline.
 * Visible to finance roles only (layout gate); amounts stay configuration.
 */

import { checkDatabase } from "../../../lib/db.ts";
import { money, ownerBoard } from "../queries.ts";

export const dynamic = "force-dynamic";

export default async function OwnersPage() {
  const db = await checkDatabase();
  if (!db.ok) {
    return (
      <main className="admin-main">
        <h1 className="admin-h1">Owner Center</h1>
        <div className="admin-notice admin-notice-error">
          <strong>Database unavailable</strong>
          {db.detail}
        </div>
      </main>
    );
  }

  const { owners, reimbursements } = await ownerBoard();

  return (
    <main className="admin-main">
      <h1 className="admin-h1">Owner Center</h1>
      <p className="admin-sub">
        Compensation is separate from ownership; reimbursements are liabilities,
        never second expenses; distributions are equity (S212-24/25/26).
      </p>

      <section className="fin-section">
        <h2>Owners</h2>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th>Owner</th>
                <th className="fin-num">Ownership %</th>
                <th className="fin-num">Distribution %</th>
                <th className="fin-num">Weekly compensation</th>
              </tr>
            </thead>
            <tbody>
              {owners.map((o) => (
                <tr key={o.id}>
                  <td>{o.label}</td>
                  <td className="fin-num">{Number(o.ownership_pct).toFixed(1)}%</td>
                  <td className="fin-num">{Number(o.distribution_pct).toFixed(1)}%</td>
                  <td className="fin-num">{money(o.weekly_compensation)}</td>
                </tr>
              ))}
              {owners.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    No owner records yet. Ownership percentages, distribution
                    splits and weekly compensation are owner decisions (S208) -
                    they are entered here once decided, never assumed.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="fin-section">
        <h2>Open reimbursements (S117)</h2>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr><th>Owner</th><th>Vendor</th><th>Date</th><th className="fin-num">Amount</th><th>Status</th></tr>
            </thead>
            <tbody>
              {reimbursements.map((r) => (
                <tr key={r.id}>
                  <td>{r.owner_label}</td>
                  <td>{r.vendor_name}</td>
                  <td>{r.spent_on}</td>
                  <td className="fin-num">{money(r.amount)}</td>
                  <td>
                    <span className={r.status === "hold_missing_receipt" ? "fin-chip fin-chip-warning" : "fin-chip"}>
                      {r.status.replaceAll("_", " ")}
                    </span>
                  </td>
                </tr>
              ))}
              {reimbursements.length === 0 && (
                <tr><td colSpan={5}>No open reimbursements.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="fin-footnote">
          Accounting flow (S118): expense/COGS debit + Due to Owner credit on
          approval; reimbursement debits Due to Owner. Never a second expense.
        </p>
      </section>
    </main>
  );
}
