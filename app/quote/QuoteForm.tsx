"use client";

/**
 * The quote request form.
 *
 * The only client component on the page: everything a crawler or an answer
 * engine needs to read is server-rendered around it. It posts to the existing
 * public endpoint at /api/leads/intake, so this page adds a front door to the
 * lead manager rather than a second, parallel way of capturing leads.
 */

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { track } from "../analytics";
import {
  PROJECT_OPTIONS,
  QUOTE_CITIES,
  buildIntakePayload,
  validateQuoteForm,
  type QuoteFieldErrors,
  type QuoteFormValues,
} from "./options";

const EMPTY: QuoteFormValues = { name: "", phone: "", email: "", city: "", project: "", summary: "" };

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

export default function QuoteForm() {
  const router = useRouter();
  const uid = useId();
  const [values, setValues] = useState<QuoteFormValues>(EMPTY);
  const [errors, setErrors] = useState<QuoteFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Bots fill every field they find. A real person never sees this one.
  const [trap, setTrap] = useState("");

  const field = (key: keyof QuoteFormValues) => ({
    id: uid + "-" + key,
    name: key,
    value: values[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setValues((v) => ({ ...v, [key]: e.target.value }));
    },
  });

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);

    // Silently accept the bot so it does not retry, and never call the API.
    if (trap.trim()) {
      router.push("/quote/thanks");
      return;
    }

    const found = validateQuoteForm(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    try {
      const search =
        typeof window === "undefined" ? undefined : new URLSearchParams(window.location.search);
      const response = await fetch("/api/leads/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildIntakePayload(values, search)),
      });

      if (response.ok) {
        track("generate_lead", {
          form: "quote_landing_page",
          project: values.project || "unspecified",
        });
        router.push("/quote/thanks");
        return;
      }

      const body: unknown = await response.json().catch(() => null);
      const payload = (body ?? {}) as { errors?: unknown; error?: unknown };
      const fieldErrors = mapServerErrors(payload.errors);
      if (Object.keys(fieldErrors).length > 0) {
        setErrors(fieldErrors);
        setFormError("Please check the highlighted fields and send it again.");
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
        "That did not reach us - please check your connection, or call (208) 477-1169 and we will take the details over the phone.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const describe = (key: keyof QuoteFieldErrors) =>
    errors[key] ? uid + "-" + key + "-error" : undefined;

  return (
    <form className="quote-form" onSubmit={onSubmit} noValidate>
      <p className="quote-form-intro">
        Every field except your name and one way to reach you is optional. The more you tell us, the
        more useful the first call is.
      </p>

      <div className="quote-field">
        <label htmlFor={uid + "-name"}>
          Your name <span aria-hidden="true">*</span>
        </label>
        <input
          {...field("name")}
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

      {errors.contact && (
        <p className="quote-error" role="alert">
          {errors.contact}
        </p>
      )}

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

      <button className="button button-dark quote-submit" type="submit" disabled={submitting}>
        {submitting ? "Sending your request..." : "Request my free quote"}
      </button>

      <p className="quote-form-note">
        No cost and no obligation. We use your details to answer this enquiry and nothing else - see
        our <a href="/legal/privacy">privacy policy</a>. Prefer to talk?{" "}
        <a href="tel:+12084771169" onClick={() => track("phone_click", { location: "quote_form" })}>
          (208) 477-1169
        </a>
        .
      </p>
    </form>
  );
}
