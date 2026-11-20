/**
 * The two Google reviews on the P5 Home Co profile (owner, 20 November 2026).
 *
 * Quoted verbatim. An excerpt may only leave out whole sentences, shown as
 * "...", and never changes a word. Toni Knowles's second sentence is left out
 * because it contains an em dash, which the site does not print; it is not
 * edited. The reviewer names are as written on Google.
 *
 * No AggregateRating or Review JSON-LD (self-serving reviews), no star
 * markup and no rating count: the cards name the reviewer, say "Google
 * review" and link to the profile.
 */
import { P5_GBP_MAPS_URL } from "./publicIdentity.ts";

export type GoogleReview = { readonly name: string; readonly text: string };

export const GOOGLE_REVIEWS: readonly GoogleReview[] = [
  {
    name: "Toni Knowles",
    text: "Nick with P5 completed a full kitchen and home remodel at my home in the North End, and he was absolutely amazing! ... Nick was attentive, thoughtful, and dedicated to making sure every detail was just right. We couldn't be happier with the results and highly recommend him to anyone looking for an exceptional remodeling experience!",
  },
  {
    name: "beverly van zandt",
    text: "We had P5 remodel our bathroom and kitchen, and we couldn't be happier with the work! They do a little bit of everything. No job seems too big or too small. If you're looking for someone reliable who can handle a variety of projects, I highly recommend giving P5 a call. Definitely recommend!",
  },
];

/** The P5 Home Co Google Business Profile, the same link the contact page uses. */
export const GOOGLE_REVIEWS_URL = P5_GBP_MAPS_URL;
