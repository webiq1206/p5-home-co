import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import { BUSINESS_HOURS_LABEL } from "../lib/businessHours.ts";
import {
  ADU_D3_LINE,
  IDAHO_DOPL_LICENSE_SEARCH,
  LLMS_CONTACT,
  PUBLIC_NAP,
  PUBLIC_REGISTRATION,
  SISTER_LINE,
} from "../app/publicIdentity.ts";
import { TRUSTED_H1 } from "../app/publicClaims.ts";

// Estimator pages carry the identity block themselves.
const pages = [
  "app/estimate/p5-preview/page.tsx",
  "app/estimate/scope/page.tsx",
];
// Every other public page sits inside components/SiteChrome.tsx, whose family
// footer (components/family/SiteFooter.tsx, configured by lib/familyBrand.ts)
// prints the same approved NAP, hours, registration and family row.
const chromePages = [
  "app/HomePageClient.tsx",
  "app/about/AboutClient.tsx",
  "app/legal/layout.tsx",
  "app/quote/QuoteLanding.tsx",
  "app/quote/thanks/page.tsx",
  "app/sitemap/page.tsx",
  "app/not-found.tsx",
];

test("public contact copy keeps useful details without street or administrative labels", () => {
  assert.equal(
    PUBLIC_NAP,
    "Serving Boise and the Treasure Valley · (208) 477-1169 · hello@p5homeco.com",
  );
  assert.equal(
    SISTER_LINE,
    "Part of P5 Home Co: Boise Construction Co · Boise Remodeling Co · Boise Cabinet Co · Boise Handyman Co · Boise ADU Co projects run through Boise Construction Co.",
  );
  assert.equal(PUBLIC_REGISTRATION, "Idaho Registered Contractor #8381215");
  assert.equal(PUBLIC_REGISTRATION.includes("("), false);
  assert.equal(IDAHO_DOPL_LICENSE_SEARCH, "https://edopl.idaho.gov/OnlineServices/?link=PubSearch");
  assert.match(LLMS_CONTACT, /Serving Boise and the Treasure Valley/);
  assert.doesNotMatch(PUBLIC_NAP + LLMS_CONTACT, /Wapoot|public representative|staffed storefront/i);
  assert.match(LLMS_CONTACT, /hello@p5homeco\.com/);
  assert.equal(PUBLIC_NAP.includes("Jared") || SISTER_LINE.includes("Jared") || LLMS_CONTACT.includes("Jared"), false);
});

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(path));
    else if (/\.(tsx|ts)$/.test(entry.name)) found.push(path);
  }
  return found;
}

test("the registration number renders in both modes and estimator pages omit the verification link", () => {
  const identity = readFileSync("components/PublicIdentity.tsx", "utf8");
  assert.match(identity, /linkRegistration \?/);
  const schema = readFileSync("app/structuredData.ts", "utf8");
  assert.equal(schema.includes(IDAHO_DOPL_LICENSE_SEARCH), false);
  assert.equal(schema.includes(PUBLIC_REGISTRATION), false);
  assert.match(schema, /identifier: CONTRACTOR_REGISTRATION/);

  const require = createRequire(import.meta.url);
  const compile = (fileUrl: URL) => ts.transpileModule(readFileSync(fileUrl, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const cache = new Map<string, unknown>();
  const load = (id: string): unknown => {
    if (cache.has(id)) return cache.get(id);
    if (id === "@/app/publicIdentity") {
      const loaded = require(new URL("../app/publicIdentity.ts", import.meta.url).pathname);
      cache.set(id, loaded);
      return loaded;
    }
    if (!id.startsWith("@/")) return require(id);
    const exported: Record<string, unknown> = {};
    const moduleUrl = [".ts", ".tsx"].map(extension => new URL(`../${id.slice(2)}${extension}`, import.meta.url)).find(url => existsSync(url));
    assert.ok(moduleUrl, `Missing source module: ${id}`);
    new Function("require", "exports", "React", compile(moduleUrl))(load, exported, React);
    cache.set(id, exported);
    return exported;
  };
  const identityExports: { default?: React.ComponentType<{ tone?: "inherit" | "ink"; linkRegistration?: boolean }> } = {};
  new Function("require", "exports", "React", compile(new URL("../components/PublicIdentity.tsx", import.meta.url)))(load, identityExports, React);
  const PublicIdentity = identityExports.default!;
  const linked = renderToStaticMarkup(React.createElement(PublicIdentity, {}));
  const plain = renderToStaticMarkup(React.createElement(PublicIdentity, { linkRegistration: false }));
  const registration = linked.slice(linked.indexOf('class="public-registration"'));
  assert.match(registration, new RegExp(`>${PUBLIC_REGISTRATION}</a>`));
  assert.equal(linked.includes(`href="${IDAHO_DOPL_LICENSE_SEARCH}" target="_blank" rel="noopener noreferrer"`), true);
  assert.match(linked, /title="Idaho contractor registration"/);
  assert.match(linked, /aria-label="Idaho contractor registration 8381215, opens in a new tab"/);
  assert.doesNotMatch(linked, /look it up|look up registration|public representative|staffed storefront|Wapoot/i);
  assert.equal(plain.includes(IDAHO_DOPL_LICENSE_SEARCH), false);
  assert.match(plain, new RegExp(`class="public-registration">${PUBLIC_REGISTRATION}</p>`));

  const falseFiles = [
    "app/estimate/scope/page.tsx",
    "app/estimate/p5-preview/page.tsx",
  ];
  for (const file of falseFiles) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /linkRegistration=\{false\}/, file);
    assert.equal(source.includes("edopl.idaho.gov"), false, file);
  }
  for (const root of ["app", "components"]) {
    for (const file of sourceFiles(root)) {
      if (!/<PublicIdentity\b[^>]*\blinkRegistration=\{false\}/.test(readFileSync(file, "utf8"))) continue;
      assert.ok(falseFiles.includes(file), file);
    }
  }
});

