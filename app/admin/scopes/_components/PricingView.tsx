"use client";

/**
 * Internal pricing review. Shows every line's link to its phase, division,
 * task, QuickBooks item, quantity, unit, rate and total, with internal cost
 * and margin kept on this screen only. The customer estimate in QuickBooks
 * carries descriptions, quantities and selling prices, never costs.
 */

import { divisionLabel, groupByPhaseDivision, phaseName } from "../../../lib/scopes/divisions.ts";
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
          <div><dt>Internal direct cost</dt><dd>{p.totals.baseCost === null ? "Not fully known" : money(p.totals.baseCost)}</dd></div>
          <div><dt>Gross margin</dt><dd>{p.totals.margin === null ? "Not known" : `${Math.round(p.totals.margin * 1000) / 10}%`}</dd></div>
          <div><dt>P5 labor hours</dt><dd>{p.totals.laborHours}</dd></div>
        </dl>
        <p className="sc-small sc-muted">
          Price = direct cost × (1 + {Math.round(p.policy.contingencyRate * 100)}% reserve) ÷ (1 − {Math.round(p.policy.overheadRate * 100)}% overhead − {Math.round(p.policy.profitRate * 100)}% profit). Cost book: {p.policy.costBookSource}, {p.policy.finishTier} tier. P5 labor is billed at ${p.policy.laborRate}/hour as is, with no markup.
        </p>
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
                            <th scope="col" className="sc-num">Cost</th>
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
                              <td className="sc-num">{l.cost === null ? "Unknown" : money(l.cost)}</td>
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
