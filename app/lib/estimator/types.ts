/**
 * Guided estimator: shared vocabulary.
 *
 * Pure types and tiny helpers only. The browser imports this file, so nothing
 * here may import the cost book, pricing policy or any server module.
 *
 * The estimator has no pricing of its own. A customer's selections are
 * compiled into the same scope document the internal scope platform uses
 * (app/lib/scopes), and that platform's engine prices it from the owner's
 * cost book. See compile.ts and price.ts.
 */

export type BrandId = "p5" | "remodeling" | "construction" | "handyman" | "cabinet" | "adu";

export type Tier = "builder" | "mid" | "high" | "luxury";

/**
 * What kind of number the customer is looking at.
 *  quote        fixed price for the listed work, standard conditions
 *  preliminary  itemized from typical dimensions, confirmed at a site visit
 *  budgetary    priced from a whole-project rate, for planning only
 */
export type EstimateClass = "quote" | "preliminary" | "budgetary";

export type Option = {
  id: string;
  label: string;
  hint?: string;
  /** Path under /estimator/img, without extension. */
  image?: string;
};

/** Conditions are data, never functions, so a flow can be stored and edited centrally. */
export type Cond = { q: string; in: string[] } | { q: string; notIn: string[] };

type QuestionBase = { id: string; prompt: string; help?: string; showIf?: Cond[] };

export type ChoiceQuestion = QuestionBase & { kind: "choice"; options: Option[]; default: string };

export type NumberQuestion = QuestionBase & {
  kind: "number";
  unit: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** Quick picks shown as chips above the stepper. */
  presets?: number[];
  /** Prefill from the property record when it is available. */
  prefill?: "homeSqft";
};

export type TaskOption = { id: string; label: string; hint?: string; group: string; max: number };

/** A menu of small jobs, each with a count. */
export type TasksQuestion = QuestionBase & { kind: "tasks"; options: TaskOption[] };

export type Question = ChoiceQuestion | NumberQuestion | TasksQuestion;

export type AnswerValue = string | number | Record<string, number>;
export type Answers = Record<string, AnswerValue>;

export type ProjectFlow = {
  id: string;
  /** Trade id from TRADES in flows.ts: the first question the customer answers. */
  group: string;
  title: string;
  blurb: string;
  image: string;
  /** Key into the owner's service matrix (lib/p5/pricing.ts). */
  service: string;
  estimateClass: EstimateClass;
  /** Whether the finish-level step applies. */
  usesFinish: boolean;
  questions: Question[];
};

/** Property facts, each labeled with where it came from. Never treated as measured. */
export type PropertyFacts = {
  /** Who supplied the record, in plain words. */
  source: string;
  parcel?: string | null;
  livingSqft?: number | null;
  yearBuilt?: number | null;
  lotAcres?: number | null;
  stories?: number | null;
  garageSpaces?: number | null;
  jurisdiction?: string | null;
  /** Set when the customer tapped "That is right" or corrected a value. */
  confirmed?: boolean;
};

export type Contact = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  marketingConsent: boolean;
};

export type Submission = {
  brand: BrandId;
  project: string;
  tier: Tier;
  answers: Answers;
  address: string | null;
  property: PropertyFacts | null;
  contact: Contact;
  /** Browser-generated id, so a retry or double tap is one estimate. */
  clientKey: string;
  attribution: Record<string, string>;
  /** Milliseconds from the first selection to submit, for the 60-second target. */
  elapsedMs: number | null;
};

// ---------------------------------------------------------------------------
// What the customer is allowed to see. Built on the server from the priced
// estimate; it has no field that can carry a cost, a margin or a cost code.
// ---------------------------------------------------------------------------

export type CustomerItem = {
  text: string;
  quantity: number;
  unit: string;
  price: number;
  allowance: boolean;
};

export type CustomerEstimate = {
  token: string;
  brandName: string;
  projectName: string;
  address: string | null;
  summary: string[];
  estimateClass: EstimateClass;
  classLabel: string;
  classStatement: string;
  /** Null while the estimate is with the team for review. */
  total: number | null;
  phases: {
    name: string;
    subtotal: number;
    divisions: { name: string; subtotal: number; items: CustomerItem[] }[];
  }[];
  assumptions: string[];
  exclusions: string[];
  nextSteps: string[];
  /** True when the official copy is on its way from QuickBooks. */
  officialCopy: "sending" | "after-review";
  createdAt: string;
};

export function conditionHolds(cond: Cond, answers: Answers): boolean {
  const value = String(answers[cond.q] ?? "");
  return "in" in cond ? cond.in.includes(value) : !cond.notIn.includes(value);
}

export function isVisible(question: Question, answers: Answers): boolean {
  return (question.showIf ?? []).every((c) => conditionHolds(c, answers));
}

/** Answers with defaults filled in for every visible question, and hidden ones dropped. */
export function resolveAnswers(flow: ProjectFlow, given: Answers): Answers {
  const out: Answers = {};
  for (const q of flow.questions) {
    if (!isVisible(q, out)) continue;
    const value = given[q.id];
    if (q.kind === "choice") {
      out[q.id] = typeof value === "string" && q.options.some((o) => o.id === value) ? value : q.default;
    } else if (q.kind === "number") {
      const n = typeof value === "number" && Number.isFinite(value) ? value : q.default;
      out[q.id] = Math.min(q.max, Math.max(q.min, Math.round(n / q.step) * q.step));
    } else {
      const counts: Record<string, number> = {};
      if (value && typeof value === "object") {
        for (const o of q.options) {
          const n = Math.floor(Number((value as Record<string, number>)[o.id] ?? 0));
          if (Number.isFinite(n) && n > 0) counts[o.id] = Math.min(o.max, n);
        }
      }
      out[q.id] = counts;
    }
  }
  return out;
}

export const TIER_LABELS: Record<Tier, { label: string; hint: string }> = {
  builder: { label: "Essential", hint: "Clean, durable, value-focused selections" },
  mid: { label: "Signature", hint: "The most popular level of finish" },
  high: { label: "Premium", hint: "Upgraded materials and details throughout" },
  luxury: { label: "Luxury", hint: "Top-of-line materials and custom work" },
};

export const CLASS_LABELS: Record<EstimateClass, { label: string; statement: string }> = {
  quote: {
    label: "Fixed price",
    statement:
      "This is a fixed price for the work listed, assuming standard conditions and access. If we find something different on site we will tell you before any work starts.",
  },
  preliminary: {
    label: "Preliminary estimate",
    statement:
      "This is a preliminary estimate built from typical dimensions for the project you described. We confirm measurements and selections at a site visit before it becomes a fixed price.",
  },
  budgetary: {
    label: "Budgetary estimate",
    statement:
      "This is a budgetary estimate for planning. Projects of this size are priced in detail during preconstruction, once drawings, site conditions and selections are known.",
  },
};
