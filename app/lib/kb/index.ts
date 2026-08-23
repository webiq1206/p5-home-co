/**
 * Knowledge Center registry: every article, in section order, with lookup
 * helpers. Pure data - safe to import from pages, jobs, and tests alike.
 */

import { automations } from "./content/automations.ts";
import { contracts } from "./content/contracts.ts";
import { dataQuality } from "./content/data-quality.ts";
import { faq } from "./content/faq.ts";
import { future } from "./content/future.ts";
import { glossary } from "./content/glossary.ts";
import { howP5Works } from "./content/how-p5-works.ts";
import { lifecycle } from "./content/lifecycle.ts";
import { hubspot } from "./content/hubspot.ts";
import { procedures } from "./content/procedures.ts";
import { quickbooks } from "./content/quickbooks.ts";
import { reporting } from "./content/reporting.ts";
import { troubleshooting } from "./content/troubleshooting.ts";
import { workflows } from "./content/workflows.ts";
import { SECTIONS, type Article, type SectionId } from "./types.ts";

export { SECTIONS };
export type { Article, SectionId };

export const ALL_ARTICLES: Article[] = [
  ...howP5Works,
  ...lifecycle,
  ...quickbooks,
  ...dataQuality,
  ...hubspot,
  ...workflows,
  ...procedures,
  ...contracts,
  ...automations,
  ...reporting,
  ...troubleshooting,
  ...faq,
  ...glossary,
  ...future,
];

const BY_SLUG = new Map(ALL_ARTICLES.map((a) => [a.slug, a]));

export function getArticle(slug: string): Article | null {
  return BY_SLUG.get(slug) ?? null;
}

export function articlesInSection(section: SectionId): Article[] {
  return ALL_ARTICLES.filter((a) => a.section === section);
}

/** Articles that a given drift-check key watches. */
export function articlesVerifiedBy(checkKey: string): Article[] {
  return ALL_ARTICLES.filter((a) => a.verifies?.includes(checkKey));
}