test("every public page renders the shared identity block", () => {
  for (const file of pages) {
    assert.match(readFileSync(file, "utf8"), /<PublicIdentity\b/, file);
  }
  // The other public pages render inside the shared site chrome, whose footer
  // carries the identity, so it is not repeated on the page.
  for (const file of chromePages) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /<SiteChrome\b/, file);
    assert.equal(source.includes("<PublicIdentity"), false, file);
  }
  assert.match(readFileSync("components/SiteChrome.tsx", "utf8"), /<SiteFooter\b/);
});

test("the family footer prints the approved NAP, hours, registration and family row", () => {
  // Render the shared footer with this site's brand config, resolving the
  // @/ alias and the shared folder's relative imports from source.
  const require = createRequire(import.meta.url);
  const compile = (fileUrl: URL) => ts.transpileModule(readFileSync(fileUrl, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const cache = new Map<string, unknown>();
  const loadFile = (url: URL): unknown => {
    if (cache.has(url.href)) return cache.get(url.href);
    const exported: Record<string, unknown> = {};
    cache.set(url.href, exported);
    const local = (id: string) => {
      if (id.startsWith("./")) return loadFile([".ts", ".tsx"].map((ext) => new URL(id + ext, url)).find((u) => existsSync(u))!);
      if (id.startsWith("@/")) {
        const target = [".ts", ".tsx"].map((ext) => new URL(`../${id.slice(2)}${ext}`, import.meta.url)).find((u) => existsSync(u));
        assert.ok(target, `Missing source module: ${id}`);
        return loadFile(target);
      }
      if (id === "next/link") return { __esModule: true, default: (props: Record<string, unknown>) => React.createElement("a", props) };
      return require(id);
    };
    new Function("require", "exports", "React", compile(url))(local, exported, React);
    return exported;
  };
  const footer = loadFile(new URL("../components/family/SiteFooter.tsx", import.meta.url)) as { SiteFooter: React.ComponentType };
  const html = renderToStaticMarkup(React.createElement(footer.SiteFooter));
  const text = html.replace(/<[^>]+>/g, "");
  // PUBLIC_NAP, piece by piece: the footer sets contact details beside the service area.
  for (const part of PUBLIC_NAP.split(" · ").map((piece) => piece.replace(/\.$/, ""))) {
    assert.ok(text.includes(part), part);
  }
  assert.ok(text.includes(BUSINESS_HOURS_LABEL));
  assert.match(html, new RegExp(`>${PUBLIC_REGISTRATION}</a>`));
  assert.ok(html.includes(`href="${IDAHO_DOPL_LICENSE_SEARCH}" target="_blank" rel="noopener noreferrer"`));
  assert.match(html, /title="Idaho contractor registration"/);
  assert.match(html, /aria-label="Idaho contractor registration 8381215, opens in a new tab"/);
  assert.doesNotMatch(html, /look it up|look up registration|public representative|staffed storefront|Wapoot/i);
  // SISTER_LINE: every sibling linked with rel="noopener" (no noreferrer), and the ADU line.
  for (const site of ["boiseconstruction.co", "boiseremodeling.co", "boisecabinet.co", "boisehandyman.co"]) {
    assert.match(html, new RegExp(`<a href="https://${site.replace(".", "\\.")}" rel="noopener">`), site);
  }
  assert.ok(text.includes(ADU_D3_LINE), "Boise ADU Co line");
  assert.ok(html.includes("https://www.facebook.com/1228704823655951"));
  // Owner call A: P5's Google Business Profile, once, beside the Facebook page.
  assert.equal((html.match(/data-testid="link-footer-google"/g) ?? []).length, 1);
  assert.ok(html.includes('<a href="https://www.google.com/search?kgmid=/g/11ntl1t7dc" rel="noopener" target="_blank" data-testid="link-footer-google">P5 Home Co on Google</a>'));
  assert.equal(html.includes("\u2014"), false);
});

test("the registration line is linked in the footer and plain text on funnel pages", () => {
  const identity = readFileSync("components/PublicIdentity.tsx", "utf8");
  assert.equal(IDAHO_DOPL_LICENSE_SEARCH, "https://edopl.idaho.gov/OnlineServices/?link=PubSearch");
  assert.match(identity, /href=\{IDAHO_DOPL_LICENSE_SEARCH\}/);
  assert.match(identity, /target="_blank"/);
  assert.match(identity, /rel="noopener noreferrer"/);
  assert.match(identity, /title="Idaho contractor registration"/);
  assert.match(identity, /aria-label="Idaho contractor registration 8381215, opens in a new tab"/);
  assert.equal(identity.includes("process.env"), false);
  assert.match(identity, /\{PUBLIC_REGISTRATION\}/);
  assert.equal(identity.includes("Idaho contractor registration"), true);
  const plain = [
    "app/estimate/p5-preview/page.tsx",
    "app/estimate/scope/page.tsx",
  ];
  for (const file of plain) {
    assert.match(readFileSync(file, "utf8"), /linkRegistration=\{false\}/, file);
  }
  assert.match(readFileSync("app/estimate/page.tsx", "utf8"), /redirect\("\/quote"\)/);
  // The family footer links the registration through the brand config (rendered in the footer test above).
  const brand = readFileSync("lib/familyBrand.ts", "utf8");
  assert.match(brand, /text: PUBLIC_REGISTRATION/);
  assert.match(brand, /href: IDAHO_DOPL_LICENSE_SEARCH/);
  for (const file of ["components/SiteChrome.tsx", "app/sitemap/page.tsx", "app/quote/QuoteLanding.tsx", "app/quote/thanks/page.tsx"]) {
    const source = readFileSync(file, "utf8");
    assert.equal(source.includes("linkRegistration={false}"), false, file);
    assert.equal(source.includes("edopl.idaho.gov"), false, file);
  }
  const schema = readFileSync("app/structuredData.ts", "utf8");
  assert.match(schema, /credentialCategory: "registration"/);
  assert.match(schema, /identifier: CONTRACTOR_REGISTRATION/);
  assert.match(schema, /name: "Idaho Registered Contractor"/);
  assert.match(schema, /"@type": "GovernmentOrganization"/);
  assert.match(schema, /name: "Idaho Division of Occupational and Professional Licenses"/);
  assert.match(schema, /url: "https:\/\/dopl\.idaho\.gov\/con\/"/);
  assert.equal(schema.includes('credentialCategory: "license"'), false);
  const proof = readFileSync("app/quote/proof.ts", "utf8");
  assert.match(proof, /Idaho Registered Contractor #8381215, carried across all five companies\./);
  assert.equal(proof.includes("Idaho contractor registration"), false);
  for (const file of ["app/site.ts", "app/HomePageClient.tsx", "public/llms.txt", "public/llms-full.txt"]) {
    assert.equal(/licen[cs]e/i.test(readFileSync(file, "utf8")), false, file);
  }
});

test("homepage preserves identity and location while explaining the three-step process", () => {
  const home = readFileSync("app/HomePageClient.tsx", "utf8");
  assert.equal(TRUSTED_H1, "Boise’s Trusted Home Specialists");
  // The family HeroPhoto renders the H1 as title plus the accent second line.
  // Owner call C (1 November): sentence case, same words.
  const heroStart = home.indexOf("<HeroPhoto");
  const hero = home.slice(heroStart, home.indexOf("/>", heroStart));
  assert.match(hero, /title="Boise’s home"/);
  assert.match(hero, /titleAccent="specialists"/);
  assert.doesNotMatch(hero, /PUBLIC_REGISTRATION|Trusted Home/);
  assert.match(home, /PUBLIC_REGISTRATION/);
  assert.match(home, /Bonded and insured/);
  assert.match(home, /Who you are hiring/);
  assert.match(home, /href="\/about"/);
  assert.equal(home.includes("Jared"), false);
  const trustAt = home.indexOf('className="trust-strip"');
  const howAt = home.indexOf('className="how-p5"');
  const companiesAt = home.indexOf('id="companies"');
  const entryAt = home.indexOf('id="request-form"');
  // Phase 3 plan (owner approved 31 October): proof, matcher and the five companies
  // come before the request entry; How P5 works follows it in its existing order.
  assert.ok(trustAt >= 0 && companiesAt > trustAt && entryAt > companiesAt && howAt > entryAt, "Trust strip, companies, request entry, then How P5 works");
  for (const line of [
    "How P5 works",
    "Tell us what you’re planning",
    "Connect with the right company",
    "Discuss the next steps",
    "Agree on the work, price and schedule before work begins.",
  ]) {
    assert.equal(home.includes(line) || readFileSync("app/site.ts", "utf8").includes(line), true, line);
  }
});
