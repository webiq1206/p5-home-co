"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import { track, trackAcceptedInquiry } from "../app/analytics";
import { PUBLIC_PHONE_DISPLAY } from "../app/publicIdentity";
import { isNewAcceptedInquiry } from "../app/quote/conversion.ts";
import { continueAssistantProject } from "../lib/p5/assistantContinuation.ts";
import { captureAttribution } from "../lib/p5/browserAttribution.ts";
import styles from "./SiteChat.module.css";

type Line = { role: "user" | "team"; content: string };

const GREETING = `Tell us what your home needs. Call ${PUBLIC_PHONE_DISPLAY} anytime, or type a short note here and we will route it to the right P5 team.`;

/** Opens the on-site chat from any Call / Chat / form row. */
export function openSiteChat() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("p5:chat-open"));
}

export function OpenChatButton({
  className,
  children = "Chat",
  location = "chat",
  onOpen,
}: {
  className?: string;
  children?: React.ReactNode;
  location?: string;
  onOpen?: () => void;
}) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        track("chat_open", { location });
        onOpen?.();
        openSiteChat();
      }}
    >
      {children}
    </button>
  );
}

export default function SiteChat() {
  const path = usePathname() || "";
  const hidden = path.startsWith("/admin") || path.startsWith("/portal");
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"note" | "contact" | "sent">("note");
  const [lines, setLines] = useState<Line[]>([{ role: "team", content: GREETING }]);
  const [note, setNote] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const trapRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (hidden) return;
    const onOpen = () => setOpen(true);
    window.addEventListener("p5:chat-open", onOpen);
    return () => window.removeEventListener("p5:chat-open", onOpen);
  }, [hidden]);

  useEffect(() => {
    if (!open || hidden) return;
    const dialog = dialogRef.current;
    const pin = () => {
      if (!dialog) return;
      const viewport = window.visualViewport;
      const narrow = window.matchMedia("(max-width: 820px)").matches;
      if (narrow && viewport) {
        dialog.style.top = `${viewport.offsetTop}px`;
        dialog.style.left = "0px";
        dialog.style.width = "100%";
        dialog.style.height = `${viewport.height}px`;
        dialog.style.right = "auto";
        dialog.style.bottom = "auto";
      } else {
        dialog.style.top = "";
        dialog.style.left = "";
        dialog.style.width = "";
        dialog.style.height = "";
        dialog.style.right = "";
        dialog.style.bottom = "";
      }
    };
    pin();
    document.body.dataset.p5ChatOpen = "true";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.visualViewport?.addEventListener("resize", pin);
    window.visualViewport?.addEventListener("scroll", pin);
    dialog?.querySelector<HTMLElement>("textarea, input:not([tabindex='-1'])")?.focus();
    return () => {
      delete document.body.dataset.p5ChatOpen;
      window.removeEventListener("keydown", onKey);
      window.visualViewport?.removeEventListener("resize", pin);
      window.visualViewport?.removeEventListener("scroll", pin);
    };
  }, [open, phase, hidden]);

  function close() {
    setOpen(false);
  }

  function userNotes(): { role: string; content: string }[] {
    return lines.filter((line) => line.role === "user");
  }

  function continueInEstimator() {
    try {
      continueAssistantProject(userNotes(), note);
      window.location.assign("/estimate");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "The estimator could not open from this chat. Call (208) 477-1169.";
      setLines((current) => [...current, { role: "team", content: message }]);
    }
  }

  function sendNote(event: React.FormEvent) {
    event.preventDefault();
    const text = note.trim();
    if (!text) {
      setError("Type a short note, or call the number above.");
      return;
    }
    setError("");
    setLines((current) => [
      ...current,
      { role: "user", content: text },
      { role: "team", content: "What is your name and phone? We will send this note to the right team." },
    ]);
    setNote("");
    setPhase("contact");
  }

  async function sendContact(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (!name.trim()) {
      setError("Enter a name.");
      return;
    }
    if (phone.replace(/\D/g, "").length < 10) {
      setError("Enter a phone number we can call.");
      return;
    }
    setPending(true);
    setError("");
    const summary = userNotes().map((line) => line.content).join("\n\n");
    try {
      const response = await fetch("/api/leads/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          brand: "P5 Home Co",
          projectType: "Something else, or I am not sure",
          summary,
          form: "Site Chat",
          source: "Organic Website",
          website_url: trapRef.current?.value ?? "",
          ...captureAttribution(),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { accepted?: unknown; error?: string; message?: string };
      if (!response.ok) {
        setError(payload.error || `We could not send that. Call ${PUBLIC_PHONE_DISPLAY}.`);
        setPending(false);
        return;
      }
      if (isNewAcceptedInquiry(response.status, payload, false)) trackAcceptedInquiry();
      setLines((current) => [
        ...current,
        { role: "user", content: `${name.trim()}, ${phone.trim()}` },
        { role: "team", content: payload.message || "Thanks. Your note is with the team and someone will follow up." },
      ]);
      setPhase("sent");
      setPending(false);
    } catch {
      setError(`We could not send that. Call ${PUBLIC_PHONE_DISPLAY}.`);
      setPending(false);
    }
  }

  if (hidden || !open) return null;

  return (
    <div
      ref={dialogRef}
      className={styles.shell}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-state="open"
    >
      <header className={styles.header}>
        <p id={titleId}>Chat with P5</p>
        <button type="button" className={styles.close} onClick={close} aria-label="Close chat">×</button>
      </header>
      <ul className={styles.log}>
        {lines.map((line, index) => (
          <li key={`${line.role}-${index}`} className={line.role === "user" ? styles.user : styles.team}>{line.content}</li>
        ))}
      </ul>
      {phase !== "sent" && (
        <form className={styles.composer} onSubmit={phase === "note" ? sendNote : sendContact}>
          {phase === "note" ? (
            <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="A short note about the project" aria-label="A short note about the project" maxLength={4000} />
          ) : (
            <>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" aria-label="Name" autoComplete="name" maxLength={120} />
              <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Phone" aria-label="Phone" autoComplete="tel" inputMode="tel" maxLength={30} />
            </>
          )}
          <label className={styles.trap}>
            Website
            <input ref={trapRef} name="website_url" type="text" tabIndex={-1} autoComplete="off" />
          </label>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <div className={styles.row}>
            <button className="button button-dark" type="submit" disabled={pending} aria-busy={pending}>
              {phase === "note" ? "Continue" : pending ? "Sending" : "Send to the team"}
            </button>
            <button className={styles.continue} type="button" onClick={continueInEstimator}>Continue in the estimator</button>
          </div>
        </form>
      )}
      {phase === "sent" && (
        <div className={styles.composer}>
          <button className={styles.continue} type="button" onClick={continueInEstimator}>Continue in the estimator</button>
        </div>
      )}
    </div>
  );
}
