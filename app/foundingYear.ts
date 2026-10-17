/**
 * Idaho SOS shows P5 Home Co. LLC filed 09/25/2025. Nothing backs a 2020
 * founding year, so every public use of that year stays in source and is
 * hidden unless this flag is turned on. Do not delete the sentences below.
 */
export const SHOW_FOUNDING_YEAR = false;

/** Every founding phrase stays here for the guard test. The flag publishes at most one badge. */
export const FOUNDING_PHRASES = [
  "Est. 2020",
  "Established 2020",
  "founded in 2020",
  "since 2020",
  "Working here since 2020",
] as const;

/** Flag on adds one badge. It does not add the other phrases as extra badges. */
export function visibleFoundingBadges(): readonly string[] {
  return SHOW_FOUNDING_YEAR ? ["Est. 2020"] : [];
}

export const ESTABLISHED_2020_LINE =
  "Established 2020. Bonded and insured. Serving Ada and Canyon counties.";

export const BONDED_SINCE_2020_ANSWER =
  "Yes. The P5 companies are bonded and insured, have worked across the Treasure Valley since 2020, and handle permits in-house where a project requires them.";

export const BONDED_ANSWER =
  "Yes. The P5 companies are bonded and insured and handle permits in-house where a project requires them.";
