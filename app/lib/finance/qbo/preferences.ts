/**
 * The QuickBooks company settings P5 depends on (S214).
 *
 * Several data-quality rules are only enforceable because a setting in the
 * company file is switched on. "Track expenses and items by customer" is what
 * puts the job column on a bill in the first place; without it, the rule saying
 * every bill needs a job is unenforceable by anything except nagging.
 *
 * The trouble with a settings checklist is that it is true the day somebody
 * writes it and quietly stops being true afterwards. Settings get switched off
 * by accident, or by somebody solving an unrelated problem, and nothing
 * announces it. So rather than document the settings, this reads them back from
 * QuickBooks - making the configuration a monitored fact instead of an act of
 * collective memory.
 *
 * ON NOT GUESSING
 *
 * QuickBooks exposes some of these settings through the Preferences endpoint
 * and some not at all, and the exact field names vary by company edition. A
 * checker that assumed a field name and found nothing would report the setting
 * as OFF every single morning - nine false alarms a day, which is precisely how
 * a useful alert list becomes one people filter away.
 *
 * So a setting has three states here, not two: on, off, and NOT VISIBLE TO US.
 * The third is reported as a gap in our checking rather than as a problem with
 * the company file, and it is resolved by a person confirming the setting once
 * and recording that they did. Being honest about what we cannot see is what
 * makes the things we do report worth reading.
 */

import { qboRequest } from "./client.ts";
import type { AuditSeverity } from "./audit-rules.ts";

export type PreferenceState =
  /** QuickBooks reports it on. Nothing to do. */
  | "on"
  /** QuickBooks reports it off. This is a real finding. */
  | "off"
  /** QuickBooks did not report it. We cannot see it, so a person must confirm. */
  | "unknown";

export type PreferenceCheck = {
  /** Stable key. Used as the attention_item subject, so never rename one. */
  key: string;
  /** The setting as QuickBooks labels it, so it can be found by eye. */
  label: string;
  /** Where it lives in the interface, for the person who has to go and look. */
  path: string;
  severity: AuditSeverity;
  /** What the setting does, for someone who has never seen it. */
  plain: string;
  /** What stops working when it is off. */
  consequence: string;
  /**
   * Candidate locations in the Preferences payload, most likely first.
   *
   * More than one because the field name differs across QuickBooks editions.
   * The first path that yields a value wins; if none does, the setting is
   * `unknown` rather than assumed off.
   */
  paths: string[];
  /**
   * How to read the value found. Most settings are a plain on/off switch, but
   * some are "is anything set at all" - a default term is configured, or a book
   * close date exists.
   */
  kind?: "boolean" | "present";
};

/**
 * The settings P5 requires, with the reason each one matters.
 *
 * Everything here is a genuine dependency of how the company runs, not a
 * matter of taste. A setting that is merely nice to have does not belong on a
 * list that generates alerts.
 */
