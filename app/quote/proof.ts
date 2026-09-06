/**
 * Trust signals for the quote pages.
 *
 * Two lists, kept apart on purpose.
 *
 * PROOF_POINTS are facts P5 already states publicly on p5homeco.com and in
 * llms.txt - registration, founding year, service area, and how a scope is
 * written. Nothing here is a claim invented for the landing page.
 *
 * TESTIMONIALS is deliberately EMPTY. As of 2026-09-06 the Google Business
 * Profile shows "No reviews" and Yelp shows 0.0, so there is no verifiable
 * customer feedback to publish. A landing page behind paid advertising is
 * exactly the wrong place to put an unverifiable endorsement: the FTC treats
 * testimonials in advertising as claims the advertiser must be able to
 * substantiate. The section renders only when this array has entries, so
 * adding real, attributable reviews is a data change and nothing else.
 */

export interface ProofPoint {
  readonly label: string;
  readonly detail: string;
}

export const PROOF_POINTS: readonly ProofPoint[] = [
  {
    label: "Bonded and insured",
    detail: "Idaho contractor registration 8381215, carried across all five companies.",
  },
  {
    label: "Working here since 2020",
    detail: "Building, remodeling, and repairing homes across Ada and Canyon counties.",
  },
  {
    label: "A written scope, before work starts",
    detail: "What is included, what is not, and the price - in writing, so you can compare it.",
  },
  {
    label: "Permits handled in-house",
    detail: "We deal with Ada and Canyon County permitting where a project requires it.",
  },
  {
    label: "Five specialist teams",
    detail: "Each company does its own craft. P5 coordinates the handoff between them.",
  },
  {
    label: "Free to ask",
    detail: "Quotes and site visits cost nothing and carry no obligation to proceed.",
  },
] as const;

export interface Testimonial {
  /** The customer's own words, quoted exactly. */
  readonly quote: string;
  /** How they are willing to be identified. */
  readonly name: string;
  /** Project and city, so the reader can place it. */
  readonly context: string;
  /** Where it can be verified - a Google review URL, for example. */
  readonly sourceUrl?: string;
}

export const TESTIMONIALS: readonly Testimonial[] = [];

/** Whether there is anything real to show. */
export function hasTestimonials(): boolean {
  return TESTIMONIALS.length > 0;
}
