/**
 * The contract template registry (S215).
 *
 * Every document P5 issues, in one list, so nothing is drafted twice and no
 * clause quietly differs between two jobs.
 */

import { agreements } from "./agreements.ts";
import { lienWaivers } from "./lien-waivers.ts";
import { standaloneAgreements } from "./standalone.ts";
import type { DocumentTemplate } from "./types.ts";

export * from "./types.ts";
export * from "./render.ts";
export * from "./lien-waivers.ts";
export * from "./agreements.ts";
export * from "./readiness.ts";
export * from "./standalone.ts";

export const ALL_TEMPLATES: DocumentTemplate[] = [
  ...agreements,
  ...standaloneAgreements,
  ...lienWaivers,
];

const BY_KEY = new Map(ALL_TEMPLATES.map((t) => [t.key, t]));

export function getTemplate(key: string): DocumentTemplate | null {
  return BY_KEY.get(key) ?? null;
}

export function templatesByCategory(
  category: DocumentTemplate["category"],
): DocumentTemplate[] {
  return ALL_TEMPLATES.filter((t) => t.category === category);
}

/**
 * Templates not yet cleared by counsel.
 *
 * Surfaced rather than buried: these are the documents that decide who pays
 * when something goes wrong, and every one of them was drafted by software.
 */
export function awaitingReview(): DocumentTemplate[] {
  return ALL_TEMPLATES.filter((t) => t.reviewState !== "approved");
}

/**
 * Clauses that carry the risk, across every template.
 *
 * The list a subcontractor's redline should be checked against - these are the
 * ones to escalate rather than concede.
 */
export function loadBearingClauses(): {
  template: string;
  heading: string;
  rationale: string;
}[] {
  return ALL_TEMPLATES.flatMap((t) =>
    t.clauses
      .filter((c) => c.loadBearing)
      .map((c) => ({
        template: t.title,
        heading: c.heading,
        rationale: c.rationale ?? "Decides who pays when something goes wrong.",
      })),
  );
}
