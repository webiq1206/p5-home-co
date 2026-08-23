import type { MetadataRoute } from "next";
import { siteUrl } from "./site";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    {
      url: siteUrl,
      lastModified,
      changeFrequency: "monthly",
      priority: 1,
    },
    // The legal documents are listed because they have to be publicly
    // reachable, not because they are meant to win traffic.
    {
      url: `${siteUrl}/legal/terms`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.2,
    },
    {
      url: `${siteUrl}/legal/privacy`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.2,
    },
    {
      url: `${siteUrl}/legal/quickbooks-disconnect`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.1,
    },
  ];
}
