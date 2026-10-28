"use client";

import { useId, useState } from "react";

import { trackAcceptedInquiry } from "../app/analytics";
import { PUBLIC_PHONE_DISPLAY } from "../app/publicIdentity";
import { isNewAcceptedInquiry } from "../app/quote/conversion.ts";
import { PROJECT_OPTIONS } from "../app/quote/options.ts";
import { captureAttribution } from "../lib/p5/browserAttribution.ts";
import SaveContactButton from "./SaveContactButton";

const MAX_FILES = 4;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

const FALLBACK_PROJECT = "Something else, or I am not sure";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Primary lead form. Name, phone, email, and a project note are required.
 * A photo, plan, or file is optional. This is the only public surface that accepts those files.
 */
export function ShortRequestForm({
  id,
  formName,
  defaultProject,
  plain = false,
  compact = false,
}: {
  id: string;
  formName: string;
  defaultProject?: string;
  plain?: boolean;
  compact?: boolean;
}) {
  const nameId = useId();
  const phoneId = useId();
  const emailId = useId();
  const noteId = useId();
  const projectId = useId();
  const fileId = useId();
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const projectDefault = PROJECT_OPTIONS.some((option) => option.value === defaultProject)
    ? defaultProject
    : FALLBACK_PROJECT;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || done) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const phone = String(data.get("phone") ?? "").trim();
    const email = String(data.get("email") ?? "").trim();
    const note = String(data.get("note") ?? "").trim();
    if (!name) {
      setStatus({ tone: "error", text: "Enter a name." });
      return;
    }
    if (phone.replace(/\D/g, "").length < 10) {
      setStatus({ tone: "error", text: "Enter a phone number we can call." });
      return;
    }
    if (!email || !EMAIL.test(email)) {
      setStatus({ tone: "error", text: email ? "That email address does not look right." : "Enter an email address." });
      return;
    }
    if (!note) {
      setStatus({ tone: "error", text: "Add a short note about the project." });
      return;
    }
    const picked = [...(form.querySelector<HTMLInputElement>('input[type="file"]')?.files ?? [])].filter((file) => file.size > 0);
    if (picked.length > MAX_FILES) {
      setStatus({ tone: "error", text: "Attach up to 4 files." });
      return;
    }
    const total = picked.reduce((sum, file) => sum + file.size, 0);
    if (picked.some((file) => file.size > MAX_FILE_BYTES)) {
      setStatus({ tone: "error", text: "Each file must be 8 MB or smaller." });
      return;
    }
    if (total > MAX_TOTAL_BYTES) {
      setStatus({ tone: "error", text: "Those files together are larger than 20 MB." });
      return;
    }

    const body = new FormData();
    body.set("name", name);
    body.set("phone", phone);
    body.set("email", email);
    body.set("note", note);
    body.set("project", String(data.get("project") ?? projectDefault));
    body.set("form", formName);
    body.set("website_url", String(data.get("website_url") ?? ""));
    for (const [key, value] of Object.entries(captureAttribution())) {
      if (value) body.set(key, value);
    }
    for (const file of picked) body.append("files", file);

    setPending(true);
    setStatus(null);
    try {
      const response = await fetch("/api/leads/short-request", { method: "POST", body });
      const payload = (await response.json().catch(() => ({}))) as { accepted?: unknown; error?: string; message?: string };
      if (!response.ok) {
        setStatus({ tone: "error", text: payload.error || `We could not send that. Call ${PUBLIC_PHONE_DISPLAY}.` });
        setPending(false);
        return;
      }
      if (isNewAcceptedInquiry(response.status, payload, false)) trackAcceptedInquiry();
      setDone(true);
      setStatus({
        tone: "ok",
        text:
          payload.message ||
          "We reply within one business day with questions or a time to visit. You get a written scope before any price.",
      });
    } catch {
      setStatus({ tone: "error", text: `We could not send that. Call ${PUBLIC_PHONE_DISPLAY}.` });
      setPending(false);
    }
  }

  return (
    <form
      id={id}
      className={`short-request${plain ? " short-request-plain" : ""}${compact ? " short-request-compact" : ""}`}
      data-suppress-mobile-bar=""
      data-suppress-sticky-cta=""
      onSubmit={onSubmit}
      noValidate
    >
      <h2 className={compact ? "short-request-sr" : undefined}>Request a quote</h2>
      {compact ? null : <p className="short-request-note">No obligation. Or call {PUBLIC_PHONE_DISPLAY}.</p>}
      {done ? (
        <div className="short-request-thanks">
          <p className="short-request-status" role="status">{status?.text}</p>
          <SaveContactButton location="form_thanks" />
          <p className="short-request-note">Save our contact so you have Nick&apos;s number when we call back.</p>
        </div>
      ) : (
        <>
          <label htmlFor={nameId}>
            Name
            <input id={nameId} name="name" type="text" autoComplete="name" required maxLength={120} />
          </label>
          <label htmlFor={phoneId}>
            Phone
            <input id={phoneId} name="phone" type="tel" autoComplete="tel" inputMode="tel" required maxLength={30} />
          </label>
          <label htmlFor={emailId}>
            Email
            <input id={emailId} name="email" type="email" autoComplete="email" inputMode="email" required maxLength={200} />
          </label>
          <label htmlFor={noteId}>
            Project note
            <textarea id={noteId} name="note" required maxLength={4000} rows={compact ? 2 : 3} />
          </label>
          <label htmlFor={projectId}>
            Project
            <select id={projectId} name="project" defaultValue={projectDefault}>
              {PROJECT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.value}</option>
              ))}
            </select>
          </label>
          <label className="short-request-file" htmlFor={fileId}>
            <span>Add a photo, plan, or file <small>Optional</small></span>
            <input
              id={fileId}
              name="files"
              type="file"
              multiple
              accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,.heic,.heif,application/pdf"
            />
          </label>
          <label className="short-request-trap">
            Website
            <input name="website_url" type="text" tabIndex={-1} autoComplete="off" />
          </label>
          <button className="button button-dark short-request-submit" type="submit" disabled={pending} aria-busy={pending}>
            {pending ? "Sending" : "Request a quote"}
          </button>
          {status && <p className="short-request-status" role="alert">{status.text}</p>}
        </>
      )}
    </form>
  );
}
