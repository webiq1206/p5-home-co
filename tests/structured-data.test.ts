import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { schemaFor } from "../app/quote/schema.ts";
import { QUOTE_SERVICES } from "../app/quote/services.ts";
import { NICK_PERKINS_ID, SCHEMA_LEGAL_NAME, SCHEMA_TELEPHONE } from "../app/publicIdentity.ts";
import { businessDescription, businessId, homePageSchema, serializeJsonLd, siteDescription, siteSchema, siteTitle } from "../app/structuredData.ts";
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
  assert.deepEqual(graph.flatMap(types), ["HomeAndConstructionBusiness", "GeneralContractor", "WebSite"]);
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
  assert.equal(organization["@id"], businessId);
  assert.equal(organization["@id"], "https://p5homeco.com/#business");
  assert.equal(organization.description, businessDescription);
  assert.equal(siteSchema["@graph"][1].description, siteDescription);
  assert.equal(homePageSchema.description, siteDescription);
  assert.notEqual(organization.description, siteDescription);
  assert.equal("streetAddress" in address, false);
  assert.equal("postalCode" in address, false);
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
  assert.equal(organization.employee.worksFor["@id"], businessId);
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
    "https://nextdoor.com/pages/boise-remodeling-co-meridian-id/",
    "https://ezlocal.com/id/meridian/home-remodeling/0919899218",
    "https://www.cylex.us.com/company/p5-home-co--llc-40749871.html",
    "https://www.google.com/maps?cid=11869148461693849141",
    "https://www.google.com/search?kgmid=/g/11ntl1t7dc",
  ]);
  assert.equal(organization.sameAs.some((url) => /bbb\.org|houzz\.com|buildzoom\.com|yelp\.com/i.test(url)), false);
  assert.equal("priceRange" in organization, false);
  assert.equal(JSON.stringify(organization).includes("aggregateRating"), false);
  assert.equal(siteTitle, "Boise Builders, Remodelers, Cabinets & Repairs | P5 Home Co");
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
  assert.equal(serialized.includes("streetAddress"), false);
  assert.equal(serialized.includes("Wapoot"), false);
  assert.equal(serialized.toLowerCase().includes("storefront"), false);
  assert.equal(serialized.includes('"addressLocality":"Boise"'), false);
  assert.equal(serialized.includes('"addressLocality":"Meridian"'), true);
  assert.equal(serialized.includes("postalCode"), false);
  assert.equal(/showroom|shop/i.test(JSON.stringify(organization)), false);
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
  // boiseadu.co has no DNS record. Boise ADU Co links to /quote/adu.
  const organization = siteSchema["@graph"][0];
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
  assert.deepEqual(ids, [
    "https://boiseconstruction.co/#business",
    "https://boiseremodeling.co/#business",
    "https://boisecabinet.co/#business",
    "https://boisehandyman.co/#business",
    "https://p5homeco.com/#adu",
  ]);
  const adu = organization.subOrganization.find((node) => node.name === "Boise ADU Co");
  assert.equal(adu?.url, "https://p5homeco.com/quote/adu");
  assert.equal(adu?.["@id"], "https://p5homeco.com/#adu");
  for (const node of organization.subOrganization) {
    assert.equal(node.parentOrganization["@id"], businessId);
  }
  const cabinet = organization.subOrganization.find((node) => node.name === "Boise Cabinet Co");
  const remodeling = organization.subOrganization.find((node) => node.name === "Boise Remodeling Co");
  assert.equal("sameAs" in (cabinet ?? {}), false);
  assert.equal("sameAs" in (remodeling ?? {}), false);
  assert.equal(organization.subOrganization.some((node) => "sameAs" in node), false);
  const graphIds = records(siteSchema).flatMap((record) => (
    record["@type"] && record["@id"] ? [String(record["@id"])] : []
  ));
  assert.equal(new Set(graphIds).size, graphIds.length);
  const businessNodes = records(siteSchema).filter((record) => {
    const nodeTypes = types(record);
    return nodeTypes.includes("HomeAndConstructionBusiness") || nodeTypes.includes("GeneralContractor");
  });
  assert.equal(businessNodes.length, 1);
  assert.equal(businessNodes[0]?.["@id"], businessId);
});
