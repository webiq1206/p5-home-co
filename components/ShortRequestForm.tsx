"use client";

import { useEffect, useId, useMemo, useState } from "react";

import { trackAcceptedInquiry } from "../app/analytics";
import { PUBLIC_PHONE_DISPLAY } from "../app/publicIdentity";
import { isNewAcceptedInquiry } from "../app/quote/conversion.ts";
import { PROJECT_OPTIONS, brandForProject } from "../app/quote/options.ts";
import { captureAttribution } from "../lib/p5/browserAttribution.ts";
import SaveContactButton from "./SaveContactButton";

const MAX_FILES = 4;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

const FALLBACK_PROJECT = "Something else, or I am not sure";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const STORAGE_KEY = "p5-quote-wizard-v4";

type CategoryId = "remodel" | "home" | "adu" | "cabinets" | "repairs" | "other";

const CATEGORIES: ReadonlyArray<{
  id: CategoryId;
  label: string;
  projects: readonly string[];
}> = [
  {
    id: "remodel",
    label: "Remodel or addition",
    projects: [
      "Kitchen remodel",
      "Bathroom remodel",
      "Whole-home remodel",
      "Home addition",
      "Basement finishing",
    ],
  },
  {
    id: "home",
    label: "New custom home",
    projects: ["New custom home", "Build on land I own"],
  },
  {
    id: "adu",
    label: "ADU or conversion",
    projects: ["Accessory dwelling unit (ADU)", "Garage conversion"],
  },
  {
    id: "cabinets",
    label: "Cabinets or built-ins",
    projects: ["Custom cabinets or built-ins", "Bathroom vanity"],
  },
  {
    id: "repairs",
    label: "Repairs or handyman",
    projects: ["Home repairs or handyman work"],
  },
  {
    id: "other",
    label: "Something else",
    projects: [FALLBACK_PROJECT],
  },
];

/** Text steps are one field each so every step fits with keyboard open (C10). */
type Step = "category" | "project" | "match" | "note" | "contact" | "phone" | "email" | "review";

const STEPS: readonly Step[] = ["category", "project", "match", "note", "contact", "phone", "email", "review"];

type WizardState = {
  step: Step;
  category: CategoryId | null;
  project: string;
  note: string;
  name: string;
  phone: string;
  email: string;
};

const DEFAULT_STATE: WizardState = {
  step: "category",
  category: null,
  project: "",
  note: "",
  name: "",
  phone: "",
  email: "",
};

function normalizeStep(step: unknown): Step | null {
  if (typeof step !== "string") return null;
  if ((STEPS as readonly string[]).includes(step)) return step as Step;
  return null;
}

function categoryForProject(project: string | undefined): CategoryId | null {
  if (!project) return null;
  const found = CATEGORIES.find((entry) => entry.projects.includes(project));
  return found?.id ?? "other";
}

function readStored(defaultProject?: string): WizardState {
  if (typeof window === "undefined") {
    return {
      ...DEFAULT_STATE,
      project: defaultProject && PROJECT_OPTIONS.some((o) => o.value === defaultProject) ? defaultProject : "",
      category: categoryForProject(defaultProject),
      step: defaultProject && PROJECT_OPTIONS.some((o) => o.value === defaultProject) ? "match" : "category",
    };
  }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<WizardState>;
      const project =
        typeof parsed.project === "string" && PROJECT_OPTIONS.some((o) => o.value === parsed.project)
          ? parsed.project
          : defaultProject && PROJECT_OPTIONS.some((o) => o.value === defaultProject)
            ? defaultProject
            : "";
      const category =
        parsed.category && CATEGORIES.some((c) => c.id === parsed.category)
          ? parsed.category
          : categoryForProject(project);
      const step =
        normalizeStep(parsed.step) ??
        (project ? "match" : "category");
      return {
        step,
        category,
        project,
        note: typeof parsed.note === "string" ? parsed.note : "",
        name: typeof parsed.name === "string" ? parsed.name : "",
        phone: typeof parsed.phone === "string" ? parsed.phone : "",
        email: typeof parsed.email === "string" ? parsed.email : "",
      };
    }
  } catch {
    /* ignore corrupt drafts */
  }
  if (defaultProject && PROJECT_OPTIONS.some((o) => o.value === defaultProject)) {
    return {
      ...DEFAULT_STATE,
      project: defaultProject,
      category: categoryForProject(defaultProject),
      step: "match",
    };
  }
  return DEFAULT_STATE;
}

