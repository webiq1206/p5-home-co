/**
 * Vocabulary and validation for the public quote form.
 *
 * Kept as a pure module, with no React and no network, so the routing rules
 * and the validation can be tested directly - the same split the finance and
 * leads modules use. The form component renders these lists; it does not
 * invent its own.
 *
 * The brand on each option is the whole point of the page: a visitor picks the
 * work they want done, and P5 decides which of the five companies owns it, so
 * nobody has to know the org chart before they can ask for a price.
 */

import { BRANDS, type Brand } from "../lib/leads/types.ts";
import { inferLeadSource, type Attribution } from "./attribution.ts";
import { QUOTE_SERVICES } from "./services.ts";

export interface ProjectOption {
  /** Sent to the intake endpoint as projectType, and shown in the select. */
  readonly value: string;
  /** The P5 company that owns this kind of work. */
  readonly brand: Brand;
}

/**
 * What a homeowner can ask for, in their words, mapped to the company that
 * does it. Ordered by how often the work is searched for rather than
 * alphabetically, because the first few options carry most of the traffic.
 */
export const PROJECT_OPTIONS: readonly ProjectOption[] = [
  { value: "Kitchen remodel", brand: "Boise Remodeling Co" },
  { value: "Bathroom remodel", brand: "Boise Remodeling Co" },
  { value: "Whole-home remodel", brand: "Boise Remodeling Co" },
  { value: "Home addition", brand: "Boise Remodeling Co" },
  { value: "Basement finishing", brand: "Boise Remodeling Co" },
  { value: "New custom home", brand: "Boise Construction Co" },
  { value: "Build on land I own", brand: "Boise Construction Co" },
  { value: "Accessory dwelling unit (ADU)", brand: "Boise ADU Co" },
  { value: "Garage conversion", brand: "Boise ADU Co" },
  { value: "Custom cabinets or built-ins", brand: "Boise Cabinet Co" },
  { value: "Bathroom vanity", brand: "Boise Cabinet Co" },
  { value: "Home repairs or handyman work", brand: "Boise Handyman Co" },
  { value: "Something else, or I am not sure", brand: "P5 Home Co" },
] as const;

/**
 * Cities P5 takes work in. "Somewhere else" is last and deliberate: a visitor
 * just outside the list should still be able to ask rather than bounce.
 */
export const QUOTE_CITIES = [
  "Boise",
  "Meridian",
  "Eagle",
  "Nampa",
  "Kuna",
  "Star",
  "Middleton",
  "Caldwell",
  "Garden City",
  "Somewhere else in the Treasure Valley",
] as const;

/** Which company a chosen project belongs to; the parent when unrecognised. */
export function brandForProject(project: string | null | undefined): Brand {
  const match = PROJECT_OPTIONS.find((o) => o.value === project);
  return match ? match.brand : "P5 Home Co";
}

export interface QuoteFormValues {
  name: string;
  phone: string;
  email: string;
  city: string;
  project: string;
  summary: string;
}

export type QuoteFieldErrors = Partial<Record<"name" | "contact" | "email" | "phone", string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Client-side validation.
 *
 * Deliberately mirrors validateInboundLead on the server rather than being
 * stricter: the server is the authority, and a form that rejects something the
 * server would have accepted just loses a lead. Ten digits is the US minimum,
 * so a visitor is told about a typo here instead of after a round trip.
 */
export function validateQuoteForm(values: QuoteFormValues): QuoteFieldErrors {
  const errors: QuoteFieldErrors = {};
  const name = values.name.trim();
  const email = values.email.trim();
  const phone = values.phone.trim();

  if (!name) errors.name = "Enter your name so we know who we are speaking to.";
  if (!email && !phone) {
    errors.contact = "Add a phone number or an email address so we can send your quote.";
  }
  if (email && !EMAIL.test(email)) errors.email = "That email address does not look right.";
  if (phone && phone.replace(/\D/g, "").length < 10) {
    errors.phone = "That phone number does not look right.";
  }
  return errors;
}

/** True when nothing failed, so callers read as a question rather than a count. */
export function isValidQuoteForm(values: QuoteFormValues): boolean {
  return Object.keys(validateQuoteForm(values)).length === 0;
}

/**
 * The body posted to /api/leads/intake.
 *
 * Acquisition is derived from actual click identifiers and UTMs, never from
 * the page a visitor happened to use. The context contains no form data.
 */
export function buildIntakePayload(
  values: QuoteFormValues,
  attribution: Attribution = {},
): Record<string, string> {
  const payload: Record<string, string> = {
    name: values.name.trim(),
    brand: brandForProject(values.project),
    source: inferLeadSource(attribution),
    form: "Quote Landing Page",
  };

  const email = values.email.trim();
  const phone = values.phone.trim();
  const summary = values.summary.trim();
  if (email) payload.email = email;
  if (phone) payload.phone = phone;
  if (values.project) payload.projectType = values.project;
  const service = QUOTE_SERVICES.find((entry) => entry.project === values.project);
  if (service) payload.service = service.slug;
  if (values.city && !values.city.startsWith("Somewhere else")) payload.city = values.city;
  if (summary) payload.summary = summary;

  for (const [key, value] of Object.entries(attribution)) {
    if (value) payload[key] = value;
  }

  return payload;
}

/** Guard so a typo in PROJECT_OPTIONS cannot ship an unknown brand. */
export function projectBrandsAreKnown(): boolean {
  return PROJECT_OPTIONS.every((o) => (BRANDS as readonly string[]).includes(o.brand));
}
