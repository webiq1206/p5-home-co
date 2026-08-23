/**
 * Project financial health (S150): contract, budget, actuals from QBO,
 * commitments, forecast, margin health and funding per project.
 */

import { checkDatabase } from "../../../lib/db.ts";
import {
  forecastIsStale,
  forecastToComplete,
  marginHealth,
} from "../../../lib/finance/engines.ts";
import { projectRollup } from "../../../lib/finance/reporting.ts";
import { loadFinanceSettings } from "../../../lib/finance/settings.ts";
import { money, projectBoard } from "../queries.ts";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const db = await checkDatabase();
  if (!db.ok) {
    return (
      <main className="admin-main">
        <h1 className="admin-h1">Projects</h1>
        <div className="admin-notice admin-notice-error">
          <strong>Database unavailable</strong>
          {db.detail}
        </div>
      </main>
    );
  }

  const settings = await loadFinanceSettings();
  const projects = await projectBoard();
  const today = new Date();

  const enriched = await Promise.all(
    projects.map(async (p) => {
      const rollup = p.qboCustomerId ? await projectRollup(p.qboCustomerId) : null;
      const revised = p.contractAmount + p.approvedCos;
      const forecast = forecastToComplete({
        revisedContract: revised,
        actualCost: rollup?.billed ?? 0,
        remainingCommitments: rollup?.openCommitments ?? 0,
        additionalEtc: p.etcAmount,
      });
      const health = marginHealth(forecast.projectedGpPct, p.targetGpPct, settings, {
        projectedLoss: forecast.projectedGrossProfit < 0,
      });
      const stale = forecastIsStale(
        p.etcUpdatedAt ? new Date(p.etcUpdatedAt) : null,
        today,
        settings,
      );
      return { p, rollup, revised, forecast, health, stale };
    }),
  );

  return (
    <main className="admin-main">
      <h1 className="admin-h1">Projects</h1>
      <p className="admin-sub">
        Financial health per project. Actuals and commitments come from
        QuickBooks; forecasts add the P5 estimate-to-complete (S48).
      </p>

      {enriched.length === 0 ? (
        <div className="admin-empty">
          <h2>No projects registered</h2>
          <p>
            Projects appear here once created in the P5 registry with a link to
            their QuickBooks project.
          </p>
        </div>
      ) : (
        <div className="admin-cards">
          {enriched.map(({ p, rollup, revised, forecast, health, stale }) => (
            <article
              key={p.id}
              className={
                health === "red"
                  ? "lead-card lead-card-critical"
                  : health === "yellow"
                    ? "lead-card lead-card-warn"
                    : "lead-card"
              }
            >
              <div className="lead-top">
                <h3 className="lead-name">
                  {p.p5Id} · {p.name}
                </h3>
                <span className={`fin-chip ${health === "green" ? "fin-chip-green" : health === "yellow" ? "fin-chip-warning" : "fin-chip-critical"}`}>
                  {health}
                </span>
              </div>
              <div className="lead-tags">
                <span className="lead-tag lead-tag-brand">{p.division}</span>
                <span className="lead-tag">{p.projectType}</span>
                <span className="lead-tag">{p.status}</span>
                {stale && <span className="fin-chip fin-chip-warning">Forecast stale (S49)</span>}
              </div>
              <div className="lead-meta lead-meta-wide">
                <div><b>Revised contract</b>{money(revised)}</div>
                <div><b>Current budget</b>{money(p.currentBudget)}</div>
                <div><b>Actual cost</b>{money(rollup?.billed ?? 0)}</div>
                <div><b>Open commitments</b>{money(rollup?.openCommitments ?? 0)}</div>
                <div><b>ETC</b>{money(p.etcAmount)}</div>
                <div><b>Projected final</b>{money(forecast.projectedFinalCost)}</div>
                <div><b>Projected GP</b>{money(forecast.projectedGrossProfit)}</div>
                <div>
                  <b>Projected GP%</b>
                  {forecast.projectedGpPct === null
                    ? "—"
                    : `${forecast.projectedGpPct.toFixed(1)}% (target ${p.targetGpPct}%)`}
                </div>
                <div><b>Invoiced</b>{money(rollup?.invoiced ?? 0)}</div>
                <div><b>Collected</b>{money(rollup?.collected ?? 0)}</div>
                <div><b>Open AR</b>{money(rollup?.arOpen ?? 0)}</div>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
