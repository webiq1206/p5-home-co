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

function records(value: unknown, found: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (!value || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    for (const item of value) records(item, found);
    return found;
  }
  const record = value as Record<string, unknown>;
  found.push(record);
  for (const child of Object.values(record)) records(child, found);
  return found;
}

test("the root schema contains only site-wide entities", () => {
  const graph = siteSchema["@graph"];
  assert.deepEqual(graph.flatMap(types), ["Organization", "HomeAndConstructionBusiness", "WebSite"]);
  assert.ok(!serializeJsonLd(siteSchema).includes("FAQPage"));
});

test("the only postal address is the Meridian service-area locality", () => {
  const organization = siteSchema["@graph"][0];
  assert.ok(types(organization).includes("HomeAndConstructionBusiness"));
  assert.deepEqual(organization.address, {
    "@type": "PostalAddress",
    addressLocality: "Meridian",
    addressRegion: "ID",
    addressCountry: "US",
  });
  assert.equal("streetAddress" in organization.address, false);

  const addresses = records(siteSchema).filter((record) => record["@type"] === "PostalAddress");
  assert.equal(addresses.length, 1);
  for (const city of ["Boise", "Eagle", "Nampa", "Garden City", "Meridian"]) {
    const area = organization.areaServed.find((entry) => entry.name === city);
    assert.ok(area, `${city} is areaServed`);
    assert.equal(area["@type"], "City");
    assert.equal("address" in area, false);
  }

  const serialized = serializeJsonLd(siteSchema) + serializeJsonLd(homePageSchema) + serializeJsonLd(schemaFor(null));
  assert.equal(serialized.includes("streetAddress"), false);
  assert.equal(serialized.toLowerCase().includes("storefront"), false);
  assert.equal(serialized.includes('"addressLocality":"Boise"'), false);
  assert.equal(serialized.includes('"addressLocality":"Meridian"'), true);
  assert.equal(records(homePageSchema).some((record) => record["@type"] === "PostalAddress"), false);
  assert.equal(records(schemaFor(null)).some((record) => record["@type"] === "PostalAddress"), false);
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
