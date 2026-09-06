import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  QUOTE_SERVICES,
  SERVICE_FAQ,
  serviceBySlug,
  serviceSlugs,
} from "../app/quote/services.ts";
import { faqsFor, pathFor, schemaFor } from "../app/quote/schema.ts";
import { PROJECT_OPTIONS, brandForProject } from "../app/quote/options.ts";
import { TESTIMONIALS } from "../app/quote/proof.ts";
import { ownPages } from "../app/siteUrls.ts";

const root = join(import.meta.dirname, "..");

// --- Routing ----------------------------------------------------------------

/**
 * The one that actually costs money if it breaks: a typo in `project` would
 * send a paid kitchen lead to the parent company instead of the remodelers,
 * silently, with no error anywhere.
 */
test("every service pre-selects a real project that routes to its own brand", () => {
  const values = PROJECT_OPTIONS.map((o) => o.value);
  for (const service of QUOTE_SERVICES) {
    assert.ok(
      values.includes(service.project),
      `${service.slug}: "${service.project}" is not a PROJECT_OPTIONS value`,
    );
    assert.equal(
      brandForProject(service.project),
      service.brand,
      `${service.slug} would route to the wrong company`,
    );
  }
});

test("slugs are unique, url-safe, and never collide with the thanks route", () => {
  const slugs = serviceSlugs();
  assert.equal(new Set(slugs).size, slugs.length, "duplicate slug");
  for (const slug of slugs) {
    assert.match(slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${slug} is not url-safe`);
    assert.notEqual(slug, "thanks", "would shadow /quote/thanks");
  }
});

test("an unknown slug resolves to null so the route can 404", () => {
  assert.equal(serviceBySlug("kitchen-remodel")?.brand, "Boise Remodeling Co");
  assert.equal(serviceBySlug("not-a-service"), null);
  assert.equal(serviceBySlug(undefined), null);
});

// --- Assets and metadata ----------------------------------------------------

test("every hero image actually exists in public/", () => {
  for (const service of QUOTE_SERVICES) {
    assert.ok(
      existsSync(join(root, "public", service.image)),
      `${service.slug}: missing ${service.image}`,
    );
    assert.ok(service.imageAlt.length > 15, `${service.slug}: alt text is too thin`);
  }
});

test("titles and descriptions are unique and within sensible search limits", () => {
  const titles = new Set<string>();
  const descriptions = new Set<string>();
  for (const service of QUOTE_SERVICES) {
    assert.ok(!titles.has(service.metaTitle), `duplicate title: ${service.metaTitle}`);
    assert.ok(
      !descriptions.has(service.metaDescription),
      `duplicate description on ${service.slug}`,
    );
    titles.add(service.metaTitle);
    descriptions.add(service.metaDescription);

    assert.ok(service.metaTitle.length <= 65, `${service.slug} title is ${service.metaTitle.length}`);
    assert.ok(
      service.metaDescription.length >= 110 && service.metaDescription.length <= 175,
      `${service.slug} description is ${service.metaDescription.length}`,
    );
  }
});

test("every service page is in the sitemap source", () => {
  const hrefs = ownPages.map((p) => p.href);
  assert.ok(hrefs.includes("/quote"), "the generic quote page is missing");
  for (const service of QUOTE_SERVICES) {
    assert.ok(hrefs.includes(`/quote/${service.slug}`), `${service.slug} is not in the sitemap`);
  }
});

// --- FAQ and structured data -------------------------------------------------

test("each service has its own first question, so no two FAQPages are identical", () => {
  const firsts = new Set<string>();
  for (const service of QUOTE_SERVICES) {
    const faq = SERVICE_FAQ[service.slug];
    assert.ok(faq, `${service.slug} has no service-specific question`);
    assert.equal(faqsFor(service)[0]?.q, faq.q, "the specific question should come first");
    assert.ok(!firsts.has(faq.q), `duplicate opening question on ${service.slug}`);
    firsts.add(faq.q);
  }
  // The generic page falls back to the shared set.
  assert.equal(faqsFor(null)[0]?.q, "How much does a quote cost?");
});

test("schema ids are page-specific, so variants never claim the same entity", () => {
  const ids = new Set<string>();
  for (const service of [null, ...QUOTE_SERVICES]) {
    const graph = schemaFor(service)["@graph"] as { "@id": string; "@type": string }[];
    for (const node of graph) {
      assert.ok(!ids.has(node["@id"]), `duplicate @id: ${node["@id"]}`);
      ids.add(node["@id"]);
      assert.ok(node["@id"].startsWith("https://p5homeco.com/quote"));
    }
  }
});

test("a service page's breadcrumb walks home, quote, then the service", () => {
  const service = QUOTE_SERVICES[0]!;
  const graph = schemaFor(service)["@graph"] as Record<string, unknown>[];
  const crumb = graph.find((n) => n["@type"] === "BreadcrumbList") as {
    itemListElement: { name: string; item: string }[];
  };
  assert.equal(crumb.itemListElement.length, 3);
  assert.equal(crumb.itemListElement[2]?.name, service.label);
  assert.equal(crumb.itemListElement[2]?.item, `https://p5homeco.com${pathFor(service)}`);
  // The generic page has no third level.
  const generic = (schemaFor(null)["@graph"] as Record<string, unknown>[]).find(
    (n) => n["@type"] === "BreadcrumbList",
  ) as { itemListElement: unknown[] };
  assert.equal(generic.itemListElement.length, 2);
});

test("every FAQ answer is non-trivial, since the schema promises a real answer", () => {
  for (const service of [null, ...QUOTE_SERVICES]) {
    for (const faq of faqsFor(service)) {
      assert.ok(faq.q.endsWith("?"), `not a question: ${faq.q}`);
      assert.ok(faq.a.length > 80, `answer too thin: ${faq.q}`);
    }
  }
});

// --- Proof -------------------------------------------------------------------

/**
 * Guard rail, not a style check. As of 2026-09-06 the Google Business Profile
 * shows "No reviews" and Yelp shows 0.0, so anything appearing here would be
 * unverifiable. If this fails, someone added a testimonial: it must be real,
 * attributable, and ideally carry a sourceUrl a reader can check.
 */
test("no testimonial ships without a name and a context", () => {
  for (const t of TESTIMONIALS) {
    assert.ok(t.quote.trim().length > 20, "empty or trivial quote");
    assert.ok(t.name.trim().length > 0, "a testimonial must be attributable");
    assert.ok(t.context.trim().length > 0, "a testimonial must say what and where");
  }
});
