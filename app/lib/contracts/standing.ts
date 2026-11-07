/**
 * Values that are the same on every P5 contract (S227).
 *
 * These are not dynamic data. P5's registration number does not change per
 * customer, and neither do its insurance minimums or standard terms. Printing
 * them as blanks invites a different answer each time, and the one time a
 * figure is typed wrong is the time it matters.
 *
 * Anything still null here is a standing value nobody has told the system yet.
 * It stays a blank on the document deliberately: inventing an insurance minimum
 * or a registration number would put a confident wrong number on a signed
 * contract, which is worse than an obvious gap.
 */

export const P5_STANDING = {
  /** Idaho Contractors Board registration. Printed on every agreement. */
  registrationNumber: null as string | null,

  /** Days after approved invoice that P5 pays a subcontractor. */
  subcontractorPaymentDays: 30,

  /** Workmanship warranty on construction work, months. */
  constructionWarrantyMonths: 12,

  /** Minimum commercial general liability P5 requires of a subcontractor. */
  subcontractorGeneralLiability: null as string | null,

  /** Minimum commercial auto P5 requires of a subcontractor. */
  subcontractorAutoLiability: null as string | null,

  /** Revision rounds included in a design fee before further work is chargeable. */
  designRevisionRounds: null as number | null,

  /** Percentage of the design fee credited against a construction contract. */
  designFeeCreditPercent: null as number | null,
} as const;

/**
 * The standing values still unanswered.
 *
 * Surfaced rather than left to be discovered on a contract, because each one is
 * a single decision that removes a blank from every future document.
 */
export function unsetStandingValues(): string[] {
  return Object.entries(P5_STANDING)
    .filter(([, v]) => v === null)
    .map(([k]) => k);
}
