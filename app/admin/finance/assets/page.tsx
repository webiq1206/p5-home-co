/**
 * Assets, Vehicles & Debt (S131-S138).
 *
 * The error this page exists to prevent: a financed asset booked wholly as an
 * expense. That overstates cost, understates the balance sheet, and never
 * reduces the liability. Assets and the debt secured on them are shown
 * together so the pairing is visible.
 */

import { checkDatabase } from "../../../lib/db.ts";
import { addDebtInstrument, addFixedAsset } from "../actions.ts";
import { assetBoard, debtBoard } from "../modules.ts";
import { money } from "../queries.ts";

export const dynamic = "force-dynamic";

const CATEGORIES = ["vehicle", "equipment", "tool", "computer", "furniture", "other"];
const DEBT_KINDS = [
  "loan",
  "line_of_credit",
  "equipment_finance",
  "vehicle_finance",
  "card",
  "other",
];

export default async function AssetsPage() {
  const db = await checkDatabase();
  if (!db.ok) {
    return (
      <main className="admin-main">
        <h1 className="admin-h1">Assets, Vehicles &amp; Debt</h1>
        <div className="admin-notice admin-notice-error">
          <strong>Database unavailable</strong>
          {db.detail}
        </div>
      </main>
    );
  }

  const [{ assets, totalCost, expiringRegistrations }, { debts, totalBalance }] =
    await Promise.all([assetBoard(), debtBoard()]);

  const expiring = assets.filter(
    (a) => a.registrationDays !== null && a.registrationDays <= 45,
  );

  return (
    <main className="admin-main">
      <h1 className="admin-h1">Assets, Vehicles &amp; Debt</h1>
      <p className="admin-sub">
        What P5 owns, and what is owed against it. A financed asset is never wholly an
        expense.
      </p>

      <div className="fin-hero">
        <div className="admin-stat">
          <span>Assets at cost</span>
          <b>{money(totalCost)}</b>
        </div>
        <div className="admin-stat">
          <span>Debt outstanding</span>
          <b>{money(totalBalance)}</b>
        </div>
        <div className={`admin-stat ${expiringRegistrations > 0 ? "fin-negative" : ""}`}>
          <span>Registrations due</span>
          <b>{expiringRegistrations}</b>
        </div>
      </div>

      {expiring.length > 0 && (
        <div className="admin-notice admin-notice-error">
          <strong>
            {expiring.length} vehicle registration{expiring.length === 1 ? "" : "s"} due within
            45 days
          </strong>
          {expiring
            .map((a) =>
              `${a.name}${a.plate ? ` (${a.plate})` : ""} — ${
                (a.registrationDays ?? 0) < 0
                  ? `expired ${Math.abs(a.registrationDays ?? 0)} days ago`
                  : `${a.registrationDays} days`
              }`,
            )
            .join("; ")}
        </div>
      )}

      <section className="fin-section">
        <h2>Assets</h2>
        {assets.length === 0 ? (
          <div className="admin-empty">
            <h2>No assets recorded</h2>
            <p>Add vehicles, equipment and computers so registration and depreciation are tracked.</p>
          </div>
        ) : (
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>Asset</th><th>Category</th><th>Cost</th><th>Acquired</th>
                  <th>Plate</th><th>Registration</th><th>Depreciation</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => (
                  <tr key={a.id}>
                    <td>{a.name}</td>
                    <td>{a.category}</td>
                    <td>{money(a.cost)}</td>
                    <td>{a.acquiredOn ?? "—"}</td>
                    <td>{a.plate ?? "—"}</td>
                    <td className={a.registrationDays !== null && a.registrationDays <= 45 ? "fin-negative" : ""}>
                      {a.registrationExpires ?? "—"}
                    </td>
                    <td>{a.depreciationMethod ?? "CPA to set"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form action={addFixedAsset} className="fin-inline-form" style={{ marginTop: 12 }}>
          <label className="lead-field">
            <span>Name</span>
            <input name="name" required placeholder="2022 F-250" />
          </label>
          <label className="lead-field">
            <span>Category</span>
            <select name="category">
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="lead-field">
            <span>Cost</span>
            <input name="cost" type="number" step="0.01" min="0" defaultValue="0" />
          </label>
          <label className="lead-field">
            <span>Acquired</span>
            <input name="acquiredOn" type="date" />
          </label>
          <label className="lead-field">
            <span>Plate</span>
            <input name="plate" placeholder="Vehicles only" />
          </label>
          <label className="lead-field">
            <span>Registration expires</span>
            <input name="registrationExpires" type="date" />
          </label>
          <button className="lead-action" type="submit">Add asset</button>
        </form>
      </section>

      <section className="fin-section">
        <h2>Debt</h2>
        {debts.length === 0 ? (
          <div className="admin-empty">
            <h2>No debt recorded</h2>
            <p>Record loans and finance agreements so principal and interest can be split correctly.</p>
          </div>
        ) : (
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>Lender</th><th>Type</th><th>Balance</th><th>Rate</th>
                  <th>Payment</th><th>Next due</th><th>Secured by</th>
                </tr>
              </thead>
              <tbody>
                {debts.map((d) => (
                  <tr key={d.id}>
                    <td>{d.lender}</td>
                    <td>{d.kind.replace(/_/g, " ")}</td>
                    <td>{money(d.currentBalance)}</td>
                    <td>{d.interestRate !== null ? `${d.interestRate}%` : "—"}</td>
                    <td>{d.scheduledPayment !== null ? money(d.scheduledPayment) : "—"}</td>
                    <td>{d.nextPaymentOn ?? "—"}</td>
                    <td>{d.securedBy ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form action={addDebtInstrument} className="fin-inline-form" style={{ marginTop: 12 }}>
          <label className="lead-field">
            <span>Lender</span>
            <input name="lender" required />
          </label>
          <label className="lead-field">
            <span>Type</span>
            <select name="kind">
              {DEBT_KINDS.map((k) => <option key={k} value={k}>{k.replace(/_/g, " ")}</option>)}
            </select>
          </label>
          <label className="lead-field">
            <span>Balance</span>
            <input name="currentBalance" type="number" step="0.01" min="0" defaultValue="0" />
          </label>
          <label className="lead-field">
            <span>Rate %</span>
            <input name="interestRate" type="number" step="0.001" min="0" />
          </label>
          <label className="lead-field">
            <span>Payment</span>
            <input name="scheduledPayment" type="number" step="0.01" min="0" />
          </label>
          <label className="lead-field">
            <span>Next due</span>
            <input name="nextPaymentOn" type="date" />
          </label>
          <button className="lead-action" type="submit">Add debt</button>
        </form>
        <p className="fin-footnote">
          Splitting each payment between principal and interest is a posting decision in
          QuickBooks; recording the instrument here is what makes that split checkable.
        </p>
      </section>
    </main>
  );
}
