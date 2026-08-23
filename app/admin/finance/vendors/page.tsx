/**
 * Vendor compliance board (S81-S89): status, documents, holds with reasons.
 */

import { checkDatabase } from "../../../lib/db.ts";
import {
  createVendorInQuickBooks,
  setVendorDocument,
  setVendorHold,
} from "../actions.ts";
import { money, vendorBoard } from "../queries.ts";

export const dynamic = "force-dynamic";

const DOC_TYPES = [
  "W-9",
  "General Liability",
  "Workers Comp",
  "Commercial Auto",
  "Master Subcontractor Agreement",
  "Idaho Registration",
  "Trade License",
];

const DOC_STATUSES = ["missing", "requested", "received", "verified", "expired", "waived"];

export default async function VendorsPage() {
  const db = await checkDatabase();
  if (!db.ok) {
    return (
      <main className="admin-main">
        <h1 className="admin-h1">Vendors</h1>
        <div className="admin-notice admin-notice-error">
          <strong>Database unavailable</strong>
          {db.detail}
        </div>
      </main>
    );
  }

  const vendors = await vendorBoard();

  return (
    <main className="admin-main">
      <h1 className="admin-h1">Vendors &amp; compliance</h1>
      <p className="admin-sub">
        No vendor payment without applicable compliance (S212-20). Holds always
        carry their reason (S105).
      </p>

      {vendors.length === 0 ? (
        <div className="admin-empty">
          <h2>No vendors yet</h2>
          <p>Vendors appear automatically after a QuickBooks sync.</p>
        </div>
      ) : (
        <div className="admin-cards">
          {vendors.map((v) => (
            <article
              key={v.id}
              className={
                v.paymentHold || v.complianceStatus === "Payment Hold"
                  ? "lead-card lead-card-critical"
                  : v.complianceStatus === "Compliant"
                    ? "lead-card"
                    : "lead-card lead-card-warn"
              }
            >
              <div className="lead-top">
                <h3 className="lead-name">{v.displayName}</h3>
                <span
                  className={`fin-chip ${
                    v.complianceStatus === "Compliant"
                      ? "fin-chip-green"
                      : v.complianceStatus === "Payment Hold"
                        ? "fin-chip-critical"
                        : "fin-chip-warning"
                  }`}
                >
                  {v.complianceStatus}
                </span>
              </div>
              <div className="lead-tags">
                <span className="lead-tag">{v.vendorType}</span>
                {v.openBalance > 0 && (
                  <span className="lead-tag">Open balance {money(v.openBalance)}</span>
                )}
                {v.paymentHold && (
                  <span className="fin-chip fin-chip-critical">MANUAL HOLD</span>
                )}
                {!v.inQuickBooks && (
                  <span className="fin-chip fin-chip-warning">NOT IN QUICKBOOKS</span>
                )}
              </div>
              {!v.inQuickBooks && (
                /* A vendor who exists only in P5 cannot be paid, because there
                   is nothing in the books to bill against. Creating them is
                   idempotent - a second click returns the same record. */
                <form action={createVendorInQuickBooks} style={{ marginTop: 10 }}>
                  <input type="hidden" name="vendorId" value={v.id} />
                  <button className="lead-action" type="submit">
                    Create in QuickBooks
                  </button>
                </form>
              )}
              {v.paymentHold && v.paymentHoldReason && (
                <p className="lead-why lead-why-critical">Hold reason: {v.paymentHoldReason}</p>
              )}

              {v.docs.length > 0 && (
                <div className="lead-meta lead-meta-wide">
                  {v.docs.map((d) => (
                    <div key={d.docType}>
                      <b>{d.docType}</b>
                      {d.status}
                      {d.expiresOn ? ` · exp ${d.expiresOn}` : ""}
                    </div>
                  ))}
                </div>
              )}

              <details style={{ marginTop: 12 }}>
                <summary className="lead-action" style={{ display: "inline-flex" }}>
                  Update
                </summary>
                <form action={setVendorDocument} className="fin-inline-form" style={{ marginTop: 12 }}>
                  <input type="hidden" name="vendorId" value={v.id} />
                  <label className="lead-field">
                    <span>Document</span>
                    <select name="docType" required>
                      {DOC_TYPES.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                  <label className="lead-field">
                    <span>Status</span>
                    <select name="status" required>
                      {DOC_STATUSES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                  <label className="lead-field">
                    <span>Expires</span>
                    <input type="date" name="expiresOn" />
                  </label>
                  <button className="lead-action" type="submit">Save document</button>
                </form>
                <form action={setVendorHold} className="fin-inline-form" style={{ marginTop: 12 }}>
                  <input type="hidden" name="vendorId" value={v.id} />
                  <input type="hidden" name="hold" value={v.paymentHold ? "false" : "true"} />
                  <label className="lead-field" style={{ flex: 1 }}>
                    <span>{v.paymentHold ? "Release reason" : "Hold reason"}</span>
                    <input name="reason" required placeholder="Required - goes to the audit log" />
                  </label>
                  <button className="lead-action" type="submit">
                    {v.paymentHold ? "Release hold" : "Set payment hold"}
                  </button>
                </form>
              </details>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
