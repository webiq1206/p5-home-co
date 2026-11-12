import { normalizeEmail, normalizePhone } from "./normalize.ts";
import type { InboundLead } from "./types.ts";

/** Only the verified Meta intake opts into tolerant contact handling. */
export function isMetaLead(lead: Pick<InboundLead, "source" | "externalLeadId">): boolean {
  return lead.source === "Facebook Lead Ad" && Boolean(lead.externalLeadId);
}

export function metaContactReview(email: string | null, phone: string | null) {
  return {
    phoneNeedsReview: Boolean(phone?.trim()) && !normalizePhone(phone),
    emailNeedsReview: Boolean(email?.trim()) && !normalizeEmail(email),
  };
}

export function metaReviewLines(email: string | null, phone: string | null): string[] {
  const review = metaContactReview(email, phone);
  return [
    ...(review.phoneNeedsReview ? ["Phone needs review — original value retained; not verified as dialable."] : []),
    ...(review.emailNeedsReview ? ["Email needs review — original value retained; not verified as deliverable."] : []),
  ];
}
