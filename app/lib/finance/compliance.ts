/**
 * Compliance engines: vendor document status (S87-S89), the payment hard gate
 * (S105), and the lien-waiver lifecycle (S94-S97).
 *
 * Pure evaluation functions; persistence lives with the callers. The gate's
 * contract is the spec's: a payment may not reach Ready to Pay until every
 * applicable requirement passes, and every failure names its exact reason -
 * a hold nobody can explain is a hold nobody can clear (S104).
 */

export type VendorDocStatus =
  | "missing" | "requested" | "received" | "verified" | "expired" | "waived";

export type VendorDoc = {
  docType: string;
  required: boolean;
  status: VendorDocStatus;
  expiresOn: Date | null;
};

export type ComplianceStatus =
  | "Onboarding Required" | "Compliance Review" | "Compliant"
  | "Expiring Soon" | "Payment Hold" | "Inactive";

/**
 * S88: derive a vendor's compliance status from its document set.
 *
 * expired required doc            -> Payment Hold (S89: hold at expiration)
 * missing/requested required doc  -> Onboarding Required
 * received (unverified) docs      -> Compliance Review
 * verified but expiring within
 *   the earliest reminder window  -> Expiring Soon
 * everything verified/waived      -> Compliant
 */
export function deriveComplianceStatus(
  docs: VendorDoc[],
  today: Date,
  reminderDays: number[],
  active: boolean = true,
): ComplianceStatus {
  if (!active) return "Inactive";
  const required = docs.filter((d) => d.required && d.status !== "waived");

  const isExpired = (d: VendorDoc) =>
    d.status === "expired" ||
    (d.expiresOn !== null && d.expiresOn.getTime() < startOfDay(today).getTime());
  if (required.some(isExpired)) return "Payment Hold";

  if (required.some((d) => d.status === "missing" || d.status === "requested")) {
    return "Onboarding Required";
  }
  if (required.some((d) => d.status === "received")) return "Compliance Review";

  const window = Math.max(...reminderDays, 0);
  const soon = required.some(
    (d) =>
      d.expiresOn !== null &&
      daysUntil(today, d.expiresOn) <= window &&
      daysUntil(today, d.expiresOn) >= 0,
  );
  return soon ? "Expiring Soon" : "Compliant";
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function daysUntil(today: Date, target: Date): number {
  return Math.floor(
    (startOfDay(target).getTime() - startOfDay(today).getTime()) / 86_400_000,
  );
}

// ---------------------------------------------------------------------------
// S105: the payment hard gate.
// ---------------------------------------------------------------------------

export type GateCheck = { name: string; passed: boolean; reason: string };

export type PaymentGateInput = {
  vendorActive: boolean;
  complianceStatus: ComplianceStatus;
  manualHold: boolean;
  manualHoldReason: string | null;
  /** Bill coded to a project + class + phase + cost group (S105, S212-21). */
  billFullyCoded: boolean;
  /** Duplicate review performed (S105). */
  duplicateReviewed: boolean;
  /** Work/material receipt verified (S103). */
  workVerified: boolean;
  /** Amount within the authorized commitment (bill <= open PO/subcontract). */
  withinAuthorizedAmount: boolean;
  /** Required conditional waiver accepted for this payment (S96). */
  lienWaiverSatisfied: boolean;
  /** Whether this vendor/project requires lien waivers at all. */
  lienWaiverRequired: boolean;
  /** Approvals collected per the S106 matrix. */
  approvalsSatisfied: boolean;
};

export type PaymentGateResult = {
  readyToPay: boolean;
  checks: GateCheck[];
  /** Every failing reason, in display order - the exact "why" (S105). */
  holdReasons: string[];
};

export function evaluatePaymentGate(input: PaymentGateInput): PaymentGateResult {
  const checks: GateCheck[] = [
    {
      name: "vendor_active",
      passed: input.vendorActive,
      reason: "Vendor is inactive.",
    },
    {
      name: "compliance",
      passed:
        input.complianceStatus === "Compliant" ||
        input.complianceStatus === "Expiring Soon",
      reason: `Vendor compliance status is "${input.complianceStatus}".`,
    },
    {
      name: "manual_hold",
      passed: !input.manualHold,
      reason: input.manualHoldReason
        ? `Manual payment hold: ${input.manualHoldReason}`
        : "Manual payment hold is set.",
    },
    {
      name: "coding",
      passed: input.billFullyCoded,
      reason: "Bill is missing project, class, phase or cost group coding.",
    },
    {
      name: "duplicate_review",
      passed: input.duplicateReviewed,
      reason: "Duplicate review has not been completed.",
    },
    {
      name: "work_verified",
      passed: input.workVerified,
      reason: "Work or material receipt has not been verified.",
    },
    {
      name: "authorized_amount",
      passed: input.withinAuthorizedAmount,
      reason: "Bill exceeds the authorized PO/subcontract amount.",
    },
    {
      name: "lien_waiver",
      passed: !input.lienWaiverRequired || input.lienWaiverSatisfied,
      reason: "Required conditional lien waiver has not been accepted.",
    },
    {
      name: "approvals",
      passed: input.approvalsSatisfied,
      reason: "Required approvals have not been collected.",
    },
  ];
  const failing = checks.filter((c) => !c.passed);
  return {
    readyToPay: failing.length === 0,
    checks,
    holdReasons: failing.map((c) => c.reason),
  };
}

// ---------------------------------------------------------------------------
// S94-S97: lien waiver lifecycle.
// ---------------------------------------------------------------------------

export type WaiverStatus =
  | "required" | "requested" | "received" | "signed" | "reviewed"
  | "accepted" | "rejected";

/** Legal transitions. Anything else is a workflow bug, not a judgment call. */
const WAIVER_TRANSITIONS: Record<WaiverStatus, WaiverStatus[]> = {
  required: ["requested"],
  requested: ["received", "rejected"],
  received: ["signed", "rejected"],
  signed: ["reviewed", "rejected"],
  reviewed: ["accepted", "rejected"],
  accepted: [],
  rejected: ["requested"],   // re-request after a rejection
};

export function canTransitionWaiver(from: WaiverStatus, to: WaiverStatus): boolean {
  return WAIVER_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * S96/S97: which waiver the workflow needs next for a vendor payment.
 * Progress payments need a conditional progress waiver before payment and an
 * unconditional progress waiver after the payment clears; final payments the
 * final pair.
 */
export function nextWaiverNeeded(
  isFinalPayment: boolean,
  paymentCleared: boolean,
): "Conditional Progress" | "Unconditional Progress" | "Conditional Final" | "Unconditional Final" {
  if (isFinalPayment) {
    return paymentCleared ? "Unconditional Final" : "Conditional Final";
  }
  return paymentCleared ? "Unconditional Progress" : "Conditional Progress";
}