/**
 * Primary lead form as a D2 wizard so every input step fits with the keyboard open (C10).
 * Category and project use choice cards; company match shows before contact capture.
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
  const fileId = useId();
  const [hydrated, setHydrated] = useState(false);
  const [state, setState] = useState<WizardState>(() => readStored(defaultProject));
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [files, setFiles] = useState<File[]>([]);

  useEffect(() => {
    setState(readStored(defaultProject));
    setHydrated(true);
  }, [defaultProject]);

  useEffect(() => {
    if (!hydrated || done) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* private mode */
    }
  }, [state, hydrated, done]);

  useEffect(() => {
    if (!hydrated) return;
    const onPop = (event: PopStateEvent) => {
      const draft = (event.state as { quoteWizard?: WizardState } | null)?.quoteWizard;
      const step = normalizeStep(draft?.step);
      if (draft && step) {
        setState({
          step,
          category: draft.category ?? null,
          project: draft.project ?? "",
          note: draft.note ?? "",
          name: draft.name ?? "",
          phone: draft.phone ?? "",
          email: draft.email ?? "",
        });
        return;
      }
      setState(readStored(defaultProject));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [defaultProject, hydrated]);

  useEffect(() => {
    if (!hydrated || done) return;
    if (!["match", "note", "contact", "phone", "email"].includes(state.step)) return;
    const form = document.getElementById(id);
    if (!form) return;
    form.scrollIntoView({ block: "start", behavior: "auto" });
  }, [state.step, hydrated, done, id]);

  function pushHistory(next: WizardState) {
    if (typeof window === "undefined") return;
    try {
      window.history.pushState({ quoteWizard: next }, "");
    } catch {
      /* ignore */
    }
  }

  const category = useMemo(
    () => CATEGORIES.find((entry) => entry.id === state.category) ?? null,
    [state.category],
  );
  const brand = state.project ? brandForProject(state.project) : null;

  const stepIndex = STEPS.indexOf(state.step) + 1;
  const stepCount = STEPS.length;

  function go(next: Partial<WizardState>, recordHistory = true) {
    setStatus(null);
    setState((prev) => {
      const merged = { ...prev, ...next };
      if (recordHistory && next.step && next.step !== prev.step) pushHistory(merged);
      return merged;
    });
  }

  function canAdvance(): boolean {
    if (state.step === "category") return Boolean(state.category);
    if (state.step === "project") return Boolean(state.project);
    if (state.step === "match") return Boolean(state.project);
    if (state.step === "note") return state.note.trim().length > 0;
    if (state.step === "contact") return state.name.trim().length > 0;
    if (state.step === "phone") return state.phone.replace(/\D/g, "").length >= 10;
    if (state.step === "email") return EMAIL.test(state.email.trim());
    return true;
  }

  function onBack() {
    if (state.step === "project") go({ step: "category", project: "" });
    else if (state.step === "match") {
      if (category && category.projects.length === 1) go({ step: "category" });
      else go({ step: "project" });
    } else if (state.step === "note") go({ step: "match" });
    else if (state.step === "contact") go({ step: "note" });
    else if (state.step === "phone") go({ step: "contact" });
    else if (state.step === "email") go({ step: "phone" });
    else if (state.step === "review") go({ step: "email" });
  }

  function onNext() {
    if (!canAdvance()) {
      if (state.step === "note") {
        setStatus({ tone: "error", text: "Add a short note about the project." });
      } else if (state.step === "contact") {
        setStatus({ tone: "error", text: "Enter a name." });
      } else if (state.step === "phone") {
        setStatus({ tone: "error", text: "Enter a phone number we can call." });
      } else if (state.step === "email") {
        setStatus({
          tone: "error",
          text: state.email.trim() ? "That email address does not look right." : "Enter an email address.",
        });
      }
      return;
    }
    if (state.step === "category" && category) {
      if (category.projects.length === 1) {
        go({ step: "match", project: category.projects[0] });
      } else {
        go({ step: "project" });
      }
      return;
    }
    if (state.step === "project") go({ step: "match" });
    else if (state.step === "match") go({ step: "note" });
    else if (state.step === "note") go({ step: "contact" });
    else if (state.step === "contact") go({ step: "phone" });
    else if (state.step === "phone") go({ step: "email" });
    else if (state.step === "email") go({ step: "review" });
  }

  async function onSubmit() {
    if (pending || done || !canAdvance()) return;
    if (!state.project || !state.note.trim()) {
      setStatus({ tone: "error", text: "Add a short note about the project." });
      return;
    }
    if (files.length > MAX_FILES) {
      setStatus({ tone: "error", text: "Attach up to 4 files." });
      return;
    }
    const total = files.reduce((sum, file) => sum + file.size, 0);
    if (files.some((file) => file.size > MAX_FILE_BYTES)) {
      setStatus({ tone: "error", text: "Each file must be 8 MB or smaller." });
      return;
    }
    if (total > MAX_TOTAL_BYTES) {
      setStatus({ tone: "error", text: "Those files together are larger than 20 MB." });
      return;
    }

    const body = new FormData();
    body.set("name", state.name.trim());
    body.set("phone", state.phone.trim());
    body.set("email", state.email.trim());
    body.set("note", state.note.trim());
    body.set("project", state.project || FALLBACK_PROJECT);
    body.set("form", formName);
    body.set("website_url", "");
    for (const [key, value] of Object.entries(captureAttribution())) {
      if (value) body.set(key, value);
    }
    for (const file of files) body.append("files", file);

    setPending(true);
    setStatus(null);
    try {
      const response = await fetch("/api/leads/short-request", { method: "POST", body });
      const payload = (await response.json().catch(() => ({}))) as {
        accepted?: unknown;
        error?: string;
        message?: string;
      };
      if (!response.ok) {
        setStatus({ tone: "error", text: payload.error || `We could not send that. Call ${PUBLIC_PHONE_DISPLAY}.` });
        setPending(false);
        return;
      }
      if (isNewAcceptedInquiry(response.status, payload, false)) trackAcceptedInquiry();
      setDone(true);
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
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
      className={`short-request quote-wizard${plain ? " short-request-plain" : ""}${compact ? " short-request-compact" : ""}`}
      data-suppress-mobile-bar=""
      data-suppress-sticky-cta=""
      data-wizard-step={state.step}
      onSubmit={(event) => {
        event.preventDefault();
        if (state.step === "review") void onSubmit();
        else onNext();
      }}
      noValidate
    >
      <h2 className={compact ? "short-request-sr" : undefined}>Request a quote</h2>
      {compact ? null : (
        <p className="short-request-note">
          Free quote. No obligation. Or call {PUBLIC_PHONE_DISPLAY}.
        </p>
      )}

      {done ? (
        <div className="short-request-thanks">
          <p className="short-request-status" role="status">
            {status?.text}
          </p>
          <SaveContactButton location="form_thanks" />
          <p className="short-request-note">Save our contact so you have Nick&apos;s number when we call back.</p>
        </div>
      ) : (
        <>
          <div className="quote-wizard-progress" aria-label={`Step ${stepIndex} of ${stepCount}`}>
            <span>
              Step {stepIndex} of {stepCount}
            </span>
            <i>
              <b style={{ width: `${(stepIndex / stepCount) * 100}%` }} />
            </i>
          </div>

          {state.step === "category" && (
            <fieldset className="quote-wizard-step">
              <legend>What kind of work?</legend>
              <div className="choice-cards" role="list">
                {CATEGORIES.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className={`choice-card${state.category === entry.id ? " is-selected" : ""}`}
                    aria-pressed={state.category === entry.id}
                    onClick={() => go({ category: entry.id, project: "" })}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {state.step === "project" && category && (
            <fieldset className="quote-wizard-step">
              <legend>Which project fits best?</legend>
              <div className="choice-cards" role="list">
                {category.projects.map((project) => (
                  <button
                    key={project}
                    type="button"
                    className={`choice-card${state.project === project ? " is-selected" : ""}`}
                    aria-pressed={state.project === project}
                    onClick={() => go({ project })}
                  >
                    {project}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {state.step === "match" && (
            <fieldset className="quote-wizard-step quote-wizard-step-compact">
              <legend>Your specialist team</legend>
              <p className="quote-wizard-result" role="status">
                <strong>{brand ?? "P5 Home Co"}</strong>
                <span> will take this from here.</span>
              </p>
            </fieldset>
          )}

          {state.step === "note" && (
            <fieldset className="quote-wizard-step quote-wizard-step-compact">
              <legend>Project note</legend>
              <label htmlFor={noteId}>
                What should we know?
                <textarea
                  id={noteId}
                  name="note"
                  required
                  maxLength={4000}
                  rows={2}
                  value={state.note}
                  onChange={(event) => go({ note: event.target.value })}
                />
              </label>
            </fieldset>
          )}

          {state.step === "contact" && (
            <fieldset className="quote-wizard-step quote-wizard-step-compact">
              <legend>Your name</legend>
              <label htmlFor={nameId}>
                Name
                <input
                  id={nameId}
                  name="name"
                  type="text"
                  autoComplete="name"
                  required
                  maxLength={120}
                  value={state.name}
                  onChange={(event) => go({ name: event.target.value })}
                />
              </label>
            </fieldset>
          )}

          {state.step === "phone" && (
            <fieldset className="quote-wizard-step quote-wizard-step-compact">
              <legend>Phone</legend>
              <label htmlFor={phoneId}>
                Phone
                <input
                  id={phoneId}
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  required
                  maxLength={30}
                  value={state.phone}
                  onChange={(event) => go({ phone: event.target.value })}
                />
              </label>
            </fieldset>
          )}

          {state.step === "email" && (
            <fieldset className="quote-wizard-step quote-wizard-step-compact">
              <legend>Email</legend>
              <label htmlFor={emailId}>
                Email
                <input
                  id={emailId}
                  name="email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  required
                  maxLength={200}
                  value={state.email}
                  onChange={(event) => go({ email: event.target.value })}
                />
              </label>
            </fieldset>
          )}

          {state.step === "review" && (
            <fieldset className="quote-wizard-step">
              <legend>Review and send</legend>
              <dl className="quote-wizard-summary">
                <div>
                  <dt>Project</dt>
                  <dd>
                    <button type="button" className="quote-wizard-edit" onClick={() => go({ step: "project" })}>
                      {state.project}
                    </button>
                  </dd>
                </div>
                <div>
                  <dt>Team</dt>
                  <dd>{brand}</dd>
                </div>
                <div>
                  <dt>Note</dt>
                  <dd>
                    <button type="button" className="quote-wizard-edit" onClick={() => go({ step: "note" })}>
                      {state.note}
                    </button>
                  </dd>
                </div>
                <div>
                  <dt>Contact</dt>
                  <dd>
                    <button type="button" className="quote-wizard-edit" onClick={() => go({ step: "contact" })}>
                      {state.name} · {state.phone} · {state.email}
                    </button>
                  </dd>
                </div>
              </dl>
              <label className="short-request-file" htmlFor={fileId}>
                <span>
                  Add a photo, plan, or file <small>Optional</small>
                </span>
                <input
                  id={fileId}
                  name="files"
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,.heic,.heif,application/pdf"
                  onChange={(event) => setFiles([...(event.target.files ?? [])].filter((file) => file.size > 0))}
                />
              </label>
              {/* Keep project in the form DOM for tests and progressive enhancement. */}
              <input type="hidden" name="project" value={state.project || FALLBACK_PROJECT} />
            </fieldset>
          )}

          <label className="short-request-trap">
            Website
            <input name="website_url" type="text" tabIndex={-1} autoComplete="off" />
          </label>

          <div className="quote-wizard-dock">
            {state.step !== "category" ? (
              <button type="button" className="button quote-wizard-back" onClick={onBack}>
                Back
              </button>
            ) : (
              <span className="quote-wizard-back-spacer" aria-hidden="true" />
            )}
            {state.step === "review" ? (
              <button
                className="button button-dark short-request-submit"
                type="submit"
                disabled={pending}
                aria-busy={pending}
              >
                {pending ? "Sending" : "Request a quote"}
              </button>
            ) : (
              <button
                className="button button-dark short-request-submit"
                type="submit"
                disabled={!canAdvance()}
              >
                {state.step === "match" ? "Continue" : state.step === "note" ? "Continue" : "Next"}
              </button>
            )}
          </div>
          {status && (
            <p className="short-request-status" role={status.tone === "error" ? "alert" : "status"}>
              {status.text}
            </p>
          )}
        </>
      )}
    </form>
  );
}
