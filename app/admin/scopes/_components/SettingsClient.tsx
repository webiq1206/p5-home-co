"use client";

import { useState } from "react";

import type { Division } from "../../../lib/scopes/divisions.ts";
import type { ItemKey, ScopeSettings } from "../../../lib/scopes/types.ts";
import { api, when } from "./client.ts";

type Check = {
  state: { configured: boolean; connected: boolean; lastSuccess: string | null; error: string | null };
  itemCount: number;
  items: { item: ItemKey; qboId: string | null }[];
  divisionLikeNames: string[];
  divisionComparison: { code: string; name: string; inQuickBooks: string | null }[];
  checkedAt: string;
  error: string | null;
};

export default function SettingsClient({ initial, canManage, divisions }: { initial: ScopeSettings; canManage: boolean; divisions: Division[] }) {
  const [s, setS] = useState<ScopeSettings>(initial);
  const [check, setCheck] = useState<Check | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Edited as text so decimals can be typed; parsed on save.
  const [rateText, setRateText] = useState(String(initial.laborRate));
  const [costText, setCostText] = useState(initial.laborLoadedCost === null ? "" : String(initial.laborLoadedCost));
  const [tripText, setTripText] = useState(initial.handymanTripCharge ? String(initial.handymanTripCharge) : "");
  const [rates, setRates] = useState(
    Object.entries(initial.productionRates)
      .map(([code, r]) => `${code} ${r.hoursPerUnit}${r.note ? ` ${r.note}` : ""}`)
      .join("\n"),
  );

  async function save() {
    setBusy("save");
    setError(null);
    setNotice(null);
    try {
      const productionRates: ScopeSettings["productionRates"] = {};
      for (const line of rates.split("\n").map((l) => l.trim()).filter(Boolean)) {
        const m = /^(\d{2}-\d{2}-\d{2})\s+(\d+(?:\.\d+)?)\s*(.*)$/.exec(line);
        if (!m) throw new Error(`Production rate line not understood: "${line}". Use: code hours-per-unit note`);
        productionRates[m[1]] = { hoursPerUnit: Number(m[2]), ...(m[3] ? { note: m[3] } : {}) };
      }
      const laborRate = Number(rateText);
      if (!Number.isFinite(laborRate) || laborRate <= 0) throw new Error("Enter the hourly rate as a number.");
      const laborLoadedCost = costText.trim() === "" ? null : Number(costText);
      if (laborLoadedCost !== null && (!Number.isFinite(laborLoadedCost) || laborLoadedCost < 0)) {
        throw new Error("Enter P5's cost per hour as a number, or leave it blank.");
      }
      const handymanTripCharge = tripText.trim() === "" ? null : Number(tripText);
      if (handymanTripCharge !== null && (!Number.isFinite(handymanTripCharge) || handymanTripCharge < 0)) {
        throw new Error("Enter the trip charge as a number, or leave it blank.");
      }
      const { settings } = await api<{ settings: ScopeSettings }>("/api/admin/scopes/settings", {
        method: "POST",
        json: { ...s, laborRate, laborLoadedCost, handymanTripCharge, productionRates },
      });
      setS(settings);
      setNotice("Saved. Open projects were re-priced.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function runCheck() {
    setBusy("check");
    setError(null);
    try {
      const { check } = await api<{ check: Check & { error?: string } }>("/api/admin/scopes/settings?check=1");
      setCheck(check);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const disabled = !canManage || !!busy;

  return (
    <div className="sc-settings">
      {!canManage && <p className="sc-alert">Only an administrator can change these settings. They are shown for reference.</p>}

      <section className="sc-card">
        <h2 className="sc-h2">P5 labor</h2>
        <p>
          P5 labor is billed to the customer at this hourly rate exactly as entered. No overhead, reserve or profit is added on top of it. Estimated hours show on
          every labor line for review.
        </p>
        <label className="sc-field">
          <span>Rate per hour (customer price)</span>
          <input inputMode="decimal" value={rateText} disabled={disabled} onChange={(e) => setRateText(e.target.value)} />
        </label>
        <label className="sc-field">
          <span>P5&apos;s own cost per hour (optional, only used to show internal margin)</span>
          <input inputMode="decimal" value={costText} disabled={disabled} onChange={(e) => setCostText(e.target.value)} />
        </label>
        <label className="sc-field">
          <span>Handyman trip charge (customer price)</span>
          <input inputMode="decimal" value={tripText} disabled={disabled} onChange={(e) => setTripText(e.target.value)} />
          <small className="sc-muted">
            Handyman estimates show this trip charge with an equal credit, because it is removed from the total when the client moves forward. Leave blank to
            leave it off estimates.
          </small>
        </label>
        {s.confirmedBy && <p className="sc-small sc-muted">Last saved by {s.confirmedBy} on {when(s.confirmedAt)}.</p>}
      </section>

      <section className="sc-card">
        <h2 className="sc-h2">Production rates</h2>
        <p className="sc-muted">
          Approved hours per cost book unit. When one exists, labor hours are calculated and not asked. One per line: code, hours per unit, optional note. Example: 06-20-26 0.08 baseboard, crew of one.
        </p>
        <label className="sc-field">
          <span className="sc-visually-hidden">Production rates</span>
          <textarea rows={6} value={rates} disabled={disabled} onChange={(e) => setRates(e.target.value)} />
        </label>
      </section>

      <section className="sc-card">
        <h2 className="sc-h2">Tax</h2>
        <p className="sc-muted">
          The Knowledge Center records Idaho sales tax treatment as a CPA decision that is still open, so no line is taxable by default. Mark items taxable only once that is decided.
        </p>
        <div className="sc-checks">
          {(check?.items.map((i) => i.item) ?? (["Project Materials", "Cabinet Product", "Subcontractor Work", "Direct Labor"] as ItemKey[])).map((item) => (
            <label key={item} className="sc-check">
              <input
                type="checkbox"
                disabled={disabled}
                checked={s.taxableItems.includes(item)}
                onChange={(e) => setS({ ...s, taxableItems: e.target.checked ? [...s.taxableItems, item] : s.taxableItems.filter((x) => x !== item) })}
              />{" "}
              {item}
            </label>
          ))}
        </div>
      </section>

      <div className="sc-actions">
        <button type="button" className="sc-btn sc-btn-primary" onClick={save} disabled={disabled}>{busy === "save" ? "Saving..." : "Save pricing setup"}</button>
      </div>

      <section className="sc-card">
        <div className="sc-row-between">
          <h2 className="sc-h2">QuickBooks setup check</h2>
          <button type="button" className="sc-btn" onClick={runCheck} disabled={!!busy}>{busy === "check" ? "Checking..." : "Check QuickBooks now"}</button>
        </div>
        <p className="sc-muted">Reads the connected QuickBooks company: the products and services estimates map to, and any numbered division names in items, categories or classes.</p>
        {check && (
          <>
            <p>
              QuickBooks {check.state.connected ? "connected" : check.state.configured ? "not connected" : "not configured"} · {check.itemCount} products and services read · checked {when(check.checkedAt)}
            </p>
            {check.error && <p className="sc-alert sc-alert-bad">{check.error}</p>}
            <h3 className="sc-h4">Estimate items</h3>
            <ul className="sc-plain">
              {check.items.map((i) => (
                <li key={i.item} className="sc-row-between">
                  <span>{i.item}</span>
                  {i.qboId ? (
                    <span className="sc-pill sc-pill-ready">Found (id {i.qboId})</span>
                  ) : (
                    <span>
                      <span className="sc-pill sc-pill-needs_information">Not found</span>{" "}
                      {canManage && (
                        <input
                          aria-label={`QuickBooks item id for ${i.item}`}
                          className="sc-small-input"
                          placeholder="item id"
                          value={s.itemOverrides[i.item] ?? ""}
                          onChange={(e) => setS({ ...s, itemOverrides: { ...s.itemOverrides, [i.item]: e.target.value.trim() } })}
                        />
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <h3 className="sc-h4">Divisions</h3>
            {check.divisionLikeNames.length === 0 ? (
              <p className="sc-muted">
                No numbered division names were found in QuickBooks items, categories or classes. Estimates group lines under Phase and Division headings using the cost book
                structure ({divisions.length} divisions).
              </p>
            ) : (
              <div className="sc-table-wrap">
                <table className="sc-table">
                  <thead><tr><th scope="col">Cost book division</th><th scope="col">In QuickBooks</th></tr></thead>
                  <tbody>
                    {check.divisionComparison.map((d) => (
                      <tr key={d.code}><td>{d.code} {d.name}</td><td>{d.inQuickBooks ?? <span className="sc-muted">not found</span>}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      {notice && <p className="sc-alert sc-alert-good" role="status">{notice}</p>}
      {error && <p className="sc-alert sc-alert-bad" role="alert">{error}</p>}
    </div>
  );
}
