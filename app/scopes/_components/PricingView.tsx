"use client";

/**
 * Internal pricing review. Shows every line's link to its phase, division,
 * task, QuickBooks item, quantity, unit, rate and total, with internal cost
 * and margin kept on this screen only. The customer estimate in QuickBooks
 * carries descriptions, quantities and selling prices, never costs.
 */

import { divisionLabel, groupByPhaseDivision, phaseName } from "../../lib/scopes/divisions.ts";
import Link from "next/link";

import { money, type Workspace } from "./client.ts";

const BASIS: Record<string, string> = {
  "cost-book": "Cost book",
  "written-quote": "Written quote",
  "internal-labor": "P5 labor",
  allowance: "Allowance",
  percentage: "Percentage",
  "trip-charge": "Trip charge",
};

export default function PricingView({ ws, onDetails }: { ws: Workspace; onDetails: () => void }) {
  const p = ws.pricing;
  // Scopes-only accounts see customer prices, never internal cost, margin or markup.
  const internal = ws.viewer.internal;
  const base = p.lines.filter((l) => !l.optional);
  const optional = p.lines.filter((l) => l.optional);
  const blocking = p.issues.filter((i) => i.blocking);
  const taskTitle = (id: string) => ws.doc.tasks.find((t) => t.id === id)?.title ?? id;

  return (
    <div className="sc-pricing">
      <section className="sc-card">
        <h2 className="sc-h2">Pricing summary</h2>
        <dl className="sc-totals">
          <div><dt>Base estimate</dt><dd>{money(p.totals.basePrice)}</dd></div>
          <div><dt>Optional upgrades (separate)</dt><dd>{money(p.totals.optionalPrice)}</dd></div>
          <div><dt>P5 labor hours</dt><dd>{p.totals.laborHours}</dd></div>
        </dl>
        {internal && <ProfitPanel ws={ws} />}
        {blocking.length > 0 && (
          <div className="sc-alert sc-alert-warn">
            <b>{blocking.length} pricing item{blocking.length === 1 ? "" : "s"} still open.</b>{" "}
            <button type="button" className="sc-link" onClick={onDetails}>Complete details</button>
            <ul className="sc-plain">{blocking.slice(0, 8).map((i) => <li key={i.key}>{i.message}</li>)}</ul>
          </div>
        )}
      </section>

      {[["Base estimate", base], ["Optional upgrades, not in the base total", optional]].map(([title, lines]) =>
        (lines as typeof base).length ? (
          <section key={title as string} className="sc-card">
            <h2 className="sc-h2">{title as string}</h2>
            {groupByPhaseDivision(lines as typeof base).map((g) => (
              <div key={g.phase} className="sc-phase">
                <h3 className="sc-h3">{phaseName(g.phase)}</h3>
                {g.divisions.map((d) => (
                  <div key={d.code} className="sc-division">
                    <h4 className="sc-h4">Division {divisionLabel(d.code)}</h4>
                    <div className="sc-table-wrap">
                      <table className="sc-table">
                        <thead>
                          <tr>
                            <th scope="col">Line</th>
                            <th scope="col">QuickBooks item</th>
                            <th scope="col" className="sc-num">Qty</th>
                            <th scope="col" className="sc-num">Rate</th>
                            <th scope="col" className="sc-num">Price</th>
                            {internal && <th scope="col" className="sc-num">Cost</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {d.items.map((l) => (
                            <tr key={l.id}>
                              <td>
                                <b>{l.description}</b>
                                <span className="sc-small sc-muted sc-block">
                                  {BASIS[l.basis]}
                                  {l.allowance ? ", allowance" : ""} · task: {taskTitle(l.taskId)} · {l.source}
                                </span>
                                {l.notes.map((n, i) => <span key={i} className="sc-small sc-muted sc-block">{n}</span>)}
                              </td>
                              <td>{l.item}</td>
                              <td className="sc-num">{l.quantity} {l.unit}</td>
                              <td className="sc-num">{money(l.unitPrice)}</td>
                              <td className="sc-num">{money(l.price)}</td>
                              {internal && <td className="sc-num">{l.cost === null ? "Unknown" : money(l.cost)}</td>}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </section>
        ) : null,
      )}

      {!p.lines.length && (
        <section className="sc-card">
          <p className="sc-muted">No priced lines yet. Confirmed, approved work with a cost book match, a quote or P5 labor hours appears here.</p>
        </section>
      )}
    </div>
  );
}

const STATUS: Record<string, { label: string; tone: string; line: string }> = {
  "on-target": { label: "On target", tone: "good", line: "This estimate meets the profit target." },
  high: { label: "Above target", tone: "good", line: "This estimate is well above the profit target." },
  thin: { label: "Thin", tone: "warn", line: "This estimate makes money but less than the profit target." },
  below: { label: "Below target", tone: "bad", line: "This estimate does not return enough profit." },
};
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

/** Cost, margin and profit for employees: what the job costs, what the business keeps, and whether that meets the target. */
function ProfitPanel({ ws }: { ws: Workspace }) {
  const t = ws.pricing.totals;
  const policy = ws.pricing.policy;
  if (!ws.pricing.lines.length) return null;

  if (!t.profit || t.baseCost === null) {
    const gaps = t.costGaps;
    const reasons = [
      gaps?.laborHours ? `P5's own cost per labor hour is not set, so ${gaps.laborHours} labor hours have no cost` : "",
      gaps?.lines ? `${gaps.lines} line${gaps.lines === 1 ? " has" : "s have"} no cost yet` : "",
    ].filter(Boolean);
    return (
      <div className="sc-profit sc-profit-warn">
        <h3 className="sc-h4">Cost and margin cannot be worked out yet</h3>
        <p>{reasons.length ? `${reasons.join(", and ")}.` : "Some costs are not known yet."}</p>
        {gaps?.laborHours ? (
          <p>
            {ws.viewer.canManagePricing ? (
              <Link className="sc-btn sc-btn-primary" href="/scopes/settings">Enter P5&apos;s cost per labor hour</Link>
            ) : (
              "An administrator can enter it under Pricing setup."
            )}
          </p>
        ) : null}
        <p className="sc-small sc-muted">
          This is what an hour of P5 crew time costs the company: wages, payroll taxes, workers&apos; compensation and benefits. It is entered once and used on every estimate.
        </p>
      </div>
    );
  }

  const s = STATUS[t.profit.status];
  return (
    <div className={`sc-profit sc-profit-${s.tone}`}>
      <div className="sc-row-between">
        <h3 className="sc-h4">Profit check</h3>
        <span className={`sc-pill sc-pill-${s.tone === "good" ? "ready" : s.tone === "warn" ? "needs_information" : "est-declined"}`}>{s.label}</span>
      </div>
      <p>
        {s.line} Expected profit is <b>{money(t.profit.netProfit)}</b> ({pct(t.profit.netMargin)} of the price) against a target of {pct(t.profit.targetNetMargin)}.
      </p>
      <dl className="sc-ledger">
        <div><dt>Base estimate</dt><dd>{money(t.basePrice)}</dd></div>
        <div><dt>Direct cost (materials, trades, P5 labor)</dt><dd>− {money(t.baseCost)}</dd></div>
        <div className="sc-ledger-sum"><dt>Gross profit ({t.margin === null ? "" : pct(t.margin)} gross margin)</dt><dd>{money(t.profit.grossProfit)}</dd></div>
        <div><dt>Overhead ({pct(policy.overheadRate)} of the price)</dt><dd>− {money(t.profit.overhead)}</dd></div>
        <div><dt>Reserve for surprises ({pct(policy.contingencyRate)} of marked-up cost)</dt><dd>− {money(t.profit.reserve)}</dd></div>
        <div className="sc-ledger-sum"><dt>Expected profit</dt><dd>{money(t.profit.netProfit)}</dd></div>
      </dl>
      {t.profit.notes.length > 0 && <ul className="sc-plain">{t.profit.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      <p className="sc-small sc-muted">
        Marked-up lines: price = direct cost × (1 + {Math.round(policy.contingencyRate * 100)}% reserve) ÷ (1 − {Math.round(policy.overheadRate * 100)}% overhead − {Math.round(policy.profitRate * 100)}% profit). Cost book: {policy.costBookSource}, {policy.finishTier} tier. P5 labor is billed at ${policy.laborRate}/hour as is, with no markup. The reserve is kept as extra profit when nothing goes wrong.
      </p>
    </div>
  );
}
