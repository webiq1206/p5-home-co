"use client";

/**
 * The project workspace. One screen, five steps as tabs:
 *   Record -> Scope -> Details -> Pricing -> Estimate   (+ Files and history)
 * State lives on the server; this component holds a copy and refreshes it
 * after every action, on a timer while open, and when the tab regains focus,
 * so another employee's change or a QuickBooks update appears on its own.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Evidence } from "../../../lib/scopes/types.ts";
import { api, clock, newKey, SCOPE_LABEL, SERVICES, when, type Workspace as WS } from "./client.ts";
import EstimatePanel from "./EstimatePanel.tsx";
import { assetUrl } from "./EvidenceLinks.tsx";
import PricingView from "./PricingView.tsx";
import Recorder from "./Recorder.tsx";
import ScopeView from "./ScopeView.tsx";
import Wizard from "./Wizard.tsx";
import Dictate from "./Dictate.tsx";

type Tab = "record" | "scope" | "details" | "pricing" | "estimate" | "files";
const TABS: [Tab, string][] = [
  ["record", "Record"],
  ["scope", "Scope"],
  ["details", "Details"],
  ["pricing", "Pricing"],
  ["estimate", "Estimate"],
  ["files", "Files"],
];

export default function Workspace({ initial, initialTab }: { initial: WS; initialTab?: string }) {
  const [ws, setWs] = useState<WS>(initial);
  const [tab, setTabState] = useState<Tab>((TABS.find(([t]) => t === initialTab)?.[0] as Tab) ?? (initial.version ? "scope" : "record"));
  const [processing, setProcessing] = useState(initial.project.processing_state === "running");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [player, setPlayer] = useState<{ assetId: number; t: number; label: string } | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const id = ws.project.id;

  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", t);
      window.history.replaceState(null, "", url);
    } catch {
      // Cosmetic.
    }
  };

  const reload = useCallback(
    async (refresh = false) => {
      try {
        const { workspace, refreshError } = await api<{ workspace: WS; refreshError?: string | null }>(`/api/admin/scopes/${id}${refresh ? "?refresh=1" : ""}`);
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
      const res = await api<{ message: string }>(`/api/admin/scopes/${id}/process`, { method: "POST" });
      setMessage(res.message);
      await reload();
      setTab("scope");
    } catch (e) {
      // A long recording can outlast the request while the server keeps working.
      // If it is still running, keep showing progress instead of an error.
      const latest = await api<{ workspace: WS }>(`/api/admin/scopes/${id}`).catch(() => null);
      if (latest) setWs(latest.workspace);
      if (latest?.workspace.project.processing_state === "running") return;
      setError((e as Error).message);
      setProcessing(false);
    }
  }, [id, reload]);

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
  const fresh = ws.assets.filter((a) => !a.usedInVersion && a.state !== "failed" && !proposed.has(a.id));
  const patchProject = async (fields: Record<string, string>) => {
    try {
      const { workspace } = await api<{ workspace: WS }>(`/api/admin/scopes/${id}`, { method: "PATCH", json: fields });
      setWs(workspace);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const blocking = ws.questions.filter((q) => q.blocking).length;
  const p = ws.project;
  const client = [p.client_first_name, p.client_last_name].filter(Boolean).join(" ");

  return (
    <div className="sc-ws">
      <header className="sc-ws-head">
        <Link href="/admin/scopes" className="sc-back">All projects</Link>
        <h1 className="admin-h1">{client || p.title || "New project"}</h1>
        <p className="admin-sub">
          {[p.title && client ? p.title : null, p.project_address].filter(Boolean).join(" · ") || "Address not set"}
          {" · "}
          <label className="sc-inline-select">
            <span className="sc-visually-hidden">Type of work</span>
            <select
              value={p.service}
              onChange={(ev) => void patchProject({ service: ev.target.value })}
            >
              {SERVICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="sc-inline-select">
            <span className="sc-visually-hidden">Finish tier</span>
            <select
              value={p.finish_tier}
              onChange={(ev) => void patchProject({ finish_tier: ev.target.value })}
            >
              <option value="builder">Builder grade</option>
              <option value="mid">Mid-range</option>
              <option value="high">High-end</option>
              <option value="luxury">Luxury</option>
            </select>
          </label>
        </p>
        <div className="sc-ws-status" aria-label="Project status">
          <span className={`sc-pill sc-pill-${ws.readiness.status}`}>Scope: {SCOPE_LABEL[ws.readiness.status]}</span>
          <span className={`sc-pill sc-pill-est-${ws.estimate?.status ?? "not_created"}`}>Estimate: {ws.estimate?.statusLabel ?? "Not created"}</span>
          <span className={`sc-pill ${p.qbo_project_id ? "sc-pill-ready" : ""}`}>Project: {p.qbo_project_id ? "Linked" : "Not linked"}</span>
          {p.archived && <span className="sc-pill">Archived</span>}
        </div>
      </header>

      <nav className="sc-tabs" aria-label="Workspace steps">
        {TABS.map(([t, label], i) => (
          <button
            key={t}
            type="button"
            className={`sc-tab${tab === t ? " sc-tab-active" : ""}`}
            aria-current={tab === t ? "step" : undefined}
            onClick={() => setTab(t)}
          >
            {t !== "files" && <span className="sc-tab-n" aria-hidden="true">{i + 1}</span>}
            {label}
            {t === "details" && blocking > 0 && <span className="sc-badge" aria-label={`${blocking} required`}>{blocking}</span>}
            {t === "scope" && ws.proposal && <span className="sc-badge" aria-label="Proposed changes">!</span>}
          </button>
        ))}
      </nav>

      {processing && (
        <p className="sc-alert" role="status" aria-live="polite">
          <span className="sc-spinner" aria-hidden="true" /> {p.processing_note || "Working"}... This can take a few minutes for a long recording. You can leave this page; it keeps going.
        </p>
      )}
      {message && <p className="sc-alert sc-alert-good" role="status">{message}</p>}
      {error && (
        <p className="sc-alert sc-alert-bad" role="alert">
          {error} <button type="button" className="sc-link" onClick={() => setError(null)}>Dismiss</button>
        </p>
      )}
      {fresh.length > 0 && !processing && tab !== "record" && (
        <p className="sc-alert">
          {fresh.length} new item{fresh.length === 1 ? "" : "s"} not yet in the scope.{" "}
          <button type="button" className="sc-link" onClick={process}>Update the scope now</button>
        </p>
      )}

      {tab === "record" && (
        <div className="sc-record">
          <section className="sc-card">
            <h2 className="sc-h2">Record the meeting or walkthrough</h2>
            <Recorder projectId={id} kind="recording" onUploaded={() => void reload()} onFinished={() => void process()} />
          </section>
          <AddMaterial ws={ws} onAdded={() => reload()} />
          <section className="sc-card">
            <div className="sc-row-between">
              <div>
                <h2 className="sc-h2">{ws.version ? "Update the scope" : "Build the scope"}</h2>
                <p className="sc-muted">
                  {fresh.length
                    ? `${fresh.length} item${fresh.length === 1 ? "" : "s"} ready to read.`
                    : ws.version
                      ? "Everything added has been read."
                      : "Add a recording, note or file first."}{" "}
                  Recordings are transcribed, then every source is reconciled into one scope.
                </p>
              </div>
              <button type="button" className="sc-btn sc-btn-primary" onClick={process} disabled={processing || (!fresh.length && !ws.assets.length)}>
                {processing ? "Working..." : ws.version ? "Update scope" : "Build scope"}
              </button>
            </div>
          </section>
        </div>
      )}

      {tab === "scope" && <ScopeView ws={ws} onWorkspace={setWs} onPlay={play} />}
      {tab === "details" && <Wizard ws={ws} onWorkspace={setWs} onPlay={play} onDone={() => setTab("pricing")} />}
      {tab === "pricing" && <PricingView ws={ws} onDetails={() => setTab("details")} />}
      {tab === "estimate" && <EstimatePanel ws={ws} onWorkspace={setWs} onScope={() => setTab(blocking ? "details" : "scope")} />}
      {tab === "files" && <FilesAndHistory ws={ws} onWorkspace={setWs} onPlay={play} />}

      {player && (
        <div className="sc-player" role="region" aria-label="Recording playback">
          <span className="sc-small">{player.label}</span>
          <audio ref={audio} controls preload="metadata" src={assetUrl(id, player.assetId)} />
          <button type="button" className="sc-btn sc-btn-small" onClick={() => setPlayer(null)} aria-label="Close player">Close</button>
        </div>
      )}
    </div>
  );
}

function AddMaterial({ ws, onAdded }: { ws: WS; onAdded: () => Promise<void> | void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = ws.project.id;

  async function upload(files: FileList | null, kind?: "photo" | "document") {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    let done = 0;
    for (const f of Array.from(files)) {
      setStatus(`Uploading ${f.name} (${done + 1} of ${files.length})...`);
      const form = new FormData();
      form.append("file", f);
      form.append("kind", kind ?? (f.type.startsWith("image/") ? "photo" : f.type.startsWith("audio/") ? "note" : "document"));
      form.append("clientKey", newKey("file").slice(0, 100));
      form.append("label", f.name);
      let attempt = 0;
      for (;;) {
        try {
          await api(`/api/admin/scopes/${id}/assets`, { method: "POST", body: form });
          done++;
          break;
        } catch (e) {
          if (++attempt >= 3) {
            setError(`${f.name}: ${(e as Error).message}`);
            break;
          }
          await new Promise((r) => setTimeout(r, 2000 * attempt));
        }
      }
    }
    setStatus(`${done} file${done === 1 ? "" : "s"} added.`);
    setBusy(false);
    await onAdded();
  }

  async function saveNote() {
    if (!note.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/scopes/${id}/assets`, { method: "POST", json: { clientKey: newKey("text").slice(0, 100), text: note, label: "Typed note" } });
      setNote("");
      setStatus("Note added.");
      await onAdded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sc-card">
      <h2 className="sc-h2">Add more information</h2>
      <p className="sc-muted">Plans, photos, meeting notes, trade quotes, a dictated change or a typed note. New information updates the right phase, division and task; conflicts are flagged.</p>
      <div className="sc-add-grid">
        <label className="sc-btn sc-file">
          Take or add photos
          <input type="file" accept="image/*" capture="environment" multiple onChange={(e) => void upload(e.target.files, "photo")} disabled={busy} />
        </label>
        <label className="sc-btn sc-file">
          Add documents or plans
          <input type="file" accept=".pdf,.doc,.docx,.xlsx,.txt,.csv,image/*,audio/*" multiple onChange={(e) => void upload(e.target.files)} disabled={busy} />
        </label>
      </div>
      <div className="sc-note-rec">
        <h3 className="sc-h4">Dictate a note or change</h3>
        <Recorder projectId={id} kind="note" compact onUploaded={() => void onAdded()} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void saveNote(); }}>
        <label className="sc-field">
          <span>Type a note or change</span>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Client switched to quartz counters; backsplash goes to the ceiling behind the range." />
        </label>
        <div className="sc-actions">
          <button type="submit" className="sc-btn" disabled={busy || !note.trim()}>Add note</button>
          <Dictate onText={(t) => setNote((n) => (n ? `${n} ${t}` : t))} />
        </div>
      </form>
      {status && <p className="sc-muted" role="status">{status}</p>}
      {error && <p className="sc-alert sc-alert-bad" role="alert">{error}</p>}
    </section>
  );
}

function FilesAndHistory({ ws, onWorkspace, onPlay }: { ws: WS; onWorkspace: (w: WS) => void; onPlay: (e: Evidence) => void }) {
  const id = ws.project.id;
  const [error, setError] = useState<string | null>(null);
  const archive = async (archived: boolean) => {
    try {
      const { workspace } = await api<{ workspace: WS }>(`/api/admin/scopes/${id}`, { method: "PATCH", json: { archived } });
      onWorkspace(workspace);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const restore = async (versionId: number) => {
    try {
      const { workspace } = await api<{ workspace: WS }>(`/api/admin/scopes/${id}/scope`, { method: "POST", json: { action: "edit", ops: [{ op: "restore-version", versionId }] } });
      onWorkspace(workspace);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="sc-files">
      {error && <p className="sc-alert sc-alert-bad" role="alert">{error}</p>}
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
                    {a.state === "failed" ? "could not be read" : a.state === "transcribing" ? "transcribing" : a.usedInVersion ? "in the scope" : "not yet read"}
                  </span>
                </span>
                {a.kind !== "text" && <a className="sc-btn sc-btn-small" href={assetUrl(id, a.id)} target="_blank" rel="noreferrer">Open</a>}
              </div>
              {a.error && <p className="sc-small sc-text-warn">{a.error}</p>}
              {a.bodyText && <p className="sc-small">{a.bodyText}</p>}
              {a.transcript && a.transcript.length > 0 && (
                <details>
                  <summary className="sc-small">Transcript</summary>
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
    </div>
  );
}
