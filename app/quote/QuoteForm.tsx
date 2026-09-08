"use client";

/**
 * The quote request form.
 *
 * The only client component on the page: everything a crawler or an answer
 * engine needs to read is server-rendered around it. It posts to the existing
 * public endpoint at /api/leads/intake, so this page adds a front door to the
 * lead manager rather than a second, parallel way of capturing leads.
 *
 * Contact fields come first and the project detail is explicitly optional.
 * On a cold ad click every extra field that looks mandatory costs a lead, and
 * the server only needs a name and one way to reply.
 */

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { track, trackAcceptedInquiry } from "../analytics";
import { AbandonmentPrompt } from "./AbandonmentPrompt.tsx";
import { useAbandonmentRecovery } from "./useAbandonmentRecovery.ts";
import { markEstimatorCompleted, reportEstimatorProgress } from "./estimatorSession.ts";
import { captureAttribution } from "./attribution";
import { isNewAcceptedInquiry } from "./conversion.ts";
import {
  PROJECT_OPTIONS,
  QUOTE_CITIES,
  buildIntakePayload,
  validateQuoteForm,
  type QuoteFieldErrors,
  type QuoteFormValues,
} from "./options";

function emptyValues(defaultProject: string): QuoteFormValues {
  return { name: "", phone: "", email: "", city: "", project: defaultProject, summary: "" };
}

/** Field errors the server can send back, mapped onto our field names. */
function mapServerErrors(errors: unknown): QuoteFieldErrors {
  if (!Array.isArray(errors)) return {};
  const mapped: QuoteFieldErrors = {};
  for (const entry of errors) {
    if (typeof entry !== "object" || entry === null) continue;
    const { field, message } = entry as { field?: unknown; message?: unknown };
    if (typeof message !== "string") continue;
    if (field === "name" || field === "email" || field === "phone" || field === "contact") {
      mapped[field] = message;
    }
  }
  return mapped;
}

