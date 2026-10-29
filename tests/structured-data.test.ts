import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { schemaFor } from "../app/quote/schema.ts";
import { QUOTE_SERVICES } from "../app/quote/services.ts";
import { NICK_PERKINS_ID, SCHEMA_LEGAL_NAME, SCHEMA_TELEPHONE } from "../app/publicIdentity.ts";
import { homePageSchema, serializeJsonLd, siteSchema, siteTitle } from "../app/structuredData.ts";
import { ESTIMATOR_BRAND } from "../lib/p5/brand.ts";

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

test("the business address is the authorized Meridian street, and cities stay service areas", () => {
  const organization = siteSchema["@graph"][0];
  assert.ok(types(organization).includes("HomeAndConstructionBusiness"));
  const address = organization.address;
  const published = `${address.streetAddress}, ${address.addressLocality}, ${address.addressRegion} ${address.postalCode}`;
  const operations = readFileSync("docs/growth/OPERATIONS.md", "utf8");
  const legal = readFileSync("app/legal/layout.tsx", "utf8");
  assert.equal(operations.includes(published), true);
  assert.equal(legal.includes(published), true);
  assert.equal(ESTIMATOR_BRAND.phone, "(208) 477-1169");
  assert.equal(operations.includes(ESTIMATOR_BRAND.phone), true);
  assert.deepEqual(address, {
    "@type": "PostalAddress",
    streetAddress: "4031 W Wapoot St",
    addressLocality: "Meridian",
    addressRegion: "ID",
    postalCode: "83646",
    addressCountry: "US",
  });
  assert.equal(organization.legalName, SCHEMA_LEGAL_NAME);
  assert.equal(organization.telephone, SCHEMA_TELEPHONE);
  assert.equal(organization.email, ESTIMATOR_BRAND.email);
  assert.equal(organization.employee["@id"], NICK_PERKINS_ID);
  assert.equal(organization.employee.name, "Nick Perkins");
  assert.equal(organization.employee.jobTitle, "Public representative");
  assert.equal(organization.employee.worksFor["@id"], "https://p5homeco.com/#organization");
  assert.equal(organization.contactPoint.name, "Nick Perkins");
  assert.equal(organization.contactPoint.contactType, "customer service");
  assert.equal(organization.contactPoint.telephone, SCHEMA_TELEPHONE);
  assert.equal(organization.contactPoint.areaServed, "US-ID");
  assert.equal(organization.contactPoint.availableLanguage, "English");
  assert.equal("email" in organization.contactPoint, false);
  assert.equal(organization.hasCredential.credentialCategory, "registration");
  assert.equal(organization.hasCredential.identifier, "8381215");
  assert.equal(organization.hasCredential.name, "Idaho Registered Contractor");
  assert.deepEqual(organization.hasCredential.recognizedBy, {
    "@type": "GovernmentOrganization",
    name: "Idaho Division of Occupational and Professional Licenses",
    url: "https://dopl.idaho.gov/con/",
  });
  assert.equal(JSON.stringify(organization).includes("Jared"), false);
  assert.equal(siteTitle, "P5 Home Co | Treasure Valley Home-Service Companies");
  assert.ok(siteTitle.length <= 60);

  const addresses = records(siteSchema).filter((record) => record["@type"] === "PostalAddress");
  assert.equal(addresses.length, 1);
  for (const city of ["Boise", "Eagle", "Nampa", "Garden City", "Meridian"]) {
    const area = organization.areaServed.find((entry) => entry.name === city);
    assert.ok(area, `${city} is areaServed`);
    assert.equal(area["@type"], "City");
    assert.equal("address" in area, false);
  }

  const serialized = serializeJsonLd(siteSchema) + serializeJsonLd(homePageSchema) + serializeJsonLd(schemaFor(null));
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
