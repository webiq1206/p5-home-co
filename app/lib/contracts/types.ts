/**
 * Contract and document templates (S215).
 *
 * P5 issues the same handful of documents over and over: a subcontract, a work
 * order, a change order, a lien waiver, the disclosure Idaho requires before
 * residential work starts. Retyping them invites two failures - a blank left
 * unfilled, and a clause quietly edited on one job and not the others.
 *
 * So a template here is data, not a Word file: named clauses plus the fields
 * that have to be filled before it can be issued at all.
 *
 * TWO RULES THIS FILE EXISTS TO ENFORCE
 *
 * 1. A document with an unfilled required field cannot be rendered. Not
 *    rendered-with-a-warning: refused. A subcontract that goes out reading
 *    "retainage of ___ percent" is worse than no subcontract, because it looks
 *    signed and is unenforceable on the one term that is in dispute.
 *
 * 2. A template that no attorney has reviewed is watermarked as a draft and
 *    says so on its face. These documents decide who pays when something goes
 *    wrong, and this system generated them - which is exactly the situation
 *    where confident-looking output is most dangerous. The review state is
 *    part of the template, and a person records it; nothing here can mark
 *    itself approved.
 */

export type ReviewState =
  /** Drafted here, never seen by a lawyer. Cannot be relied on. */
  | "unreviewed"
  /** Sent to counsel, no answer yet. */
  | "in_review"
  /** Counsel approved this version. Safe to issue. */
  | "approved";

export type FieldKind = "text" | "money" | "date" | "number" | "multiline";

export type TemplateField = {
  key: string;
  label: string;
  kind: FieldKind;
  /** Nothing renders while a required field is empty. */
  required: boolean;
  /** What goes here, for whoever fills it in. */
  help?: string;
  /** Where the value comes from automatically, when it does. */
  source?: string;
};

export type Clause = {
  heading: string;
  /**
   * Body text. `{{field_key}}` markers are replaced at render time; anything
   * left unreplaced is a bug, and renderDocument treats it as one.
   */
  body: string;
  /**
   * Why this clause is here. Not printed on the document - this is for the
   * person deciding whether to accept a redline, who otherwise has no way to
   * tell a load-bearing clause from boilerplate.
   */
  rationale?: string;
  /** A clause that must not be removed without counsel. */
  loadBearing?: boolean;
};

export type DocumentTemplate = {
  /** Stable key. Used in vendor_document and audit trails, so never rename. */
  key: string;
  title: string;
  /** Who signs it and when it is used. */
  purpose: string;
  category: "subcontractor" | "client" | "change" | "waiver" | "disclosure";
  reviewState: ReviewState;
  /** Set by a person when counsel approves. Never set by code. */
  reviewedOn?: string;
  reviewedBy?: string;
  /**
   * The statute this document exists to satisfy, when there is one. Recorded
   * because a document required by law has to be re-checked when the law
   * changes, and nobody can do that without knowing which law it was.
   */
  statute?: string;
  fields: TemplateField[];
  clauses: Clause[];
  /** Lines the signatories sign on. */
  signatures: { role: string; nameField?: string }[];
  /** Shown to the person issuing it, above the document. */
  issuingNotes?: string[];
};

export type RenderedDocument = {
  template: DocumentTemplate;
  title: string;
  /** Clause bodies with every field substituted. */
  clauses: { heading: string; body: string }[];
  signatures: { role: string; name: string | null }[];
  /** Present when the template has not been through counsel. */
  draftWatermark: string | null;
};

export class MissingFieldsError extends Error {
  /** Declared as a field rather than a constructor parameter property, which
   *  the repo's type-stripping test runner cannot compile. */
  missing: TemplateField[];

  constructor(missing: TemplateField[]) {
    super(
      `Cannot produce this document: ${missing
        .map((f) => f.label)
        .join(", ")} ${missing.length === 1 ? "is" : "are"} not filled in.`,
    );
    this.name = "MissingFieldsError";
    this.missing = missing;
  }
}
