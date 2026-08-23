/**
 * Owner reimbursements (S117, S118).
 *
 * Two rules this exists to enforce, both of which cost real money when broken:
 *
 *   1. A reimbursement without a receipt is HELD, not approved. The receipt is
 *      what makes the expense deductible; approving without one converts a
 *      business expense into an unsupported owner draw at audit.
 *
 *   2. A reimbursement is a LIABILITY to the owner, not a second expense. The
 *      cost was already incurred when the owner paid the vendor. Booking it
 *      again on payment would double the cost and understate profit - which is
 *      exactly what the "recorded" step exists to make explicit.
 */

export type ReimbursementStatus =
  | "submitted"
  | "hold_missing_receipt"
  | "approved"
  | "recorded"
  | "paid"
  | "rejected";

/**
 * Legal moves. Note what is absent: nothing goes straight from submitted or
 * hold to paid. The liability has to be recorded before money moves, or the
 * payment has no matching obligation and the expense gets counted twice.
 */
const TRANSITIONS: Record<ReimbursementStatus, ReimbursementStatus[]> = {
  submitted: ["approved", "hold_missing_receipt", "rejected"],
  hold_missing_receipt: ["submitted", "rejected"],
  approved: ["recorded", "rejected"],
  recorded: ["paid"],
  paid: [],
  rejected: ["submitted"], // a corrected claim can be resubmitted
};

export function canTransitionReimbursement(
  from: ReimbursementStatus,
  to: ReimbursementStatus,
): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * The status a newly submitted claim lands in.
 *
 * Deliberately not a warning that someone can click past: a missing receipt
 * changes the STATE, so the claim cannot be approved until the receipt exists.
 */
export function statusOnSubmit(receiptRef: string | null | undefined): ReimbursementStatus {
  return receiptRef && receiptRef.trim() ? "submitted" : "hold_missing_receipt";
}

/** Whether this claim is currently payable, and if not, why. */
export function payability(status: ReimbursementStatus): {
  payable: boolean;
  reason: string;
} {
  switch (status) {
    case "recorded":
      return { payable: true, reason: "Liability is recorded; the payment has something to settle." };
    case "hold_missing_receipt":
      return { payable: false, reason: "No receipt on file. The receipt is what makes this deductible." };
    case "submitted":
      return { payable: false, reason: "Not yet approved." };
    case "approved":
      return {
        payable: false,
        reason: "Approved, but the liability is not recorded yet. Paying now would leave the expense counted twice.",
      };
    case "paid":
      return { payable: false, reason: "Already paid; paying again would duplicate the reimbursement." };
    case "rejected":
      return {
        payable: false,
        reason: "Rejected. A corrected claim can be resubmitted, but this one will not be paid.",
      };
  }
}
