"use client";

/**
 * The completion wizard: one field at a time, only for what is genuinely
 * missing. Questions come from the server already reduced to the minimum;
 * each Next saves immediately (a new scope version), and the server re-derives
 * the list, so an answer that resolves other gaps removes those steps too.
 */

import { useMemo, useState } from "react";

import type { Answer, Evidence, Question } from "../../../lib/scopes/types.ts";
import { unitLabel } from "../../../lib/scopes/divisions.ts";
import { api, newKey, type Workspace } from "./client.ts";
import Dictate from "./Dictate.tsx";
import EvidenceLinks from "./EvidenceLinks.tsx";

/** Accept 12.5, 12' 6", 12 ft 6 in, 1,200 and $1,200.50. */
export function parseNumber(text: string, unit?: string): number | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const ftIn = /^(\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inches)?)?$/.exec(t);
  if (ftIn && (unit === "LF" || unit === "SF" || !unit)) return Number(ftIn[1]) + (ftIn[2] ? Number(ftIn[2]) / 12 : 0);
  const n = Number(t.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function draftKey(projectId: number, key: string) {
  return `p5-scope-draft:${projectId}:${key}`;
}
function readDraft(projectId: number, key: string): string {
  try {
    return localStorage.getItem(draftKey(projectId, key)) ?? "";
  } catch {
    return "";
  }
}
function writeDraft(projectId: number, key: string, v: string) {
  try {
    if (v) localStorage.setItem(draftKey(projectId, key), v);
    else localStorage.removeItem(draftKey(projectId, key));
  } catch {
    // Drafts are a convenience.
  }
}

export default function Wizard({
  ws,
  onWorkspace,
  onPlay,
  onDone,
}: {
  ws: Workspace;
  onWorkspace: (w: Workspace) => void;
  onPlay: (e: Evidence) => void;
  onDone: () => void;
}) {
  const projectId = ws.project.id;
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<{ q: Question; value: string }[]>([]);
  const [back, setBack] = useState<{ q: Question; value: string } | null>(null);
  const [value, setValue] = useState("");
  const [other, setOther] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queue = useMemo(() => ws.questions.filter((q) => !skipped.has(q.key)), [ws.questions, skipped]);
  const q = back?.q ?? queue[0] ?? null;
  const total = history.length + queue.length;
  const blockingLeft = ws.questions.filter((x) => x.blocking).length;

  // Reset the inputs when a different step is shown (derived state, set during render).
  const stepKey = q ? `${q.key}|${back ? "back" : "next"}|${history.length}` : null;
  const [shownStep, setShownStep] = useState<string | null>(null);
  if (q && stepKey !== shownStep) {
    setShownStep(stepKey);
    setValue(back?.value ?? (readDraft(projectId, q.key) || (q.suggested !== null && q.suggested !== undefined ? String(q.suggested) : "")));
    setOther("");
    setFile(null);
    setError(null);
  }

  if (!q) {
    return (
      <section className="sc-card sc-wizard-done" aria-live="polite">
        <h2 className="sc-h2">{ws.questions.length ? "Nothing more in this session" : "Every required detail is captured"}</h2>
        <p>
          {blockingLeft
            ? `${blockingLeft} required item${blockingLeft === 1 ? " is" : "s are"} saved for later. The estimate cannot be created until ${blockingLeft === 1 ? "it is" : "they are"} answered.`
            : "Nothing is blocking the estimate."}
        </p>
        {skipped.size > 0 && (
          <button type="button" className="sc-btn" onClick={() => setSkipped(new Set())}>
            Show skipped questions again
          </button>
        )}
        <button type="button" className="sc-btn sc-btn-primary" onClick={onDone}>
          Review pricing
        </button>
      </section>
    );
  }

  function answerFrom(): Answer | null {
    const input = q!.input;
    switch (input.type) {
      case "measurement":
      case "number": {
        const n = parseNumber(value, input.unit);
        if (n === null) throw new Error(`Enter a number in ${unitLabel(input.unit)}.`);
        return { value: n, unit: input.unit };
      }
      case "currency": {
        const n = parseNumber(value);
        if (n === null) throw new Error("Enter a dollar amount.");
        return { amount: n };
      }
      case "choice": {
        const v = value === "__other" ? other.trim() : value;
        if (!v) throw new Error("Choose an option.");
        return { value: v };
      }
      case "confirm":
        if (value !== "yes" && value !== "no") throw new Error("Choose an option.");
        return { value: value === "yes" };
      case "text":
        if (!value.trim()) throw new Error("Enter an answer, or skip.");
        return { value: value.trim() };
    }
  }

  async function submit(defer: boolean) {
    if (!q) return;
    setBusy(true);
    setError(null);
    try {
      let answer: Answer | null = null;
      let assetId: number | null = null;
      if (!defer) {
        answer = answerFrom();
        if (file) {
          const form = new FormData();
          form.append("file", file);
          form.append("kind", "quote");
          form.append("clientKey", newKey("quote"));
          form.append("label", `Quote: ${q.context}`);
          const res = await api<{ asset: { id: number } }>(`/api/admin/scopes/${projectId}/assets`, { method: "POST", body: form });
          assetId = res.asset.id;
          if (answer && "amount" in answer) answer = { ...answer, assetId };
        }
      }
      const { workspace } = await api<{ workspace: Workspace }>(`/api/admin/scopes/${projectId}/answer`, {
        method: "POST",
        json: { key: q.key, answer, defer, assetId, prompt: q.prompt },
      });
      writeDraft(projectId, q.key, "");
      setHistory((h) => [...h, { q, value }]);
      if (defer) setSkipped((s) => new Set(s).add(q.key));
      setBack(null);
      onWorkspace(workspace);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function skip() {
    setHistory((h) => [...h, { q: q!, value }]);
    setSkipped((s) => new Set(s).add(q!.key));
    setBack(null);
  }

  function goBack() {
    const prev = history.at(-1);
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setSkipped((s) => {
      const n = new Set(s);
      n.delete(prev.q.key);
      return n;
    });
    setBack(prev);
  }

  const update = (v: string) => {
    setValue(v);
    writeDraft(projectId, q.key, v);
  };

  const input = q.input;
  const step = history.length + 1;
  const id = `wiz-${q.key.replace(/[^a-z0-9]/gi, "-")}`;

  return (
    <section className="sc-card sc-wizard" aria-labelledby={`${id}-prompt`}>
      <div className="sc-progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={step - 1} aria-label="Questions answered">
        <span style={{ width: `${total ? ((step - 1) / total) * 100 : 0}%` }} />
      </div>
      <p className="sc-step-meta">
        Step {step} of {total}
        <span className={q.blocking ? "sc-pill sc-pill-needs_information" : "sc-pill"}>
          {q.blocking ? "Required for the estimate" : "Optional"}
        </span>
        {q.deferred && <span className="sc-pill">Saved for later</span>}
      </p>
      <p className="sc-context">{q.context}</p>
      <h2 className="sc-h2" id={`${id}-prompt`}>{q.prompt}</h2>
      <p className="sc-muted">{q.help}</p>
      <EvidenceLinks projectId={projectId} evidence={q.evidence} assets={ws.assets} onPlay={onPlay} />

      <form
        className="sc-wizard-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(false);
        }}
      >
        {(input.type === "measurement" || input.type === "number") && (
          <label className="sc-field sc-field-big" htmlFor={id}>
            <span>{input.type === "measurement" ? "Measurement" : input.unit === "HR" ? "Hours" : "Quantity"}</span>
            <span className="sc-unit-input">
              <input id={id} inputMode="decimal" autoFocus value={value} onChange={(e) => update(e.target.value)} aria-describedby={`${id}-unit`} />
              <span id={`${id}-unit`} className="sc-unit">{unitLabel(input.unit)}</span>
            </span>
            {input.unit === "LF" && <small className="sc-muted">Feet and inches work too, for example 12&apos; 6&quot;.</small>}
          </label>
        )}

        {input.type === "currency" && (
          <>
            <label className="sc-field sc-field-big" htmlFor={id}>
              <span>Amount (P5&apos;s cost)</span>
              <span className="sc-unit-input">
                <span className="sc-unit">$</span>
                <input id={id} inputMode="decimal" autoFocus value={value} onChange={(e) => update(e.target.value)} />
              </span>
            </label>
            {input.allowAttachment && (
              <label className="sc-field">
                <span>Attach the quote (optional)</span>
                <input type="file" accept="image/*,application/pdf,.doc,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
            )}
          </>
        )}

        {input.type === "choice" && (
          <fieldset className="sc-choices">
            <legend className="sc-visually-hidden">{q.prompt}</legend>
            {input.options.map((o) => (
              <label key={o} className="sc-choice">
                <input type="radio" name={id} value={o} checked={value === o} onChange={() => update(o)} />
                <span>{o}</span>
              </label>
            ))}
            {input.allowOther && (
              <label className="sc-choice">
                <input type="radio" name={id} value="__other" checked={value === "__other"} onChange={() => update("__other")} />
                <span>Other</span>
              </label>
            )}
            {value === "__other" && (
              <label className="sc-field">
                <span>Describe it</span>
                <input value={other} onChange={(e) => setOther(e.target.value)} autoFocus />
                <Dictate onText={(t) => setOther(t)} />
              </label>
            )}
          </fieldset>
        )}

        {input.type === "confirm" && (
          <fieldset className="sc-choices">
            <legend className="sc-visually-hidden">{q.prompt}</legend>
            <label className="sc-choice">
              <input type="radio" name={id} checked={value === "yes"} onChange={() => update("yes")} />
              <span>{input.yes}</span>
            </label>
            <label className="sc-choice">
              <input type="radio" name={id} checked={value === "no"} onChange={() => update("no")} />
              <span>{input.no}</span>
            </label>
          </fieldset>
        )}

        {input.type === "text" && (
          <label className="sc-field" htmlFor={id}>
            <span>Answer</span>
            <textarea id={id} rows={4} value={value} onChange={(e) => update(e.target.value)} />
            <Dictate onText={(t) => update(value ? `${value} ${t}` : t)} />
          </label>
        )}

        {(input.type === "measurement" || input.type === "number" || input.type === "currency") && (
          <Dictate label="Say the number" onText={(t) => update(t.replace(/[^0-9.,'"\s$ftinches]/gi, "").trim())} />
        )}

        {error && <p className="sc-alert sc-alert-bad" role="alert">{error}</p>}

        <div className="sc-wizard-nav">
          <button type="button" className="sc-btn" onClick={goBack} disabled={!history.length || busy}>
            Back
          </button>
          <button type="submit" className="sc-btn sc-btn-primary" disabled={busy}>
            {busy ? "Saving..." : "Next"}
          </button>
        </div>
        <div className="sc-wizard-secondary">
          <button type="button" className="sc-link" onClick={() => void submit(true)} disabled={busy}>
            Not known yet, save for later
          </button>
          {!q.blocking && (
            <button type="button" className="sc-link" onClick={skip} disabled={busy}>
              Skip
            </button>
          )}
        </div>
        <p className="sc-muted sc-small">Answers save as you go. You can leave and come back on any device.</p>
      </form>
    </section>
  );
}
