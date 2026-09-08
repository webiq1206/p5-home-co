"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { track } from "../analytics.ts";
import { deviceCategory, getEstimatorSessionId, recordRecoveryAction } from "./estimatorSession.ts";
import type { ExitMethod } from "./useAbandonmentRecovery.ts";

const PHONE_DISPLAY = "(208) 477-1169";
const PHONE_TEL = "tel:+12084771169";
const PHONE_SMS = "sms:+12084771169";

export interface AbandonmentPromptProps {
  open: boolean;
  method: ExitMethod | null;
  leaving: boolean;
  onStay: () => void;
  onContinue: () => void;
}

/**
 * "Prefer to talk instead?" for the quote form. A native <dialog> with the
 * site's own classes: focus moves in, Escape and the backdrop dismiss it, and
 * the dismissal is remembered for the session by the hook that opens it.
 */
export function AbandonmentPrompt({ open, method, leaving, onStay, onContinue }: AbandonmentPromptProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const restore = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      restore.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
      dialog.querySelector<HTMLElement>("input, button")?.focus();
      recordRecoveryAction("quote", { shown: true }, method ?? undefined);
      track("estimator_recovery_prompt", { flow: "quote", method: method ?? "unknown", action: "shown" });
    } else if (!open && dialog.open) {
      dialog.close();
      restore.current?.focus?.();
    }
  }, [open, method]);

  const dismiss = (how: "stay" | "continue") => {
    recordRecoveryAction("quote", { dismissed: true });
    track("estimator_recovery_prompt", { flow: "quote", action: how === "continue" ? "continue_leaving" : "stay" });
    if (how === "continue") onContinue(); else onStay();
  };

  async function submitCallback(event: FormEvent) {
    event.preventDefault();
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) { setState("error"); setMessage("Please enter a 10-digit phone number."); return; }
    setState("sending"); setMessage(null);
    try {
      const res = await fetch("/api/recovery/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: getEstimatorSessionId(), flow: "quote", phone: digits, name: name.trim() || undefined, pagePath: window.location.pathname, device: deviceCategory() }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok || !json.ok) { setState("error"); setMessage(json.message ?? `We could not save that. Please call ${PHONE_DISPLAY}.`); return; }
      setState("sent");
      track("estimator_recovery_prompt", { flow: "quote", action: "callback_requested" });
    } catch {
      setState("error"); setMessage(`We could not reach the server. Please call ${PHONE_DISPLAY}.`);
    }
  }

  return (
    <dialog
      ref={ref}
      className="recovery"
      aria-labelledby="recovery-title"
      aria-describedby="recovery-desc"
      data-testid="abandonment-prompt"
      onCancel={(e) => { e.preventDefault(); dismiss("stay"); }}
      onClick={(e) => { if (e.target === ref.current) dismiss("stay"); }}
    >
      <div className="recovery-panel">
        <p className="eyebrow">{leaving ? "Before you go" : "Need a hand?"}</p>
        <h2 id="recovery-title">{state === "sent" ? "We will call you back." : "Prefer to talk it through instead?"}</h2>
        <p id="recovery-desc" className="recovery-lede">
          {state === "sent"
            ? "Thanks. Someone from the team will call within one business day. You can keep going here or close this window."
            : "A quick call or text answers most questions in a minute. Or leave a number and we will call you back within one business day."}
        </p>
        {state !== "sent" && (
          <>
            <div className="recovery-actions">
              <a className="button button-dark" href={PHONE_TEL} data-testid="recovery-call" onClick={() => { recordRecoveryAction("quote", { call: true }); track("phone_click", { location: "recovery_prompt" }); }}>Call {PHONE_DISPLAY}</a>
              <a className="button" href={PHONE_SMS} data-testid="recovery-text" onClick={() => { recordRecoveryAction("quote", { text: true }); track("text_click", { location: "recovery_prompt" }); }}>Text us</a>
            </div>
            <form className="recovery-form" onSubmit={submitCallback} noValidate data-testid="recovery-callback-form">
              <p className="eyebrow">Or request a callback</p>
              <div className="recovery-row">
                <label className="visually-hidden" htmlFor="recovery-phone">Your phone number</label>
                <input id="recovery-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="(208) 555-0100" value={phone} onChange={(e) => { setPhone(e.target.value); if (state === "error") setState("idle"); }} aria-invalid={state === "error" || undefined} aria-describedby={message ? "recovery-msg" : undefined} data-testid="recovery-phone" />
                <button className="button button-dark" type="submit" disabled={state === "sending"} data-testid="recovery-callback-submit">{state === "sending" ? "Sending…" : "Call me"}</button>
              </div>
              <label className="visually-hidden" htmlFor="recovery-name">Your name (optional)</label>
              <input id="recovery-name" type="text" autoComplete="name" placeholder="Your name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
              {message && <p id="recovery-msg" className="quote-error" role="alert">{message}</p>}
            </form>
          </>
        )}
        <div className="recovery-footer">
          <button type="button" className="text-link" onClick={() => dismiss(leaving ? "continue" : "stay")} data-testid="recovery-dismiss">{leaving ? "No thanks, continue" : "No thanks"}</button>
          {state !== "sent" ? (
            <button type="button" className="text-link" onClick={() => dismiss("stay")} data-testid="recovery-stay">Keep going with my request</button>
          ) : (
            <button type="button" className="text-link" onClick={() => (leaving ? onContinue() : onStay())}>{leaving ? "Continue" : "Close"}</button>
          )}
        </div>
      </div>
    </dialog>
  );
}
