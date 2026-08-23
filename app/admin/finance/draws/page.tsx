/**
 * Lender draws (S77): configure the project's lender, run draws through
 * draft -> submitted -> approved -> funded, and open the generated package.
 * Submission readiness shows its blockers before anyone hits submit.
 */

import Link from "next/link";

import { checkDatabase, query } from "../../../lib/db.ts";
import {
  drawFacts,
  evaluateDrawReadiness,
  type DrawStatus,
} from "../../../lib/finance/draws.ts";
import { money } from "../queries.ts";
import { configureLender, createDraw, transitionDraw, updateDrawEvidence } from "./actions.ts";

export const dynamic = "force-dynamic";

const STATUS_CHIP: Record<DrawStatus, string> = {
  draft: "fin-chip",
  submitted: "fin-chip fin-chip-info",
  approved: "fin-chip fin-chip-warning",
  funded: "fin-chip fin-chip-green",
  rejected: "fin-chip fin-chip-critical",
};

export default async function DrawsPage() {
  const db = await checkDatabase();
  if (!db.ok) {
    return (
      <main className="admin-main">
        <h1 className="admin-h1">Lender draws</h1>
        <div className="admin-notice admin-notice-error">
          <strong>Database unavailable</strong>
          {db.detail}
        </div>
      </main>
    );
  }

  const lenderProjects = await query<{
    id: string; p5_id: string; name: string; funding_source: string;
    lender_name: string | null; loan_number: string | null;
    approved_loan_budget: string | null;
    requires_inspection: boolean | null; requires_lien_waivers: boolean | null;
    requires_invoices: boolean | null; requires_photos: boolean | null;
  }>(
    `SELECT p.id, p.p5_id, p.name, p.funding_source,
            l.lender_name, l.loan_number, l.approved_loan_budget,
            l.requires_inspection, l.requires_lien_waivers,
            l.requires_invoices, l.requires_photos
     FROM p5_project p
     LEFT JOIN project_lender l ON l.project_id = p.id
     WHERE p.funding_source IN ('Construction loan','Mixed')
        OR l.project_id IS NOT NULL
     ORDER BY p.p5_id`,
  );

  const draws = await query<{
    id: string; project_id: string; draw_number: number; status: DrawStatus;
    amount_requested: string; amount_approved: string | null; amount_funded: string | null;
    inspection_status: string; photos_ref: string | null;
    p5_id: string; name: string;
  }>(
    `SELECT d.*, p.p5_id, p.name
     FROM lender_draw d JOIN p5_project p ON p.id = d.project_id
     ORDER BY p.p5_id, d.draw_number DESC`,
  );

  // Readiness for draft/rejected draws so blockers show before submission.
  const readiness = new Map<string, { ready: boolean; blockers: string[] }>();
  for (const d of draws) {
    if (d.status !== "draft" && d.status !== "rejected") continue;
    const lender = lenderProjects.find((p) => p.id === d.project_id);
    if (!lender?.lender_name) continue;
    const facts = await drawFacts(Number(d.id));
    if (!facts) continue;
    readiness.set(
      d.id,
      evaluateDrawReadiness(
        {
          requiresInspection: lender.requires_inspection ?? true,
          requiresLienWaivers: lender.requires_lien_waivers ?? true,
          requiresInvoices: lender.requires_invoices ?? true,
          requiresPhotos: lender.requires_photos ?? false,
        },
        facts,
      ),
    );
  }

  return (
    <main className="admin-main">
      <h1 className="admin-h1">Lender draws</h1>
      <p className="admin-sub">
        Draw packages generate from live project data and freeze at submission
        (S77). A draw cannot be submitted while a lender requirement is unmet.
      </p>

      {lenderProjects.length === 0 && (
        <div className="admin-empty">
          <h2>No lender-funded projects</h2>
          <p>
            Projects with funding source &quot;Construction loan&quot; or
            &quot;Mixed&quot; appear here for lender setup.
          </p>
        </div>
      )}

      {lenderProjects.map((p) => {
        const projectDraws = draws.filter((d) => d.project_id === p.id);
        return (
          <section key={p.id} className="fin-section">
            <h2>
              {p.p5_id} · {p.name}
            </h2>

            {p.lender_name ? (
              <p className="portal-note" style={{ marginBottom: 14 }}>
                Lender: <strong>{p.lender_name}</strong>
                {p.loan_number ? ` · Loan ${p.loan_number}` : ""}
                {p.approved_loan_budget
                  ? ` · Approved budget ${money(p.approved_loan_budget)}`
                  : " · No loan budget cap configured"}
              </p>
            ) : (
              <div className="admin-notice">
                <strong>Lender not configured</strong>
                Set up the lender before creating draws.
              </div>
            )}

            <details style={{ marginBottom: 16 }}>
              <summary className="lead-action" style={{ display: "inline-flex" }}>
                {p.lender_name ? "Edit lender" : "Configure lender"}
              </summary>
              <form action={configureLender} className="fin-inline-form" style={{ marginTop: 12 }}>
                <input type="hidden" name="projectId" value={p.id} />
                <label className="lead-field"><span>Lender name</span>
                  <input name="lenderName" defaultValue={p.lender_name ?? ""} required /></label>
                <label className="lead-field"><span>Loan #</span>
                  <input name="loanNumber" defaultValue={p.loan_number ?? ""} /></label>
                <label className="lead-field"><span>Contact name</span><input name="contactName" /></label>
                <label className="lead-field"><span>Contact email</span><input name="contactEmail" type="email" /></label>
                <label className="lead-field"><span>Approved loan budget</span>
                  <input name="approvedLoanBudget" type="number" step="0.01"
                    defaultValue={p.approved_loan_budget ?? ""} /></label>
                <label className="lead-field"><span>
                  <input type="checkbox" name="requiresInspection" defaultChecked={p.requires_inspection ?? true} /> Inspection</span></label>
                <label className="lead-field"><span>
                  <input type="checkbox" name="requiresLienWaivers" defaultChecked={p.requires_lien_waivers ?? true} /> Lien waivers</span></label>
                <label className="lead-field"><span>
                  <input type="checkbox" name="requiresInvoices" defaultChecked={p.requires_invoices ?? true} /> Invoices</span></label>
                <label className="lead-field"><span>
                  <input type="checkbox" name="requiresPhotos" defaultChecked={p.requires_photos ?? false} /> Photos</span></label>
                <button className="lead-action" type="submit">Save lender</button>
              </form>
            </details>

            {p.lender_name && (
              <form action={createDraw} className="fin-inline-form" style={{ marginBottom: 16 }}>
                <input type="hidden" name="projectId" value={p.id} />
                <label className="lead-field">
                  <span>New draw amount</span>
                  <input name="amount" type="number" step="0.01" min="0.01" required />
                </label>
                <button className="lead-action lead-action-primary" type="submit">
                  Create draw #{projectDraws.length + 1}
                </button>
              </form>
            )}

            <div className="admin-cards">
              {projectDraws.map((d) => {
                const r = readiness.get(d.id);
                return (
                  <article key={d.id} className={d.status === "rejected" ? "lead-card lead-card-critical" : "lead-card"}>
                    <div className="lead-top">
                      <h3 className="lead-name">Draw #{d.draw_number} — {money(d.amount_requested)}</h3>
                      <span className={STATUS_CHIP[d.status]}>{d.status}</span>
                    </div>
                    <div className="lead-meta">
                      <div><b>Inspection</b>{d.inspection_status.replaceAll("_", " ")}</div>
                      {d.amount_approved && <div><b>Approved</b>{money(d.amount_approved)}</div>}
                      {d.amount_funded && <div><b>Funded</b>{money(d.amount_funded)}</div>}
                      <div><b>Photos</b>{d.photos_ref ? "attached" : "none"}</div>
                    </div>

                    {r && !r.ready && (
                      <p className="lead-why">
                        Not ready to submit: {r.blockers.join(" ")}
                      </p>
                    )}

                    {(d.status === "draft" || d.status === "rejected") && (
                      <form action={updateDrawEvidence} className="fin-inline-form" style={{ marginTop: 10 }}>
                        <input type="hidden" name="id" value={d.id} />
                        <label className="lead-field"><span>Inspection</span>
                          <select name="inspectionStatus" defaultValue={d.inspection_status}>
                            <option value="not_required">not required</option>
                            <option value="pending">pending</option>
                            <option value="scheduled">scheduled</option>
                            <option value="passed">passed</option>
                            <option value="failed">failed</option>
                          </select>
                        </label>
                        <label className="lead-field" style={{ flex: 1 }}><span>Photos link</span>
                          <input name="photosRef" defaultValue={d.photos_ref ?? ""} placeholder="Drive folder URL" /></label>
                        <button className="lead-action" type="submit">Save evidence</button>
                      </form>
                    )}

                    <div className="lead-actions">
                      <Link className="lead-action" href={`/admin/finance/draws/${d.id}/package`}>
                        View package
                      </Link>
                      {(d.status === "draft" || d.status === "rejected") && (
                        <>
                          {d.status === "rejected" && (
                            <form action={transitionDraw}>
                              <input type="hidden" name="id" value={d.id} />
                              <input type="hidden" name="to" value="draft" />
                              <button className="lead-action" type="submit">Rework</button>
                            </form>
                          )}
                          {d.status === "draft" && (
                            <form action={transitionDraw}>
                              <input type="hidden" name="id" value={d.id} />
                              <input type="hidden" name="to" value="submitted" />
                              <button
                                className="lead-action lead-action-primary"
                                type="submit"
                                disabled={r ? !r.ready : false}
                              >
                                Submit to lender
                              </button>
                            </form>
                          )}
                        </>
                      )}
                      {d.status === "submitted" && (
                        <form action={transitionDraw} className="fin-inline-form">
                          <input type="hidden" name="id" value={d.id} />
                          <input type="hidden" name="to" value="approved" />
                          <label className="lead-field"><span>Approved amount</span>
                            <input name="amount" type="number" step="0.01" defaultValue={d.amount_requested} /></label>
                          <button className="lead-action lead-action-primary" type="submit">Mark approved</button>
                        </form>
                      )}
                      {d.status === "approved" && (
                        <form action={transitionDraw} className="fin-inline-form">
                          <input type="hidden" name="id" value={d.id} />
                          <input type="hidden" name="to" value="funded" />
                          <label className="lead-field"><span>Funded amount</span>
                            <input name="amount" type="number" step="0.01"
                              defaultValue={d.amount_approved ?? d.amount_requested} /></label>
                          <button className="lead-action lead-action-primary" type="submit">Mark funded</button>
                        </form>
                      )}
                      {(d.status === "submitted" || d.status === "approved") && (
                        <form action={transitionDraw}>
                          <input type="hidden" name="id" value={d.id} />
                          <input type="hidden" name="to" value="rejected" />
                          <button className="lead-action" type="submit">Mark rejected</button>
                        </form>
                      )}
                    </div>
                  </article>
                );
              })}
              {projectDraws.length === 0 && p.lender_name && (
                <p className="fin-footnote">No draws yet.</p>
              )}
            </div>
          </section>
        );
      })}
    </main>
  );
}
