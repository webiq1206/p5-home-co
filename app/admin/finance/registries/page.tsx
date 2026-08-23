/**
 * Registries (S127 subscriptions, S130 insurance, S135 corporate compliance).
 * Deadlines feed the attention queue automatically; this page is the record.
 */

import { checkDatabase } from "../../../lib/db.ts";
import {
  addInsurancePolicy,
  addObligation,
  addSubscription,
  completeObligation,
} from "../actions.ts";
import { money, registryBoard } from "../queries.ts";

export const dynamic = "force-dynamic";

export default async function RegistriesPage() {
  const db = await checkDatabase();
  if (!db.ok) {
    return (
      <main className="admin-main">
        <h1 className="admin-h1">Registries</h1>
        <div className="admin-notice admin-notice-error">
          <strong>Database unavailable</strong>
          {db.detail}
        </div>
      </main>
    );
  }

  const { subscriptions, insurance, obligations } = await registryBoard();
  const monthlySubSpend = subscriptions.reduce((sum, s) => {
    const amount = Number(s.amount);
    return sum + (s.cadence === "annual" ? amount / 12 : s.cadence === "quarterly" ? amount / 3 : amount);
  }, 0);

  return (
    <main className="admin-main">
      <h1 className="admin-h1">Registries</h1>
      <p className="admin-sub">
        Subscriptions, insurance and the corporate compliance calendar. Nothing
        here depends on someone remembering to check it (S212-50).
      </p>

      <section className="fin-section">
        <h2>Subscriptions — {money(monthlySubSpend)}/mo equivalent</h2>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr><th>Vendor</th><th>Product</th><th className="fin-num">Amount</th><th>Cadence</th><th>Next renewal</th><th>Auto-renew</th></tr>
            </thead>
            <tbody>
              {subscriptions.map((s) => (
                <tr key={s.id}>
                  <td>{s.vendor_name}</td>
                  <td>{s.product}</td>
                  <td className="fin-num">{money(s.amount)}</td>
                  <td>{s.cadence}</td>
                  <td>{s.next_renewal ?? "—"}</td>
                  <td>{s.auto_renew ? "yes" : "no"}</td>
                </tr>
              ))}
              {subscriptions.length === 0 && (
                <tr><td colSpan={6}>No subscriptions registered.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <form action={addSubscription} className="fin-inline-form" style={{ marginTop: 12 }}>
          <label className="lead-field"><span>Vendor</span><input name="vendorName" required /></label>
          <label className="lead-field"><span>Product</span><input name="product" required /></label>
          <label className="lead-field"><span>Amount</span><input name="amount" type="number" step="0.01" required /></label>
          <label className="lead-field"><span>Cadence</span>
            <select name="cadence"><option>monthly</option><option>annual</option><option>quarterly</option></select>
          </label>
          <label className="lead-field"><span>Next renewal</span><input name="nextRenewal" type="date" /></label>
          <button className="lead-action" type="submit">Add</button>
        </form>
      </section>

      <section className="fin-section">
        <h2>Insurance policies</h2>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr><th>Policy</th><th>Carrier</th><th>Expires</th><th className="fin-num">Premium</th></tr>
            </thead>
            <tbody>
              {insurance.map((p) => (
                <tr key={p.id}>
                  <td>{p.policy_type}</td>
                  <td>{p.carrier}</td>
                  <td>{p.expires_on}</td>
                  <td className="fin-num">{p.premium ? money(p.premium) : "—"}</td>
                </tr>
              ))}
              {insurance.length === 0 && <tr><td colSpan={4}>No policies registered.</td></tr>}
            </tbody>
          </table>
        </div>
        <form action={addInsurancePolicy} className="fin-inline-form" style={{ marginTop: 12 }}>
          <label className="lead-field"><span>Policy type</span><input name="policyType" required placeholder="General Liability" /></label>
          <label className="lead-field"><span>Carrier</span><input name="carrier" required /></label>
          <label className="lead-field"><span>Expires</span><input name="expiresOn" type="date" required /></label>
          <label className="lead-field"><span>Premium</span><input name="premium" type="number" step="0.01" /></label>
          <button className="lead-action" type="submit">Add</button>
        </form>
      </section>

      <section className="fin-section">
        <h2>Corporate compliance calendar</h2>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr><th>Obligation</th><th>Category</th><th>Due</th><th>Recurs</th><th></th></tr>
            </thead>
            <tbody>
              {obligations.map((o) => (
                <tr key={o.id}>
                  <td>{o.name}</td>
                  <td>{o.category}</td>
                  <td>{o.due_on}</td>
                  <td>{o.recurrence}</td>
                  <td>
                    <form action={completeObligation}>
                      <input type="hidden" name="id" value={o.id} />
                      <button className="lead-action" type="submit">Done</button>
                    </form>
                  </td>
                </tr>
              ))}
              {obligations.length === 0 && <tr><td colSpan={5}>No open obligations.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="fin-footnote">
          Completing a recurring obligation rolls the next occurrence forward
          automatically (S135).
        </p>
        <form action={addObligation} className="fin-inline-form" style={{ marginTop: 12 }}>
          <label className="lead-field"><span>Name</span><input name="name" required placeholder="Idaho annual report" /></label>
          <label className="lead-field"><span>Due</span><input name="dueOn" type="date" required /></label>
          <label className="lead-field"><span>Recurs</span>
            <select name="recurrence"><option>annual</option><option>quarterly</option><option>monthly</option><option value="one_time">one time</option></select>
          </label>
          <button className="lead-action" type="submit">Add</button>
        </form>
      </section>
    </main>
  );
}
