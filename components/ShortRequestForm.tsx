"use client";

import { useEffect, useId, useRef, useState, type FocusEvent } from "react";

import { track, trackAcceptedInquiry } from "../app/analytics";
import { normalizeEmail, normalizePhone } from "../app/lib/leads/normalize.ts";
import { CALLBACK_REQUEST, TIMING_OPTIONS, contactPreferenceFrom, type ContactPreference } from "../app/lib/leads/shortRequest.ts";
import { PUBLIC_PHONE_DISPLAY, PUBLIC_PHONE_SMS } from "../app/publicIdentity";
import { isNewAcceptedInquiry } from "../app/quote/conversion.ts";
import { PROJECT_OPTIONS, brandForProject } from "../app/quote/options.ts";
import { saveQuoteReceipt } from "../app/quote/thanksState.ts";
import ThanksQuestions from "../app/quote/ThanksQuestions";
import TrackedPhoneLink from "../app/quote/TrackedPhoneLink";
import { captureAttribution } from "../lib/p5/browserAttribution.ts";
import { AttachmentTile, type PickedFile } from "./AttachmentTile";
import SaveContactButton from "./SaveContactButton";
import { OpenChatButton } from "./SiteChat";

const FALLBACK_PROJECT = "Something else, or I am not sure";
const STORAGE_KEY = "p5-quote-form-v6";

/** "How should we reach you?" P5 has a text line, so Text is the default. */
const REACH_OPTIONS: ReadonlyArray<{ value: ContactPreference; label: string }> = [
  { value: "call", label: "Call" },
  { value: "text", label: "Text" },
  { value: "email", label: "Email" },
];
const DEFAULT_REACH: ContactPreference = "text";

/** "Have us call you": the same choices the family offers. "Any time" sends nothing. */
const BEST_TIMES = ["Any time", "Morning", "Midday", "Afternoon"] as const;

/** Step 2 project chips: short labels for the same values that route a request to a company. */
const PROJECT_CHIPS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "Kitchen remodel", label: "Kitchen" },
  { value: "Bathroom remodel", label: "Bathroom" },
  { value: "Whole-home remodel", label: "Whole home" },
  { value: "Home addition", label: "Addition" },
  { value: "Basement finishing", label: "Basement" },
  { value: "New custom home", label: "New home" },
  { value: "Build on land I own", label: "Build on my land" },
  { value: "Accessory dwelling unit (ADU)", label: "ADU" },
  { value: "Garage conversion", label: "Garage conversion" },
  { value: "Custom cabinets or built-ins", label: "Cabinets or built-ins" },
  { value: "Bathroom vanity", label: "Vanity" },
  { value: "Home repairs or handyman work", label: "Repairs" },
];

type Mode = "request" | "callback";
type Field = "note" | "name" | "phone" | "email";

type Draft = {
  mode: Mode;
  note: string;
  name: string;
  phone: string;
  email: string;
  reach: ContactPreference;
  project: string;
  bestTime: string;
};

/** Top to bottom, the order errors are checked and focused in. */
const FIELD_ORDER: readonly Field[] = ["note", "name", "phone", "email"];

type RequestKey = { id: number; token: string };

