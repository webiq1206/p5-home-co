"use client";

/**
 * Review and edit the scope: Phase 1 and Phase 2, each by division, with
 * approved work separated from optional upgrades, ideas and future work.
 * Suggested supporting tasks wait for confirmation. Every fact links back to
 * the recording moment or file it came from. Edits are saved as a new version
 * and are never overwritten by regeneration.
 */

import { useState } from "react";

import { DIVISIONS, PHASES, divisionLabel, groupByPhaseDivision, phaseName, unitLabel } from "../../lib/scopes/divisions.ts";
import type { Bucket, Evidence, ScopeTask } from "../../lib/scopes/types.ts";
import { api, BUCKET_LABEL, CERTAINTY_LABEL, MEASURE_LABEL, newKey, type Workspace } from "./client.ts";
import EvidenceLinks from "./EvidenceLinks.tsx";

type Props = { ws: Workspace; onWorkspace: (w: Workspace) => void; onPlay: (e: Evidence) => void };

async function edit(projectId: number, ops: unknown[]): Promise<Workspace> {
  const { workspace } = await api<{ workspace: Workspace }>(`/api/scopes/${projectId}/scope`, { method: "POST", json: { action: "edit", ops } });
  return workspace;
}

export default function ScopeView({ ws, onWorkspace, onPlay }: Props) {
  const doc = ws.doc;
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = doc.tasks.filter((t) => !t.dismissed);
  const suggested = live.filter((t) => t.certainty === "suggested");
  const dismissed = doc.tasks.filter((t) => t.dismissed);
  const byBucket = (b: Bucket) => live.filter((t) => t.bucket === b && t.certainty !== "suggested");

  const run = async (ops: unknown[]): Promise<boolean> => {
    setError(null);
    try {
      onWorkspace(await edit(ws.project.id, ops));
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  /** For editors: throws, so the form stays open with its message when a save fails. */
  const saveTask = async (t: ScopeTask) => {
    onWorkspace(await edit(ws.project.id, [{ op: "task", task: t }]));
  };

  if (!ws.version) {
    return (
      <section className="sc-card">
        <h2 className="sc-h2">No scope yet</h2>
        <p>Record the walkthrough or add notes and files, then build the scope. You can also add tasks by hand.</p>
        <button type="button" className="sc-btn" onClick={() => setAdding(true)}>Add a task by hand</button>
        {adding && <TaskEditor projectId={ws.project.id} onSave={(t) => saveTask(t).then(() => setAdding(false))} onCancel={() => setAdding(false)} />}
        {error && <p className="sc-alert sc-alert-bad" role="alert">{error}</p>}
      </section>
    );
  }

  return (
    <div className="sc-scope">
      {ws.proposal && <ProposalReview ws={ws} onWorkspace={onWorkspace} />}
      {error && <p className="sc-alert sc-alert-bad" role="alert">{error}</p>}

      <section className="sc-card">
        <h2 className="sc-h2">Summary</h2>
        <EditableText value={doc.summary} multiline onSave={(v) => run([{ op: "summary", value: v }])} />
        <div className="sc-lists">
          <ListBlock title="Client goals" field="goals" values={doc.goals} run={run} />
          <ListBlock title="Priorities" field="priorities" values={doc.priorities} run={run} />
          <ListBlock title="Rooms and areas" field="areas" values={doc.areas} run={run} />
        </div>
      </section>

      {doc.conflicts.filter((c) => !c.resolution).length > 0 && (
        <section className="sc-card sc-card-warn">
          <h2 className="sc-h2">Conflicting information</h2>
          <p className="sc-muted">Resolve these in Complete details. Affected work is not priced until then.</p>
          <ul className="sc-plain">
            {doc.conflicts.filter((c) => !c.resolution).map((c) => (
              <li key={c.id}>
                <b>{c.topic}</b>
                <ul>
                  {c.statements.map((s, i) => (
                    <li key={i}>
                      {s.text} <EvidenceLinks projectId={ws.project.id} evidence={s.evidence} assets={ws.assets} onPlay={onPlay} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      {suggested.length > 0 && (
        <section className="sc-card sc-card-suggest">
          <h2 className="sc-h2">Suggested supporting work</h2>
          <p className="sc-muted">Often left out of walkthrough notes. Nothing here is priced until you add it.</p>
          {suggested.map((t) => (
            <div key={t.id} className="sc-suggest">
              <div>
                <b>{t.title}</b> <span className="sc-muted">{divisionLabel(t.division)}</span>
                <p>{t.description}</p>
              </div>
              <div className="sc-actions">
                <button type="button" className="sc-btn sc-btn-small" onClick={() => run([{ op: "task", task: { ...t, certainty: "confirmed" } }])}>Add</button>
                <button type="button" className="sc-btn sc-btn-small" onClick={() => run([{ op: "remove-task", id: t.id }])}>Not needed</button>
              </div>
            </div>
          ))}
        </section>
      )}

      {(["approved", "optional", "considering", "future"] as Bucket[]).map((b) => {
        const tasks = byBucket(b);
        if (!tasks.length && b !== "approved") return null;
        return (
          <section key={b} className="sc-card">
            <h2 className="sc-h2">{BUCKET_LABEL[b]}</h2>
            {b === "optional" && <p className="sc-muted">Priced separately and kept out of the base estimate total.</p>}
            {b === "considering" || b === "future" ? <p className="sc-muted">Not priced. Kept for reference and follow-up.</p> : null}
            {!tasks.length && <p className="sc-muted">No approved work yet.</p>}
            {groupByPhaseDivision(tasks).map((g) => (
              <div key={g.phase} className="sc-phase">
                <h3 className="sc-h3">{phaseName(g.phase)}</h3>
                {g.divisions.map((d) => (
                  <div key={d.code} className="sc-division">
                    <h4 className="sc-h4">Division {divisionLabel(d.code)}</h4>
                    {d.items.map((t) => (
                      <TaskCard key={t.id} t={t} ws={ws} onPlay={onPlay} run={run} saveTask={saveTask} />
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </section>
        );
      })}

      <section className="sc-card">
        <div className="sc-row-between">
          <h2 className="sc-h2">Add work</h2>
          {!adding && <button type="button" className="sc-btn" onClick={() => setAdding(true)}>Add a task</button>}
        </div>
        {adding && <TaskEditor projectId={ws.project.id} onSave={(t) => saveTask(t).then(() => setAdding(false))} onCancel={() => setAdding(false)} />}
      </section>

      <section className="sc-card">
        <h2 className="sc-h2">Measurements</h2>
        {doc.measurements.length === 0 && <p className="sc-muted">None recorded.</p>}
        <ul className="sc-measures">
          {doc.measurements.map((m) => (
            <MeasureRow key={m.id} m={m} ws={ws} onPlay={onPlay} run={run} />
          ))}
        </ul>
      </section>

      <section className="sc-card">
        <h2 className="sc-h2">Conditions, terms and open items</h2>
        <div className="sc-lists">
          <ListBlock title="Site conditions" field="siteConditions" values={doc.siteConditions} run={run} />
          <ListBlock title="Access limitations" field="access" values={doc.access} run={run} />
          <ListBlock title="Scheduling requirements" field="schedule" values={doc.schedule} run={run} />
          <ListBlock title="Included" field="inclusions" values={doc.inclusions} run={run} />
          <ListBlock title="Not included" field="exclusions" values={doc.exclusions} run={run} />
          <ListBlock title="Assumptions" field="assumptions" values={doc.assumptions} run={run} />
          <ListBlock title="Unresolved questions" field="openQuestions" values={doc.openQuestions} run={run} />
        </div>
      </section>

      {dismissed.length > 0 && (
        <details className="sc-card">
          <summary className="sc-h2">Removed or declined ({dismissed.length})</summary>
          {dismissed.map((t) => (
            <div key={t.id} className="sc-suggest">
              <span>{t.title} <span className="sc-muted">{divisionLabel(t.division)}</span></span>
              <button type="button" className="sc-btn sc-btn-small" onClick={() => run([{ op: "restore-task", id: t.id }])}>Restore</button>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

function TaskCard({ t, ws, onPlay, run, saveTask }: { t: ScopeTask; ws: Workspace; onPlay: (e: Evidence) => void; run: (ops: unknown[]) => Promise<boolean>; saveTask: (t: ScopeTask) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const m = t.quantity?.measurementId ? ws.doc.measurements.find((x) => x.id === t.quantity!.measurementId) : null;
  const qty = m
    ? m.value !== null
      ? `${+(m.value * (t.quantity?.factor || 1)).toFixed(2)} ${m.unit}`
      : `${m.label}: missing`
    : t.quantity?.value !== null && t.quantity?.value !== undefined
      ? `${t.quantity.value} ${t.quantity.unit ?? ""}`
      : null;
  const estimated = m ? m.status === "estimated" : t.quantity?.estimated;
  const lines = ws.pricing.lines.filter((l) => l.taskId === t.id);
  const issues = ws.pricing.issues.filter((i) => i.taskId === t.id);

  if (editing) {
    return <TaskEditor projectId={ws.project.id} initial={t} onSave={(next) => saveTask(next).then(() => setEditing(false))} onCancel={() => setEditing(false)} />;
  }
  return (
    <article className={`sc-task sc-task-${t.certainty}`}>
      <div className="sc-row-between">
        <h5 className="sc-task-title">
          {t.area && <span className="sc-muted">{t.area}: </span>}
          {t.title}
        </h5>
        <span className="sc-actions">
          <button type="button" className="sc-btn sc-btn-small" onClick={() => setEditing(true)} aria-label={`Edit ${t.title}`}>Edit</button>
          <button type="button" className="sc-btn sc-btn-small" onClick={() => run([{ op: "remove-task", id: t.id }])} aria-label={`Remove ${t.title}`}>Remove</button>
        </span>
      </div>
      <p>{t.description}</p>
      <div className="sc-tags">
        <span className={`sc-pill sc-cert-${t.certainty}`}>{CERTAINTY_LABEL[t.certainty]}</span>
        {qty && <span className={`sc-pill${estimated ? " sc-pill-needs_information" : ""}`}>{qty}{estimated ? " (estimate)" : ""}</span>}
        {t.performer && <span className="sc-pill">{t.performer === "internal" ? "P5 crew" : t.performer === "supplier" ? "Supplier" : "Trade partner"}</span>}
        {t.laborHours?.value ? <span className="sc-pill">{t.laborHours.value} hr ({t.laborHours.basis})</span> : null}
        {t.costCode && <span className="sc-pill">Cost book {t.costCode}</span>}
        {t.quote && <span className="sc-pill">Quote on file</span>}
        {t.allowance && <span className="sc-pill">Allowance{t.allowance.approved ? " approved" : ""}</span>}
        {t.edited?.length ? <span className="sc-pill">Edited</span> : null}
      </div>
      {!!t.materials?.length && <p className="sc-small"><b>Materials:</b> {t.materials.join(", ")}</p>}
      {!!t.selections?.length && (
        <p className="sc-small">
          {t.selections.map((s) => (
            <span key={s.id} className="sc-sel">
              <b>{s.label}:</b> {s.chosen ?? `undecided (${s.options.join(" / ") || "no options yet"})`}
            </span>
          ))}
        </p>
      )}
      {t.notes && <p className="sc-small sc-muted">{t.notes}</p>}
      {lines.length > 0 && (
        <p className="sc-small sc-muted">Priced: {lines.map((l) => `${l.quantity} ${l.unit} = ${l.price.toLocaleString("en-US", { style: "currency", currency: "USD" })}`).join(" + ")}</p>
      )}
      {issues.map((i) => (
        <p key={i.key} className={`sc-small ${i.blocking ? "sc-text-warn" : "sc-muted"}`}>{i.message}</p>
      ))}
      <EvidenceLinks projectId={ws.project.id} evidence={t.evidence} assets={ws.assets} onPlay={onPlay} />
    </article>
  );
}

function TaskEditor({ projectId, initial, onSave, onCancel }: { projectId: number; initial?: ScopeTask; onSave: (t: ScopeTask) => Promise<void>; onCancel: () => void }) {
  const [t, setT] = useState<ScopeTask>(
    initial ?? {
      id: newKey("manual").slice(0, 40),
      title: "",
      description: "",
      phase: "construction",
      division: "06",
      bucket: "approved",
      certainty: "confirmed",
      performer: "subcontractor",
      evidence: [],
      origin: "manual",
    },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Numbers are edited as text so decimals can be typed, and parsed on save.
  const [qtyText, setQtyText] = useState(t.quantity?.measurementId ? "" : String(t.quantity?.value ?? ""));
  const [hoursText, setHoursText] = useState(String(t.laborHours?.value ?? ""));
  const set = <K extends keyof ScopeTask>(k: K, v: ScopeTask[K]) => setT((x) => ({ ...x, [k]: v }));
  void projectId;

  function build(): ScopeTask {
    const next: ScopeTask = { ...t, description: t.description || t.title, materials: (t.materials ?? []).map((m) => m.trim()).filter(Boolean) };
    const unit = t.quantity?.unit ?? null;
    if (qtyText.trim() === "") {
      next.quantity = t.quantity?.measurementId ? t.quantity : unit ? { value: null, unit } : null;
    } else {
      const value = Number(qtyText.replace(/,/g, ""));
      if (!Number.isFinite(value) || value < 0) throw new Error("Quantity must be a number.");
      next.quantity = { measurementId: null, value, unit: unit ?? "EA", estimated: false };
    }
    if (hoursText.trim() === "") {
      next.laborHours = initial?.laborHours && initial.laborHours.value === null ? initial.laborHours : null;
    } else {
      const value = Number(hoursText.replace(/,/g, ""));
      if (!Number.isFinite(value) || value < 0) throw new Error("Hours must be a number.");
      next.laborHours = initial?.laborHours?.value === value ? initial.laborHours : { value, basis: "confirmed" };
    }
    return next;
  }
  return (
    <form
      className="sc-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!t.title.trim()) return;
        setError(null);
        setBusy(true);
        try {
          await onSave(build());
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <label className="sc-field"><span>Task</span><input value={t.title} onChange={(e) => set("title", e.target.value)} required /></label>
      <label className="sc-field"><span>Customer-facing description</span><textarea rows={3} value={t.description} onChange={(e) => set("description", e.target.value)} /></label>
      <div className="sc-two">
        <label className="sc-field"><span>Room or area</span><input value={t.area ?? ""} onChange={(e) => set("area", e.target.value || null)} /></label>
        <label className="sc-field">
          <span>Phase</span>
          <select value={t.phase} onChange={(e) => set("phase", e.target.value as ScopeTask["phase"])}>
            {PHASES.map((p) => <option key={p.id} value={p.id}>{phaseName(p.id)}</option>)}
          </select>
        </label>
      </div>
      <div className="sc-two">
        <label className="sc-field">
          <span>Division</span>
          <select value={t.division} onChange={(e) => set("division", e.target.value)}>
            {DIVISIONS.map((d) => <option key={d.code} value={d.code}>{d.code} {d.name}</option>)}
          </select>
        </label>
        <label className="sc-field">
          <span>Part of</span>
          <select value={t.bucket} onChange={(e) => set("bucket", e.target.value as Bucket)}>
            {Object.entries(BUCKET_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>
      <div className="sc-two">
        <label className="sc-field">
          <span>Status</span>
          <select value={t.certainty} onChange={(e) => set("certainty", e.target.value as ScopeTask["certainty"])}>
            {Object.entries(CERTAINTY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="sc-field">
          <span>Done by</span>
          <select value={t.performer ?? "subcontractor"} onChange={(e) => set("performer", e.target.value as ScopeTask["performer"])}>
            <option value="internal">P5 crew</option>
            <option value="subcontractor">Trade partner</option>
            <option value="supplier">Supplier (material)</option>
          </select>
        </label>
      </div>
      <div className="sc-two">
        <label className="sc-field">
          <span>Quantity</span>
          <input
            inputMode="decimal"
            value={qtyText}
            placeholder={t.quantity?.measurementId ? "Uses a measurement" : ""}
            onChange={(e) => setQtyText(e.target.value)}
          />
        </label>
        <label className="sc-field">
          <span>Unit</span>
          <select value={t.quantity?.unit ?? "EA"} onChange={(e) => set("quantity", { ...(t.quantity ?? {}), unit: e.target.value })}>
            {["EA", "LF", "SF", "SQ", "CY", "TON", "HR", "DAY", "MO", "RL", "AC", "W"].map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}
          </select>
        </label>
      </div>
      <div className="sc-two">
        <label className="sc-field">
          <span>Cost book code (optional)</span>
          <input value={t.costCode ?? ""} placeholder="e.g. 09-30-12" onChange={(e) => set("costCode", e.target.value.trim() || null)} />
        </label>
        <label className="sc-field">
          <span>P5 crew hours (optional)</span>
          <input
            inputMode="decimal"
            value={hoursText}
            onChange={(e) => setHoursText(e.target.value)}
          />
        </label>
      </div>
      <label className="sc-field">
        <span>Materials and selections (one per line)</span>
        <textarea rows={2} value={(t.materials ?? []).join("\n")} onChange={(e) => set("materials", e.target.value.split("\n"))} />
      </label>
      {error && <p className="sc-alert sc-alert-bad" role="alert">{error}</p>}
      <div className="sc-actions">
        <button type="submit" className="sc-btn sc-btn-primary" disabled={busy}>{busy ? "Saving..." : "Save"}</button>
        <button type="button" className="sc-btn" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}

function MeasureRow({ m, ws, onPlay, run }: { m: Workspace["doc"]["measurements"][number]; ws: Workspace; onPlay: (e: Evidence) => void; run: (ops: unknown[]) => Promise<boolean> }) {
  const [value, setValue] = useState(m.value === null ? "" : String(m.value));
  const used = ws.doc.tasks.filter((t) => t.quantity?.measurementId === m.id && !t.dismissed).length;
  return (
    <li className="sc-measure">
      <div>
        <b>{[m.area, m.label].filter(Boolean).join(": ")}</b>
        <span className={`sc-pill sc-measure-${m.status}`}>{MEASURE_LABEL[m.status]}</span>
        <span className="sc-muted sc-small"> Used by {used} task{used === 1 ? "" : "s"}</span>
        <EvidenceLinks projectId={ws.project.id} evidence={m.evidence} assets={ws.assets} onPlay={onPlay} />
      </div>
      <form
        className="sc-inline"
        onSubmit={(e) => {
          e.preventDefault();
          const n = value.trim() === "" ? null : Number(value);
          if (n !== null && !Number.isFinite(n)) return;
          void run([{ op: "measurement", id: m.id, value: n }]);
        }}
      >
        <label className="sc-visually-hidden" htmlFor={`m-${m.id}`}>{m.label} in {unitLabel(m.unit)}</label>
        <input id={`m-${m.id}`} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
        <span className="sc-unit">{m.unit}</span>
        <button type="submit" className="sc-btn sc-btn-small">{m.status === "estimated" ? "Confirm" : "Save"}</button>
      </form>
    </li>
  );
}

function ListBlock({ title, field, values, run }: { title: string; field: string; values: string[]; run: (ops: unknown[]) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(values.join("\n"));
  return (
    <div className="sc-listblock">
      <div className="sc-row-between">
        <h3 className="sc-h4">{title}</h3>
        {!editing && (
          <button type="button" className="sc-link" onClick={() => { setText(values.join("\n")); setEditing(true); }} aria-label={`Edit ${title}`}>
            Edit
          </button>
        )}
      </div>
      {editing ? (
        <form onSubmit={(e) => { e.preventDefault(); void run([{ op: "list", field, values: text.split("\n") }]).then((ok) => ok && setEditing(false)); }}>
          <label className="sc-visually-hidden" htmlFor={`list-${field}`}>{title}, one per line</label>
          <textarea id={`list-${field}`} rows={4} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="sc-actions">
            <button type="submit" className="sc-btn sc-btn-small">Save</button>
            <button type="button" className="sc-btn sc-btn-small" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      ) : values.length ? (
        <ul className="sc-plain">{values.map((v, i) => <li key={i}>{v}</li>)}</ul>
      ) : (
        <p className="sc-muted sc-small">None</p>
      )}
    </div>
  );
}

function EditableText({ value, onSave, multiline }: { value: string; onSave: (v: string) => Promise<boolean>; multiline?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  if (!editing) {
    return (
      <div className="sc-row-between">
        <p>{value || <span className="sc-muted">No summary yet.</span>}</p>
        <button type="button" className="sc-link" onClick={() => { setText(value); setEditing(true); }}>Edit</button>
      </div>
    );
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void onSave(text).then((ok) => ok && setEditing(false)); }}>
      <label className="sc-visually-hidden" htmlFor="scope-summary">Summary</label>
      {multiline ? <textarea id="scope-summary" rows={4} value={text} onChange={(e) => setText(e.target.value)} /> : <input id="scope-summary" value={text} onChange={(e) => setText(e.target.value)} />}
      <div className="sc-actions">
        <button type="submit" className="sc-btn sc-btn-small">Save</button>
        <button type="button" className="sc-btn sc-btn-small" onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </form>
  );
}

function ProposalReview({ ws, onWorkspace }: { ws: Workspace; onWorkspace: (w: Workspace) => void }) {
  const changes = ws.proposal!.changes;
  const applicable = changes.filter((c) => !c.informational);
  const [selected, setSelected] = useState<Set<string>>(new Set(applicable.map((c) => c.id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (action: "accept" | "reject") => {
    setBusy(true);
    setError(null);
    try {
      const { workspace } = await api<{ workspace: Workspace }>(`/api/scopes/${ws.project.id}/scope`, {
        method: "POST",
        json: { action, ids: [...selected] },
      });
      onWorkspace(workspace);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="sc-card sc-card-suggest" aria-labelledby="proposal-h">
      <h2 className="sc-h2" id="proposal-h">Proposed changes from new information</h2>
      <p className="sc-muted">Your edits and confirmed values are kept. Choose what to apply; the current version stays in history either way.</p>
      <ul className="sc-changes">
        {changes.map((c) => (
          <li key={c.id} className={c.informational ? "sc-change-info" : ""}>
            {c.informational ? (
              <span>ⓘ {c.label}</span>
            ) : (
              <label>
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={(e) => {
                    const n = new Set(selected);
                    if (e.target.checked) n.add(c.id);
                    else n.delete(c.id);
                    setSelected(n);
                  }}
                />{" "}
                {c.label}
                {c.kind === "update-task" && (
                  <span className="sc-diff">
                    <del>{fmt(c.before)}</del> <ins>{fmt(c.after)}</ins>
                  </span>
                )}
              </label>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="sc-alert sc-alert-bad" role="alert">{error}</p>}
      <div className="sc-actions">
        {applicable.length > 0 && (
          <button type="button" className="sc-btn sc-btn-primary" onClick={() => act("accept")} disabled={busy}>
            Apply {selected.size} change{selected.size === 1 ? "" : "s"}
          </button>
        )}
        <button type="button" className="sc-btn" onClick={() => act("reject")} disabled={busy}>Dismiss all</button>
      </div>
    </section>
  );
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "none";
  if (typeof v === "string") return v.length > 140 ? `${v.slice(0, 140)}…` : v;
  return JSON.stringify(v).slice(0, 140);
}
