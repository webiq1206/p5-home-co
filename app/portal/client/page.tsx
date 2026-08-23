/**
 * Client portal (S152): the customer's own project, revenue side only.
 * Renders exclusively from clientPortalData - the projection layer guarantees
 * no internal cost, vendor pricing, margin or forecast can appear.
 */

import { redirect } from "next/navigation";

import { checkDatabase } from "../../lib/db.ts";
import { getPortalContact } from "../../lib/portal/auth.ts";
import { clientPortalData } from "../../lib/portal/queries.ts";
import { portalSignOut } from "../actions.ts";

export const dynamic = "force-dynamic";

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default async function ClientPortalPage() {
  const db = await checkDatabase();
  if (!db.ok) redirect("/portal");
  const contact = await getPortalContact();
  if (!contact || contact.kind !== "client" || contact.projectId === null) {
    redirect("/portal");
  }
  const data = await clientPortalData(contact.projectId);
  if (!data) redirect("/portal");
  const p = data.project;

  return (
    <>
      <header className="portal-bar">
        <div className="admin-brand">
          P5 Home Co <small>Client portal</small>
        </div>
        <form action={portalSignOut}>
          <button type="submit">Sign out</button>
        </form>
      </header>
      <main className="admin-main">
        <h1 className="admin-h1">{p.name}</h1>
        <p className="admin-sub">
          {p.p5Id} · {p.status}
        </p>

        <div className="fin-hero">
          <div className="admin-stat">
            <b>{money(p.revisedContract)}</b>
            <span>Contract incl. changes</span>
          </div>
          <div className="admin-stat">
            <b>{money(p.invoicedToDate)}</b>
            <span>Invoiced to date</span>
          </div>
          <div className="admin-stat">
            <b>{money(p.paidToDate)}</b>
            <span>Paid to date</span>
          </div>
          <div className={p.outstandingBalance > 0 ? "admin-stat admin-stat-alarm" : "admin-stat"}>
            <b>{money(p.outstandingBalance)}</b>
            <span>Balance due</span>
          </div>
        </div>

        <section className="fin-section">
          <h2>Contract</h2>
          <div className="fin-table-wrap">
            <table className="fin-table">
              <tbody>
                <tr><td>Original contract</td><td className="fin-num">{money(p.contractAmount)}</td></tr>
                <tr><td>Approved change orders</td><td className="fin-num">{money(p.approvedChangeOrders)}</td></tr>
                <tr><td><strong>Revised contract</strong></td><td className="fin-num"><strong>{money(p.revisedContract)}</strong></td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="fin-section">
          <h2>Invoices</h2>
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead>
                <tr><th>Invoice</th><th>Date</th><th>Due</th><th className="fin-num">Amount</th><th className="fin-num">Balance</th><th>Status</th></tr>
              </thead>
              <tbody>
                {data.invoices.map((inv, i) => (
                  <tr key={i}>
                    <td>{inv.number}</td>
                    <td>{inv.date ?? "—"}</td>
                    <td>{inv.due ?? "—"}</td>
                    <td className="fin-num">{money(inv.amount)}</td>
                    <td className="fin-num">{money(inv.openBalance)}</td>
                    <td>
                      <span className={`fin-chip ${inv.status === "paid" ? "fin-chip-green" : inv.status === "open" ? "fin-chip-warning" : "fin-chip-info"}`}>
                        {inv.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {data.invoices.length === 0 && (
                  <tr><td colSpan={6}>No invoices yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="fin-footnote">
            Payment links arrive with each emailed invoice. Questions? Reply to
            any invoice email and the P5 team will pick it up.
          </p>
        </section>
      </main>
    </>
  );
}
