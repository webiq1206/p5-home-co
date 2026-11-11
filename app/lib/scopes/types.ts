/**
 * The scope document: what a walkthrough produced, organized by phase and
 * division, with every fact carrying where it came from and how sure it is.
 *
 * Pure types only. Shared by the server, the pricing engine, the wizard and
 * the browser, so nothing here may import server code.
 */

export type PhaseId = "pre-construction" | "construction";

/** Where a statement came from. `t` is seconds into the recording (whole project timeline). */
export type Evidence = {
  assetId: number;
  t?: number | null;
  page?: number | null;
  quote?: string | null;
};

/**
 * How firmly a fact is established.
 *  confirmed  - stated as decided, documented, or confirmed by an employee
 *  suggested  - proposed by the system (often an overlooked supporting task)
 *  assumed    - an assumption the scope relies on, not yet confirmed
 *  conflict   - sources disagree; see the conflicts list
 *  undecided  - the client has not chosen yet
 */
export type Certainty = "confirmed" | "suggested" | "assumed" | "conflict" | "undecided";

/** Which part of the offer a task belongs to. Only `approved` is in the base estimate. */
export type Bucket = "approved" | "optional" | "considering" | "future";

/**
 * Measurement basis. `documented` (plans, written notes) and `confirmed`
 * (employee entered) are firm. `stated` was said aloud. `estimated` was
 * inferred and stays an estimate until confirmed. `missing` has no value.
 */
export type MeasureStatus = "documented" | "confirmed" | "stated" | "estimated" | "missing";

export type Measurement = {
  id: string;
  label: string;
  area?: string | null;
  value: number | null;
  unit: string;
  status: MeasureStatus;
  evidence: Evidence[];
};

export type Selection = {
  id: string;
  label: string;
  options: string[];
  chosen: string | null;
  evidence: Evidence[];
};

export type LaborBasis = "production-rate" | "stated" | "proposed" | "confirmed";

export type Performer = "internal" | "subcontractor" | "supplier";

export type ScopeTask = {
  id: string;
  title: string;
  /** Customer-facing description. Plain, specific, no internal codes or costs. */
  description: string;
  area?: string | null;
  phase: PhaseId;
  /** Two-digit division code, e.g. "06". */
  division: string;
  bucket: Bucket;
  certainty: Certainty;
  /** True when the system added it as an easily overlooked supporting task. */
  supporting?: boolean;
  /** Cost book line, e.g. "06-20-26". */
  costCode?: string | null;
  quantity?: {
    measurementId?: string | null;
    value?: number | null;
    unit?: string | null;
    /** Multiplier applied to the measurement (e.g. 1.1 for waste). Default 1. */
    factor?: number | null;
    /** Inferred, not measured or stated. Stays an estimate until confirmed. */
    estimated?: boolean;
  } | null;
  performer?: Performer;
  laborHours?: { value: number | null; basis: LaborBasis; note?: string | null } | null;
  materials?: string[];
  selections?: Selection[];
  /** A written trade or supplier quote replacing the cost book price. Direct cost. */
  quote?: { amount: number; assetId?: number | null; vendor?: string | null } | null;
  /** An allowance amount (direct cost) that must be approved before the estimate is complete. */
  allowance?: { amount: number; approved: boolean } | null;
  notes?: string | null;
  evidence: Evidence[];
  /** Declined suggestion. Kept for the record, never priced. */
  dismissed?: boolean;
  /** Fields an employee edited by hand. Regeneration never overwrites these. */
  edited?: string[];
  origin?: "generated" | "manual" | "checklist";
};

export type Conflict = {
  id: string;
  topic: string;
  statements: { text: string; evidence: Evidence[] }[];
  taskIds: string[];
  resolution?: string | null;
};

export type ClientField = { value: string | null; certainty: Certainty; evidence: Evidence[] };

export type ScopeDoc = {
  projectName?: string | null;
  summary: string;
  client?: {
    firstName?: ClientField;
    lastName?: ClientField;
    email?: ClientField;
    phone?: ClientField;
    projectAddress?: ClientField;
    billingAddress?: ClientField;
  };
  goals: string[];
  priorities: string[];
  areas: string[];
  measurements: Measurement[];
  tasks: ScopeTask[];
  siteConditions: string[];
  access: string[];
  schedule: string[];
  inclusions: string[];
  exclusions: string[];
  assumptions: string[];
  openQuestions: string[];
  conflicts: Conflict[];
};

export function emptyScope(): ScopeDoc {
  return {
    summary: "",
    goals: [],
    priorities: [],
    areas: [],
    measurements: [],
    tasks: [],
    siteConditions: [],
    access: [],
    schedule: [],
    inclusions: [],
    exclusions: [],
    assumptions: [],
    openQuestions: [],
    conflicts: [],
  };
}