function ChevronIcon() {
  return (
    <svg className="quote-form-chevron" aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function TickIcon({ size = 14 }: { size?: number }) {
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

/**
 * The two steps, always in view above the form: step 1 is the request itself
 * (the only part anyone has to complete), step 2 is optional photos and
 * details. Once the request is saved, step 1 reads "Request sent" with a tick,
 * so nobody is left wondering whether the extra questions are part of sending.
 */
function QuoteSteps({ sent }: { sent: boolean }) {
  return (
    <ol className="quote-form-steps" data-quote-steps="" data-quote-sent={sent ? "true" : "false"}>
      <li aria-current={sent ? undefined : "step"} data-step-state={sent ? "done" : "current"}>
        <span className="quote-form-step-badge" aria-hidden="true">
          {sent ? <TickIcon /> : "1"}
        </span>
        <span>
          <span className="short-request-sr">Step 1: </span>
          {sent ? "Request sent" : "Your request"}
        </span>
      </li>
      <li aria-current={sent ? "step" : undefined} data-step-state={sent ? "current" : "next"}>
        <span className="quote-form-step-badge" aria-hidden="true">
          2
        </span>
        <span>
          <span className="short-request-sr">Step 2: </span>
          Photos and details (optional)
        </span>
      </li>
    </ol>
  );
}
type UploadState = "sending" | "sent" | "failed";

function knownProject(value: unknown): string {
  return typeof value === "string" && PROJECT_OPTIONS.some((option) => option.value === value) ? value : "";
}

function initialDraft(defaultProject?: string): Draft {
  return {
    mode: "request",
    note: "",
    name: "",
    phone: "",
    email: "",
    reach: DEFAULT_REACH,
    project: knownProject(defaultProject),
    bestTime: BEST_TIMES[0],
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
      note: str(saved.note),
      name: str(saved.name),
      phone: str(saved.phone),
      email: str(saved.email),
      reach: saved.reach ? contactPreferenceFrom(saved.reach) : DEFAULT_REACH,
      project: knownProject(saved.project) || fresh.project,
      bestTime: (BEST_TIMES as readonly string[]).includes(str(saved.bestTime)) ? str(saved.bestTime) : BEST_TIMES[0],
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
 * Send files one at a time to a saved request. The last one asks the server
 * to email the team the full list. Returns the keys that did not upload.
 */
async function uploadFiles(
  files: readonly PickedFile[],
  request: RequestKey,
  onState: (key: string, state: UploadState, error?: string) => void,
): Promise<string[]> {
  const failed: string[] = [];
  for (const [index, { key, file }] of files.entries()) {
    onState(key, "sending");
    const body = new FormData();
    body.set("id", String(request.id));
    body.set("token", request.token);
    body.set("file", file);
    if (index === files.length - 1) body.set("final", "1");
    try {
      const response = await fetch("/api/leads/short-request/files", { method: "POST", body });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (response.ok) onState(key, "sent");
      else {
        failed.push(key);
        onState(key, "failed", payload.error);
      }
    } catch {
      failed.push(key);
      onState(key, "failed");
    }
  }
  return failed;
}

type Done = {
  first: string;
  callback: boolean;
  team: string;
  request: RequestKey | null;
  hadEmail: boolean;
  projectKnown: boolean;
};

/**
 * The quote form, in two steps (owner, 1 November; 11 November, after a client
 * found the family form confusing because "it just kept asking more
 * questions": nothing optional is shown until asked for, and the steps line
 * says plainly where the visitor is).
 *
 * Step 1, "Your request", is only what we need to call back: what we can help
 * with, name and phone. Email and "How should we reach you?" sit in one closed
 * dropdown, "Add an email or choose how we reach you (optional)". "Send a
 * request" | "Have us call you" sits under the heading as two quiet tabs; the
 * callback side is name, phone and a best time. One send button, then one
 * quiet line of call, text and chat links.
 *
 * Step 2 sits on the success screen, after "You are all set. Nothing else is
 * needed.", as one closed dropdown: "Add photos, plans or project details
 * (optional)". Project type, address, timing, files and an email if Step 1
 * had none. It adds to the same lead (the server merges, never overwrites).
 * Leaving it closed is skipping. Files upload one by one after the lead is
 * saved, so an upload can never cost the request.
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
    bestTime: `${uid}-best-time`,
    next: `${uid}-next`,
    details: `${uid}-details`,
    address: `${uid}-address`,
    detailsEmail: `${uid}-details-email`,
  };
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [hydrated, setHydrated] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => initialDraft(defaultProject));
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [uploads, setUploads] = useState<Record<string, { state: UploadState; error?: string }>>({});
  const [done, setDone] = useState<Done | null>(null);
  /** The Step 1 dropdown of optional fields (email, how to reach you); closed until asked for. */
  const [optionsOpen, setOptionsOpen] = useState(false);

  // Step 2
  const [details, setDetails] = useState({ project: "", address: "", timing: "", email: "" });
  const [detailsState, setDetailsState] = useState<"open" | "saving" | "saved">("open");
  const [detailsError, setDetailsError] = useState<{ field: "email" | "details" | null; message: string } | null>(null);

  // The saved draft lives in sessionStorage, which only exists after mount;
  // reading it during render would make the server and client HTML differ.
  useEffect(() => {
    const restored = readDraft(defaultProject);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from sessionStorage after hydration
    setDraft(restored);
    // Anything already entered in the optional dropdown is shown, never hidden.
    if (restored.email.trim() || restored.reach !== DEFAULT_REACH) setOptionsOpen(true);
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
    const focus = () => {
      const element = document.getElementById(ids[field]);
      if (element) {
        element.focus({ preventScroll: true });
        element.scrollIntoView({ block: "center" });
      }
    };
    if (field === "email" && !optionsOpen) {
      // The email sits in the optional dropdown: open it, then focus the field.
      setOptionsOpen(true);
      window.requestAnimationFrame(focus);
    } else focus();
  }

  function setUpload(key: string, state: UploadState, error?: string) {
    setUploads((current) => ({ ...current, [key]: { state, error } }));
  }

  async function sendFiles(list: readonly PickedFile[], request: RequestKey | null) {
    if (!list.length) return [];
    if (!request) {
      for (const { key } of list) setUpload(key, "failed");
      return list.map((entry) => entry.key);
    }
    return uploadFiles(list, request, setUpload);
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
      if (draft.bestTime !== BEST_TIMES[0]) body.set("best_time", draft.bestTime);
    } else {
      body.set("request_type", "request");
      body.set("note", draft.note.trim());
      body.set("email", draft.email.trim());
      body.set("contact_preference", draft.reach);
    }
    for (const [key, value] of Object.entries(captureAttribution())) {
      if (value) body.set(key, value);
    }

    setPending(true);
    setStatus(null);
    try {
      // The request goes first and alone: files follow once it is saved.
      const response = await fetch("/api/leads/short-request", { method: "POST", body });
      const payload = (await response.json().catch(() => ({}))) as {
        accepted?: unknown;
        error?: string;
        field?: string;
        request?: { id?: unknown; token?: unknown } | null;
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
      const request =
        payload.request && typeof payload.request.id === "number" && typeof payload.request.token === "string"
          ? { id: payload.request.id, token: payload.request.token }
          : null;
      const team = brandForProject(project);
      // Files are added on Step 2, after the request is saved; Step 1 sends none.
      saveQuoteReceipt({ project, team, files: 0, filesAttached: false });
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
        request,
        hadEmail: !callback && Boolean(draft.email.trim()),
        projectKnown: Boolean(draft.project),
      });
    } catch {
      setStatus(`We could not send that. Call ${PUBLIC_PHONE_DISPLAY}.`);
      setPending(false);
    }
  }

  async function retryFailed() {
    if (!done) return;
    const failed = files.filter(({ key }) => uploads[key]?.state === "failed");
    await sendFiles(failed, done.request);
  }

  async function saveDetails() {
    if (!done || detailsState === "saving") return;
    const email = details.email.trim();
    if (email && !normalizeEmail(email)) {
      setDetailsError({ field: "email", message: "That email address does not look right." });
      document.getElementById(ids.detailsEmail)?.focus();
      return;
    }
    const fields = {
      project: details.project,
      address: details.address.trim(),
      timing: details.timing,
      email,
    };
    const filled = Object.values(fields).filter(Boolean).length;
    if (!filled && !files.length) {
      setDetailsError({ field: "details", message: "Add a detail or a file above. If you have nothing to add, you are already done." });
      return;
    }
    if (!done.request) {
      setDetailsError({ field: null, message: `We could not save that here. Call or text ${PUBLIC_PHONE_DISPLAY} with the details.` });
      return;
    }
    setDetailsError(null);
    setDetailsState("saving");
    try {
      if (filled) {
        const response = await fetch("/api/leads/short-request/details", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: done.request.id, token: done.request.token, ...fields }),
        });
        const payload = (await response.json().catch(() => ({}))) as { error?: string; field?: string; team?: string | null };
        if (!response.ok) {
          setDetailsError({
            field: payload.field === "email" ? "email" : null,
            message: payload.error || `We could not save that. Call or text ${PUBLIC_PHONE_DISPLAY}.`,
          });
          setDetailsState("open");
          return;
        }
        if (payload.team) setDone((current) => (current ? { ...current, team: payload.team ?? current.team } : current));
      }
      await sendFiles(files, done.request);
      // One analytics event, no personal details, and never a second conversion.
      track("lead_details_added", { form: "quote_landing_page", fields: filled, files: files.length });
      setDetailsState("saved");
    } catch {
      setDetailsError({ field: null, message: `We could not save that. Call or text ${PUBLIC_PHONE_DISPLAY}.` });
      setDetailsState("open");
    }
  }

  const describe = (field: Field, hint?: string) =>
    [hint, errors[field] ? `${ids[field]}-error` : null].filter(Boolean).join(" ") || undefined;

  const error = (field: Field) => (
    <p id={`${ids[field]}-error`} className="quote-field-error" aria-live="polite">
      {errors[field] ?? ""}
    </p>
  );

  const uploadNote = (key: string): string | null => {
    const upload = uploads[key];
    if (!upload) return null;
    if (upload.state === "sending") return "Sending";
    if (upload.state === "sent") return "Attached";
    return upload.error ? `Did not upload. ${upload.error}` : "Did not upload";
  };

  // "Prefer to talk?": one quiet line of links under the send button, so the
  // send button is the only button on the screen. Same tracking as before.
  const talk = (
    <p className="quote-form-talk">
      <span id={`${uid}-talk`}>Prefer to talk?</span>{" "}
      <span className="quote-form-talk-links" role="group" aria-labelledby={`${uid}-talk`}>
        <TrackedPhoneLink className="quote-form-talk-link" location="quote_form">
          Call {PUBLIC_PHONE_DISPLAY}
        </TrackedPhoneLink>
        <a
          className="quote-form-talk-link"
          href={PUBLIC_PHONE_SMS}
          onClick={() => track("text_click", { location: "quote_form" })}
        >
          Text us
        </a>
        <OpenChatButton className="quote-form-talk-link" location="quote_form">
          Chat
        </OpenChatButton>
      </span>
    </p>
  );

  const failedUploads = done ? files.filter(({ key }) => uploads[key]?.state === "failed") : [];
  const sendingUploads = done ? files.filter(({ key }) => uploads[key]?.state === "sending") : [];
  const showDetails = Boolean(done?.request);

  return (
    <form
      id={id}
      className={`short-request quote-form${plain ? " short-request-plain" : ""}${compact ? " short-request-compact" : ""}`}
      data-suppress-mobile-bar=""
      data-suppress-sticky-cta=""
      // The family mobile bar steps aside while this form, its success screen or Step 2 is on
      // screen (components/family/MobileActionBar.tsx).
      data-family-bar-yield=""
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
        // Enter in a Step 2 field saves the details; before that it sends the request.
        if (done) {
          if (detailsState === "open") void saveDetails();
        } else void onSubmit();
      }}
      noValidate
    >
      <h2 id={ids.heading} ref={headingRef} tabIndex={-1} className={compact ? "short-request-sr" : undefined}>
        {done ? (
          <span className="quote-form-tick" aria-hidden="true">
            <TickIcon size={16} />
          </span>
        ) : null}
        <span>
          {done
            ? done.first
              ? `Thanks, ${done.first}. We have your request.`
              : "Thanks. We have your request."
            : callback
              ? "Request a call"
              : "Request a quote"}
        </span>
      </h2>
      <QuoteSteps sent={Boolean(done)} />

      {done ? (
        <div className="quote-form-done">
          <p>
            {done.callback
              ? `Someone from ${done.team} will call you back to answer your questions and help you work out the next step.`
              : `A specialist from ${done.team} answers your questions and helps you work out the next step, which may be a time to visit. You get a written scope before any price.`}
          </p>

          <p className="quote-form-all-set" data-testid="quote-all-set">
            You are all set. Nothing else is needed.
          </p>

          <p>
            Have a question now?{" "}
            <TrackedPhoneLink location="form_thanks">Call {PUBLIC_PHONE_DISPLAY}</TrackedPhoneLink>
            <span aria-hidden="true"> or </span>
            <a href={PUBLIC_PHONE_SMS} onClick={() => track("text_click", { location: "form_thanks" })}>
              text us
            </a>
            .
          </p>

          {showDetails && (
            <section
              className="quote-details"
              aria-labelledby={ids.details}
              data-details-state={detailsState}
              data-testid="quote-details-panel"
            >
              {detailsState === "saved" ? (
                <>
                  <h3 id={ids.details}>Saved. Thank you.</h3>
                  <p role="status">The team sees your details with your request.</p>
                  {failedUploads.length > 0 && !sendingUploads.length && (
                    <div className="quote-form-uploads" role="status" aria-live="polite">
                      <p>{`${failedUploads.map(({ file }) => file.name).join(", ")} did not upload. Your request is saved.`}</p>
                      <p className="quote-form-upload-retry">
                        <button type="button" className="quote-form-link-button" onClick={() => void retryFailed()}>
                          Try again
                        </button>
                        <span aria-hidden="true"> or </span>
                        <a href={PUBLIC_PHONE_SMS} onClick={() => track("text_click", { location: "form_thanks" })}>
                          text them to us
                        </a>
                        .
                      </p>
                    </div>
                  )}
                </>
              ) : (
                // Step 2: one dropdown, closed until the visitor asks for it. Leaving it closed is skipping.
                <details className="quote-form-disclosure" data-testid="quote-details-disclosure">
                  <summary>
                    <h3 id={ids.details}>
                      Add photos, plans or project details <span className="quote-form-optional">(optional)</span>
                    </h3>
                    <ChevronIcon />
                  </summary>
                  <div className="quote-form-disclosure-body">
                    <p className="quote-details-why">
                      Answer any of these, or none. Each one helps us give you a closer quote on the first call.
                    </p>

                    {!done.projectKnown && (
                      <fieldset className="quote-form-reach quote-details-chips">
                        <legend>Type of project</legend>
                        <div className="quote-chips">
                          {PROJECT_CHIPS.map((chip) => (
                            <label key={chip.value} className="quote-form-pill quote-chip">
                              <input
                                type="radio"
                                name="details_project"
                                value={chip.value}
                                checked={details.project === chip.value}
                                onChange={() => setDetails({ ...details, project: chip.value })}
                              />
                              <span>{chip.label}</span>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    )}

                    <div className="quote-form-field">
                      <label htmlFor={ids.address}>Address or ZIP code</label>
                      <input
                        id={ids.address}
                        name="details_address"
                        type="text"
                        autoComplete="street-address"
                        maxLength={300}
                        value={details.address}
                        onChange={(event) => setDetails({ ...details, address: event.target.value })}
                      />
                    </div>

                    <fieldset className="quote-form-reach quote-details-chips">
                      <legend>When would you like to start?</legend>
                      <div className="quote-chips quote-chips-timing">
                        {TIMING_OPTIONS.map((timing) => (
                          <label key={timing} className="quote-form-pill quote-chip">
                            <input
                              type="radio"
                              name="details_timing"
                              value={timing}
                              checked={details.timing === timing}
                              onChange={() => setDetails({ ...details, timing })}
                            />
                            <span>{timing}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    <div className="quote-form-field">
                      <AttachmentTile
                        files={files}
                        onChange={setFiles}
                        disabled={detailsState === "saving"}
                        status={uploadNote}
                      />
                    </div>

                    {!done.hadEmail && (
                      <div className="quote-form-field">
                        <label htmlFor={ids.detailsEmail}>
                          Email <span className="quote-form-optional">(optional)</span>
                        </label>
                        <input
                          id={ids.detailsEmail}
                          name="details_email"
                          type="email"
                          inputMode="email"
                          autoComplete="email"
                          maxLength={200}
                          value={details.email}
                          aria-invalid={detailsError?.field === "email" ? true : undefined}
                          aria-describedby={detailsError?.field === "email" ? `${ids.details}-error` : undefined}
                          onChange={(event) => {
                            setDetails({ ...details, email: event.target.value });
                            if (detailsError) setDetailsError(null);
                          }}
                        />
                      </div>
                    )}

                    <p id={`${ids.details}-error`} className="quote-field-error" aria-live="polite">
                      {detailsError?.message ?? ""}
                    </p>
                    <div className="quote-details-actions">
                      <button
                        type="button"
                        className="button button-dark quote-details-save"
                        disabled={detailsState === "saving"}
                        aria-busy={detailsState === "saving"}
                        onClick={() => void saveDetails()}
                      >
                        {detailsState === "saving" ? "Saving" : "Save details"}
                      </button>
                    </div>
                  </div>
                </details>
              )}
            </section>
          )}

          <SaveContactButton location="form_thanks" />
          {/* The two feedback questions wait in their own closed dropdown, so the
              sent screen never opens with another question on it. */}
          {!showDetails || detailsState === "saved" ? (
            <details className="quote-form-disclosure quote-form-feedback">
              <summary>
                <span>
                  Answer two quick questions for us <span className="quote-form-optional">(optional)</span>
                </span>
                <ChevronIcon />
              </summary>
              <div className="quote-form-disclosure-body">
                <ThanksQuestions />
              </div>
            </details>
          ) : null}
        </div>
      ) : (
        <>
          {/* Two equal choices, the form or a callback, as quiet tabs: an underline marks
              the active one, so it never reads as a second send button. */}
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

          {callback ? null : (
            <>
              <div className="quote-form-field">
                <label htmlFor={ids.note}>What can we help with?</label>
                <textarea
                  id={ids.note}
                  name="note"
                  rows={3}
                  required
                  maxLength={4000}
                  placeholder="For example: remodel the kitchen, finish the basement, or fix a few things around the house."
                  value={draft.note}
                  aria-invalid={errors.note ? true : undefined}
                  aria-describedby={describe("note")}
                  onChange={(event) => update({ note: event.target.value })}
                  onBlur={onBlur("note")}
                />
                {error("note")}
              </div>

            </>
          )}

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
              <select
                id={ids.bestTime}
                name="best_time"
                value={draft.bestTime}
                onChange={(event) => update({ bestTime: event.target.value })}
              >
                {BEST_TIMES.map((time) => (
                  <option key={time} value={time}>
                    {time}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            // Everything optional lives in this one closed dropdown.
            <details
              className="quote-form-disclosure"
              open={optionsOpen}
              onToggle={(event) => setOptionsOpen(event.currentTarget.open)}
              data-testid="quote-options"
            >
              <summary>
                <span>
                  Add an email or choose how we reach you <span className="quote-form-optional">(optional)</span>
                </span>
                <ChevronIcon />
              </summary>
              <div className="quote-form-disclosure-body">
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
                    {REACH_OPTIONS.map((option) => (
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
              </div>
            </details>
          )}

          <label className="short-request-trap">
            Website
            <input name="website_url" type="text" tabIndex={-1} autoComplete="off" />
          </label>
          <input type="hidden" name="form" value={formName} />
          <input type="hidden" name="project" value={draft.project || FALLBACK_PROJECT} />
          <input type="hidden" name="request_type" value={callback ? CALLBACK_REQUEST : "request"} />

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
                ? "We call you back during business hours."
                : "That is all we need. You can add photos or plans after you send."}
            </p>
          </div>
          {talk}
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
