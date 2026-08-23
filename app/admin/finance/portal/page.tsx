/**
 * Portal administration (S151/S152): invite vendor and client contacts,
 * see who can sign in, review vendor submissions.
 */

import { checkDatabase, query } from "../../../lib/db.ts";
import { invitePortalContact, reviewSubmission, setContactActive } from "./actions.ts";

export const dynamic = "force-dynamic";

export default async function PortalAdminPage() {
  const db = await checkDatabase();
  if (!db.ok) {
    return (
      <main className="admin-main">
        <h1 className="admin-h1">Portal access</h1>
        <div className="admin-notice admin-notice-error">
          <strong>Database unavailable</strong>
          {db.detail}
        </div>
      </main>
    );
  }

  const contacts = await query<{
    id: string; kind: string; email: string; full_name: string; is_active: boolean;
    last_login_at: Date | null; vendor_name: string | null; project_name: string | null;
  }>(
    `SELECT c.id, c.kind, c.email, c.full_name, c.is_active, c.last_login_at,
            v.display_name AS vendor_name,
            p.p5_id || ' · ' || p.name AS project_name
     FROM portal_contact c
     LEFT JOIN vendor_profile v ON v.id = c.vendor_id
     LEFT JOIN p5_project p ON p.id = c.project_id
     ORDER BY c.created_at DESC`,
  );
  const vendors = await query<{ id: string; display_name: string }>(
    `SELECT id, display_name FROM vendor_profile WHERE active ORDER BY display_name`,
  );
  const projects = await query<{ id: string; label: string }>(
    `SELECT id, p5_id || ' · ' || name AS label FROM p5_project
     WHERE status NOT IN ('Closed','Cancelled') ORDER BY p5_id`,
  );
  const submissions = await query<{
    id: string; kind: string; reference: string | null; body: string;
    created_at: Date; contact_name: string; scope: string | null;
  }>(
    `SELECT s.id, s.kind, s.reference, s.body, s.created_at,
            c.full_name AS contact_name, v.display_name AS scope
     FROM portal_submission s
     JOIN portal_contact c ON c.id = s.contact_id
     LEFT JOIN vendor_profile v ON v.id = c.vendor_id
     WHERE s.reviewed_at IS NULL
     ORDER BY s.created_at`,
  );

  return (
    <main className="admin-main">
      <h1 className="admin-h1">Portal access</h1>
      <p className="admin-sub">
        Vendors see only their own compliance and payments; clients see only
        their own project&apos;s revenue side (S151/S152).
      </p>

      {submissions.length > 0 && (
        <section className="fin-section">
          <h2>Vendor submissions to review</h2>
          <div className="admin-cards">
            {submissions.map((s) => (
              <article key={s.id} className="lead-card lead-card-warn">
                <div className="lead-top">
                  <h3 className="lead-name">
                    {s.scope ?? s.contact_name}: {s.kind.replaceAll("_", " ")}
                    {s.reference ? ` — ${s.reference}` : ""}
                  </h3>
                  <span className="lead-age">{new Date(s.created_at).toLocaleString()}</span>
                </div>
                <p className="lead-why">{s.body}</p>
                <form action={reviewSubmission} className="fin-inline-form" style={{ marginTop: 10 }}>
                  <input type="hidden" name="id" value={s.id} />
                  <button className="lead-action" type="submit">Mark reviewed</button>
                </form>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="fin-section">
        <h2>Invite a contact</h2>
        <form action={invitePortalContact} className="fin-inline-form">
          <label className="lead-field">
            <span>Kind</span>
            <select name="kind" required>
              <option value="vendor">Vendor</option>
              <option value="client">Client</option>
            </select>
          </label>
          <label className="lead-field">
            <span>Vendor <small>(vendor invites)</small></span>
            <select name="vendorId">
              <option value="">—</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.display_name}</option>
              ))}
            </select>
          </label>
          <label className="lead-field">
            <span>Project <small>(client invites)</small></span>
            <select name="projectId">
              <option value="">—</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </label>
          <label className="lead-field">
            <span>Name</span>
            <input name="fullName" required />
          </label>
          <label className="lead-field">
            <span>Email</span>
            <input name="email" type="email" required />
          </label>
          <button className="lead-action lead-action-primary" type="submit">
            Invite &amp; send link
          </button>
        </form>
      </section>

      <section className="fin-section">
        <h2>Contacts</h2>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr><th>Kind</th><th>Scope</th><th>Name</th><th>Email</th><th>Last sign-in</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id}>
                  <td>{c.kind}</td>
                  <td>{c.vendor_name ?? c.project_name ?? "—"}</td>
                  <td>{c.full_name}</td>
                  <td>{c.email}</td>
                  <td>{c.last_login_at ? new Date(c.last_login_at).toLocaleString() : "never"}</td>
                  <td>
                    <span className={c.is_active ? "fin-chip fin-chip-green" : "fin-chip"}>
                      {c.is_active ? "active" : "disabled"}
                    </span>
                  </td>
                  <td>
                    <form action={setContactActive}>
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="active" value={c.is_active ? "false" : "true"} />
                      <button className="lead-action" type="submit">
                        {c.is_active ? "Disable" : "Enable"}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
              {contacts.length === 0 && (
                <tr><td colSpan={7}>No portal contacts yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
