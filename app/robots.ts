import type { MetadataRoute } from "next";
import { siteUrl } from "./site";

// Major AI answer engines are named explicitly rather than left to the
// wildcard rule. A cautious crawler can back off when its access is
// ambiguous, so naming and allowing each one removes the guesswork.
const aiCrawlers = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "anthropic-ai",
  "Claude-Web",
  "PerplexityBot",
  "Google-Extended",
  "CCBot",
];

// The lead manager and its endpoints are staff-only and hold client contact
// details. They carry noindex headers as well; this keeps them out of the
// crawl in the first place.
const privatePaths = ["/admin", "/api/"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: privatePaths },
      ...aiCrawlers.map((userAgent) => ({ userAgent, allow: "/", disallow: privatePaths })),
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
