/**
 * Every public URL P5 Home Co is responsible for, in one place. The XML sitemap
 * (app/sitemap.ts) and the HTML sitemap page (app/sitemap/page.tsx) both render
 * from this list, so they cannot drift.
 *
 * P5 is a single-page site whose real job is to route visitors to five child
 * companies, so its crawl path is short by design: this site's own pages, then
 * a followed link to each child site. Boise ADU Co is listed but not linked -
 * its domain does not resolve yet (see replit.md); link it only once live.
 */
import { companies, siteUrl } from "./site.ts";

type ChangeFrequency = "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";

export interface SiteUrlEntry {
  /** Absolute for external child sites, site-relative ("/") for this site. */
  href: string;
  label: string;
  external?: boolean;
  /** Present but not yet a live destination. */
  comingSoon?: boolean;
  /** For sitemap.xml. Fragment links and external sites carry none. */
  changeFrequency?: ChangeFrequency;
  priority?: number;
}

export const ownPages: SiteUrlEntry[] = [
  { href: "/", label: "Home", changeFrequency: "monthly", priority: 1 },
  { href: "/#companies", label: "Our companies" },
  { href: "/#p5-standard", label: "The P5 standard" },
  { href: "/#about", label: "About P5 Home Co" },
  { href: "/#service-area", label: "Service area" },
  { href: "/#faq", label: "Common questions" },
  { href: "/sitemap", label: "Site map", changeFrequency: "monthly", priority: 0.3 },
];

/**
 * The legal documents are listed because they have to be publicly reachable,
 * not because they are meant to win traffic - a real followed link is exactly
 * what "publicly reachable" means to a crawler.
 */
export const legalPages: SiteUrlEntry[] = [
  { href: "/legal/terms", label: "Terms of service", changeFrequency: "yearly", priority: 0.2 },
  { href: "/legal/privacy", label: "Privacy policy", changeFrequency: "yearly", priority: 0.2 },
  { href: "/legal/quickbooks-disconnect", label: "QuickBooks disconnect", changeFrequency: "yearly", priority: 0.1 },
];

export const childSites: SiteUrlEntry[] = companies.map((c) => ({
  href: c.url,
  label: c.name,
  external: true,
  comingSoon: c.description.includes("Launching soon"),
}));

/** Indexable URLs for sitemap.xml: this site's real pages (fragments excluded). */
export function getIndexableEntries(): { url: string; changeFrequency: ChangeFrequency; priority: number }[] {
  return [...ownPages, ...legalPages]
    .filter((p) => !p.href.includes("#") && p.changeFrequency && p.priority !== undefined)
    .map((p) => ({
      url: p.href === "/" ? siteUrl : `${siteUrl}${p.href}`,
      changeFrequency: p.changeFrequency as ChangeFrequency,
      priority: p.priority as number,
    }));
}
