/**
 * Unproven public claims stay in source and stay off the published page
 * unless a flag is turned on. Nothing in this file is deleted.
 * SHOW_FOUNDING_YEAR stays off.
 */
export const SHOW_FOUNDING_YEAR = false;

/** Flag off publishes the neutral homepage lines. The trusted sentences stay below. */
export const SHOW_UNPROVEN_TRUSTED = false;

export const BONDED_SINCE_2020_ANSWER =
  "Yes. The P5 companies are bonded and insured, have worked across the Treasure Valley since 2020, and handle permits in-house where a project requires them.";

export const BONDED_ANSWER =
  "Yes. The P5 companies are bonded and insured and handle permits in-house where a project requires them.";

export const ESTABLISHED_2020_LINE =
  "Established 2020. Bonded and insured. Serving Ada and Canyon counties.";

export const ESTABLISHED_LINE = "Bonded and insured. Serving Ada and Canyon counties.";

export const TRUSTED_H1 = "Boise’s Trusted Home Specialists";

export const HOMEPAGE_H1 = "Boise’s Home Specialists";

export const TRUSTED_LEDE =
  "Build it. Remodel it. Expand it. Care for it. Finish it. P5 brings every chapter of homeownership under one trusted family of specialized Treasure Valley companies.";

export const HOMEPAGE_LEDE =
  "Build it. Remodel it. Expand it. Care for it. Finish it. P5 brings every chapter of homeownership under one family of specialized Treasure Valley companies.";

export const WORKING_HERE_SINCE_2020 = {
  label: "Working here since 2020",
  detail: "Building, remodeling, and repairing homes across Ada and Canyon counties.",
} as const;
