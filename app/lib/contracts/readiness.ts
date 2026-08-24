/**
 * The pre-send check, run before a contract goes to QuickBooks (S223).
 *
 * QuickBooks will happily send a contract with no plan set attached, no
 * disclosure delivered, and no attorney review. It has no idea any of those
 * things are supposed to exist. So the gate lives here, and it runs before the
 * document reaches QuickBooks at all.
 *
 * TWO KINDS OF CHECK, AND THE DIFFERENCE MATTERS
 *
 * A BLOCKING check stops the send. Those are reserved for things that are wrong
 * in every circumstance: an unreviewed contract, a missing required field, an
 * absent plan set on work that is defined by its drawings.
 *
 * A PROMPT does not stop anything. It asks a question the person may have a
 * good answer to - "is there a bid to attach?" - and records the answer. The
 * distinction exists because a gate that blocks on things which are sometimes
 * legitimately absent gets clicked through on reflex, and then it is not a gate
 * any more, it is a speed bump on the way to the same mistake.
 *
 * Pure: facts in, checks out. No database, no QuickBooks, no sending.
 */

import { missingFields, type FieldValues } from "./render.ts";
import { canIssue } from "./render.ts";
import type { DocumentTemplate } from "./types.ts";

export type CheckSeverity = "blocking" | "prompt";

export type PreSendCheck = {
  /** Stable key, so a UI can remember which prompts were answered. */
  code: string;
  label: string;
  severity: CheckSeverity;
  satisfied: boolean;
  /** What goes wrong if this is ignored. Plain language, no jargon. */
  why: string;
  /** The next physical action. */
  fix: string;
};

export type ProjectFacts = {
  /** Idaho's disclosure duty attaches to residential work, not commercial. */
  residential: boolean;
  /** Contract value, for the disclosure threshold. */
  contractAmount: number;
  /** When the Idaho disclosure was delivered, or null. */
  idahoDisclosureDeliveredOn: string | null;
};

export type ReadinessInput = {
  template: DocumentTemplate;
  values: FieldValues;
  /** Exhibit labels a person has confirmed are attached, e.g. ["Exhibit A"]. */
  attachedExhibits: string[];
  /** Prompt codes the person has explicitly answered, so they stop re-asking. */
  acknowledged?: string[];
  /** Omitted for documents that are not about a job. */
  project?: ProjectFacts;
};

export type Readiness = {
  checks: PreSendCheck[];
  /** False while any blocking check is unsatisfied. */
  canSend: boolean;
  blocking: PreSendCheck[];
  /** Unanswered prompts. Not blockers, but the person has not seen them yet. */
  unanswered: PreSendCheck[];
};

/**
 * Idaho Code 45-525 applies to residential work above a dollar threshold.
 *
 * The figure is deliberately a parameter rather than a constant in a clause:
 * thresholds move, and a number baked into prose is one nobody re-checks. It is
 * confirmed with counsel, not assumed from whatever was true when this was
 * written.
 */
export const IDAHO_DISCLOSURE_THRESHOLD = 2_000;

