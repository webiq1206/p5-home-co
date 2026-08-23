/**
 * Client Funding (S55, S56): whether each project is paying for itself.
 *
 * The governing rule is that P5 should not finance a client's project with
 * unrestricted company cash. Red means it currently is.
 */

import { checkDatabase } from "../../../lib/db.ts";
import { fundingBoard } from "../modules.ts";
import { money } from "../queries.ts";

export const dynamic = "force-dynamic";

export default async function FundingPage() {
  const db = await checkDatabase();
  if (!db.ok) {
    return (
      <main className="admin-main">
        <h1 className="admin-h1">Client Funding</h1>
        <div className="admin-notice admin-notice-error">
          <strong>Database unavailable</strong>
          {db.detail}
        </div>
      </main>
    );
  }

  const projects = await fundingBoard();
  const red = projects.filter((p) => p.status === "red");
  const totalDraw = projects.reduce((sum, p) => sum + p.recommendedDraw, 0);

  return (
    <main className="admin-main">
      <h1 className="admin-h1">Client Funding</h1>
      <p className="admin-sub">
        Whether each project is funded by its own client. P5 should not be financing a
        project with company cash.
      </p>

      <div className="fin-hero">
        <div className={`admin-stat ${red.length ? "fin-negative" : ""}`}>
          <span>Underfunded</span>
          <b>{red.length}</b>
        </div>
        <div className="admin-stat">
          <span>Recommended draws</span>
          <b>{money(totalDraw)}</b>
        </div>
        <div className="admin-stat">
          <span>Active projects</span>
          <b>{projects.length}</b>
        </div>
      </div>

      {red.length > 0 && (
        <div className="admin-notice admin-notice-error">
          <strong>{red.length} project{red.length === 1 ? "" : "s"} need client funding</strong>
          Company cash is currently carrying work that the client has not yet paid for.
        </div>
      )}

      <section className="fin-section">
        {projects.length === 0 ? (
          <div className="admin-empty">
            <h2>No active projects</h2>
            <p>Funding status appears here once projects exist and are linked to QuickBooks.</p>
          </div>
        ) : (
          projects.map((p) => (
            <article
              key={p.id}
              className={
                p.status === "red"
                  ? "lead-card lead-card-critical"
                  : p.status === "yellow"
                    ? "lead-card lead-card-warn"
                    : "lead-card"
              }
            >
              <div className="lead-top">
                <h3 className="lead-name">
                  {p.p5Id} · {p.name}
                </h3>
                <span
                  className={`fin-chip ${
                    p.status === "red"
                      ? "fin-chip-critical"
                      : p.status === "yellow"
                        ? "fin-chip-warning"
                        : "fin-chip-green"
                  }`}
                >
                  {p.status === "red"
                    ? "FUNDING REQUIRED"
                    : p.status === "yellow"
                      ? "SHORTAGE APPROACHING"
                      : "FUNDED"}
                </span>
              </div>

              <div className="fin-hero">
                <div className="admin-stat">
                  <span>Collected</span>
                  <b>{money(p.collected)}</b>
                </div>
                <div className="admin-stat">
                  <span>Spent</span>
                  <b>{money(p.consumed)}</b>
                </div>
                <div className={`admin-stat ${p.available < 0 ? "fin-negative" : ""}`}>
                  <span>Project cash held</span>
                  <b>{money(p.available)}</b>
                </div>
                <div className="admin-stat">
                  <span>Near-term need</span>
                  <b>{money(p.nearTermRequirement)}</b>
                </div>
                <div className="admin-stat">
                  <span>Recommended draw</span>
                  <b>{money(p.recommendedDraw)}</b>
                </div>
              </div>

              {/* Everything P5 has not recorded was passed to the calculation
                  as zero, and a zero only ever makes this number smaller. So
                  the gap has to be stated on the same screen as the figure -
                  a recommendation that looks precise gets treated as precise. */}
              {p.unrecorded.length > 0 && (
                <p className="lead-why">
                  <strong>This is a minimum, not the full requirement.</strong>{" "}
                  The calculation counts open purchase orders only. Not counted,
                  because P5 has not recorded them: {p.unrecorded.join("; ")}.
                  The real amount needed is higher than {money(p.recommendedDraw)},
                  and the difference is money P5 fronts.
                </p>
              )}

              {p.contractStructureReview && (
                <p className="lead-why lead-why-critical">
                  The funding this project needs exceeds what the contract still permits
                  billing. That is a contract structure problem, not a collections one —
                  raising a draw will not fix it.
                </p>
              )}
            </article>
          ))
        )}
      </section>
    </main>
  );
}
