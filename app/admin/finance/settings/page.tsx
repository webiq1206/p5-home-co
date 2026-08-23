/**
 * Finance settings (S106, S125, S140, S208): the decision register made
 * concrete. Every number here is policy the engines read - nothing is
 * hardcoded at a call site.
 */

import { getSessionUser } from "../../../lib/auth.ts";
import { checkDatabase } from "../../../lib/db.ts";
import { loadFinanceSettings } from "../../../lib/finance/settings.ts";
import { updateReserves } from "../actions.ts";
import { money } from "../queries.ts";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const db = await checkDatabase();
  if (!db.ok) {
    return (
      <main className="admin-main">
        <h1 className="admin-h1">Settings</h1>
        <div className="admin-notice admin-notice-error">
          <strong>Database unavailable</strong>
          {db.detail}
        </div>
      </main>
    );
  }

  const user = await getSessionUser();
  const s = await loadFinanceSettings();
  const isAdmin = user?.role === "administrator";

  return (
    <main className="admin-main">
      <h1 className="admin-h1">Finance settings</h1>
      <p className="admin-sub">
        Formula parameters and approval policy. Changes are audited (S174).
      </p>

      <section className="fin-section">
        <h2>Reserves &amp; tax (S140, S125)</h2>
        <form action={updateReserves} className="lead-form" style={{ maxWidth: 560 }}>
          <label className="lead-field">
            <span>
              Minimum operating reserve <small>(owner decision, S208)</small>
            </span>
            <input
              name="minimumOperatingReserve"
              type="number"
              step="0.01"
              defaultValue={s.reserves.minimumOperatingReserve}
              disabled={!isAdmin}
            />
          </label>
          <label className="lead-field">
            <span>
              <input
                type="checkbox"
                name="confirmed"
                defaultChecked={s.reserves.minimumOperatingReserveConfirmed}
                disabled={!isAdmin}
              />{" "}
              Reserve confirmed by ownership
            </span>
          </label>
          <label className="lead-field">
            <span>
              Tax reserve rate, % of net income <small>(CPA-controlled, S125)</small>
            </span>
            <input
              name="taxRate"
              type="number"
              step="0.1"
              min="0"
              max="60"
              defaultValue={Math.round(s.taxReserve.rate * 1000) / 10}
              disabled={!isAdmin}
            />
          </label>
          <label className="lead-field">
            <span>
              <input
                type="checkbox"
                name="taxConfirmed"
                defaultChecked={s.taxReserve.rateConfirmedByCpa}
                disabled={!isAdmin}
              />{" "}
              Methodology confirmed by CPA
            </span>
          </label>
          {isAdmin ? (
            <button className="lead-action lead-action-primary" type="submit">
              Save
            </button>
          ) : (
            <p className="lead-note">Administrator role required to change policy.</p>
          )}
        </form>
        <p className="fin-footnote">
          Until both boxes are confirmed, Safe Cash displays as provisional and
          an attention item stays open (S208, S125).
        </p>
      </section>

      <section className="fin-section">
        <h2>Bill approval matrix (S106)</h2>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr><th>Up to</th><th>Approvers</th></tr>
            </thead>
            <tbody>
              {s.billApprovalTiers.map((t, i) => (
                <tr key={i}>
                  <td>{t.upTo === null ? "Above" : money(t.upTo)}</td>
                  <td>{t.approvers.join(" + ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="fin-section">
        <h2>Alert ladders</h2>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <tbody>
              <tr><td>Vendor compliance reminders</td><td>{s.complianceReminderDays.join(" / ")} days before expiry</td></tr>
              <tr><td>Subscription renewals</td><td>{s.subscriptionAlertDays.join(" / ")} days</td></tr>
              <tr><td>Insurance renewals</td><td>{s.insuranceAlertDays.join(" / ")} days</td></tr>
              <tr><td>Forecast staleness</td><td>{s.forecastStaleDays} days</td></tr>
              <tr><td>High-confidence AR window</td><td>{s.highConfidenceArDays} days</td></tr>
              <tr><td>1099 threshold</td><td>{money(s.form1099Threshold)} (configurable, S86)</td></tr>
              <tr><td>Distribution cadence</td><td>{s.distributionCadence} (S122)</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
