"use client";

/**
 * The project workspace: one page, built like a phone app.
 *   Record -> Scope -> Details -> Pricing -> Estimate   (+ Project)
 * Each step is an accordion section with a one-line summary; one is open at a
 * time. A dock at the bottom always offers the next thing to do.
 * State lives on the server; this component holds a copy and refreshes it
 * after every action, on a timer while open, and when the page regains focus,
 * so another person's change or a QuickBooks update appears on its own.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Evidence } from "../../lib/scopes/types.ts";
import { api, clock, money, newKey, SERVICES, when, type Workspace as WS } from "./client.ts";
import EstimatePanel from "./EstimatePanel.tsx";
import { assetUrl } from "./EvidenceLinks.tsx";
import PricingView from "./PricingView.tsx";
import Recorder from "./Recorder.tsx";
import ScopeView from "./ScopeView.tsx";
import Wizard from "./Wizard.tsx";

type Step = "record" | "scope" | "details" | "pricing" | "estimate" | "project";
const STEPS: Step[] = ["record", "scope", "details", "pricing", "estimate", "project"];
const TITLE: Record<Step, string> = {
  record: "Record",
  scope: "Scope",
  details: "Details",
  pricing: "Pricing",
  estimate: "Estimate",
  project: "Project and files",
};

const isAudioAsset = (a: WS["assets"][number]) => a.kind === "recording" || (a.mimeType ?? "").startsWith("audio/");
// Kept in step with app/lib/scopes/files.ts: larger files go up in pieces.
const WHOLE_UPLOAD_BYTES = 20 * 1024 * 1024;
const PART_BYTES = 8 * 1024 * 1024;
const MAX_FILE_BYTES = 300 * 1024 * 1024;
const COPY_LABEL: Record<string, string> = { pending: "waiting", sent: "copied", failed: "not copied", skipped: "too large", removed: "removed" };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function Workspace({ initial, initialTab }: { initial: WS; initialTab?: string }) {
  const [ws, setWs] = useState<WS>(initial);
  const [open, setOpenState] = useState<Step | null>(() => {
    const asked = initialTab === "files" ? "project" : initialTab;
    if (STEPS.includes(asked as Step)) return asked as Step;
    if (!initial.version) return "record";
    if (initial.proposal) return "scope";
    if (initial.questions.some((q) => q.blocking)) return "details";
    return initial.estimate ? "estimate" : "scope";
  });
  const [processing, setProcessing] = useState(initial.project.processing_state === "running");
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [player, setPlayer] = useState<{ assetId: number; t: number; label: string } | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const id = ws.project.id;

  /** Open one section (or close it when it is already open) and bring its header to the top. */
  const show = useCallback((step: Step, toggle = false) => {
    setOpenState((cur) => {
      const next = toggle && cur === step ? null : step;
      try {
        const url = new URL(window.location.href);
        if (next) url.searchParams.set("tab", next);
        else url.searchParams.delete("tab");
        window.history.replaceState(null, "", url);
      } catch {
        // Cosmetic.
      }
      if (next) {
        setTimeout(() => {
          const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
          document.getElementById(`sc-sec-${next}`)?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
        }, 30);
      }
      return next;
    });
  }, []);

  const reload = useCallback(
    async (refresh = false) => {
      try {
        const { workspace, refreshError } = await api<{ workspace: WS; refreshError?: string | null }>(`/api/scopes/${id}${refresh ? "?refresh=1" : ""}`);
        setWs(workspace);
        setProcessing(workspace.project.processing_state === "running");
        if (refreshError) setError(`QuickBooks status could not be refreshed: ${refreshError}`);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [id],
  );

  // Keep current while open: faster while processing, slower otherwise.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, processing ? 4000 : 60_000);
    const onFocus = () => document.visibilityState === "visible" && void reload();
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [processing, reload]);

  // A stale QuickBooks status refreshes itself once on open.
  useEffect(() => {
    if (!initial.estimate?.stale || !initial.qbo.connected) return;
    const t = setTimeout(() => void reload(true), 0);
    return () => clearTimeout(t);
  }, [initial.estimate?.stale, initial.qbo.connected, reload]);

  const process = useCallback(async () => {
    setError(null);
    setMessage(null);
    setProcessing(true);
    try {
      // A long plan set is read over several requests; keep going until it is finished.
      let res = await api<{ message: string; partial?: boolean }>(`/api/scopes/${id}/process`, { method: "POST" });
      for (let pass = 0; res.partial && pass < 200; pass++) {
        setMessage(res.message);
        res = await api<{ message: string; partial?: boolean }>(`/api/scopes/${id}/process`, { method: "POST" });
      }
      setMessage(res.message);
      await reload();
      if (!/could not be read yet/.test(res.message)) show("scope");
    } catch (e) {
      // A long recording can outlast the request while the server keeps working.
      // If it is still running, keep showing progress instead of an error.
      const latest = await api<{ workspace: WS }>(`/api/scopes/${id}`).catch(() => null);
      if (latest) setWs(latest.workspace);
      if (latest?.workspace.project.processing_state === "running") return;
      setError((e as Error).message);
      setProcessing(false);
    }
  }, [id, reload, show]);

  const play = (e: Evidence) => {
    const a = ws.assets.find((x) => x.id === e.assetId);
    if (!a) return;
    const local = Math.max(0, (e.t ?? a.offsetSeconds) - a.offsetSeconds);
    setPlayer({ assetId: a.id, t: local, label: `${a.label} at ${clock(e.t ?? a.offsetSeconds)}` });
  };

  useEffect(() => {
    const el = audio.current;
    if (!el || !player) return;
    const start = () => {
      el.currentTime = player.t;
      void el.play().catch(() => undefined);
    };
    if (el.readyState >= 1) start();
    else el.addEventListener("loadedmetadata", start, { once: true });
  }, [player]);

  // New material: not yet read into the scope and not already waiting in a proposal.
  const proposed = new Set(ws.proposal?.sourceIds ?? []);
  // A recording that failed to transcribe stays in this list, so the next step always offers to try it again.
  const fresh = ws.assets.filter((a) => !a.usedInVersion && !proposed.has(a.id) && (a.state !== "failed" || isAudioAsset(a)));
  const untranscribed = fresh.filter((a) => a.state === "failed").length;
  const blocking = ws.questions.filter((q) => q.blocking).length;
  const p = ws.project;
  const client = [p.client_first_name, p.client_last_name].filter(Boolean).join(" ");
  const tasks = ws.doc.tasks.filter((t) => !t.dismissed).length;
  const hasEstimate = Boolean(ws.estimate && ws.estimate.status !== "deleted");
  const estimateBehind = hasEstimate && ws.version !== null && ws.estimate!.versionId !== ws.version.id;

  const summary: Record<Step, string> = {
    record: untranscribed
      ? `${plural(untranscribed, "recording part")} not transcribed yet`
      : ws.assets.length ? `${plural(ws.assets.length, "item")}${fresh.length ? `, ${fresh.length} new` : ""}` : "Nothing yet",
    scope: !ws.version ? "Not built yet" : ws.proposal ? "Changes to review" : `${plural(tasks, "task")}, version ${ws.version.versionNo}`,
    details: !ws.version ? "After the scope" : blocking ? `${blocking} needed` : "Complete",
    pricing: !ws.version ? "After the scope" : `${money(ws.pricing.totals.basePrice)}${blocking ? ", not final" : ""}`,
    estimate: hasEstimate ? `${ws.estimate!.statusLabel}${estimateBehind ? ", scope changed since" : ""}` : "Not created",
    project: p.archived ? "Archived" : `${plural(ws.versions.length, "version")}, ${plural(ws.assets.length, "file")}`,
  };
  const done: Record<Step, boolean> = {
    record: ws.assets.length > 0 && fresh.length === 0,
    scope: Boolean(ws.version) && !ws.proposal,
    details: Boolean(ws.version) && blocking === 0,
    pricing: Boolean(ws.version) && ws.readiness.status === "ready",
    estimate: hasEstimate && !estimateBehind,
    project: false,
  };
  const attention: Partial<Record<Step, boolean>> = {
    record: fresh.length > 0,
    scope: Boolean(ws.proposal),
    details: blocking > 0,
    estimate: estimateBehind,
  };

  // The one next thing to do. Hidden when the section it points at is already open.
  type Next = { label: string; hint?: string; go: () => void; target?: Step };
  let next: Next | null;
  if (ws.proposal) next = { label: "Review changes", hint: "New information changed the scope", go: () => show("scope"), target: "scope" };
  else if (untranscribed) next = { label: "Try transcribing again", hint: `${plural(untranscribed, "recording part")} saved, not transcribed yet`, go: () => void process() };
  else if (fresh.length) next = { label: ws.version ? "Update scope" : "Build scope", hint: `${plural(fresh.length, "new item")} to read`, go: () => void process() };
  else if (!ws.version) {
    next = ws.assets.length
      ? { label: "Build scope", go: () => void process() }
      : { label: "Record walkthrough", hint: "Or add notes, photos and files", go: () => show("record"), target: "record" };
  } else if (blocking) next = { label: `Complete ${plural(blocking, "detail")}`, hint: "Needed before pricing is final", go: () => show("details"), target: "details" };
  else if (!hasEstimate) {
    next = open === "pricing" || open === "estimate"
      ? { label: "Create estimate", hint: money(ws.pricing.totals.basePrice), go: () => show("estimate"), target: "estimate" }
      : { label: "Review pricing", hint: money(ws.pricing.totals.basePrice), go: () => show("pricing"), target: "pricing" };
  } else if (estimateBehind) next = { label: "Update estimate", hint: "The scope changed since it was created", go: () => show("estimate"), target: "estimate" };
  else next = { label: "View estimate", hint: ws.estimate!.statusLabel, go: () => show("estimate"), target: "estimate" };
  const showNext = !recording && next !== null && (!next.target || next.target !== open);

  const panel: Record<Exclude<Step, "record">, () => React.ReactNode> = {
    scope: () => <ScopeView ws={ws} onWorkspace={setWs} onPlay={play} />,
    details: () => <Wizard ws={ws} onWorkspace={setWs} onPlay={play} onDone={() => show("pricing")} />,
    pricing: () => <PricingView ws={ws} onDetails={() => show("details")} />,
    estimate: () => <EstimatePanel ws={ws} onWorkspace={setWs} onScope={() => show(blocking ? "details" : "scope")} />,
    project: () => <FilesAndHistory ws={ws} onWorkspace={setWs} onPlay={play} onError={setError} />,
  };

  return (
    <div className="sc-ws">
      <header className="sc-ws-head">
        <Link href="/scopes" className="sc-back">
          <span aria-hidden="true">‹</span> Projects
        </Link>
        <h1 className="sc-ws-title">{p.title || "New project"}</h1>
        <p className="sc-ws-sub">
          {[client, p.project_address].filter(Boolean).join(" · ") || "Client and address not set"}
          {p.archived && <span className="sc-pill">Archived</span>}
        </p>
      </header>

      {processing && (
        <p className="sc-alert" role="status" aria-live="polite">
          <span className="sc-spinner" aria-hidden="true" /> {p.processing_note || "Working"}... A long recording can take a few minutes. You can leave this page.
        </p>
      )}
      {message && <p className="sc-alert sc-alert-good" role="status">{message}</p>}
      {error && (
        <p className="sc-alert sc-alert-bad" role="alert">
          {error} <button type="button" className="sc-link" onClick={() => setError(null)}>Dismiss</button>
        </p>
      )}

      <div className="sc-acc">
        {STEPS.map((step, i) => {
          const isOpen = open === step;
          return (
            <section key={step} id={`sc-sec-${step}`} className={`sc-sec${isOpen ? " sc-sec-open" : ""}`}>
              <h2 className="sc-sec-h">
                <button
                  type="button"
                  className="sc-sec-btn"
                  aria-expanded={isOpen}
                  aria-controls={`sc-panel-${step}`}
                  id={`sc-head-${step}`}
                  onClick={() => show(step, true)}
                >
                  <span className={`sc-sec-n${done[step] ? " sc-sec-done" : ""}`} aria-hidden="true">
                    {step === "project" ? "···" : done[step] ? "✓" : i + 1}
                  </span>
                  <span className="sc-sec-text">
                    <span className="sc-sec-title">{TITLE[step]}</span>
                    <span className={`sc-sec-sum${attention[step] ? " sc-sec-attn" : ""}`}>{summary[step]}</span>
                  </span>
                  <span className="sc-sec-chev" aria-hidden="true" />
                </button>
              </h2>
              {/* The recorder stays mounted while its section is closed, so closing it never stops a recording. */}
              {step === "record" ? (
                <div className="sc-sec-panel" id="sc-panel-record" role="region" aria-labelledby="sc-head-record" hidden={!isOpen}>
                  <Recorder projectId={id} kind="recording" onUploaded={() => void reload()} onFinished={() => void process()} onActive={setRecording} />
                  <AddMaterial ws={ws} onAdded={() => reload()} />
                </div>
              ) : (
                isOpen && (
                  <div className="sc-sec-panel" id={`sc-panel-${step}`} role="region" aria-labelledby={`sc-head-${step}`}>
                    {panel[step]()}
                  </div>
                )
              )}
            </section>
          );
        })}
      </div>

      {(showNext || processing || player) && (
        <div className="sc-dock">
          {player && (
            <div className="sc-player" role="region" aria-label="Recording playback">
              <span className="sc-small">{player.label}</span>
              <audio ref={audio} controls preload="metadata" src={assetUrl(id, player.assetId)} />
              <button type="button" className="sc-btn sc-btn-small" onClick={() => setPlayer(null)} aria-label="Close player">Close</button>
            </div>
          )}
          {processing ? (
            <button type="button" className="sc-btn sc-btn-primary sc-dock-btn" disabled>
              <span className="sc-spinner" aria-hidden="true" /> Working...
            </button>
          ) : (
            showNext && next && (
              <button type="button" className="sc-btn sc-btn-primary sc-dock-btn" onClick={next.go}>
                <span>{next.label}</span>
                {next.hint && <small>{next.hint}</small>}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

const ICON = {
  photo: "M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
  file: "M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6",
  voice: "M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v4",
  note: "M4 20h4L19 9l-4-4L4 16zM13 7l4 4",
};
function Icon({ name }: { name: keyof typeof ICON }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICON[name]} />
    </svg>
  );
}

function AddMaterial({ ws, onAdded }: { ws: WS; onAdded: () => Promise<void> | void }) {
  const [note, setNote] = useState("");
  const [mode, setModeState] = useState<"voice" | "note" | null>(null);
  const tiles = useRef<HTMLDivElement | null>(null);
  // Opening a note panel brings it into view above the dock.
  const setMode = (m: "voice" | "note" | null) => {
    setModeState(m);
    if (m) setTimeout(() => tiles.current?.scrollIntoView({ block: "start", behavior: "smooth" }), 30);
  };
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = ws.project.id;

  /** Send one file: whole when small, in pieces when large, retrying each request. */
  async function sendFile(f: File, kind: string, onProgress: (text: string) => void): Promise<void> {
    const retry = async <T,>(fn: () => Promise<T>): Promise<T> => {
      for (let attempt = 1; ; attempt++) {
        try {
          return await fn();
        } catch (e) {
          if (attempt >= 4) throw e;
          await new Promise((r) => setTimeout(r, 2000 * attempt));
        }
      }
    };
    const key = newKey("file").slice(0, 100);
    if (f.size <= WHOLE_UPLOAD_BYTES) {
      const form = new FormData();
      form.append("file", f);
      form.append("kind", kind);
      form.append("clientKey", key);
      form.append("label", f.name);
      await retry(() => api(`/api/scopes/${id}/assets`, { method: "POST", body: form }));
      return;
    }
    if (f.size > MAX_FILE_BYTES) throw new Error(`Files up to ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB can be uploaded.`);
    const parts = Math.ceil(f.size / PART_BYTES);
    const fields = (form: FormData) => {
      form.append("uploadKey", key);
      form.append("parts", String(parts));
      form.append("size", String(f.size));
      return form;
    };
    for (let i = 0; i < parts; i++) {
      onProgress(`${Math.round((i / parts) * 100)}%`);
      const form = fields(new FormData());
      form.append("part", String(i));
      form.append("file", f.slice(i * PART_BYTES, Math.min(f.size, (i + 1) * PART_BYTES)), "part");
      await retry(() => api(`/api/scopes/${id}/assets/parts`, { method: "POST", body: form }));
    }
    onProgress("saving");
    const done = fields(new FormData());
    done.append("finish", "1");
    done.append("kind", kind === "photo" ? "photo" : "document");
    done.append("name", f.name);
    done.append("label", f.name);
    done.append("mime", f.type);
    await retry(() => api(`/api/scopes/${id}/assets/parts`, { method: "POST", body: done }));
  }

  async function upload(input: HTMLInputElement, kind?: "photo" | "document") {
    const files = Array.from(input.files ?? []);
    // Clearing the input lets the same file be picked again.
    input.value = "";
    if (!files.length) return;
    setBusy(true);
    setError(null);
    let done = 0;
    const problems: string[] = [];
    for (const f of files) {
      const label = `Uploading ${f.name} (${done + 1} of ${files.length})`;
      setStatus(`${label}...`);
      try {
        await sendFile(f, kind ?? (f.type.startsWith("image/") ? "photo" : f.type.startsWith("audio/") ? "note" : "document"), (p) => setStatus(`${label}, ${p}...`));
        done++;
      } catch (e) {
        problems.push(`${f.name}: ${(e as Error).message}`);
      }
    }
    if (problems.length) setError(problems.join(" "));
    setStatus(`${plural(done, "file")} added.`);
    setBusy(false);
    await onAdded();
  }

  async function saveNote() {
    if (!note.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/scopes/${id}/assets`, { method: "POST", json: { clientKey: newKey("text").slice(0, 100), text: note, label: "Typed note" } });
      setNote("");
      setMode(null);
      setStatus("Note added.");
      await onAdded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sc-add">
      <h3 className="sc-add-h">Add to this project</h3>
      <div className="sc-tiles" ref={tiles}>
        <label className={`sc-tile sc-file${busy ? " sc-tile-off" : ""}`}>
          <Icon name="photo" />
          Photos
          <input type="file" accept="image/*" multiple onChange={(e) => void upload(e.currentTarget, "photo")} disabled={busy} />
        </label>
        <label className={`sc-tile sc-file${busy ? " sc-tile-off" : ""}`}>
          <Icon name="file" />
          Plans and files
          <input type="file" multiple onChange={(e) => void upload(e.currentTarget)} disabled={busy} />
        </label>
        <button type="button" className={`sc-tile${mode === "voice" ? " sc-tile-on" : ""}`} aria-expanded={mode === "voice"} onClick={() => setMode(mode === "voice" ? null : "voice")}>
          <Icon name="voice" />
          Voice note
        </button>
        <button type="button" className={`sc-tile${mode === "note" ? " sc-tile-on" : ""}`} aria-expanded={mode === "note"} onClick={() => setMode(mode === "note" ? null : "note")}>
          <Icon name="note" />
          Typed note
        </button>
      </div>
      {/* Kept mounted so hiding the tile never stops a note that is being recorded. */}
      <div className="sc-add-panel" hidden={mode !== "voice"}>
        <Recorder projectId={id} kind="note" compact onUploaded={() => void onAdded()} />
      </div>
      {mode === "note" && (
        <form className="sc-add-panel" onSubmit={(e) => { e.preventDefault(); void saveNote(); }}>
          <label className="sc-field">
            <span>Note or change</span>
            <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Client switched to quartz counters." />
          </label>
          <div className="sc-actions">
            <button type="submit" className="sc-btn sc-btn-primary" disabled={busy || !note.trim()}>Add note</button>
          </div>
        </form>
      )}
      {status && <p className="sc-muted sc-small" role="status">{status}</p>}
      {error && <p className="sc-alert sc-alert-bad" role="alert">{error}</p>}
    </div>
  );
}

function FilesAndHistory({ ws, onWorkspace, onPlay, onError }: { ws: WS; onWorkspace: (w: WS) => void; onPlay: (e: Evidence) => void; onError: (m: string) => void }) {
  const id = ws.project.id;
  const p = ws.project;
  const setError = onError;
  const [busy, setBusy] = useState<string | null>(null);
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState("");
  const [syncNotes, setSyncNotes] = useState<string[]>([]);
  const act = async (action: string, name: string) => {
    setBusy(name);
    try {
      const res = await api<{ workspace: WS; summary?: { notes?: string[]; quickbooks?: { sent: number; failed: number }; hubspot?: { sent: number; failed: number } } | null }>(`/api/scopes/${id}`, { method: "POST", json: { action } });
      onWorkspace(res.workspace);
      if (res.summary) {
        const q = res.summary.quickbooks;
        const h = res.summary.hubspot;
        setSyncNotes([
          `Sent just now: ${q?.sent ?? 0} to QuickBooks, ${h?.sent ?? 0} to HubSpot.${(q?.failed ?? 0) + (h?.failed ?? 0) ? ` ${(q?.failed ?? 0) + (h?.failed ?? 0)} could not be sent; the reason is shown on each file below.` : ""}`,
          ...(res.summary.notes ?? []),
        ]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    setBusy("delete");
    try {
      await api(`/api/scopes/${id}`, { method: "DELETE", json: { confirm: "DELETE" } });
      router.push("/scopes");
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };
  const patch = async (fields: Record<string, string>) => {
    try {
      const { workspace } = await api<{ workspace: WS }>(`/api/scopes/${id}`, { method: "PATCH", json: fields });
      onWorkspace(workspace);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const archive = async (archived: boolean) => {
    try {
      const { workspace } = await api<{ workspace: WS }>(`/api/scopes/${id}`, { method: "PATCH", json: { archived } });
      onWorkspace(workspace);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const restore = async (versionId: number) => {
    try {
      const { workspace } = await api<{ workspace: WS }>(`/api/scopes/${id}/scope`, { method: "POST", json: { action: "edit", ops: [{ op: "restore-version", versionId }] } });
      onWorkspace(workspace);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="sc-files">
      <section className="sc-card">
        <h2 className="sc-h2">Project settings</h2>
        <div className="sc-two">
          <label className="sc-field">
            <span>Type of work</span>
            <select value={p.service} onChange={(ev) => void patch({ service: ev.target.value })}>
              {SERVICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="sc-field">
            <span>Finish tier</span>
            <select value={p.finish_tier} onChange={(ev) => void patch({ finish_tier: ev.target.value })}>
              <option value="builder">Builder grade</option>
              <option value="mid">Mid-range</option>
              <option value="high">High-end</option>
              <option value="luxury">Luxury</option>
            </select>
          </label>
        </div>
        <p className="sc-small sc-muted">Client name and address are edited under Estimate.</p>
      </section>
      <section className="sc-card">
        <h2 className="sc-h2">Property record</h2>
        {ws.property ? (
          <>
            <dl className="sc-ledger">
              {ws.property.rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
            </dl>
            <p className="sc-small sc-muted">
              From {ws.property.source}, looked up {when(ws.property.lookedUpAt)}. A public record, not a site measurement: it informs the scope, and any quantity taken from it is asked for confirmation. It does not include the size of individual rooms.
            </p>
          </>
        ) : !ws.propertyLookup.configured ? (
          <p className="sc-muted">Property lookup is not set up yet. Once a RentCast key is added, the address pulls in living area, bedrooms, bathrooms, year built and more.</p>
        ) : !p.project_address ? (
          <p className="sc-muted">Save the project address and the public record is looked up automatically.</p>
        ) : (
          <p className="sc-muted">{ws.propertyLookup.checked ? "No public record was found for this address." : "Not looked up yet."}</p>
        )}
        {ws.propertyLookup.configured && p.project_address && (
          <button type="button" className="sc-btn" disabled={!!busy} onClick={() => act("property", "property")}>
            {busy === "property" ? "Looking up..." : ws.property ? "Look up again" : "Look up the property"}
          </button>
        )}
      </section>
      <section className="sc-card">
        <h2 className="sc-h2">Copies in QuickBooks and HubSpot</h2>
        <p className="sc-muted">
          Plans, documents, photos and quotes are copied to the QuickBooks estimate or customer and to the client&apos;s HubSpot contact. Recordings and notes stay here.
        </p>
        {syncNotes.map((n, i) => <p key={i} className="sc-small sc-muted">{n}</p>)}
        <button type="button" className="sc-btn" disabled={!!busy} onClick={() => act("sync-files", "sync")}>
          {busy === "sync" ? "Sending files..." : "Send files now"}
        </button>
      </section>
      <section className="sc-card">
        <h2 className="sc-h2">Recordings, notes and files ({ws.assets.length})</h2>
        {ws.assets.length === 0 && <p className="sc-muted">Nothing yet.</p>}
        <ul className="sc-assets">
          {ws.assets.map((a) => (
            <li key={a.id}>
              <div className="sc-row-between">
                <span>
                  <b>{a.label || a.fileName}</b>{" "}
                  <span className="sc-muted sc-small">
                    {a.kind}
                    {a.durationSeconds ? `, ${clock(a.durationSeconds)}` : ""} · {when(a.createdAt)} ·{" "}
                    {a.state === "failed" ? (isAudioAsset(a) ? "saved, not transcribed yet" : "could not be read") : a.state === "transcribing" ? "transcribing" : a.usedInVersion ? "in the scope" : "not yet read"}
                  </span>
                </span>
                {a.kind !== "text" && <a className="sc-btn sc-btn-small" href={assetUrl(id, a.id)} target="_blank" rel="noreferrer">Open</a>}
              </div>
              {a.copies.length > 0 && (
                <p className="sc-small sc-muted">
                  {a.copies.map((c) => `${c.target === "quickbooks" ? "QuickBooks" : "HubSpot"}: ${COPY_LABEL[c.status] ?? c.status}`).join(" · ")}
                </p>
              )}
              {a.copies.filter((c) => c.status === "failed" && c.error).map((c) => (
                <p key={c.target} className="sc-small sc-text-warn">{c.target === "quickbooks" ? "QuickBooks" : "HubSpot"}: {c.error}</p>
              ))}
              {a.error && <p className="sc-small sc-text-warn">{a.error}</p>}
              {a.bodyText && <p className="sc-small">{a.bodyText}</p>}
              {a.transcript && a.transcript.length > 0 && (
                <details>
                  <summary className="sc-small">Transcript{a.transcriptApproximate ? " (times are approximate)" : ""}</summary>
                  <ol className="sc-transcript">
                    {a.transcript.map((s, i) => (
                      <li key={i}>
                        <button type="button" className="sc-ev" onClick={() => onPlay({ assetId: a.id, t: a.offsetSeconds + s.start })}>
                          ▶ {clock(a.offsetSeconds + s.start)}
                        </button>{" "}
                        {s.text}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="sc-card">
        <h2 className="sc-h2">Scope versions ({ws.versions.length})</h2>
        <p className="sc-muted">Every change is kept. Restoring makes a copy as the newest version.</p>
        <ul className="sc-plain">
          {ws.versions.map((v) => (
            <li key={v.id} className="sc-row-between">
              <span>
                <b>Version {v.versionNo}</b> <span className="sc-muted sc-small">{when(v.createdAt)} · {v.source}{v.note ? ` · ${v.note}` : ""}</span>
                {ws.estimate?.versionId === v.id && <span className="sc-pill sc-pill-ready">Sent to QuickBooks</span>}
              </span>
              {ws.version?.id !== v.id && <button type="button" className="sc-btn sc-btn-small" onClick={() => restore(v.id)}>Restore</button>}
            </li>
          ))}
        </ul>
      </section>

      <section className="sc-card">
        <h2 className="sc-h2">Activity</h2>
        <ul className="sc-plain sc-small">
          {ws.events.map((e, i) => (
            <li key={i}>{when(e.at)} · {e.kind.replace(/-/g, " ")}{e.who ? ` · ${e.who}` : ""}</li>
          ))}
        </ul>
        <button type="button" className="sc-btn" onClick={() => archive(!ws.project.archived)}>
          {ws.project.archived ? "Restore to active projects" : "Archive this project"}
        </button>
        <p className="sc-small sc-muted">Archived projects keep every file, version and estimate and stay searchable under Archived.</p>
      </section>
      {ws.viewer.internal && (
        <details className="sc-card sc-more">
          <summary>Delete this project</summary>
          <p>
            Deletes the project here and removes what it put in QuickBooks: the estimate, the files attached there, and the QuickBooks project if this platform created it. <b>The customer is never touched.</b> A job that has been invoiced cannot be deleted; archive it instead. This cannot be undone from this screen.
          </p>
          <label className="sc-field">
            <span>Type DELETE to confirm</span>
            <input value={confirmDelete} onChange={(ev) => setConfirmDelete(ev.target.value)} autoComplete="off" autoCapitalize="characters" />
          </label>
          <button type="button" className="sc-btn sc-btn-danger" disabled={confirmDelete.trim() !== "DELETE" || !!busy} onClick={remove}>
            {busy === "delete" ? "Deleting..." : "Delete project"}
          </button>
        </details>
      )}
    </div>
  );
}
