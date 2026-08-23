/**
 * Weekly Money Run (S139-S143): the owner's primary cash screen.
 *
 * Live computation on every view; the Persist buttons store the formal
 * preliminary/final runs. Safe Cash shows its full component breakdown so the
 * number can always be explained (S157), and displays PROVISIONAL while the
 * reserve/tax-rate decisions are unconfirmed (S208).
 */

import { checkDatabase } from "../../../lib/db.ts";
import { buildMoneyRun } from "../../../lib/finance/money-run.ts";
import { loadFinanceSettings } from "../../../lib/finance/settings.ts";
import { saveMoneyRunNow } from "../actions.ts";
import { money } from "../queries.ts";

export const dynamic = "force-dynamic";

export default async function MoneyRunPage() {
  const db = await checkDatabase();
  if (!db.ok) {
    return (
      <main className="admin-main">
        <h1 className="admin-h1">Weekly Money Run</h1>
        <div className="admin-notice admin-notice-error">
          <strong>Database unavailable</strong>
          {db.detail}
        </div>
      </main>
    );
  }

  const settings = await loadFinanceSettings();
  const run = await buildMoneyRun(settings);
  const sc = run.safeCash;

  return (
    <main className="admin-main">
      <h1 className="admin-h1">Weekly Money Run</h1>
      <p className="admin-sub">{run.headline}</p>

      <div className="fin-hero">
        <div
          className={
            "admin-stat" +
            (sc.safeCashAvailable < 0 ? " fin-negative" : "") +
            (sc.provisional ? " fin-provisional" : "")
          }
        >
          <b>{money(sc.safeCashAvailable)}</b>
          <span>Safe cash{sc.provisional ? " (provisional)" : ""}</span>
        </div>
        <div className="admin-stat">
          <b>{money(run.required.total)}</b>
          <span>Pay this run</span>
        </div>
        <div className="admin-stat">
          <b>{money(run.inflows.highConfidence)}</b>
          <span>Expected in</span>
        </div>
        <div className="admin-stat">
          <b>{money(run.onHold.total)}</b>
          <span>On hold</span>
        </div>
      </div>

      <section className="fin-section">
        <h2>Cash</h2>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <tbody>
              <tr><td>Operating cash</td><td className="fin-num">{money(run.cash.operating)}</td></tr>
              <tr><td>Tax reserve (1030) — protected</td><td className="fin-num">{money(run.cash.taxReserve)}</td></tr>
              <tr><td>Operating reserve (1040) — protected</td><td className="fin-num">{money(run.cash.operatingReserve)}</td></tr>
              <tr><td>Pending processor / undeposited</td><td className="fin-num">{money(run.cash.undeposited)}</td></tr>
            </tbody>
          </table>
        </div>
        {run.cash.asOf && (
          <p className="fin-footnote">
            Source: QuickBooks, synced {new Date(run.cash.asOf).toLocaleString()}.
          </p>
        )}
      </section>

      <section className="fin-section">
        <h2>Safe cash breakdown (S140)</h2>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <tbody>
              <tr><td>Unrestricted cleared operating cash</td><td className="fin-num">{money(sc.components.unrestrictedClearedOperatingCash)}</td></tr>
              <tr><td>+ High-confidence inflows before next run</td><td className="fin-num">{money(sc.components.highConfidenceInflows)}</td></tr>
              <tr><td>− Required outflows not yet withdrawn</td><td className="fin-num">{money(sc.components.requiredOutflowsNotReflected)}</td></tr>
              <tr><td>− Tax reserve requirement</td><td className="fin-num">{money(sc.components.taxReserveRequirement)}</td></tr>
              <tr><td>− Minimum operating reserve</td><td className="fin-num">{money(sc.components.minimumOperatingReserve)}</td></tr>
              <tr><td>− Approved unfunded project exposure</td><td className="fin-num">{money(sc.components.approvedUnfundedProjectExposure)}</td></tr>
              <tr><td>− Other protected reserves</td><td className="fin-num">{money(sc.components.otherProtectedReserves)}</td></tr>
              <tr><td><strong>Safe cash available</strong></td><td className="fin-num"><strong>{money(sc.safeCashAvailable)}</strong></td></tr>
            </tbody>
          </table>
        </div>
        <p className="fin-footnote">
          Uncertain AR ({money(run.inflows.uncertain)}) is never treated as cash
          (S139). Overdue AR: {money(run.inflows.overdue)} — chased, not counted.
        </p>
      </section>

      <section className="fin-section">
        <h2>Required payments</h2>
        {run.required.bills.length === 0 ? (
          <div className="admin-empty"><h2>Nothing due</h2><p>No open bills inside the pay horizon.</p></div>
        ) : (
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead>
                <tr><th>Vendor</th><th>Bill</th><th>Due</th><th className="fin-num">Open</th></tr>
              </thead>
              <tbody>
                {run.required.bills.map((b) => (
                  <tr key={b.qboId}>
                    <td>{b.counterparty ?? "—"}</td>
                    <td>{b.docNumber ?? b.qboId}</td>
                    <td>{b.dueDate ?? "—"}</td>
                    <td className="fin-num">{money(b.openBalance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {run.onHold.bills.length > 0 && (
        <section className="fin-section">
          <h2>On hold — do not pay (S105)</h2>
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead>
                <tr><th>Vendor</th><th>Bill</th><th>Due</th><th className="fin-num">Open</th></tr>
              </thead>
              <tbody>
                {run.onHold.bills.map((b) => (
                  <tr key={b.qboId}>
                    <td>{b.counterparty ?? "—"}</td>
                    <td>{b.docNumber ?? b.qboId}</td>
                    <td>{b.dueDate ?? "—"}</td>
                    <td className="fin-num">{money(b.openBalance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="fin-footnote">
            Held by vendor compliance or a manual hold. The Vendors page shows
            the exact reason for each.
          </p>
        </section>
      )}

      <section className="fin-section">
        <h2>Persist this run</h2>
        <div className="lead-actions">
          <form action={saveMoneyRunNow}>
            <input type="hidden" name="kind" value="preliminary" />
            <button className="lead-action" type="submit">Save as preliminary</button>
          </form>
          <form action={saveMoneyRunNow}>
            <input type="hidden" name="kind" value="final" />
            <button className="lead-action lead-action-primary" type="submit">Save as final</button>
          </form>
        </div>
        <p className="fin-footnote">
          Wednesdays and Fridays persist automatically (S143); these buttons
          cover off-cadence runs.
        </p>
      </section>
    </main>
  );
}
