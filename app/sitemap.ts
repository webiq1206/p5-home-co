import type { MetadataRoute } from "next";
import { getIndexableEntries } from "./siteUrls.ts";

/**
 * Rendered from app/siteUrls.ts - the same list the HTML sitemap page uses, so
 * the two cannot drift. Each entry carries its own frequency and priority: the
 * homepage is the one page meant to win traffic; the legal documents are listed
 * because they have to be publicly reachable, not to rank.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return getIndexableEntries().map((e) => ({
    url: e.url,
    lastModified,
    changeFrequency: e.changeFrequency,
    priority: e.priority,
  }));
}
