import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { schemaFor } from "../app/quote/schema.ts";
import { QUOTE_SERVICES } from "../app/quote/services.ts";
import { NICK_PERKINS_ID, SCHEMA_LEGAL_NAME, SCHEMA_TELEPHONE } from "../app/publicIdentity.ts";
import { breadcrumbSchema, homePageSchema, serializeJsonLd, siteSchema, siteTitle } from "../app/structuredData.ts";
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
  assert.deepEqual(graph.flatMap(types), ["Organization", "GeneralContractor", "WebSite"]);
  assert.ok(!serializeJsonLd(siteSchema).includes("FAQPage"));
});

test("public schema publishes the locality, rounded geo and the seven service areas", () => {
  const organization = siteSchema["@graph"][0];
  assert.ok(types(organization).includes("GeneralContractor"));
  const address = organization.address;
  const operations = readFileSync("docs/growth/OPERATIONS.md", "utf8");
  const legal = readFileSync("app/legal/layout.tsx", "utf8");
  assert.equal(legal.includes("streetAddress"), false);
  assert.equal(ESTIMATOR_BRAND.phone, "(208) 477-1169");
  assert.equal(operations.includes(ESTIMATOR_BRAND.phone), true);
  assert.deepEqual(address, {
    "@type": "PostalAddress",
    addressLocality: "Meridian",
    addressRegion: "ID",
    postalCode: "83646",
    addressCountry: "US",
  });
  assert.deepEqual(organization.geo, {
    "@type": "GeoCoordinates",
    latitude: 43.652,
    longitude: -116.444,
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
    "https://www.facebook.com/p5homeco",
    "https://www.instagram.com/p5_home_co",
    "https://www.google.com/search?kgmid=/g/11ntl1t7dc",
    "https://maps.google.com/?cid=11869148461693849141",
    "https://www.bbb.org/us/id/meridian/profile/general-contractor/p5-home-co-llc-1296-1000203624",
  ]);
  assert.equal(JSON.stringify(organization).includes("aggregateRating"), false);
  assert.equal(/accreditation|bbbRating|"rating"/i.test(JSON.stringify(organization)), false);
  for (const node of organization.subOrganization) assert.equal("sameAs" in node, false, node.name);
  // Parent-brand title (owner, 20 November 2026; SEO audit P5-S1): no trade head terms.
  assert.equal(siteTitle, "P5 Home Co | Five Treasure Valley home companies");
  assert.doesNotMatch(siteTitle, /builder|remodel|cabinet|handyman|repair/i);
  assert.ok(siteTitle.length <= 60);

  const addresses = records(siteSchema).filter((record) => record["@type"] === "PostalAddress");
  assert.equal(addresses.length, 1);
  assert.deepEqual(organization.areaServed.map((entry) => entry.name), [
    "Ada County, Idaho",
    "Canyon County, Idaho",
    "Boise",
    "Meridian",
    "Eagle",
    "Garden City",
    "Nampa",
    "Kuna",
    "Star",
    "Middleton",
    "Caldwell",
  ]);
  for (const city of ["Boise", "Eagle", "Nampa", "Meridian"]) {
    const area = organization.areaServed.find((entry) => entry.name === city);
    assert.ok(area, `${city} is areaServed`);
    assert.equal(area["@type"], "City");
    assert.equal("address" in area, false);
  }
  // Middleton and Garden City are both served (owner, 20 November 2026).
  for (const city of ["Middleton", "Garden City"]) assert.ok(organization.areaServed.some((entry) => entry.name === city), city);

  const siteJson = serializeJsonLd(siteSchema);
  const elsewhere = serializeJsonLd(homePageSchema) + serializeJsonLd(schemaFor(null));
  const hiddenStreet = ["Wa", "poot"].join("");
  assert.equal(siteJson.includes("streetAddress"), false);
  assert.equal(elsewhere.includes("streetAddress"), false);
  assert.equal((siteJson + elsewhere).toLowerCase().includes(hiddenStreet.toLowerCase()), false);
  assert.equal((siteJson + elsewhere).toLowerCase().includes("storefront"), false);
  assert.equal((siteJson + elsewhere).includes('"addressLocality":"Boise"'), false);
  assert.equal(siteJson.includes('"addressLocality":"Meridian"'), true);
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

test("each subOrganization has its own @id and url", () => {
  // Boise ADU Co has no site yet. Its node uses the P5 ADU request, which is
  // a different url and @id from Boise Construction Co.
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
    "Boise ADU Co",
  ]);
  const adu = organization.subOrganization.find((node) => node.name === "Boise ADU Co");
  assert.equal(adu?.url, "https://p5homeco.com/quote/adu");
  assert.equal(JSON.stringify(organization).includes("boiseadu.co"), false);
});

test("document pages carry a Home > page BreadcrumbList (audit P5-T3)", () => {
  const crumb = breadcrumbSchema("Site map", "/sitemap");
  assert.equal(crumb["@type"], "BreadcrumbList");
  assert.deepEqual(crumb.itemListElement.map((item) => item.item), ["https://p5homeco.com", "https://p5homeco.com/sitemap"]);
  for (const [file, name, path] of [
    ["app/sitemap/page.tsx", "Site map", "/sitemap"],
    ["app/legal/privacy/page.tsx", "Privacy policy", "/legal/privacy"],
    ["app/legal/terms/page.tsx", "Terms of use", "/legal/terms"],
    ["app/legal/quickbooks-disconnect/page.tsx", "Disconnecting QuickBooks", "/legal/quickbooks-disconnect"],
  ]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.ok(source.includes(`breadcrumbJsonLd("${name}", "${path}")`), file);
  }
});
