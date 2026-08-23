/**
 * Subcontracts (S91-S98): the commitment a vendor's invoices draw against.
 *
 * Without this record, "is this invoice within scope?" has no answer, which is
 * how scope creep gets paid for. The original amount and approved changes stay
 * separate so the original commitment is never quietly rewritten.
 */

import { checkDatabase, query } from "../../../lib/db.ts";
import { addSubcontract } from "../actions.ts";
import { subcontractBoard } from "../modules.ts";
import { money } from "../queries.ts";

export const dynamic = "force-dynamic";

export default async function SubcontractsPage() {
  const db = await checkDatabase();
  if (!db.ok) {
    return (
      <main className="admin-main">
        <h1 className="admin-h1">Subcontracts</h1>
        <div className="admin-notice admin-notice-error">
          <strong>Database unavailable</strong>
          {db.detail}
        </div>
      </main>
    );
  }

  const [subcontracts, projects, vendors] = await Promise.all([
    subcontractBoard(),
    query<{ id: string; p5_id: string; name: string }>(
      `SELECT id, p5_id, name FROM p5_project
        -- Capitalised to match the CHECK constraint on p5_project. Lowercase
        -- matched nothing, so finished jobs stayed selectable here.
        WHERE status NOT IN ('Closed','Cancelled') ORDER BY p5_id`,
    ),
    query<{ id: string; display_name: string }>(
      `SELECT id, display_name FROM vendor_profile WHERE active ORDER BY display_name`,
    ),
  ]);

  const committed = subcontracts.reduce((s, c) => s + c.revisedAmount, 0);

  return (
    <main className="admin-main">
      <h1 className="admin-h1">Subcontracts</h1>
      <p className="admin-sub">
        What each trade is contracted to do, for how much. Vendor invoices are checked
        against this.
      </p>

      <div className="fin-hero">
        <div className="admin-stat">
          <span>Active subcontracts</span>
          <b>{subcontracts.filter((s) => !["closed", "terminated"].includes(s.status)).length}</b>
        </div>
        <div className="admin-stat">
          <span>Total committed</span>
          <b>{money(committed)}</b>
        </div>
      </div>

      <section className="fin-section">
        <h2>Subcontracts</h2>
        {subcontracts.length === 0 ? (
          <div className="admin-empty">
            <h2>No subcontracts yet</h2>
            <p>Add one below once a trade package is awarded.</p>
          </div>
        ) : (
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>Project</th><th>Vendor</th><th>Ref</th><th>Scope</th>
                  <th>Original</th><th>Changes</th><th>Revised</th>
                  <th>Retainage</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {subcontracts.map((s) => (
                  <tr key={s.id}>
                    <td>{s.projectLabel}</td>
                    <td>
                      {s.vendorName}
                      {s.vendorOnHold && (
                        <span className="fin-chip fin-chip-critical" style={{ marginLeft: 6 }}>
                          HOLD
                        </span>
                      )}
                    </td>
                    <td>{s.reference}</td>
                    <td>{s.scope}</td>
                    <td>{money(s.originalAmount)}</td>
                    <td>{s.approvedChanges ? money(s.approvedChanges) : "—"}</td>
                    <td><strong>{money(s.revisedAmount)}</strong></td>
                    <td>{s.retainagePct ? `${s.retainagePct}%` : "—"}</td>
                    <td><span className="fin-chip">{s.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="fin-section">
        <h2>Add a subcontract</h2>
        {projects.length === 0 || vendors.length === 0 ? (
          <p className="fin-footnote">
            A subcontract needs both an active project and an active vendor. Add those
            first.
          </p>
        ) : (
          <form action={addSubcontract} className="fin-inline-form">
            <label className="lead-field">
              <span>Project</span>
              <select name="projectId" required>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.p5_id} · {p.name}</option>
                ))}
              </select>
            </label>
            <label className="lead-field">
              <span>Vendor</span>
              <select name="vendorId" required>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>{v.display_name}</option>
                ))}
              </select>
            </label>
            <label className="lead-field">
              <span>Reference</span>
              <input name="reference" required placeholder="SC-01" />
            </label>
            <label className="lead-field">
              <span>Scope</span>
              <input name="scope" required placeholder="Plumbing rough-in and trim" />
            </label>
            <label className="lead-field">
              <span>Amount</span>
              <input name="originalAmount" type="number" step="0.01" min="0" required />
            </label>
            <label className="lead-field">
              <span>Retainage %</span>
              <input name="retainagePct" type="number" step="0.01" min="0" max="100" defaultValue="0" />
            </label>
            <button className="lead-action" type="submit">Add subcontract</button>
          </form>
        )}
      </section>
    </main>
  );
}
