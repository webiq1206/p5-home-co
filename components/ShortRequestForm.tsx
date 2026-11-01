"use client";

import { useEffect, useId, useRef, useState, type FocusEvent } from "react";

import { track, trackAcceptedInquiry } from "../app/analytics";
import { normalizeEmail, normalizePhone } from "../app/lib/leads/normalize.ts";
import {
  CALLBACK_REQUEST,
  CONTACT_PREFERENCES,
  contactPreferenceFrom,
  type ContactPreference,
} from "../app/lib/leads/shortRequest.ts";
import { PUBLIC_PHONE_DISPLAY, PUBLIC_PHONE_SMS } from "../app/publicIdentity";
import { isNewAcceptedInquiry } from "../app/quote/conversion.ts";
import { PROJECT_OPTIONS, brandForProject } from "../app/quote/options.ts";
import { saveQuoteReceipt } from "../app/quote/thanksState.ts";
import ThanksQuestions from "../app/quote/ThanksQuestions";
import TrackedPhoneLink from "../app/quote/TrackedPhoneLink";
import { captureAttribution } from "../lib/p5/browserAttribution.ts";
import { PhoneIcon } from "./family/Icons";
import SaveContactButton from "./SaveContactButton";
import { OpenChatButton } from "./SiteChat";

const MAX_FILES = 4;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

const FALLBACK_PROJECT = "Something else, or I am not sure";
const STORAGE_KEY = "p5-quote-form-v5";

/** The project list, grouped the way people describe the work. Each value routes to one company. */
const PROJECT_GROUPS: ReadonlyArray<{ label: string; projects: readonly string[] }> = [
  {
    label: "Remodel or addition",
    projects: ["Kitchen remodel", "Bathroom remodel", "Whole-home remodel", "Home addition", "Basement finishing"],
  },
  { label: "New custom home", projects: ["New custom home", "Build on land I own"] },
  { label: "ADU or conversion", projects: ["Accessory dwelling unit (ADU)", "Garage conversion"] },
  { label: "Cabinets or built-ins", projects: ["Custom cabinets or built-ins", "Bathroom vanity"] },
  { label: "Repairs or handyman", projects: ["Home repairs or handyman work"] },
  { label: "Something else", projects: [FALLBACK_PROJECT] },
];

type Mode = "request" | "callback";
type Field = "name" | "phone" | "note" | "email";

type Draft = {
  mode: Mode;
  name: string;
  phone: string;
  note: string;
  email: string;
  reach: ContactPreference;
  project: string;
  bestTime: string;
};

const FIELD_ORDER: readonly Field[] = ["name", "phone", "note", "email"];

function knownProject(value: unknown): string {
  return typeof value === "string" && PROJECT_OPTIONS.some((option) => option.value === value) ? value : "";
}

function initialDraft(defaultProject?: string): Draft {
  return {
    mode: "request",
    name: "",
    phone: "",
    note: "",
    email: "",
    reach: "call",
    project: knownProject(defaultProject),
    bestTime: "",
  };
}

function readDraft(defaultProject?: string): Draft {
  const fresh = initialDraft(defaultProject);
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return fresh;
    const saved = JSON.parse(raw) as Partial<Draft>;
    const str = (value: unknown) => (typeof value === "string" ? value : "");
    return {
      mode: saved.mode === "callback" ? "callback" : "request",
      name: str(saved.name),
      phone: str(saved.phone),
      note: str(saved.note),
      email: str(saved.email),
      reach: contactPreferenceFrom(saved.reach),
      project: knownProject(saved.project) || fresh.project,
      bestTime: str(saved.bestTime),
    };
  } catch {
    return fresh;
  }
}

