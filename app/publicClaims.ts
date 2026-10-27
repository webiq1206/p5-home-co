import { BASEBOARD_TRIM_FIT, FRAMING_FOOTHILLS } from "./imageVariants.ts";
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
export const SHOW_UNPROVEN_TOP_RATED = false;
export const SHOW_UNPROVEN_SATISFACTION_GUARANTEE = false;
export const SHOW_CABINET_FABRICATION = false;

/** AI staff-in-shirt photos stay in the repo and render only when this is on. */
export const SHOW_FAKE_STAFF_IMAGES = false;

export const CREW_AND_TRADES =
  "Cabinets sourced and installed by our own crew, with trade partners where needed.";

export const SELF_PERFORM_FAQ =
  "P5 Home Co is an operating family of companies, not a directory or a referral network. Each of the five companies has its own craft and team, and does the work itself, under one shared standard for scopes, communication, and accountability.";

export const SPECIALTY_FAQ =
  "P5 Home Co is an operating family of companies, not a directory or a referral network. Each company has its own specialty and team, under one shared standard for scopes, communication, and accountability. Cabinets sourced and installed by our own crew, with trade partners where needed.";

export const CRAFT_EXPERTISE = "Each company has its own craft, team, and expertise.";
export const SPECIALTY_EXPERTISE = "Each company has its own specialty, team, and expertise.";

export const QUOTE_SELF_PERFORM = "Each one does its own craft under one shared standard.";
export const QUOTE_SPECIALTY = "Each one focuses on its own specialty under one shared standard.";

export const OWN_CRAFT_DETAIL = "Start with the company whose craft fits your project. Your specialist explains the next step.";
export const OWN_SPECIALTY_DETAIL = "Start with the company whose specialty fits your project. Your specialist explains the next step.";

export const FABRICATION_HANDOFF = "Cabinet design, fabrication, and installation";
export const SOURCING_HANDOFF = "Cabinet design, sourcing, and installation";

export const FABRICATION_COVER = "Design, fabrication, and installation";
export const SOURCING_COVER = "Design, sourcing, and installation";

export const FABRICATION_FAQ =
  "Yes. A complete kitchen transformation, for example, runs through Boise Remodeling Co for layout, permits, demolition, and construction; Boise Cabinet Co for cabinet design, fabrication, and installation; and Boise Handyman Co for final mounting, finish work, and punch-list items.";

export const SOURCING_FAQ =
  "Yes. A complete kitchen transformation, for example, runs through Boise Remodeling Co for layout, permits, demolition, and construction; Boise Cabinet Co for cabinet design, sourcing, and installation; and Boise Handyman Co for final mounting, finish work, and punch-list items.";

/** Kept so a later proof can turn them back on. Neither phrase is published today. */
export const TOP_RATED_PHRASE = "top-rated";
export const SATISFACTION_GUARANTEED_PHRASE = "satisfaction guaranteed";

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
export const CONSTRUCTION_NEUTRAL_IMAGE = FRAMING_FOOTHILLS.src;
export const HANDYMAN_STAFF_IMAGE = "/images/p5-handyman-branded.webp";
export const HANDYMAN_NEUTRAL_IMAGE = BASEBOARD_TRIM_FIT.src;

export const constructionImage = SHOW_FAKE_STAFF_IMAGES
  ? CONSTRUCTION_STAFF_IMAGE
  : CONSTRUCTION_NEUTRAL_IMAGE;
export const handymanImage = SHOW_FAKE_STAFF_IMAGES ? HANDYMAN_STAFF_IMAGE : HANDYMAN_NEUTRAL_IMAGE;

export const cabinetProof = [SHOW_UNPROVEN_FINISH_COUNT ? CABINET_FINISH_COUNT : "", SHOW_UNPROVEN_WARRANTY ? CABINET_WARRANTY : ""]
  .filter(Boolean)
  .join(" · ");
