import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { faqs } from "../app/site.ts";
import { homePageSchema, siteDescription, siteTitle } from "../app/structuredData.ts";
import { QUOTE_SERVICES } from "../app/quote/services.ts";
import { withBrandPageMetadata } from "../lib/brand-page-metadata.ts";
import sitemap from "../app/sitemap.ts";

function titleOf(meta: { title?: unknown }): string {
  const value = meta.title;
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "absolute" in value) return String((value as { absolute?: string }).absolute || "");
  return "";
}

function descriptionOf(meta: { description?: unknown }): string {
  return typeof meta.description === "string" ? meta.description : "";
}

test("public titles stay at 60 characters or fewer and descriptions at 155 or fewer", () => {
  const cases: [string, { title?: unknown; description?: unknown }][] = [
    ["layout", withBrandPageMetadata({ title: siteTitle, description: siteDescription }, "__layout__")],
    ["quote", withBrandPageMetadata({ title: "Request a Free Home Project Quote | P5 Home Co", description: "placeholder", alternates: { canonical: "/quote" } }, "/quote")],
    ["sitemap", withBrandPageMetadata({ title: "Site Map | P5 Home Co", description: "Every page on p5homeco.com, and a direct link to each of the five P5 Home Co companies.", alternates: { canonical: "/sitemap" } }, "/sitemap")],
    ["estimate", withBrandPageMetadata({
      title: { absolute: "Start Your Home Project in Boise | P5 Home Co" },
      description: "Describe your Treasure Valley home project, add plans or photos, and review the details before sending your request to P5 for project review.",
      alternates: { canonical: "https://p5homeco.com/estimate" },
    }, "/estimate")],
    ["home override", withBrandPageMetadata({ title: siteTitle, description: siteDescription, alternates: { canonical: "/" } }, "/")],
  ];
  for (const service of QUOTE_SERVICES) {
    cases.push([service.slug, withBrandPageMetadata({
      title: service.metaTitle,
      description: service.metaDescription,
      alternates: { canonical: `/quote/${service.slug}` },
    }, "/quote/[service]")]);
  }
  for (const file of ["app/legal/privacy/page.tsx", "app/legal/terms/page.tsx", "app/legal/quickbooks-disconnect/page.tsx", "app/quote/thanks/page.tsx"]) {
    const source = readFileSync(file, "utf8");
    const title = source.match(/title:\s*"([^"]+)"/)?.[1];
    const description = source.match(/description:\s*(?:\n\s*)?"([^"]+)"/)?.[1];
    assert.ok(title, `${file} title`);
    assert.ok(description, `${file} description`);
    cases.push([file, { title, description }]);
  }
  for (const [name, meta] of cases) {
    const title = titleOf(meta);
    const description = descriptionOf(meta);
    assert.ok(title.length > 0 && title.length <= 60, `${name} title is ${title.length}: ${title}`);
    assert.ok(description.length > 0 && description.length <= 155, `${name} description is ${description.length}: ${description}`);
  }
});

test("llms-full.txt is the fact sheet plus the homepage FAQ and nothing invented", () => {
  const llms = readFileSync("public/llms.txt", "utf8");
  const full = readFileSync("public/llms-full.txt", "utf8");
  assert.match(llms, /https:\/\/p5homeco\.com\/llms-full\.txt/);
  assert.match(full, /Established 2020\. Bonded and insured\./);
  assert.match(full, /Boise, Meridian, Eagle, Nampa, Kuna, Star, Middleton, Caldwell, and Garden/);
  for (const item of faqs) {
    assert.ok(full.includes(item.q), item.q);
    assert.ok(full.includes(item.a), item.q);
  }
  const questions = homePageSchema.mainEntity.map((item) => item.name);
  assert.ok(questions.includes("Who builds a new home, or builds on land you already own?"));
  assert.ok(questions.includes("Can one project involve more than one company?"));
  assert.equal(full.includes("Nick Perkins"), false);
  assert.equal(full.toLowerCase().includes("facebook.com"), false);
});

test("/quote has a server-rendered H1 and /estimate renders one before the draft loads", () => {
  const quote = readFileSync("app/quote/QuoteLanding.tsx", "utf8");
  assert.match(quote, /<h1>A specialist team for your home project<\/h1>/);
  assert.match(quote, /headingAs=\{service \? "h1" : "h2"\}/);
  const preview = readFileSync("app/estimate/p5-preview/page.tsx", "utf8");
  assert.match(preview, /<EstimateDocumentTitle \/>/);
  const title = readFileSync("app/estimate/EstimateDocumentTitle.tsx", "utf8");
  assert.match(title, /INTAKE_COPY\.heading/);
  assert.match(title, /<h1>\{heading\}<\/h1>/);
  assert.match(title, /data-stage-heading/);
});

test("/quote/adu stays noindex with the other paid quote variants, and is not in the sitemap", () => {
  const source = readFileSync("app/quote/[service]/page.tsx", "utf8");
  assert.match(source, /robots:\s*\{\s*index:\s*false,\s*follow:\s*true\s*\}/);
  const urls = sitemap().map((entry) => entry.url);
  assert.equal(urls.some((url) => url.includes("/quote/adu")), false);
  assert.ok(urls.includes("https://p5homeco.com/quote"));
});

test("every live city page is in the sitemap", () => {
  const cities = ["boise", "meridian", "eagle", "nampa", "kuna", "star", "middleton", "caldwell", "garden-city"];
  const pages: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const next = prefix ? `${prefix}/${entry.name}` : `/${entry.name}`;
      if (entry.isDirectory()) walk(join(dir, entry.name), next);
      else if (entry.name === "page.tsx") pages.push(prefix || "/");
    }
  };
  walk("app", "");
  const indexed = new Set(sitemap().map((entry) => new URL(entry.url).pathname));
  const cityPages = pages.filter((path) => path.split("/").some((part) => cities.includes(part)));
  for (const path of cityPages) assert.ok(indexed.has(path), `${path} is missing from the sitemap`);
});
