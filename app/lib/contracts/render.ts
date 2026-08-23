/**
 * Turning a template into a document (S215).
 *
 * Pure: values in, document out. The interesting behaviour is all in what it
 * REFUSES to do.
 */

import {
  MissingFieldsError,
  type DocumentTemplate,
  type RenderedDocument,
  type TemplateField,
} from "./types.ts";

export type FieldValues = Record<string, string | number | null | undefined>;

const MARKER = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

function isBlank(value: string | number | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  return String(value).trim() === "";
}

/** Required fields with nothing in them. */
export function missingFields(
  template: DocumentTemplate,
  values: FieldValues,
): TemplateField[] {
  return template.fields.filter((f) => f.required && isBlank(values[f.key]));
}

function formatValue(field: TemplateField | undefined, raw: unknown): string {
  const value = String(raw ?? "");
  if (!field) return value;

  switch (field.kind) {
    case "money": {
      const n = Number(value);
      return Number.isFinite(n)
        ? n.toLocaleString("en-US", { style: "currency", currency: "USD" })
        : value;
    }
    case "date": {
      // Parsed as a plain calendar date. Left as-is when unparseable rather
      // than silently becoming today, which on a contract would be a forgery.
      const parsed = new Date(`${value}T00:00:00`);
      return Number.isNaN(parsed.getTime())
        ? value
        : parsed.toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          });
    }
    case "number": {
      const n = Number(value);
      return Number.isFinite(n) ? String(n) : value;
    }
    default:
      return value;
  }
}

/**
 * Produce the document.
 *
 * Throws MissingFieldsError when a required field is empty. This is deliberate
 * and not softenable to a warning: a subcontract that goes out reading
 * "retainage of ___ percent" looks signed and is unenforceable on precisely
 * the term that will be argued about.
 */
export function renderDocument(
  template: DocumentTemplate,
  values: FieldValues,
): RenderedDocument {
  const missing = missingFields(template, values);
  if (missing.length > 0) throw new MissingFieldsError(missing);

  const byKey = new Map(template.fields.map((f) => [f.key, f]));

  const substitute = (body: string): string =>
    body.replace(MARKER, (whole, key: string) => {
      const field = byKey.get(key);
      const raw = values[key];
      // An optional field left empty renders as a blank line rather than as
      // the marker, so the document reads as intentionally blank instead of
      // broken. A required one cannot reach here - it was caught above.
      if (isBlank(raw)) return field && !field.required ? "________" : whole;
      return formatValue(field, raw);
    });

  const clauses = template.clauses.map((c) => ({
    heading: c.heading,
    body: substitute(c.body),
  }));

  // A marker that survived substitution means the template names a field it
  // never declared. Failing loudly here beats shipping "{{owner_name}}" to a
  // customer, which is the kind of error that costs a job.
  for (const clause of clauses) {
    const leftover = clause.body.match(MARKER);
    if (leftover) {
      throw new Error(
        `Template "${template.key}" clause "${clause.heading}" uses ${leftover.join(
          ", ",
        )}, which is not one of its declared fields.`,
      );
    }
  }

  return {
    template,
    title: substitute(template.title),
    clauses,
    signatures: template.signatures.map((s) => ({
      role: s.role,
      name: s.nameField && !isBlank(values[s.nameField])
        ? String(values[s.nameField])
        : null,
    })),
    draftWatermark: watermarkFor(template),
  };
}

/**
 * The notice printed on a document counsel has not approved.
 *
 * Printed on the document itself rather than shown once in the interface,
 * because the document is what gets emailed, printed and signed - and by then
 * whatever the screen said is long gone.
 */
export function watermarkFor(template: DocumentTemplate): string | null {
  switch (template.reviewState) {
    case "approved":
      return null;
    case "in_review":
      return "DRAFT - WITH COUNSEL FOR REVIEW. Not to be signed or issued.";
    case "unreviewed":
      return (
        "DRAFT - NOT REVIEWED BY AN ATTORNEY. This document was prepared from a " +
        "template and has not been reviewed by counsel. Do not sign it, send it to " +
        "a customer or subcontractor, or rely on it, until it has been."
      );
  }
}

/** Whether this template may be issued to anyone outside P5. */
export function canIssue(template: DocumentTemplate): {
  allowed: boolean;
  reason: string;
} {
  if (template.reviewState === "approved") {
    return {
      allowed: true,
      reason: `Approved by counsel${
        template.reviewedOn ? ` on ${template.reviewedOn}` : ""
      }.`,
    };
  }
  return {
    allowed: false,
    reason:
      template.reviewState === "in_review"
        ? "Currently with counsel. Wait for the review to come back before issuing it."
        : "No attorney has reviewed this template. It decides who pays when something goes wrong, so it needs a lawyer before it is used on a real job.",
  };
}