export const REQUIRED_PREFERENCES: PreferenceCheck[] = [
  {
    key: "projects_on",
    label: "Use project financial tracking",
    path: "Settings > Advanced > Projects",
    severity: "critical",
    plain:
      "Turns on jobs. Without it, every job has to be faked as a separate customer, and the customer's own record stops adding up.",
    consequence:
      "No job profitability exists at all. Costs and income cannot be grouped by job, which is the single number this whole system exists to produce.",
    paths: [
      "ProjectsPrefs.isProjectsEnabled",
      "OtherPrefs.ProjectsEnabled",
      "AccountingInfoPrefs.TrackDepartments",
    ],
  },
  {
    key: "track_expenses_by_customer",
    label: "Track expenses and items by customer",
    path: "Settings > Expenses > Bills and expenses",
    severity: "critical",
    plain:
      "Puts the job column on bills and expenses, so a cost can be attached to the job it belongs to.",
    consequence:
      "Costs cannot be put on a job even by someone trying to. Every job cost lands on the company, so jobs look cheaper than they are and we under-bill for them.",
    paths: [
      "VendorAndPurchasesPrefs.TrackingByCustomer",
      "ExpensePrefs.EnableExpenseTracking",
    ],
  },
  {
    key: "purchase_orders_on",
    label: "Use purchase orders",
    path: "Settings > Expenses > Purchase orders",
    severity: "urgent",
    plain:
      "Lets us write down an agreed price with a vendor before the work happens, rather than finding out what it cost when the bill arrives.",
    consequence:
      "Subcontractor commitments cannot be recorded, so a job's remaining budget always looks bigger than it is and the same money can be promised twice.",
    paths: ["VendorAndPurchasesPrefs.POCustomField", "ExpensePrefs.UsePurchaseOrder"],
  },
  {
    key: "billable_expense_tracking",
    label: "Make expenses and items billable",
    path: "Settings > Expenses > Bills and expenses",
    severity: "warning",
    plain:
      "Controls whether a cost can be marked to re-bill to a customer. On a fixed-price job it never should be, but on cost-plus work it must be possible.",
    consequence:
      "Cost-plus jobs cannot pass costs through to the customer, so the work gets done and never billed.",
    paths: ["VendorAndPurchasesPrefs.BillableExpenseTracking"],
  },
  {
    key: "default_bill_terms",
    label: "Default bill payment terms",
    path: "Settings > Expenses > Bills and expenses",
    severity: "warning",
    plain:
      "Fills in when a bill is due, so it appears on the payment list at the right time instead of never.",
    consequence:
      "Bills with no due date never show as due. They get missed until the vendor calls, which costs early-payment discounts and goodwill.",
    paths: ["VendorAndPurchasesPrefs.DefaultTerms.value", "VendorAndPurchasesPrefs.DefaultTermsRef.value"],
    kind: "present",
  },
  {
    key: "default_invoice_terms",
    label: "Preferred invoice terms",
    path: "Settings > Sales > Sales form content",
    severity: "warning",
    plain:
      "Fills in when an invoice is due, so it can be counted as late once that date passes.",
    consequence:
      "An invoice with no due date can never be overdue, so it never lands on a chase list and no reminder is ever sent. It just sits there unpaid.",
    paths: ["SalesFormsPrefs.DefaultTerms.value", "SalesFormsPrefs.DefaultTermsRef.value"],
    kind: "present",
  },
  {
    key: "custom_transaction_numbers",
    label: "Custom transaction numbers",
    path: "Settings > Sales > Sales form content",
    severity: "info",
    plain: "Lets invoice numbers follow our own scheme instead of a plain running count.",
    consequence:
      "Draw invoices cannot carry the job and draw number in their reference, which is what lets a lender match a payment request to a draw without having to ask us.",
    paths: ["SalesFormsPrefs.CustomTxnNumbers"],
  },
  {
    key: "account_numbers",
    label: "Enable account numbers",
    path: "Settings > Advanced > Chart of accounts",
    severity: "info",
    plain:
      "Gives every account in the books a number, so accounts sort in a deliberate order rather than alphabetically.",
    consequence:
      "The chart of accounts sorts by name, so cost accounts scatter and reports come out in an order nobody can read down.",
    paths: ["AccountingInfoPrefs.UseAccountNumbers"],
  },
  {
    key: "close_the_books",
    label: "Close the books",
    path: "Settings > Advanced > Accounting",
    severity: "warning",
    plain:
      "Locks past months so nobody can quietly change a period that has already been reported or filed.",
    consequence:
      "Somebody can edit a transaction in a month whose numbers already went to the CPA or a lender, and the report they are holding silently stops matching the books.",
    paths: ["AccountingInfoPrefs.BookCloseDate"],
    kind: "present",
  },
];

export type QboPreferences = Record<string, unknown>;

export type PreferenceFinding = Omit<PreferenceCheck, "paths" | "kind"> & {
  state: PreferenceState;
  /** Which path the value came from, so a wrong mapping can be corrected. */
  foundAt: string | null;
};

/** Walks a dotted path, returning undefined rather than throwing on a gap. */
function at(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((node, part) => {
    if (node === null || typeof node !== "object") return undefined;
    return (node as Record<string, unknown>)[part];
  }, source);
}

/** Reads one setting, trying each candidate path in turn. */
export function readPreference(
  prefs: QboPreferences,
  check: PreferenceCheck,
): { state: PreferenceState; foundAt: string | null } {
  for (const path of check.paths) {
    const value = at(prefs, path);
    if (value === undefined || value === null) continue;

    if (check.kind === "present") {
      // "Anything at all is set" - a default term, a book close date.
      const isSet = value !== "" && value !== false;
      return { state: isSet ? "on" : "off", foundAt: path };
    }

    // QuickBooks is inconsistent about returning real booleans versus the
    // strings "true"/"false", so both are accepted rather than one silently
    // reading as truthy.
    if (typeof value === "boolean") return { state: value ? "on" : "off", foundAt: path };
    if (value === "true") return { state: "on", foundAt: path };
    if (value === "false") return { state: "off", foundAt: path };

    // Present but not a shape we recognise. Existing at all is enough to say
    // the feature is configured.
    return { state: "on", foundAt: path };
  }

  return { state: "unknown", foundAt: null };
}

/**
 * Every setting that is not confirmed on.
 *
 * Both `off` and `unknown` come back, because both need a person - one to
 * change a setting, one to confirm what we cannot see. They are reported
 * differently so nobody is sent to fix something that was never broken.
 */
export function checkPreferences(prefs: QboPreferences): PreferenceFinding[] {
  return REQUIRED_PREFERENCES.map((check) => {
    const { state, foundAt } = readPreference(prefs, check);
    // `paths` and `kind` are how the value was located; they are noise to
    // everyone downstream, so they do not travel with the finding.
    return {
      key: check.key,
      label: check.label,
      path: check.path,
      severity: check.severity,
      plain: check.plain,
      consequence: check.consequence,
      state,
      foundAt,
    };
  }).filter((f) => f.state !== "on");
}

/** Read the company's settings straight from QuickBooks. */
export async function fetchPreferences(): Promise<QboPreferences> {
  const body = await qboRequest<{ Preferences?: QboPreferences }>("/preferences");
  return body.Preferences ?? {};
}
