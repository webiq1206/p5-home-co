/**
 * Tax Center (S123-S127, S86): the tax reserve, and who is heading for a 1099.
 *
 * Careful about its own authority. The reserve rate is a CPA decision and says
 * so until confirmed; 1099 reportability also depends on tax classification,
 * so this flags who to look at rather than declaring who gets filed for.
 */

import { checkDatabase } from "../../../lib/db.ts";
import { taxCenter } from "../modules.ts";
import { money } from "../queries.ts";

export const dynamic = "force-dynamic";

export default async function TaxPage() {
  const db = await checkDatabase();
  if (!db.ok) {
    return (
      <main className="admin-main">
        <h1 className="admin-h1">Tax Center</h1>
        <div className="admin-notice admin-notice-error">
          <strong>Database unavailable</strong>
          {db.detail}
        </div>
      </main>
    );
  }

  const tax = await taxCenter();
  const reportable = tax.candidates.filter((c) => c.reportable);

  return (
    <main className="admin-main">
      <h1 className="admin-h1">Tax Center</h1>
      <p className="admin-sub">
        Tax reserve and 1099 readiness for {tax.year}. Reportable payments follow cash
        actually paid, not bills posted.
      </p>

      <div className="fin-hero">
        <div className="admin-stat">
          <span>Tax reserve balance</span>
          <b>{money(tax.reserveBalance)}</b>
        </div>
        <div className={`admin-stat ${tax.rateConfirmedByCpa ? "" : "fin-provisional"}`}>
          <span>Reserve rate</span>
          <b>{Math.round(tax.rate * 100)}%</b>
        </div>
        <div className={`admin-stat ${tax.missingW9Count > 0 ? "fin-negative" : ""}`}>
          <span>Reportable without W-9</span>
          <b>{tax.missingW9Count}</b>
        </div>
      </div>

      {!tax.rateConfirmedByCpa && (
        <div className="admin-notice">
          <strong>The reserve rate is not confirmed by the CPA</strong>
          {Math.round(tax.rate * 100)}% is a working assumption, not advice. Every figure
          derived from it is provisional until the CPA sets the rate and the federal tax
          election is made.
        </div>
      )}

      {tax.missingW9Count > 0 && (
        <div className="admin-notice admin-notice-error">
          <strong>
            {tax.missingW9Count} vendor{tax.missingW9Count === 1 ? " has" : "s have"} passed{" "}
            {money(tax.threshold)} without a W-9 on file
          </strong>
          A W-9 collected at year end is far harder to get than one collected before the
          first payment. These should be chased now.
        </div>
      )}

      <section className="fin-section">
        <h2>1099 candidates ({tax.year})</h2>
        {tax.candidates.length === 0 ? (
          <div className="admin-empty">
            <h2>No vendor payments yet this year</h2>
            <p>Once payments are recorded in QuickBooks, this tracks who approaches the threshold.</p>
          </div>
        ) : (
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead>
                <tr><th>Vendor</th><th>Paid this year</th><th>W-9</th><th>Status</th></tr>
              </thead>
              <tbody>
                {tax.candidates.map((c) => (
                  <tr key={c.name}>
                    <td>{c.name}</td>
                    <td>{money(c.paidYtd)}</td>
                    <td>
                      <span className={`fin-chip ${c.hasW9 ? "fin-chip-green" : "fin-chip-critical"}`}>
                        {c.hasW9 ? "on file" : "missing"}
                      </span>
                    </td>
                    <td>
                      {c.reportable ? (
                        <span className="fin-chip fin-chip-warning">over threshold</span>
                      ) : (
                        <span className="fin-chip fin-chip-info">under threshold</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="fin-footnote">
          Threshold {money(tax.threshold)}. {reportable.length} of {tax.candidates.length}{" "}
          vendors are over it. Whether a vendor is actually reportable also depends on
          their tax classification, which is a CPA determination.
        </p>
      </section>
    </main>
  );
}