// ---------------------------------------------------------------------------
// Pricing output
// ---------------------------------------------------------------------------

/** The P5 QuickBooks item a line books to (see Knowledge Center, "The 13 items"). */
export type ItemKey =
  | "Direct Labor"
  | "Subcontractor Work"
  | "Project Materials"
  | "Equipment and Rentals"
  | "Permits and Fees"
  | "Freight and Delivery"
  | "Other Direct Cost"
  | "Design and Preconstruction Services"
  | "Handyman Service Work"
  | "Cabinet Product"
  | "Cabinet Installation"
  | "Cabinet Freight and Delivery";

export type PriceBasis =
  | "cost-book"
  | "written-quote"
  | "internal-labor"
  | "allowance"
  | "percentage"
  | "trip-charge";

export type EstimateLine = {
  id: string;
  taskId: string;
  phase: PhaseId;
  division: string;
  item: ItemKey;
  /** Customer-facing text for QuickBooks. */
  description: string;
  quantity: number;
  unit: string;
  /** Internal only. Null when the internal cost is not known. */
  unitCost: number | null;
  cost: number | null;
  unitPrice: number;
  price: number;
  basis: PriceBasis;
  /** Where the rate came from, for employee review. */
  source: string;
  optional: boolean;
  allowance: boolean;
  laborHours?: number | null;
  notes: string[];
};

export type PricingIssue = {
  key: string;
  taskId?: string;
  kind:
    | "missing-quantity"
    | "estimated-quantity"
    | "unmatched-item"
    | "missing-price"
    | "outdated-price"
    | "proposed-hours"
    | "allowance-unapproved"
    | "item-unmapped";
  blocking: boolean;
  message: string;
};

export type PricingResult = {
  lines: EstimateLine[];
  issues: PricingIssue[];
  totals: {
    baseCost: number | null;
    basePrice: number;
    optionalPrice: number;
    margin: number | null;
    laborHours: number;
  };
  policy: {
    overheadRate: number;
    profitRate: number;
    contingencyRate: number;
    laborRate: number;
    finishTier: string;
    costBookSource: string;
    costBookVersion: string;
  };
};

export type ScopeSettings = {
  /**
   * What the customer pays per hour of P5 labor. Owner rule: this is the
   * billed rate. Overhead, reserve and profit are never added on top of it.
   */
  laborRate: number;
  /** P5's own cost per hour. Optional, used only to show internal margin. */
  laborLoadedCost: number | null;
  /**
   * Handyman trip charge, as the customer price. Shown on handyman estimates
   * with an equal credit, because it is removed when the client moves forward.
   */
  handymanTripCharge?: number | null;
  /** Hours per cost-book unit, keyed by cost code. Approved production rates. */
  productionRates: Record<string, { hoursPerUnit: number; note?: string }>;
  /** Cost codes that are taxable on the customer estimate. Empty until the CPA decides. */
  taxableItems: ItemKey[];
  /** Cost book is treated as outdated after this many days from its review date. */
  priceMaxAgeDays: number;
  /** QuickBooks item id for each P5 item, when the names in QuickBooks differ. */
  itemOverrides: Partial<Record<ItemKey, string>>;
  confirmedBy?: string | null;
  confirmedAt?: string | null;
};

export const DEFAULT_SCOPE_SETTINGS: ScopeSettings = {
  laborRate: 125,
  laborLoadedCost: null,
  productionRates: {},
  taxableItems: [],
  priceMaxAgeDays: 365,
  itemOverrides: {},
};

// ---------------------------------------------------------------------------
// Wizard
// ---------------------------------------------------------------------------

export type QuestionInput =
  | { type: "measurement"; unit: string; units?: string[] }
  | { type: "number"; unit: string }
  | { type: "currency"; allowAttachment: boolean }
  | { type: "choice"; options: string[]; allowOther: boolean }
  | { type: "confirm"; yes: string; no: string }
  | { type: "text"; multiline: boolean };

export type Question = {
  key: string;
  /** The task or location this is about, shown as the step heading. */
  context: string;
  prompt: string;
  help: string;
  input: QuestionInput;
  /** True when the estimate cannot be ready to send until this is answered. */
  blocking: boolean;
  /** Pre-filled value the employee can accept with Next. */
  suggested?: string | number | null;
  taskIds: string[];
  evidence: Evidence[];
  deferred?: boolean;
};

export type Answer =
  | { value: number; unit?: string }
  | { value: string }
  | { value: boolean }
  | { amount: number; assetId?: number | null };

export type ScopeStatusName = "in_progress" | "needs_information" | "ready";

/**
 * JSON with sorted keys. Postgres jsonb does not keep key order, so two
 * equal values must be compared through this, never plain JSON.stringify.
 */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, v[k]]))
      : v,
  );
}
