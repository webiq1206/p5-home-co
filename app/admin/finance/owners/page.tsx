/**
 * Owner Center (S193): ownership, compensation, reimbursement pipeline.
 * Visible to finance roles only (layout gate); amounts stay configuration.
 */

import { checkDatabase } from "../../../lib/db.ts";
import { addOwner, reviseOwner } from "../actions.ts";
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
                <th className="fin-num">Voting %</th>
                <th className="fin-num">Weekly compensation</th>
                <th>In force since</th>
              </tr>
            </thead>
            <tbody>
              {owners.map((o) => (
                <tr key={o.id}>
                  <td>{o.label}</td>
                  <td className="fin-num">{Number(o.ownership_pct).toFixed(1)}%</td>
                  <td className="fin-num">{Number(o.distribution_pct).toFixed(1)}%</td>
                  <td className="fin-num">{Number(o.voting_pct).toFixed(1)}%</td>
                  <td className="fin-num">{money(o.weekly_compensation)}</td>
                  <td>{o.effective_from}</td>
                </tr>
              ))}
              {owners.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    No owner records yet. Ownership percentages, distribution
                    splits and weekly compensation are owner decisions (S208) -
                    they are entered here once decided, never assumed.
                  </td>
                </tr>
              )}
              {owners.length > 0 && (
                <tr>
                  <td><strong>Total</strong></td>
                  <td className="fin-num">
                    <strong>
                      {owners.reduce((s, o) => s + Number(o.ownership_pct), 0).toFixed(1)}%
                    </strong>
                  </td>
                  <td className="fin-num">
                    <strong>
                      {owners.reduce((s, o) => s + Number(o.distribution_pct), 0).toFixed(1)}%
                    </strong>
                  </td>
                  <td className="fin-num">
                    <strong>
                      {owners.reduce((s, o) => s + Number(o.voting_pct), 0).toFixed(1)}%
                    </strong>
                  </td>
                  <td className="fin-num">
                    <strong>
                      {money(owners.reduce((s, o) => s + Number(o.weekly_compensation), 0))}
                    </strong>
                  </td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {owners.length > 0 &&
          Math.abs(owners.reduce((s, o) => s + Number(o.ownership_pct), 0) - 100) > 0.01 && (
            /* Ownership that does not total 100% means the distribution engine
               is splitting an incomplete whole - worth saying out loud. */
            <div className="admin-notice admin-notice-error">
              <strong>Ownership does not total 100%</strong>
              Distribution recommendations split whatever is recorded here, so an
              incomplete total produces incomplete distributions.
            </div>
          )}
      </section>

      <section className="fin-section">
        <h2>Add an owner</h2>
        <form action={addOwner} className="fin-inline-form">
          <label className="lead-field">
            <span>Name</span>
            <input name="label" required />
          </label>
          <label className="lead-field">
            <span>Ownership %</span>
            <input name="ownershipPct" type="number" step="0.001" min="0" max="100" required />
          </label>
          <label className="lead-field">
            <span>Distribution %</span>
            <input name="distributionPct" type="number" step="0.001" min="0" max="100" required />
          </label>
          <label className="lead-field">
            <span>Voting %</span>
            <input name="votingPct" type="number" step="0.001" min="0" max="100" required />
          </label>
          <label className="lead-field">
            <span>Weekly compensation</span>
            <input name="weeklyCompensation" type="number" step="0.01" min="0" defaultValue="0" />
          </label>
          <button className="lead-action" type="submit">Add owner</button>
        </form>
      </section>

      {owners.length > 0 && (
        <section className="fin-section">
          <h2>Revise an owner</h2>
          <p className="fin-footnote">
            A revision closes the current record and opens a new one from today, so a
            past distribution can still be explained by the percentages in force when it
            was made. Nothing is overwritten.
          </p>
          {owners.map((o) => (
            <form key={o.id} action={reviseOwner} className="fin-inline-form" style={{ marginTop: 12 }}>
              <input type="hidden" name="ownerId" value={o.id} />
              <label className="lead-field">
                <span>{o.label} ownership %</span>
                <input
                  name="ownershipPct"
                  type="number"
                  step="0.001"
                  min="0"
                  max="100"
                  defaultValue={Number(o.ownership_pct)}
                />
              </label>
              <label className="lead-field">
                <span>Distribution %</span>
                <input
                  name="distributionPct"
                  type="number"
                  step="0.001"
                  min="0"
                  max="100"
                  defaultValue={Number(o.distribution_pct)}
                />
              </label>
              <label className="lead-field">
                <span>Voting %</span>
                <input
                  name="votingPct"
                  type="number"
                  step="0.001"
                  min="0"
                  max="100"
                  defaultValue={Number(o.voting_pct)}
                />
              </label>
              <label className="lead-field">
                <span>Weekly compensation</span>
                <input
                  name="weeklyCompensation"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={Number(o.weekly_compensation)}
                />
              </label>
              <label className="lead-field">
                <span>Reason</span>
                <input name="reason" required placeholder="Operating agreement amendment" />
              </label>
              <button className="lead-action" type="submit">Revise</button>
            </form>
          ))}
        </section>
      )}

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
