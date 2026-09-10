import assert from "node:assert/strict";
import test from "node:test";

import { schemaFor } from "../app/quote/schema.ts";
import { QUOTE_SERVICES } from "../app/quote/services.ts";
import { homePageSchema, serializeJsonLd, siteSchema } from "../app/structuredData.ts";

function types(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const type = (value as Record<string, unknown>)["@type"];
  return Array.isArray(type) ? type.map(String) : type ? [String(type)] : [];
}

test("the root schema contains only site-wide entities", () => {
  const graph = siteSchema["@graph"];
  assert.deepEqual(graph.flatMap(types), ["Organization", "HomeAndConstructionBusiness", "WebSite"]);
  assert.ok(!serializeJsonLd(siteSchema).includes("FAQPage"));
});

test("the homepage owns its FAQPage schema", () => {
  assert.ok(types(homePageSchema).includes("FAQPage"));
  assert.equal(homePageSchema.url, "https://p5homeco.com");
  assert.ok(homePageSchema.mainEntity.length > 0);
});

test("each quote route emits exactly its own FAQPage", () => {
  for (const service of [null, ...QUOTE_SERVICES]) {
    const graph = schemaFor(service)["@graph"] as Record<string, unknown>[];
    const faqs = graph.filter((node) => types(node).includes("FAQPage"));
    const path = service ? `/quote/${service.slug}` : "/quote";
    assert.equal(faqs.length, 1);
    assert.equal(faqs[0]?.["@id"], `https://p5homeco.com${path}#faq`);
  }
});

test("JSON-LD serialization escapes HTML opening brackets", () => {
  assert.equal(serializeJsonLd({ value: "</script>" }), '{"value":"\\u003c/script>"}');
});
