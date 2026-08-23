/**
 * The lender draw package (S77): pay application summary, schedule of values
 * evidence, vendor schedule, lien waiver register, draw history. Print-ready -
 * the browser's print-to-PDF is the delivery format.
 *
 * Submitted draws render their FROZEN package snapshot; drafts render live
 * data marked as a preview, so what the lender received is always exactly
 * what was frozen at submission.
 */

import { notFound } from "next/navigation";

import { checkDatabase, queryOne } from "../../../../../lib/db.ts";
import {
  assembleDrawPackage,
  type DrawPackage,
} from "../../../../../lib/finance/draws.ts";
import { money } from "../../../queries.ts";

export const dynamic = "force-dynamic";

export default async function DrawPackagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const db = await checkDatabase();
  if (!db.ok) notFound();
  const { id } = await params;
  const drawId = Number(id);
  if (!drawId) notFound();

  const row = await queryOne<{ status: string; package: DrawPackage | null }>(
    `SELECT status, package FROM lender_draw WHERE id = $1`,
    [drawId],
  );
  if (!row) notFound();

  const frozen = row.package !== null;
  const pkg = frozen ? row.package! : await assembleDrawPackage(drawId);
  if (!pkg) notFound();
  const f = pkg.financial;

  return (
    <main className="admin-main" style={{ maxWidth: 900 }}>
      <style>{`@media print { .fin-nav, .admin-bar, .no-print { display: none !important; } }`}</style>

      {!frozen && (
        <div className="admin-notice no-print">
          <strong>Preview</strong>
          This draw has not been submitted; figures are live and will freeze at
          submission.
        </div>
      )}

      <h1 className="admin-h1">Construction Draw Request #{pkg.draw.number}</h1>
      <p className="admin-sub">
        {pkg.project.p5Id} · {pkg.project.name}
        {pkg.project.address ? ` · ${pkg.project.address}` : ""}
      </p>

      <section className="fin-section">
        <h2>Request</h2>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <tbody>
              <tr><td>Requested amount</td><td className="fin-num"><strong>{money(pkg.draw.amountRequested)}</strong></td></tr>
              <tr><td>Lender</td><td className="fin-num">{pkg.lender.name}{pkg.lender.loanNumber ? ` · Loan ${pkg.lender.loanNumber}` : ""}</td></tr>
              {pkg.lender.contact && <tr><td>Lender contact</td><td className="fin-num">{pkg.lender.contact}</td></tr>}
              <tr><td>Inspection</td><td className="fin-num">{pkg.draw.inspectionStatus.replaceAll("_", " ")}</td></tr>
              {pkg.draw.photosRef && <tr><td>Progress photos</td><td className="fin-num">{pkg.draw.photosRef}</td></tr>}
              <tr><td>Package generated</td><td className="fin-num">{new Date(pkg.generatedAt).toLocaleString()}</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="fin-section">
        <h2>Contract &amp; financial summary</h2>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <tbody>
              <tr><td>Original contract</td><td className="fin-num">{money(pkg.project.contractAmount)}</td></tr>
              <tr><td>Approved change orders</td><td className="fin-num">{money(pkg.project.approvedChangeOrders)}</td></tr>
              <tr><td>Revised contract</td><td className="fin-num"><strong>{money(pkg.project.revisedContract)}</strong></td></tr>
              <tr><td>Invoiced to date</td><td className="fin-num">{money(f.invoicedToDate)}</td></tr>
              <tr><td>Collected to date</td><td className="fin-num">{money(f.collectedToDate)}</td></tr>
              <tr><td>Direct cost billed to date</td><td className="fin-num">{money(f.billedCostToDate)}</td></tr>
              <tr><td>Open commitments</td><td className="fin-num">{money(f.openCommitments)}</td></tr>
              <tr><td>Prior draws funded</td><td className="fin-num">{money(f.priorDrawsFunded)}</td></tr>
              {f.remainingLoanBudget !== null && (
                <tr><td>Remaining loan budget</td><td className="fin-num"><strong>{money(f.remainingLoanBudget)}</strong></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="fin-section">
        <h2>Invoices / pay applications</h2>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead><tr><th>Invoice</th><th>Date</th><th className="fin-num">Amount</th><th className="fin-num">Open</th></tr></thead>
            <tbody>
              {pkg.invoices.map((inv, i) => (
                <tr key={i}>
                  <td>{inv.number}</td><td>{inv.date ?? "—"}</td>
                  <td className="fin-num">{money(inv.amount)}</td>
                  <td className="fin-num">{money(inv.open)}</td>
                </tr>
              ))}
              {pkg.invoices.length === 0 && <tr><td colSpan={4}>None on record.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="fin-section">
        <h2>Vendor schedule</h2>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead><tr><th>Vendor</th><th className="fin-num">Billed</th><th className="fin-num">Open commitments</th></tr></thead>
            <tbody>
              {pkg.vendors.map((v, i) => (
                <tr key={i}>
                  <td>{v.name}</td>
                  <td className="fin-num">{money(v.billed)}</td>
                  <td className="fin-num">{money(v.committed)}</td>
                </tr>
              ))}
              {pkg.vendors.length === 0 && <tr><td colSpan={3}>None on record.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="fin-section">
        <h2>Lien waiver register</h2>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead><tr><th>Vendor</th><th>Waiver</th><th>Through</th><th>Status</th></tr></thead>
            <tbody>
              {pkg.lienWaivers.map((w, i) => (
                <tr key={i}>
                  <td>{w.vendor}</td><td>{w.type}</td><td>{w.throughDate ?? "—"}</td><td>{w.status}</td>
                </tr>
              ))}
              {pkg.lienWaivers.length === 0 && <tr><td colSpan={4}>None on record.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="fin-section">
        <h2>Draw history</h2>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead><tr><th>#</th><th>Status</th><th className="fin-num">Requested</th><th className="fin-num">Funded</th><th>Funded on</th></tr></thead>
            <tbody>
              {pkg.priorDraws.map((d) => (
                <tr key={d.number}>
                  <td>{d.number}</td><td>{d.status}</td>
                  <td className="fin-num">{money(d.requested)}</td>
                  <td className="fin-num">{d.funded === null ? "—" : money(d.funded)}</td>
                  <td>{d.fundedAt ?? "—"}</td>
                </tr>
              ))}
              {pkg.priorDraws.length === 0 && <tr><td colSpan={5}>First draw on this loan.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="fin-footnote">
          Prepared by P5 Home Co. LLC from QuickBooks records and the P5 project
          registry. Use the browser&apos;s Print to save as PDF.
        </p>
      </section>
    </main>
  );
}
