import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { schemaFor } from "../app/quote/schema.ts";
import { QUOTE_SERVICES } from "../app/quote/services.ts";
import { NICK_PERKINS_ID, SCHEMA_LEGAL_NAME, SCHEMA_TELEPHONE } from "../app/publicIdentity.ts";
import { homePageSchema, serializeJsonLd, siteDescription, siteSchema, siteTitle } from "../app/structuredData.ts";
import { ADDED_FAQS, COVERAGE_LINE, HOME_DESCRIPTION, HOME_TITLE } from "../app/visibilityCopy.ts";
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

test("public schema keeps the locality and service areas while street verification stays private", () => {
  const organization = siteSchema["@graph"][0];
  assert.ok(types(organization).includes("HomeAndConstructionBusiness"));
  const address = organization.address;
  const verificationAddress = "4031 W Wapoot St, Meridian, ID 83646";
  const operations = readFileSync("docs/growth/OPERATIONS.md", "utf8");
  const legal = readFileSync("app/legal/layout.tsx", "utf8");
  assert.equal(operations.includes(verificationAddress), true);
  assert.equal(legal.includes(verificationAddress), false);
  assert.equal(ESTIMATOR_BRAND.phone, "(208) 477-1169");
  assert.equal(operations.includes(ESTIMATOR_BRAND.phone), true);
  assert.deepEqual(address, {
    "@type": "PostalAddress",
    addressLocality: "Meridian",
    addressRegion: "ID",
    addressCountry: "US",
  });
  assert.equal(organization.legalName, SCHEMA_LEGAL_NAME);
  assert.equal(organization.telephone, SCHEMA_TELEPHONE);
  assert.equal(organization.email, ESTIMATOR_BRAND.email);
  assert.equal(organization.employee["@id"], NICK_PERKINS_ID);
  assert.equal(organization.employee.name, "Nick Perkins");
  assert.equal(organization.employee.jobTitle, "Founder");
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
  assert.deepEqual(organization.sameAs, [
    "https://www.facebook.com/1228704823655951",
    "https://www.google.com/search?kgmid=/g/11ntl1t7dc",
  ]);
  assert.equal(siteTitle, HOME_TITLE);
  assert.equal(siteTitle, "Boise Construction, Remodeling, Cabinet, Handyman, ADU | P5");
  assert.ok(siteTitle.length <= 60);
  assert.equal(homePageSchema.description, siteDescription);
  assert.equal(homePageSchema.name, HOME_TITLE);
  assert.equal(siteSchema["@graph"][0].description, siteDescription);
  assert.equal(siteSchema["@graph"][1].description, siteDescription);
  assert.notEqual(siteDescription, HOME_DESCRIPTION);
  assert.equal(readFileSync("app/page.tsx", "utf8").includes("description: HOME_DESCRIPTION"), true);
  assert.equal(readFileSync("app/page.tsx", "utf8").includes("description: siteDescription"), false);
  assert.equal(JSON.stringify(siteSchema).includes("Gem County, Idaho"), true);
  assert.equal(organization.areaServed.some((entry) => entry["@type"] === "City" && entry.name === "Emmett"), true);

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
  assert.equal(serialized.includes("Wapoot"), false);
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
  const area = homePageSchema.mainEntity.find((item) => item.name === "Which areas do the P5 companies serve?");
  assert.equal(area?.acceptedAnswer.text, COVERAGE_LINE);
  for (const item of ADDED_FAQS) {
    const found = homePageSchema.mainEntity.find((entry) => entry.name === item.q);
    assert.equal(found?.acceptedAnswer.text, item.a);
  }
  const registered = homePageSchema.mainEntity.find((item) => item.name === "Are the P5 companies registered and insured?");
  assert.equal(registered?.acceptedAnswer.text, "Yes. P5 Home Co LLC, Idaho Registered Contractor #8381215. Insured; certificate on request.");
  const aduStart = homePageSchema.mainEntity.find((item) => item.name === "How do I start an ADU project?");
  assert.equal(aduStart?.acceptedAnswer.text, "Start with Boise ADU Co, or send a short request on this site and we will route it.");
  assert.equal(aduStart?.acceptedAnswer.text.includes("http"), false);
  const published = homePageSchema.mainEntity.map((item) => `${item.name} ${item.acceptedAnswer.text}`).join("\n");
  assert.equal(/bonded/i.test(published), false);
  assert.equal(/showroom/i.test(published), false);
  assert.equal(published.includes("boiseadu.co"), false);
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

test("each subOrganization has its own @id and url", () => {
  // Boise ADU Co runs through Boise Construction Co until its own site exists;
  // listing it would give two differently named nodes the same @id.
  const organization = siteSchema["@graph"][0] as unknown as { subOrganization: Array<Record<string, string>> };
  const ids = organization.subOrganization.map((node) => node["@id"]);
  const urls = organization.subOrganization.map((node) => node.url);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(urls).size, urls.length);
  assert.deepEqual(organization.subOrganization.map((node) => node.name), [
    "Boise Construction Co",
    "Boise Remodeling Co",
    "Boise Cabinet Co",
    "Boise Handyman Co",
  ]);
});
