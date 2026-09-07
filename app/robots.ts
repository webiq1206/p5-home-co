import type { MetadataRoute } from "next";
import { siteUrl } from "./site.ts";
import { PRIVATE_PREFIXES } from "./lib/privacy.ts";

/**
 * Traditional search crawlers, named explicitly.
 *
 * The wildcard rule below already allows them, so these blocks are belt and
 * braces rather than a fix: they make the permission unambiguous to anyone
 * reading robots.txt, and they are generated from the same template as every
 * other rule so they cannot drift out of step with it.
 */
const searchCrawlers = [
  "Googlebot",
  "Googlebot-Image",
  "Googlebot-News",
  "Bingbot",
  "Slurp",
  "DuckDuckBot",
  "YandexBot",
  "Baiduspider",
  "Applebot",
];

/**
 * AI answer engines and training crawlers.
 *
 * These are named individually because a cautious crawler can back off when
 * its access is ambiguous under a wildcard, and being absent from an AI
 * index is invisible - nothing reports it. Allowing them is a deliberate
 * choice: P5 wants to be quotable in AI answers, which is the same reason
 * /llms.txt exists and the pages are server-rendered.
 *
 * To opt out of AI training later, move a name out of this list and give it
 * its own Disallow rule; do not simply delete it, or it falls back to the
 * wildcard and is allowed anyway.
 */
const aiCrawlers = [
  // OpenAI: training, search index, and live user-triggered fetches.
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  // Anthropic: current and legacy agent names.
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "anthropic-ai",
  "Claude-Web",
  // Perplexity: index and live fetch.
  "PerplexityBot",
  "Perplexity-User",
  // Google Gemini / Vertex training, separate from Googlebot ranking.
  "Google-Extended",
  // Apple Intelligence training, separate from Applebot search.
  "Applebot-Extended",
  "Amazonbot",
  "meta-externalagent",
  "FacebookBot",
  "Bytespider",
  "DuckAssistBot",
  "MistralAI-User",
  "cohere-ai",
  "YouBot",
  // Common Crawl, which many models are trained from downstream.
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
      ...[...searchCrawlers, ...aiCrawlers].map((userAgent) => ({
        userAgent,
        allow: "/",
        disallow: privatePaths,
      })),
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}

/** Exported for the tests, so the allowlist cannot silently shrink. */
export const CRAWLER_ALLOWLIST = { searchCrawlers, aiCrawlers };
