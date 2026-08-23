/**
 * Finance settings: every threshold, rate and policy number the engines use.
 *
 * The master spec is explicit that these are configuration, not code: tax
 * reserve methodology is CPA-controlled (S125), approval tiers are editable
 * (S106), margin bands are editable (S50), and reserves are owner decisions
 * (S208). Engines take a FinanceSettings argument so they stay pure and
 * testable; runtime callers load the stored override merged over defaults.
 *
 * Defaults below are the spec's initial suggestions, marked pending where a
 * professional decision is required. A pending flag does not block unrelated
 * computation (S4); it surfaces as an attention item instead.
 */

import { query } from "../db.ts";

const SETTINGS_KEY = "financeSettings";

export type ApprovalTier = { upTo: number | null; approvers: string[] };

export type FinanceSettings = {
  /** S140: cash the Safe Cash formula must protect. Owner decisions (S208). */
  reserves: {
    minimumOperatingReserve: number;
    /** Pending owner decision: until set, Safe Cash reports itself as provisional. */
    minimumOperatingReserveConfirmed: boolean;
    otherProtectedReserves: number;
  };
  /** S125: CPA-controlled. Never hardcode a rate at a call site. */
  taxReserve: {
    /** Fraction of net income to reserve, e.g. 0.30. */
    rate: number;
    rateConfirmedByCpa: boolean;
  };
  /** S50: margin health bands, in percentage points below target. */
  marginBands: { yellowBelow: number; redBelow: number };
  /** S49: an ETC older than this many days is stale. */
  forecastStaleDays: number;
  /** S56: default desired post-draw buffer when a project sets none. */
  defaultPostDrawBuffer: number;
  /** S55: horizon for near-term funding requirement, days. */
  fundingHorizonDays: number;
  /** S106: bill approval matrix. upTo=null means "and above". */
  billApprovalTiers: ApprovalTier[];
  /** S66: commitment approval matrix, independently configurable. */
  commitmentApprovalTiers: ApprovalTier[];
  /** S89: days-before-expiry ladder for compliance reminders. */
  complianceReminderDays: number[];
  /** S129/S130: renewal alert ladders. */
  subscriptionAlertDays: number[];
  insuranceAlertDays: number[];
  /** S86: 1099 reporting threshold - configurable, never perpetual (S86). */
  form1099Threshold: number;
  /** S75: AR reminder ladder in days relative to due date (negative = before). */
  arReminderDays: number[];
  /** S140: count invoices due within this many days as high-confidence inflow
   *  only when not disputed; uncertain AR is never cash (S139). */
  highConfidenceArDays: number;
  /** Daily financial report email (S148-style mobile summary). */
  dailyReport: {
    enabled: boolean;
    recipients: string[];
    /** Send even when QBO is disconnected (the report then says so plainly). */
    sendWhenNotConnected: boolean;
  };
  /** S122: distribution cadence. */
  distributionCadence: "project-close" | "monthly" | "quarterly" | "ad-hoc";
  /** S121: policy holdbacks applied before the distribution pool. */
  distributionPolicy: {
    warrantyReservePctOfRevenue: number;
    overheadContributionPctOfGp: number;
    retainedEarningsPctOfGp: number;
  };
};

export const DEFAULT_FINANCE_SETTINGS: FinanceSettings = {
  reserves: {
    minimumOperatingReserve: 0,
    minimumOperatingReserveConfirmed: false,
    otherProtectedReserves: 0,
  },
  taxReserve: { rate: 0.3, rateConfirmedByCpa: false },
  marginBands: { yellowBelow: 2, redBelow: 5 },
  forecastStaleDays: 30,
  defaultPostDrawBuffer: 0,
  fundingHorizonDays: 30,
  billApprovalTiers: [
    { upTo: 2500, approvers: ["project_manager"] },
    { upTo: 10000, approvers: ["project_manager", "manager"] },
    { upTo: 50000, approvers: ["manager", "administrator"] },
    { upTo: null, approvers: ["administrator"] },
  ],
  commitmentApprovalTiers: [
    { upTo: 2500, approvers: ["project_manager"] },
    { upTo: 10000, approvers: ["project_manager", "manager"] },
    { upTo: 50000, approvers: ["manager", "administrator"] },
    { upTo: null, approvers: ["administrator"] },
  ],
  complianceReminderDays: [30, 14, 7, 0],
  subscriptionAlertDays: [90, 60, 30],
  insuranceAlertDays: [90, 60, 30, 14, 7],
  form1099Threshold: 600,
  arReminderDays: [-3, 0, 1, 7],
  highConfidenceArDays: 7,
  dailyReport: {
    enabled: true,
    recipients: ["accounting@p5homeco.com"],
    sendWhenNotConnected: true,
  },
  distributionCadence: "quarterly",
  distributionPolicy: {
    warrantyReservePctOfRevenue: 0.01,
    overheadContributionPctOfGp: 0.1,
    retainedEarningsPctOfGp: 0.1,
  },
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep-ish merge: one level of nesting, same shape as the lead settings. */
export function mergeFinanceSettings(
  base: FinanceSettings,
  override: unknown,
): FinanceSettings {
  if (!isObject(override)) return base;
  const merged: Record<string, unknown> = { ...(base as unknown as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override)) {
    const current = merged[key];
    if (isObject(value) && isObject(current)) {
      merged[key] = { ...current, ...value };
    } else if (value !== undefined) {
      merged[key] = value;
    }
  }
  return merged as unknown as FinanceSettings;
}

export async function loadFinanceSettings(): Promise<FinanceSettings> {
  try {
    const rows = await query<{ value: unknown }>(
      "SELECT value FROM setting WHERE key = $1",
      [SETTINGS_KEY],
    );
    if (!rows.length) return DEFAULT_FINANCE_SETTINGS;
    return mergeFinanceSettings(DEFAULT_FINANCE_SETTINGS, rows[0].value);
  } catch (error) {
    console.error("[finance-settings] falling back to defaults:", (error as Error).message);
    return DEFAULT_FINANCE_SETTINGS;
  }
}

export async function saveFinanceSettings(
  partial: Partial<FinanceSettings>,
  userId: number | null,
): Promise<FinanceSettings> {
  const next = mergeFinanceSettings(await loadFinanceSettings(), partial);
  await query(
    `INSERT INTO setting (key, value, updated_by)
     VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [SETTINGS_KEY, JSON.stringify(next), userId],
  );
  return next;
}

/** S106/S66: resolve which roles must approve an amount. */
export function approversForAmount(tiers: ApprovalTier[], amount: number): string[] {
  for (const tier of tiers) {
    if (tier.upTo === null || amount <= tier.upTo) return tier.approvers;
  }
  // A misconfigured matrix must fail closed: highest tier, not no approval.
  return tiers.length ? tiers[tiers.length - 1].approvers : ["administrator"];
}
