"use client";

import { useRef, useState } from "react";

/** Tap to dictate, tap again to stop. The text is returned; nothing is stored. */
export default function Dictate({ onText, label = "Dictate" }: { onText: (text: string) => void; label?: string }) {
  const [state, setState] = useState<"idle" | "listening" | "working">("idle");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const parts = useRef<Blob[]>([]);

  async function toggle() {
    setError(null);
    if (state === "listening") {
      rec.current?.stop();
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      setError("Dictation is not available in this browser. Use the keyboard microphone instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream);
      parts.current = [];
      r.ondataavailable = (e) => e.data.size && parts.current.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setState("working");
        try {
          const form = new FormData();
          const blob = new Blob(parts.current, { type: r.mimeType || "audio/webm" });
          form.append("file", blob, r.mimeType.includes("mp4") ? "dictation.m4a" : "dictation.webm");
          const res = await fetch("/api/admin/scopes/dictate", { method: "POST", body: form });
          const body = await res.json();
          if (!res.ok || !body.ok) throw new Error(body.error || "Dictation failed.");
          onText(body.text);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setState("idle");
        }
      };
      r.start();
      rec.current = r;
      setState("listening");
    } catch (e) {
      setError(`The microphone could not start: ${(e as Error).message}`);
    }
  }

  return (
    <span className="sc-dictate">
      <button type="button" className={`sc-btn sc-btn-small${state === "listening" ? " sc-btn-live" : ""}`} onClick={toggle} disabled={state === "working"} aria-pressed={state === "listening"}>
        {state === "listening" ? "Stop dictation" : state === "working" ? "Transcribing..." : label}
      </button>
      {error && <span className="sc-error-inline" role="alert">{error}</span>}
    </span>
  );
}
