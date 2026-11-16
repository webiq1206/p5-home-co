/**
 * What a customer reads after their estimate: an invitation to adjust it, and
 * one question about whether the project is part of something bigger. The
 * same words are used on the results screen, the saved estimate link and the
 * confirmation email (owner request, 16 November 2026).
 *
 * Browser-safe: no server imports. No prices, no promises about reply times.
 */

/** The family, in the order the owner lists it. A test keeps this in step with brands.ts. */
export const FAMILY_BRANDS = ["Boise Construction Co", "Boise Remodeling Co", "Boise Cabinet Co", "Boise Handyman Co"];

const PARENT = "P5 Home Co";

function list(names: string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] ?? "";
}

/** Asked on every estimate, whatever the project: a cabinet order, a repair list or a new home. */
export const ADJUST_NOTE =
  "If something is missing, or you'd like to change the scope, the finishes or the timing, tell us. It's easy to adjust, and we'd rather get it right than have you guessing.";

/** Works for every estimate, from a repair list to a new home: it asks about anything else, and assumes nothing about this project. */
export const BIGGER_PLAN_QUESTION = "Anything else on your list?";

/** Who is behind the brand the customer used, and what else the family builds. */
export function familyNote(brandName: string): string {
  const name = brandName.trim() || PARENT;
  const others = FAMILY_BRANDS.filter((b) => b !== name);
  const behind = name === PARENT ? `${PARENT} is the company behind ${list(others)}.` : `${name} is part of ${PARENT}, the company behind ${list(others)}.`;
  return `${behind} So whether it's a few repairs, new cabinets, a full kitchen or bath remodel, an addition or a new home, tell us and we'll plan it alongside this project.`;
}
