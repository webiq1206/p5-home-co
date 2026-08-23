import type { MetadataRoute } from "next";
import { siteUrl } from "./site.ts";
import { PRIVATE_PREFIXES } from "./lib/privacy.ts";

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

// Staff-only areas hold client contact details and named-customer portals.
// They carry noindex headers as well; this keeps them out of the crawl in the
// first place. The list lives in app/lib/privacy.ts so robots.txt and the
// X-Robots-Tag header cannot drift apart, and a test fails if they do.
const privatePaths = PRIVATE_PREFIXES.map((p) => (p === "/api" ? "/api/" : p));

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
