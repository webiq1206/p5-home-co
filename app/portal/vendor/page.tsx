/**
 * Vendor portal (S151): action required, compliance, payments, waivers,
 * projects - this vendor only, from the scoped queries. The page renders
 * nothing beyond what vendorPortalData returns.
 */

import { redirect } from "next/navigation";

import { checkDatabase } from "../../lib/db.ts";
import { getPortalContact } from "../../lib/portal/auth.ts";
import { vendorPortalData } from "../../lib/portal/queries.ts";
import { portalSignOut, vendorSubmit } from "../actions.ts";

export const dynamic = "force-dynamic";

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default async function VendorPortalPage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string }>;
}) {
  const db = await checkDatabase();
  if (!db.ok) redirect("/portal");
  const contact = await getPortalContact();
  if (!contact || contact.kind !== "vendor" || contact.vendorId === null) {
    redirect("/portal");
  }
  const data = await vendorPortalData(contact.vendorId);
  if (!data) redirect("/portal");
  const params = await searchParams;

  return (
    <>
      <header className="portal-bar">
        <div className="admin-brand">
          {data.displayName} <small>Vendor portal</small>
        </div>
        <form action={portalSignOut}>
          <button type="submit">Sign out</button>
        </form>
      </header>
      <main className="admin-main">
        {params.submitted && (
          <p className="lead-ok">Received - the P5 team will review it.</p>
        )}

        <h1 className="admin-h1">Action required</h1>
        {data.actionRequired.length === 0 ? (
          <p className="portal-note">Nothing needed from you right now.</p>
        ) : (
          <div className="admin-cards" style={{ marginBottom: 28 }}>
            {data.actionRequired.map((a, i) => (
              <div key={i} className="lead-card lead-card-warn">
                <p className="lead-why">{a}</p>
              </div>
            ))}
          </div>
        )}

        <section className="fin-section">
          <h2>Compliance</h2>
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead>
                <tr><th>Document</th><th>Status</th><th>Expires</th></tr>
              </thead>
              <tbody>
                {data.docs.map((d) => (
                  <tr key={d.docType}>
                    <td>{d.docType}</td>
                    <td>
                      <span className={`fin-chip ${d.status === "verified" ? "fin-chip-green" : d.status === "expired" ? "fin-chip-critical" : "fin-chip-warning"}`}>
                        {d.status}
                      </span>
                    </td>
                    <td>{d.expiresOn ?? "—"}</td>
                  </tr>
                ))}
                {data.docs.length === 0 && (
                  <tr><td colSpan={3}>No documents requested yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="fin-section">
          <h2>Payments</h2>
          {data.paymentHold && (
            <p className="lead-why lead-why-critical">
              Payments are currently on hold. See Action Required above, or
              contact the P5 office.
            </p>
          )}
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead>
                <tr><th>Invoice</th><th>Received</th><th>Due</th><th className="fin-num">Amount</th><th>Status</th></tr>
              </thead>
              <tbody>
                {data.payments.map((p, i) => (
                  <tr key={i}>
                    <td>{p.reference}</td>
                    <td>{p.received ?? "—"}</td>
                    <td>{p.due ?? "—"}</td>
                    <td className="fin-num">{money(p.amount)}</td>
                    <td>
                      <span className={`fin-chip ${p.status === "paid" ? "fin-chip-green" : p.status === "on hold" ? "fin-chip-critical" : "fin-chip-info"}`}>
                        {p.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {data.payments.length === 0 && (
                  <tr><td colSpan={5}>No invoices on record yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {data.waivers.length > 0 && (
          <section className="fin-section">
            <h2>Lien waivers</h2>
            <div className="fin-table-wrap">
              <table className="fin-table">
                <thead>
                  <tr><th>Type</th><th>Project</th><th className="fin-num">Amount</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {data.waivers.map((w) => (
                    <tr key={w.id}>
                      <td>{w.type}</td>
                      <td>{w.project}</td>
                      <td className="fin-num">{w.amount === null ? "—" : money(w.amount)}</td>
                      <td><span className="fin-chip">{w.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="fin-footnote">
              Signed waivers go back on P5&apos;s waiver forms. Use the message
              box below to confirm one is on its way.
            </p>
          </section>
        )}

        {data.projects.length > 0 && (
          <section className="fin-section">
            <h2>Your projects</h2>
            <div className="lead-tags">
              {data.projects.map((p) => (
                <span key={p} className="lead-tag lead-tag-brand">{p}</span>
              ))}
            </div>
          </section>
        )}

        <section className="fin-section">
          <h2>Send P5 a note</h2>
          <p className="portal-note">
            Email invoices as PDF to the P5 billing address you were given.
            Record the invoice number here so it is tracked from day one.
          </p>
          <form action={vendorSubmit} className="lead-form" style={{ maxWidth: 560 }}>
            <label className="lead-field">
              <span>Type</span>
              <select name="kind">
                <option value="invoice_reference">Invoice submitted</option>
                <option value="waiver_confirmation">Waiver sent</option>
                <option value="message">Question / message</option>
              </select>
            </label>
            <label className="lead-field">
              <span>Reference <small>(invoice or waiver number, optional)</small></span>
              <input name="reference" />
            </label>
            <label className="lead-field">
              <span>Message</span>
              <textarea name="body" required />
            </label>
            <button className="lead-action lead-action-primary" type="submit">Send</button>
          </form>
        </section>
      </main>
    </>
  );
}