export function preSendChecklist(input: ReadinessInput): Readiness {
  const { template, values, attachedExhibits, project } = input;
  const acknowledged = new Set(input.acknowledged ?? []);
  const attached = new Set(attachedExhibits);
  const checks: PreSendCheck[] = [];

  // -- 1. Attorney review -------------------------------------------------
  const issue = canIssue(template);
  checks.push({
    code: "attorney_review",
    label: "Reviewed by an attorney",
    severity: "blocking",
    satisfied: issue.allowed,
    why: "This document decides who pays when something goes wrong, and it was drafted from a template rather than by a lawyer. Sending it unreviewed is the risk it was built to avoid.",
    fix: issue.reason,
  });

  // -- 2. Required fields -------------------------------------------------
  const missing = missingFields(template, values);
  checks.push({
    code: "required_fields",
    label: "Every required field is filled in",
    severity: "blocking",
    satisfied: missing.length === 0,
    why: "A contract that goes out with a blank in it looks signed and is unenforceable on exactly the term that gets argued about.",
    fix:
      missing.length === 0
        ? "Nothing missing."
        : `Fill in: ${missing.map((f) => f.label).join(", ")}.`,
  });

  // -- 3. Exhibits --------------------------------------------------------
  for (const exhibit of template.exhibits ?? []) {
    const isAttached = attached.has(exhibit.label);
    if (exhibit.required) {
      checks.push({
        code: `exhibit_${exhibit.label.replace(/\s+/g, "_").toLowerCase()}`,
        label: `${exhibit.label} attached: ${exhibit.name}`,
        severity: "blocking",
        satisfied: isAttached,
        why: exhibit.purpose,
        fix: isAttached
          ? "Attached."
          : `Attach ${exhibit.name} to the signing packet before sending.`,
      });
    } else {
      const code = `exhibit_optional_${exhibit.label.replace(/\s+/g, "_").toLowerCase()}`;
      checks.push({
        code,
        label: `${exhibit.name} - attach it?`,
        severity: "prompt",
        // Answered either by attaching it, or by explicitly saying there is none.
        satisfied: isAttached || acknowledged.has(code),
        why: exhibit.purpose,
        fix: `Attach ${exhibit.name}, or confirm there is none for this job.`,
      });
    }
  }

  // -- 4. The Idaho disclosure, where it actually applies ------------------
  //
  // Residential only, and only above the threshold. Commercial handyman and
  // cabinet work falls outside it entirely, and demanding a disclosure that the
  // law does not require would train people to dismiss the check.
  if (project && template.category === "client") {
    const applies =
      project.residential && project.contractAmount >= IDAHO_DISCLOSURE_THRESHOLD;
    if (applies) {
      checks.push({
        code: "idaho_disclosure",
        label: "Idaho disclosure delivered before work begins",
        severity: "blocking",
        satisfied: Boolean(project.idahoDisclosureDeliveredOn),
        why: "Idaho Code 45-525 requires a written disclosure to a residential owner BEFORE work begins. Late delivery cannot be corrected afterwards, so this is one of the few things that genuinely cannot be fixed later.",
        fix: project.idahoDisclosureDeliveredOn
          ? `Delivered ${project.idahoDisclosureDeliveredOn}.`
          : "Send the disclosure in the same signing packet, which dates the acknowledgement automatically.",
      });
    } else {
      checks.push({
        code: "idaho_disclosure_na",
        label: "Idaho disclosure not required for this job",
        severity: "prompt",
        satisfied: true,
        why: project.residential
          ? `The contract is under the ${IDAHO_DISCLOSURE_THRESHOLD} dollar threshold.`
          : "The disclosure duty applies to residential work. This job is commercial.",
        fix: "Confirm with counsel if the job later grows past the threshold or the use changes.",
      });
    }
  }

  const blocking = checks.filter((c) => c.severity === "blocking" && !c.satisfied);
  const unanswered = checks.filter((c) => c.severity === "prompt" && !c.satisfied);

  return {
    checks,
    canSend: blocking.length === 0,
    blocking,
    unanswered,
  };
}

/**
 * A one-line summary for a notification.
 *
 * Deliberately says what is wrong rather than that something is wrong: a
 * notification reading "3 issues" makes somebody open a screen to find out
 * whether it matters, and most of the time they will not.
 */
export function summariseReadiness(readiness: Readiness): string {
  if (readiness.blocking.length > 0) {
    return `Cannot send: ${readiness.blocking.map((c) => c.label).join("; ")}.`;
  }
  if (readiness.unanswered.length > 0) {
    return `Ready to send. Still worth answering: ${readiness.unanswered
      .map((c) => c.label)
      .join("; ")}.`;
  }
  return "Ready to send.";
}