export default function QuoteForm({ defaultProject = "" }: { defaultProject?: string }) {
  const router = useRouter();
  const uid = useId();
  const [values, setValues] = useState<QuoteFormValues>(() => emptyValues(defaultProject));
  const [errors, setErrors] = useState<QuoteFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Bots fill every field they find. A real person never sees this one.
  const [trap, setTrap] = useState("");

  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  /**
   * Fires once, so drop-off between starting and sending is measurable.
   *
   * Hung off the form's onFocus rather than each field's onChange: focus
   * bubbles from every input, select, and textarea, so one handler covers the
   * whole form and nothing reads a ref during render.
   */
  const started = useRef(false);
  const accepted = useRef(false);

  useEffect(() => {
    captureAttribution();
  }, []);

  const [engaged, setEngaged] = useState(false);
  const [acceptedState, setAcceptedState] = useState(false);
  function noteStart() {
    if (started.current) return;
    started.current = true;
    setEngaged(true);
    track("form_start", { form: "quote_landing_page", project: defaultProject || "generic" });
  }

  // Partial-completion tracking (docs/estimator-recovery.md): where the visitor
  // is, never what they typed. Field names only; values stay in the browser.
  const filledCount = (["name", "phone", "email", "project", "city", "summary"] as const).filter((k) => String(values[k] ?? "").trim().length > 0).length;
  const errorKeys = Object.keys(errors).sort().join(",");
  useEffect(() => {
    if (!engaged) return;
    reportEstimatorProgress({
      flow: "quote",
      currentStep: filledCount ? "filling" : "form",
      currentStepIndex: filledCount ? 1 : 0,
      totalSteps: 2,
      lastCompletedStep: filledCount ? "form" : undefined,
      selections: { project: values.project || defaultProject || null, city: values.city || null, fields_filled: filledCount },
      validationErrors: errorKeys ? errorKeys.split(",") : [],
    });
  }, [engaged, filledCount, values.project, values.city, errorKeys, defaultProject]);

  const recovery = useAbandonmentRecovery({ armed: engaged && !acceptedState, ignoreWithin: [".quote-form", ".recovery"] });

  const field = (key: keyof QuoteFormValues) => ({
    id: uid + "-" + key,
    name: key,
    value: values[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setValues((v) => ({ ...v, [key]: e.target.value }));
    },
  });

  /** Send the visitor to the first thing they need to fix, not just announce it. */
  function focusFirstError(found: QuoteFieldErrors) {
    if (found.name) nameRef.current?.focus();
    else if (found.contact || found.phone) phoneRef.current?.focus();
    else if (found.email) emailRef.current?.focus();
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);

    // Do not show a confirmation for a honeypot submission: no inquiry exists.
    if (trap.trim()) {
      setFormError("We could not accept that request. Please call (208) 477-1169 if you need help.");
      return;
    }

    const found = validateQuoteForm(values);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      focusFirstError(found);
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/leads/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...buildIntakePayload(values, captureAttribution()), website_url: trap }),
      });

      const body: unknown = await response.json().catch(() => null);
      const payload = (body ?? {}) as { accepted?: unknown; errors?: unknown; error?: unknown };
      // 201 is the server's only proof that this callback created a nonspam
      // inquiry. Duplicates and every other response deliberately do not fire.
      if (isNewAcceptedInquiry(response.status, payload, accepted.current)) {
        accepted.current = true;
        setAcceptedState(true);
        markEstimatorCompleted("quote");
        trackAcceptedInquiry();
        try {
          sessionStorage.setItem("p5.quote-accepted", "1");
        } catch {
          // The navigation remains truthful; storage only improves direct-page copy.
        }
        router.push("/quote/thanks");
        return;
      }

      if (response.ok) {
        setFormError("We already have this enquiry. Please call (208) 477-1169 if anything has changed.");
        return;
      }
      const fieldErrors = mapServerErrors(payload.errors);
      if (Object.keys(fieldErrors).length > 0) {
        setErrors(fieldErrors);
        setFormError("Please check the highlighted fields and send it again.");
        focusFirstError(fieldErrors);
      } else {
        setFormError(
          typeof payload.error === "string"
            ? payload.error
            : "We could not send that just now. Please call (208) 477-1169 and we will take the details over the phone.",
        );
      }
    } catch {
      // A network failure must never look like a captured lead.
      setFormError(
        "That did not reach us. Please check your connection, or call (208) 477-1169 and we will take the details over the phone.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const describe = (key: keyof QuoteFieldErrors) =>
    errors[key] ? uid + "-" + key + "-error" : undefined;

  return (
    <>
    <AbandonmentPrompt
      open={recovery.open}
      method={recovery.method}
      leaving={recovery.method === "navigation" || recovery.method === "exit_control"}
      onStay={recovery.stay}
      onContinue={recovery.proceed}
    />
    <form className="quote-form" onSubmit={onSubmit} onFocus={noteStart} noValidate>
      <div className="quote-field">
        <label htmlFor={uid + "-name"}>
          Your name <span aria-hidden="true">*</span>
        </label>
        <input
          {...field("name")}
          ref={nameRef}
          type="text"
          autoComplete="name"
          required
          aria-required="true"
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={describe("name")}
        />
        {errors.name && (
          <p className="quote-error" id={uid + "-name-error"} role="alert">
            {errors.name}
          </p>
        )}
      </div>

      <div className="quote-row">
        <div className="quote-field">
          <label htmlFor={uid + "-phone"}>Phone</label>
          <input
            {...field("phone")}
            ref={phoneRef}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            aria-invalid={errors.phone ? true : undefined}
            aria-describedby={describe("phone")}
          />
          {errors.phone && (
            <p className="quote-error" id={uid + "-phone-error"} role="alert">
              {errors.phone}
            </p>
          )}
        </div>
        <div className="quote-field">
          <label htmlFor={uid + "-email"}>Email</label>
          <input
            {...field("email")}
            ref={emailRef}
            type="email"
            autoComplete="email"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={describe("email")}
          />
          {errors.email && (
            <p className="quote-error" id={uid + "-email-error"} role="alert">
              {errors.email}
            </p>
          )}
        </div>
      </div>

      <p className="quote-hint">Either one is enough; whichever you would rather we used.</p>

      {errors.contact && (
        <p className="quote-error" role="alert">
          {errors.contact}
        </p>
      )}

      <button className="button button-dark quote-submit" type="submit" disabled={submitting}>
        {submitting ? "Sending your request..." : "Request my free quote"}
      </button>

      <details className="quote-more">
        <summary>Add project details (optional)</summary>
        <div className="quote-more-inner">
          <div className="quote-row">
            <div className="quote-field">
              <label htmlFor={uid + "-project"}>What can we help with?</label>
              <select {...field("project")}>
                <option value="">Select a project</option>
                {PROJECT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.value}
                  </option>
                ))}
              </select>
            </div>
            <div className="quote-field">
              <label htmlFor={uid + "-city"}>Where is the property?</label>
              <select {...field("city")}>
                <option value="">Select a city</option>
                {QUOTE_CITIES.map((city) => (
                  <option key={city} value={city}>
                    {city}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="quote-field">
            <label htmlFor={uid + "-summary"}>Tell us about the project</label>
            <textarea
              {...field("summary")}
              rows={4}
              placeholder="Rough scope, timing, and anything already decided."
            />
          </div>
        </div>
      </details>

      {/* Honeypot. Hidden from people, off the tab order, hidden from screen readers. */}
      <div className="quote-trap" aria-hidden="true">
        <label htmlFor={uid + "-company"}>Company</label>
        <input
          id={uid + "-company"}
          name="company"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={trap}
          onChange={(e) => setTrap(e.target.value)}
        />
      </div>

      {formError && (
        <p className="quote-form-error" role="alert">
          {formError}
        </p>
      )}

      <p className="quote-form-note">
        No cost and no obligation. We use your details to answer this enquiry and nothing else; see
        our <a href="/legal/privacy">privacy policy</a>. Prefer to talk?{" "}
        <a href="tel:+12084771169" onClick={() => track("phone_click", { location: "quote_form" })}>
          (208) 477-1169
        </a>
        .
      </p>
    </form>
    </>
  );
}