/** Plain-word checks that mirror the server (app/lib/leads/shortRequest.ts). */
function fieldError(field: Field, draft: Draft): string | null {
  if (field === "name") return draft.name.trim() ? null : "Enter your name.";
  if (field === "phone") {
    if (!draft.phone.trim()) return "Enter a phone number so we can reach you.";
    return normalizePhone(draft.phone) ? null : "Enter a 10-digit phone number, area code first.";
  }
  if (draft.mode === "callback") return null;
  if (field === "note") return draft.note.trim() ? null : "Tell us a little about what you need.";
  if (field === "email") {
    const email = draft.email.trim();
    if (!email) return draft.reach === "email" ? "Enter an email address so we can reply by email." : null;
    return normalizeEmail(email) ? null : "That email address does not look right.";
  }
  return null;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

/**
 * The quote form: one short screen.
 *
 * Name, phone and what they need, then optional photos, email and how to
 * reach them. Project type sits in "Add more detail (optional)" and still
 * routes the request to the right company when given. "Send a request" |
 * "Have us call you" sits under the heading; the callback side reduces the
 * form to name and phone and sends a callback request through the same
 * route. Call, text and chat sit above the button on phones, beside it on
 * wider screens.
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
  const uid = useId();
  const ids = {
    heading: `${uid}-heading`,
    name: `${uid}-name`,
    phone: `${uid}-phone`,
    note: `${uid}-note`,
    email: `${uid}-email`,
    files: `${uid}-files`,
    project: `${uid}-project`,
    bestTime: `${uid}-best-time`,
    next: `${uid}-next`,
  };
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [hydrated, setHydrated] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => initialDraft(defaultProject));
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [done, setDone] = useState<{ first: string; callback: boolean; team: string; filesMissing: boolean } | null>(
    null,
  );

  // The saved draft lives in sessionStorage, which only exists after mount;
  // reading it during render would make the server and client HTML differ.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from sessionStorage after hydration
    setDraft(readDraft(defaultProject));
    setHydrated(true);
  }, [defaultProject]);

  useEffect(() => {
    if (!hydrated || done) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    } catch {
      /* private mode */
    }
  }, [draft, hydrated, done]);

  // Arriving on #<id>: the browser has already scrolled the form under the
  // header (scroll-margin-top). Screen readers start at its heading; no text
  // field takes focus, so a phone keyboard never covers the form.
  useEffect(() => {
    const focusHeading = () => {
      if (window.location.hash === `#${id}`) headingRef.current?.focus({ preventScroll: true });
    };
    focusHeading();
    window.addEventListener("hashchange", focusHeading);
    return () => window.removeEventListener("hashchange", focusHeading);
  }, [id]);

  // A "Request a quote" link to the page the visitor is already on (the
  // header, menu or footer CTA on /quote) would otherwise do nothing visible.
  // It brings the form back instead. The link's own click tracking still
  // runs; only the navigation is skipped.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      const here = window.location;
      if (url.origin !== here.origin || url.pathname !== here.pathname || url.search !== here.search || url.hash) return;
      event.preventDefault();
      const bring = () => {
        document.getElementById(id)?.scrollIntoView({ block: "start" });
        headingRef.current?.focus({ preventScroll: true });
      };
      bring();
      // Again once the menu has closed and released its scroll lock.
      window.requestAnimationFrame(() => window.requestAnimationFrame(bring));
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [id]);

  useEffect(() => {
    if (!done) return;
    headingRef.current?.focus({ preventScroll: true });
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [done, id]);

  const callback = draft.mode === "callback";
  const team = brandForProject(draft.project || FALLBACK_PROJECT);

  function update(next: Partial<Draft>) {
    const merged = { ...draft, ...next };
    setStatus(null);
    setDraft(merged);
    // An error clears as soon as the visitor fixes it; new errors wait for blur or submit.
    if (FIELD_ORDER.some((field) => errors[field] && !fieldError(field, merged))) {
      const after = { ...errors };
      for (const field of FIELD_ORDER) if (after[field] && !fieldError(field, merged)) delete after[field];
      setErrors(after);
    }
  }

  function onBlur(field: Field) {
    return (event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      // Leaving an untouched empty field is not a mistake yet.
      if (!event.currentTarget.value.trim() && !errors[field]) return;
      const message = fieldError(field, draft);
      setErrors((current) => {
        const after = { ...current };
        if (message) after[field] = message;
        else delete after[field];
        return after;
      });
    };
  }

  function focusField(field: Field) {
    const element = document.getElementById(ids[field]);
    if (element) {
      element.focus({ preventScroll: true });
      element.scrollIntoView({ block: "center" });
    }
  }

  async function onSubmit() {
    if (pending || done) return;
    const found: Partial<Record<Field, string>> = {};
    for (const field of FIELD_ORDER) {
      const message = fieldError(field, draft);
      if (message) found[field] = message;
    }
    setErrors(found);
    const first = FIELD_ORDER.find((field) => found[field]);
    if (first) {
      setStatus(null);
      focusField(first);
      return;
    }
    const sending = callback ? [] : files;
    if (sending.length > MAX_FILES) {
      setStatus("Attach up to 4 photos or files.");
      return;
    }
    if (sending.some((file) => file.size > MAX_FILE_BYTES)) {
      setStatus("Each file must be 8 MB or smaller.");
      return;
    }
    if (sending.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_BYTES) {
      setStatus("Those files together are larger than 20 MB.");
      return;
    }

    const project = draft.project || FALLBACK_PROJECT;
    const body = new FormData();
    body.set("name", draft.name.trim());
    body.set("phone", draft.phone.trim());
    body.set("project", project);
    body.set("form", formName);
    body.set("website_url", "");
    if (callback) {
      body.set("request_type", CALLBACK_REQUEST);
      body.set("contact_preference", "call");
      if (draft.bestTime.trim()) body.set("best_time", draft.bestTime.trim());
    } else {
      body.set("request_type", "request");
      body.set("note", draft.note.trim());
      body.set("email", draft.email.trim());
      body.set("contact_preference", draft.reach);
    }
    for (const [key, value] of Object.entries(captureAttribution())) {
      if (value) body.set(key, value);
    }
    for (const file of sending) body.append("files", file);

    setPending(true);
    setStatus(null);
    try {
      const response = await fetch("/api/leads/short-request", { method: "POST", body });
      const payload = (await response.json().catch(() => ({}))) as {
        accepted?: unknown;
        filesAttached?: unknown;
        error?: string;
        field?: string;
      };
      if (!response.ok) {
        const field = FIELD_ORDER.find((name) => name === payload.field);
        if (field && payload.error) {
          setErrors({ [field]: payload.error });
          focusField(field);
        } else {
          setStatus(payload.error || `We could not send that. Call ${PUBLIC_PHONE_DISPLAY}.`);
        }
        setPending(false);
        return;
      }
      if (isNewAcceptedInquiry(response.status, payload, false)) trackAcceptedInquiry();
      saveQuoteReceipt({
        project,
        team,
        files: sending.length,
        filesAttached: payload.filesAttached === true,
      });
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      setPending(false);
      setDone({
        first: firstName(draft.name),
        callback,
        team,
        filesMissing: sending.length > 0 && payload.filesAttached !== true,
      });
    } catch {
      setStatus(`We could not send that. Call ${PUBLIC_PHONE_DISPLAY}.`);
      setPending(false);
    }
  }

  const describe = (field: Field, hint?: string) =>
    [hint, errors[field] ? `${ids[field]}-error` : null].filter(Boolean).join(" ") || undefined;

  const error = (field: Field) => (
    <p id={`${ids[field]}-error`} className="quote-field-error" aria-live="polite">
      {errors[field] ?? ""}
    </p>
  );

  // "Prefer to talk?" as the family shows it: call full width, text and chat
  // half width. Above the send button on phones, beside it on wider screens.
  const talk = (
    <div className="quote-form-talk" role="group" aria-labelledby={`${uid}-talk`}>
      <p id={`${uid}-talk`}>Prefer to talk?</p>
      <TrackedPhoneLink className="quote-form-talk-button quote-form-talk-call" location="quote_form">
        <PhoneIcon width={18} height={18} aria-hidden="true" />
        <span>Call {PUBLIC_PHONE_DISPLAY}</span>
      </TrackedPhoneLink>
      <div className="quote-form-talk-row">
        <a
          className="quote-form-talk-button"
          href={PUBLIC_PHONE_SMS}
          onClick={() => track("text_click", { location: "quote_form" })}
        >
          Text us
        </a>
        <OpenChatButton className="quote-form-talk-button" location="quote_form">
          Chat
        </OpenChatButton>
      </div>
    </div>
  );

  return (
    <form
      id={id}
      className={`short-request quote-form${plain ? " short-request-plain" : ""}${compact ? " short-request-compact" : ""}`}
      data-suppress-mobile-bar=""
      data-suppress-sticky-cta=""
      data-form-mode={done ? "done" : draft.mode}
      data-ready={hydrated ? "" : undefined}
      aria-labelledby={ids.heading}
      // Before hydration a tap still posts to the lead route instead of
      // putting a name and phone number into this page's URL.
      method="post"
      action="/api/leads/short-request"
      encType="multipart/form-data"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit();
      }}
      noValidate
    >
      <h2 id={ids.heading} ref={headingRef} tabIndex={-1} className={compact ? "short-request-sr" : undefined}>
        {done
          ? done.first
            ? `Thanks, ${done.first}. We have your request.`
            : "Thanks. We have your request."
          : callback
            ? "Request a call"
            : "Request a quote"}
      </h2>

      {done ? (
        <div className="quote-form-done">
          <p>
            {done.callback
              ? `Someone from ${done.team} calls you back within one business day.`
              : `A specialist from ${done.team} replies within one business day with questions or a time to visit. You get a written scope before any price.`}
          </p>
          {done.filesMissing && (
            <p>The photos did not attach. Call or text {PUBLIC_PHONE_DISPLAY} and we will take them another way.</p>
          )}
          <p>
            Need it sooner?{" "}
            <TrackedPhoneLink location="form_thanks">Call {PUBLIC_PHONE_DISPLAY}</TrackedPhoneLink>
            <span aria-hidden="true"> or </span>
            <a href={PUBLIC_PHONE_SMS} onClick={() => track("text_click", { location: "form_thanks" })}>
              text us
            </a>
            .
          </p>
          <SaveContactButton location="form_thanks" />
          <ThanksQuestions />
        </div>
      ) : (
        <>
          {/* Two equal choices, the family's segmented control: the form, or a callback. */}
          <div className="quote-form-modes" role="group" aria-label="How would you like to start?">
            <button
              type="button"
              className="quote-form-mode"
              aria-pressed={!callback}
              onClick={() => update({ mode: "request" })}
            >
              Send a request
            </button>
            <button
              type="button"
              className="quote-form-mode"
              aria-pressed={callback}
              onClick={() => update({ mode: "callback" })}
            >
              Have us call you
            </button>
          </div>

          <div className="quote-form-field">
            <label htmlFor={ids.name}>Name</label>
            <input
              id={ids.name}
              name="name"
              type="text"
              autoComplete="name"
              autoCapitalize="words"
              required
              maxLength={120}
              value={draft.name}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={describe("name")}
              onChange={(event) => update({ name: event.target.value })}
              onBlur={onBlur("name")}
            />
            {error("name")}
          </div>

          <div className="quote-form-field">
            <label htmlFor={ids.phone}>Phone</label>
            <input
              id={ids.phone}
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              maxLength={30}
              value={draft.phone}
              aria-invalid={errors.phone ? true : undefined}
              aria-describedby={describe("phone")}
              onChange={(event) => update({ phone: event.target.value })}
              onBlur={onBlur("phone")}
            />
            {error("phone")}
          </div>

          {callback ? (
            <div className="quote-form-field">
              <label htmlFor={ids.bestTime}>
                Best time to call <span className="quote-form-optional">(optional)</span>
              </label>
              <input
                id={ids.bestTime}
                name="best_time"
                type="text"
                autoComplete="off"
                maxLength={120}
                value={draft.bestTime}
                onChange={(event) => update({ bestTime: event.target.value })}
              />
            </div>
          ) : (
            <>
              <div className="quote-form-field">
                <label htmlFor={ids.note}>What do you need?</label>
                <textarea
                  id={ids.note}
                  name="note"
                  rows={3}
                  required
                  maxLength={4000}
                  value={draft.note}
                  aria-invalid={errors.note ? true : undefined}
                  aria-describedby={describe("note")}
                  onChange={(event) => update({ note: event.target.value })}
                  onBlur={onBlur("note")}
                />
                {error("note")}
              </div>

              <div className="quote-form-field short-request-file">
                <label htmlFor={ids.files}>
                  Add photos <span className="quote-form-optional">(optional)</span>
                </label>
                <input
                  id={ids.files}
                  name="files"
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,.heic,.heif,application/pdf"
                  onChange={(event) => setFiles([...(event.target.files ?? [])].filter((file) => file.size > 0))}
                />
              </div>

              <div className="quote-form-field">
                <label htmlFor={ids.email}>
                  Email {draft.reach === "email" ? null : <span className="quote-form-optional">(optional)</span>}
                </label>
                <input
                  id={ids.email}
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  maxLength={200}
                  required={draft.reach === "email"}
                  value={draft.email}
                  aria-invalid={errors.email ? true : undefined}
                  aria-describedby={describe("email")}
                  onChange={(event) => update({ email: event.target.value })}
                  onBlur={onBlur("email")}
                />
                {error("email")}
              </div>

              <fieldset className="quote-form-reach">
                <legend>How should we reach you?</legend>
                <div className="quote-form-pills">
                  {CONTACT_PREFERENCES.map((option) => (
                    <label key={option.value} className="quote-form-pill">
                      <input
                        type="radio"
                        name="contact_preference"
                        value={option.value}
                        checked={draft.reach === option.value}
                        onChange={() => update({ reach: option.value })}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <details className="quote-form-more">
                <summary>Add more detail (optional)</summary>
                <div className="quote-form-field">
                  <label htmlFor={ids.project}>Type of project</label>
                  <select
                    id={ids.project}
                    name="project"
                    value={draft.project}
                    aria-describedby={draft.project ? `${ids.project}-team` : undefined}
                    onChange={(event) => update({ project: event.target.value })}
                  >
                    <option value="">Not sure yet</option>
                    {PROJECT_GROUPS.map((group) => (
                      <optgroup key={group.label} label={group.label}>
                        {group.projects.map((project) => (
                          <option key={project} value={project}>
                            {project}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  {draft.project ? (
                    <p id={`${ids.project}-team`} className="quote-form-hint">
                      Goes to {team}.
                    </p>
                  ) : null}
                </div>
              </details>
            </>
          )}

          <label className="short-request-trap">
            Website
            <input name="website_url" type="text" tabIndex={-1} autoComplete="off" />
          </label>
          <input type="hidden" name="form" value={formName} />
          <input type="hidden" name="request_type" value={callback ? CALLBACK_REQUEST : "request"} />

          <div className="quote-form-actions">
            {talk}
            <div className="quote-form-send">
              <button
                className="button button-dark short-request-submit"
                type="submit"
                disabled={pending}
                aria-busy={pending}
                aria-describedby={ids.next}
              >
                {pending ? "Sending" : callback ? "Request a call" : "Send my request"}
              </button>
              <p id={ids.next} className="quote-form-next">
                {callback
                  ? "We call you back within one business day."
                  : "We reply within one business day with questions or a time to visit."}
              </p>
            </div>
          </div>
          {status && (
            <p className="short-request-status" role="alert">
              {status}
            </p>
          )}
        </>
      )}
    </form>
  );
}
