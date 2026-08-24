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
  /**
   * The owner has read these and chosen to use them without waiting for
   * counsel. Issuing is unblocked, and the register still shows that no
   * attorney reviewed them.
   *
   * This state exists because the alternative was to record "approved" - which
   * would have been false, and would have outlived the conversation where the
   * decision was made. Whoever reads the register in a year, possibly during a
   * dispute, sees what actually happened.
   */
  | "owner_accepted"
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
  /**
   * A value that is the same on every contract: P5's own registration number,
   * its insurance minimums, its standard terms.
   *
   * These are not dynamic data and should never print as a blank for somebody
   * to fill in. A blank invites a different answer each time, and the one time
   * it is typed wrong is the time it matters.
   */
  defaultValue?: string | number;
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

/**
 * A document that rides along with the contract in the same signing packet.
 *
 * Plan sets, subcontractor bids and spec sheets are job-specific, so they can
 * never live in a reusable template - they are attached when the contract is
 * created. Declaring them here is what makes a missing one VISIBLE: the exhibit
 * list prints on the document itself, so a contract sent without its plan set
 * shows an exhibit that is not there rather than looking complete.
 *
 * That matters because the plan set is what actually defines the scope. Getting
 * it signed alongside the agreement is what turns "that is not what we agreed"
 * into "here is the drawing you initialled".
 */
export type Exhibit = {
  /** Exhibit A, B, C... assigned in order. */
  label: string;
  name: string;
  /** Whether the contract may be sent without it. */
  required: boolean;
  /** Why it is attached, in the preparer's terms. */
  purpose: string;
};

export type DocumentTemplate = {
  /** Stable key. Used in vendor_document and audit trails, so never rename. */
  key: string;
  title: string;
  /** Who signs it and when it is used. */
  purpose: string;
  category: "subcontractor" | "client" | "change" | "waiver" | "disclosure";
  reviewState: ReviewState;
  /** Set by a person when counsel approves, or when the owner accepts. */
  reviewedOn?: string;
  reviewedBy?: string;
  /** Why it was accepted without counsel, where that is what happened. */
  acceptanceNote?: string;
  /**
   * The statute this document exists to satisfy, when there is one. Recorded
   * because a document required by law has to be re-checked when the law
   * changes, and nobody can do that without knowing which law it was.
   */
  statute?: string;
  fields: TemplateField[];
  clauses: Clause[];
  /**
   * Documents attached to this one at send time, never part of the template.
   * QuickBooks allows up to five documents in one signing packet.
   */
  exhibits?: Exhibit[];
  /**
   * True when this document concerns a specific job.
   *
   * Every project document must carry the property address - it is what ties
   * the paperwork to the land, and a lien waiver or change order without it may
   * not attach to the property it was meant to cover. Enforced by test.
   */
  projectSpecific?: boolean;
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
