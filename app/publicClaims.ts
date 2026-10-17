/**
 * Unproven public claims stay in source and stay hidden unless a flag is
 * turned on. Nothing here is deleted. Priya can replace CREW_AND_TRADES
 * without hunting through the pages.
 */
export const SHOW_UNPROVEN_FINISH_COUNT = false;
export const SHOW_UNPROVEN_WARRANTY = false;
export const SHOW_UNPROVEN_PROJECT_COUNT = false;
export const SHOW_FOUNDING_YEAR = false;
export const SHOW_UNPROVEN_SELF_PERFORM = false;
export const SHOW_UNPROVEN_TRUSTED = false;

/** AI staff-in-shirt photos stay in the repo and render only when this is on. */
export const SHOW_FAKE_STAFF_IMAGES = false;

export const CREW_AND_TRADES =
  "Cabinets sourced and installed by our own crew; trusted trade partners where needed";

export const SELF_PERFORM_CLAUSE =
  "Each of the five companies has its own craft and team, and does the work itself";

export const QUOTE_SELF_PERFORM =
  "Each one does its own craft under one shared standard.";

export const CABINET_FINISH_COUNT = "299 finishes";
export const CABINET_WARRANTY = "Lifetime workmanship warranty";

export const TRUSTED_H1 = "Boise’s Trusted Home Specialists";
export const PLAIN_H1 = "Boise’s Home Specialists";

export const TRUSTED_LEDE =
  "Build it. Remodel it. Expand it. Care for it. Finish it. P5 brings every chapter of homeownership under one trusted family of specialized Treasure Valley companies.";
export const PLAIN_LEDE =
  "Build it. Remodel it. Expand it. Care for it. Finish it. P5 brings every chapter of homeownership under one family of specialized Treasure Valley companies.";

export const ESTABLISHED_2020_LINE =
  "Established 2020. Bonded and insured. Serving Ada and Canyon counties.";

export const BONDED_SINCE_2020_ANSWER =
  "Yes. The P5 companies are bonded and insured, have worked across the Treasure Valley since 2020, and handle permits in-house where a project requires them.";

export const BONDED_ANSWER =
  "Yes. The P5 companies are bonded and insured and handle permits in-house where a project requires them.";

export const CONSTRUCTION_STAFF_IMAGE = "/images/p5-construction-branded.webp";
export const CONSTRUCTION_NEUTRAL_IMAGE = "/images/p5-hero.webp";
export const HANDYMAN_STAFF_IMAGE = "/images/p5-handyman-branded.webp";
export const HANDYMAN_NEUTRAL_IMAGE = "/images/p5-closing-v2.webp";

export const constructionImage = SHOW_FAKE_STAFF_IMAGES
  ? CONSTRUCTION_STAFF_IMAGE
  : CONSTRUCTION_NEUTRAL_IMAGE;
export const handymanImage = SHOW_FAKE_STAFF_IMAGES ? HANDYMAN_STAFF_IMAGE : HANDYMAN_NEUTRAL_IMAGE;

export const cabinetProof = [SHOW_UNPROVEN_FINISH_COUNT ? CABINET_FINISH_COUNT : "", SHOW_UNPROVEN_WARRANTY ? CABINET_WARRANTY : ""]
  .filter(Boolean)
  .join(" · ");
