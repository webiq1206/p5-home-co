"use client";

/**
 * Meeting and walkthrough recorder.
 *
 * Protecting the recording is the whole design:
 *   - Audio is written to this device (IndexedDB) every 5 seconds while it
 *     records, so a crash, a dead battery or a closed tab loses at most a few
 *     seconds. Leftover parts are found and uploaded the next time the
 *     project is opened on this device.
 *   - The recording is cut into independent 10-minute parts. Each part is a
 *     complete audio file, uploaded as soon as it closes and retried until the
 *     server confirms it. The server deduplicates by part key, so a retry can
 *     never create a second copy.
 *   - A device interruption (phone call, app switch, screen lock on iPhone)
 *     ends the microphone. That is detected, what was captured is kept, and
 *     Resume starts a new part on the same timeline.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { clock, newKey } from "./client.ts";

const SEGMENT_SECONDS = 600;
const SLICE_MS = 5000;
const DB = "p5-scope-recorder";

type SegmentMeta = {
  key: string;
  projectId: number;
  kind: "recording" | "note";
  recordingId: string;
  segment: number;
  offsetSeconds: number;
  durationSeconds: number | null;
  mime: string;
  label: string;
  closed: boolean;
  startedAt: number;
};

type Chunk = { key: string; seq: number; blob: Blob };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("segments")) db.createObjectStore("segments", { keyPath: "key" });
      if (!db.objectStoreNames.contains("chunks")) {
        const s = db.createObjectStore("chunks", { keyPath: ["key", "seq"] });
        s.createIndex("byKey", "key");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req ? (req as IDBRequest<T>).result : undefined);
    t.onerror = () => reject(t.error);
  });
}

const putSegment = (m: SegmentMeta) => tx("segments", "readwrite", (s) => s.put(m));
const putChunk = (c: Chunk) => tx("chunks", "readwrite", (s) => s.put(c));
const allSegments = async () => ((await tx<SegmentMeta[]>("segments", "readonly", (s) => s.getAll())) ?? []) as SegmentMeta[];
async function chunksFor(key: string): Promise<Chunk[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction("chunks", "readonly").objectStore("chunks").index("byKey").getAll(key);
    req.onsuccess = () => resolve((req.result as Chunk[]).sort((a, b) => a.seq - b.seq));
    req.onerror = () => reject(req.error);
  });
}
async function forget(key: string): Promise<void> {
  const chunks = await chunksFor(key);
  await tx("chunks", "readwrite", (s) => {
    for (const c of chunks) s.delete([c.key, c.seq]);
  });
  await tx("segments", "readwrite", (s) => s.delete(key));
}

function pickMime(): string {
  const options = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/aac"];
  for (const m of options) if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
  return "";
}

const extFor = (mime: string) => (mime.includes("mp4") || mime.includes("aac") ? "m4a" : "webm");

type Phase = "idle" | "recording" | "paused" | "interrupted" | "saving";

export default function Recorder({
  projectId,
  kind,
  onUploaded,
  onFinished,
  compact,
}: {
  projectId: number;
  kind: "recording" | "note";
  onUploaded?: () => void;
  onFinished?: () => void;
  compact?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [pending, setPending] = useState(0);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recovered, setRecovered] = useState(0);
  const [level, setLevel] = useState(0);

  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const meta = useRef<SegmentMeta | null>(null);
  const seq = useRef(0);
  const elapsedRef = useRef(0);
  const segStart = useRef(0);
  const recordingId = useRef("");
  const segmentIndex = useRef(0);
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);
  const uploading = useRef(false);
  const finishing = useRef(false);
  const phaseRef = useRef<Phase>("idle");
  const audioCtx = useRef<AudioContext | null>(null);
  // Chunk writes are serialized so a part is never uploaded before its last chunk is on disk.
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  // Fallback when this browser has no usable IndexedDB (private mode): parts are held in memory.
  const memory = useRef<Map<string, { meta: SegmentMeta; blobs: Blob[] }>>(new Map());
  const label = kind === "recording" ? "Meeting recording" : "Dictated note";

  const setP = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  // ---- uploads ------------------------------------------------------------

  const uploadAll = useCallback(async () => {
    if (uploading.current) return;
    uploading.current = true;
    try {
      let delay = 2000;
      for (;;) {
        let todo: SegmentMeta[] = [];
        let fromDisk = true;
        try {
          todo = (await allSegments()).filter((s) => s.projectId === projectId && s.kind === kind && s.closed);
        } catch {
          fromDisk = false;
        }
        const disk = new Set(todo.map((s) => s.key));
        for (const held of memory.current.values()) {
          if (held.meta.closed && !disk.has(held.meta.key)) todo.push(held.meta);
        }
        todo.sort((a, b) => a.startedAt - b.startedAt || a.segment - b.segment);
        setPending(todo.length);
        if (!todo.length) {
          setUploadNote(null);
          break;
        }
        const s = todo[0];
        const chunks = fromDisk && disk.has(s.key) ? (await chunksFor(s.key).catch(() => [] as Chunk[])).map((c) => c.blob) : [];
        const blobs = chunks.length ? chunks : (memory.current.get(s.key)?.blobs ?? []);
        if (!blobs.length) {
          await forget(s.key).catch(() => undefined);
          memory.current.delete(s.key);
          continue;
        }
        const blob = new Blob(blobs, { type: s.mime || blobs[0].type });
        const form = new FormData();
        form.append("file", blob, `${s.kind}-${s.recordingId.slice(0, 8)}-part${s.segment + 1}.${extFor(s.mime)}`);
        form.append("kind", s.kind);
        form.append("clientKey", s.key);
        form.append("recordingId", s.recordingId);
        form.append("segmentIndex", String(s.segment));
        form.append("offsetSeconds", String(s.offsetSeconds));
        if (s.durationSeconds !== null) form.append("durationSeconds", String(s.durationSeconds));
        form.append("label", `${s.label}${s.segment ? `, part ${s.segment + 1}` : ""}`);
        try {
          setUploadNote(`Uploading part ${s.segment + 1}...`);
          const res = await fetch(`/api/scopes/${projectId}/assets`, { method: "POST", body: form });
          const body = await res.json().catch(() => ({}));
          if (!res.ok || !body.ok) throw new Error(body.error || `Upload failed (${res.status})`);
          await forget(s.key).catch(() => undefined);
          memory.current.delete(s.key);
          delay = 2000;
          onUploaded?.();
        } catch (e) {
          setUploadNote(
            navigator.onLine
              ? `Upload did not finish (${(e as Error).message}). Retrying in ${Math.round(delay / 1000)} s. The audio is safe on this device.`
              : "No connection. The recording is saved on this device and uploads when the connection returns.",
          );
          await new Promise((r) => setTimeout(r, delay));
          delay = Math.min(delay * 2, 60_000);
          if (!navigator.onLine) {
            await new Promise<void>((r) => {
              const on = () => {
                window.removeEventListener("online", on);
                r();
              };
              window.addEventListener("online", on);
              setTimeout(on, 60_000);
            });
          }
        }
      }
    } finally {
      uploading.current = false;
    }
    // Finished only when the last part has closed and uploaded. An earlier
    // upload pass ending while the final part is still being written must not
    // start scope generation without it.
    const stillOpen = [...memory.current.values()].some((h) => !h.meta.closed);
    if (finishing.current && phaseRef.current === "saving" && !stillOpen && memory.current.size === 0) {
      finishing.current = false;
      setP("idle");
      onFinished?.();
    }
  }, [projectId, kind, onUploaded, onFinished]);

  // Recover parts left on this device by a crash, a closed tab or a lost connection.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const leftovers = (await allSegments()).filter((s) => s.projectId === projectId && s.kind === kind && !memory.current.has(s.key));
        if (!leftovers.length || cancelled) return;
        for (const s of leftovers) {
          if (!s.closed) {
            const chunks = await chunksFor(s.key);
            await putSegment({ ...s, closed: true, durationSeconds: s.durationSeconds ?? (chunks.length * SLICE_MS) / 1000 });
          }
        }
        setRecovered(leftovers.length);
        void uploadAll();
      } catch {
        // IndexedDB unavailable (private mode): recording still works, without device backup.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, kind, uploadAll]);

  // ---- timer, wake lock, interruptions ------------------------------------

  useEffect(() => {
    if (phase !== "recording") return;
    const t = setInterval(() => {
      elapsedRef.current += 1;
      setElapsed(elapsedRef.current);
      if (elapsedRef.current - segStart.current >= SEGMENT_SECONDS) rotate();
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    const onVisible = async () => {
      if (document.visibilityState === "visible" && (phaseRef.current === "recording" || phaseRef.current === "paused")) {
        await requestWakeLock();
        const track = stream.current?.getAudioTracks()[0];
        if (!track || track.readyState === "ended") interrupted();
      } else if (document.visibilityState === "hidden" && phaseRef.current === "recording") {
        setWarning("This screen was left while recording. On some phones the microphone stops in the background; check the timer when you return.");
      }
    };
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (phaseRef.current === "recording" || phaseRef.current === "paused") {
        e.preventDefault();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("beforeunload", beforeUnload);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function requestWakeLock() {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
      if (nav.wakeLock && !wakeLock.current) {
        const lock = (await nav.wakeLock.request("screen")) as { release: () => Promise<void>; addEventListener?: (t: string, f: () => void) => void };
        // The phone releases the lock whenever the page is hidden; forget it so it is requested again on return.
        lock.addEventListener?.("release", () => {
          if (wakeLock.current === lock) wakeLock.current = null;
        });
        wakeLock.current = lock;
      }
    } catch {
      // Not supported or refused; the notice tells the employee to keep the screen on.
    }
  }

  function releaseWakeLock() {
    wakeLock.current?.release().catch(() => undefined);
    wakeLock.current = null;
  }

  // ---- recording ----------------------------------------------------------

  async function openStream(): Promise<MediaStream> {
    const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    s.getAudioTracks()[0]?.addEventListener("ended", () => interrupted());
    stream.current = s;
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtx.current = new Ctx();
      const analyser = audioCtx.current.createAnalyser();
      analyser.fftSize = 256;
      audioCtx.current.createMediaStreamSource(s).connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!audioCtx.current) return;
        analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(Math.min(1, peak / 64));
        requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // Level meter is a nicety.
    }
    return s;
  }

  function closeAudioCtx() {
    audioCtx.current?.close().catch(() => undefined);
    audioCtx.current = null;
    setLevel(0);
  }

  function startSegment(s: MediaStream) {
    const mime = pickMime();
    const rec = new MediaRecorder(s, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32_000 });
    const m: SegmentMeta = {
      key: `rec-${recordingId.current}-${segmentIndex.current}`,
      projectId,
      kind,
      recordingId: recordingId.current,
      segment: segmentIndex.current,
      offsetSeconds: elapsedRef.current,
      durationSeconds: null,
      mime: rec.mimeType || mime,
      label,
      closed: false,
      startedAt: Date.now(),
    };
    meta.current = m;
    seq.current = 0;
    segStart.current = elapsedRef.current;
    void putSegment(m).catch(() => undefined);
    memory.current.set(m.key, { meta: m, blobs: [] });
    rec.ondataavailable = (e) => {
      if (!e.data || e.data.size === 0) return;
      const n = seq.current++;
      memory.current.get(m.key)?.blobs.push(e.data);
      writes.current = writes.current
        .then(() => putChunk({ key: m.key, seq: n, blob: e.data }))
        .catch(() => setWarning("This device could not keep a backup copy. Keep the connection on until the upload finishes."));
    };
    rec.onstop = () => {
      const closed = { ...m, closed: true, durationSeconds: elapsedRef.current - m.offsetSeconds };
      const held = memory.current.get(m.key);
      if (held) held.meta = closed;
      writes.current = writes.current
        .then(() => putSegment(closed))
        .catch(() => undefined)
        .then(() => uploadAll());
    };
    rec.onerror = () => interrupted();
    rec.start(SLICE_MS);
    recorder.current = rec;
    segmentIndex.current += 1;
  }

  function rotate() {
    const rec = recorder.current;
    if (!rec || !stream.current) return;
    rec.stop();
    startSegment(stream.current);
  }

  function interrupted() {
    if (phaseRef.current !== "recording" && phaseRef.current !== "paused") return;
    try {
      if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
    } catch {
      // Already stopped by the device.
    }
    recorder.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    closeAudioCtx();
    setP("interrupted");
    setWarning("The device stopped the microphone (a call, another app, or the screen locking). Everything up to this point is saved. Tap Resume to keep recording.");
  }

  async function start() {
    setError(null);
    setWarning(null);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("This browser cannot record audio. Use Safari on iPhone or Chrome on Android, or upload a recording file instead.");
      return;
    }
    try {
      const s = await openStream();
      recordingId.current = newKey("r").slice(2);
      segmentIndex.current = 0;
      elapsedRef.current = 0;
      setElapsed(0);
      startSegment(s);
      await requestWakeLock();
      setP("recording");
    } catch (e) {
      setError(
        (e as Error).name === "NotAllowedError"
          ? "Microphone access was blocked. Allow the microphone for this site in the browser settings, then try again."
          : `The microphone could not start: ${(e as Error).message}`,
      );
    }
  }

  function pause() {
    recorder.current?.requestData();
    recorder.current?.pause();
    setP("paused");
  }

  async function resume() {
    setWarning(null);
    if (phaseRef.current === "interrupted") {
      try {
        const s = await openStream();
        startSegment(s);
        await requestWakeLock();
        setP("recording");
      } catch (e) {
        setError(`The microphone could not restart: ${(e as Error).message}`);
      }
      return;
    }
    recorder.current?.resume();
    setP("recording");
  }

  function stop() {
    finishing.current = true;
    setP("saving");
    // If the device already ended the recorder without telling us, close what
    // it left open so the captured audio is uploaded and saving can finish.
    const closeOrphans = () => {
      for (const held of memory.current.values()) {
        if (held.meta.closed) continue;
        held.meta = { ...held.meta, closed: true, durationSeconds: elapsedRef.current - held.meta.offsetSeconds };
        const closed = held.meta;
        writes.current = writes.current.then(() => putSegment(closed)).catch(() => undefined);
      }
      void writes.current.then(() => uploadAll());
    };
    try {
      if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
      else closeOrphans();
    } catch {
      closeOrphans();
    }
    recorder.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    closeAudioCtx();
    releaseWakeLock();
  }

  const active = phase === "recording" || phase === "paused" || phase === "interrupted";

  return (
    <div className={`sc-recorder${compact ? " sc-recorder-compact" : ""}`}>
      {recovered > 0 && (
        <p className="sc-alert" role="status">
          Found {recovered} unsaved recording part{recovered === 1 ? "" : "s"} on this device. Uploading now.
        </p>
      )}

      {!active && phase !== "saving" && (
        <button type="button" className="sc-rec-start" onClick={start}>
          <span className="sc-rec-dot" aria-hidden="true" />
          {kind === "recording" ? "Start recording" : "Record a note"}
        </button>
      )}

      {active && (
        <div className="sc-rec-live" role="group" aria-label="Recording controls">
          <div className={`sc-rec-indicator sc-rec-${phase}`} aria-live="polite">
            <span className="sc-rec-dot" aria-hidden="true" />
            <b>{phase === "recording" ? "Recording" : phase === "paused" ? "Paused" : "Interrupted"}</b>
            <span className="sc-rec-time" aria-label={`Elapsed ${clock(elapsed)}`}>{clock(elapsed)}</span>
            <span className="sc-rec-level" aria-hidden="true">
              <span style={{ transform: `scaleX(${phase === "recording" ? Math.max(0.04, level) : 0.04})` }} />
            </span>
          </div>
          <div className="sc-actions">
            {phase === "recording" ? (
              <button type="button" className="sc-btn" onClick={pause}>Pause</button>
            ) : (
              <button type="button" className="sc-btn" onClick={resume}>Resume</button>
            )}
            <button type="button" className="sc-btn sc-btn-primary" onClick={stop}>Stop and save</button>
          </div>
        </div>
      )}

      {phase === "saving" && <p className="sc-alert" role="status">Saving the recording{pending ? ` (${pending} part${pending === 1 ? "" : "s"} left)` : ""}...</p>}
      {uploadNote && <p className="sc-muted" role="status">{uploadNote}</p>}
      {warning && <p className="sc-alert sc-alert-warn" role="alert">{warning}</p>}
      {error && <p className="sc-alert sc-alert-bad" role="alert">{error}</p>}

      {!compact && (
        <details className="sc-device-note">
          <summary>Before you record on a phone</summary>
          <ul>
            <li>Keep this screen open. On iPhone, switching apps, locking the screen or answering a call stops the microphone. The screen is kept awake while recording where the phone allows it.</li>
            <li>If the device interrupts, everything captured so far is kept. Tap Resume to continue on the same timeline.</li>
            <li>Audio is saved on this phone every few seconds and uploaded in 10-minute parts. With no signal, it waits on the phone and uploads when the connection returns. Do not clear browser data before it finishes.</li>
            <li>Tell the client the conversation is being recorded.</li>
          </ul>
        </details>
      )}
    </div>
  );
}
