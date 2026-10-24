import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import {
  IDAHO_DOPL_LICENSE_SEARCH,
  LLMS_CONTACT,
  PUBLIC_NAP,
  PUBLIC_REGISTRATION,
  SISTER_LINE,
} from "../app/publicIdentity.ts";
import { TRUSTED_H1 } from "../app/publicClaims.ts";

const pages = [
  "app/HomePageClient.tsx",
  "app/quote/QuoteLanding.tsx",
  "app/quote/thanks/page.tsx",
  "app/sitemap/page.tsx",
  "app/legal/layout.tsx",
  "app/estimate/p5-preview/page.tsx",
  "app/estimate/scope/page.tsx",
];

test("the approved NAP and sister row are the audit strings", () => {
  assert.equal(
    PUBLIC_NAP,
    "Public representative: Nick Perkins · 4031 W Wapoot St, Meridian, ID 83646 · Service-area business, not a staffed storefront. · (208) 477-1169 · hello@p5homeco.com",
  );
  assert.equal(
    SISTER_LINE,
    "Part of P5 Home Co: Boise Construction Co · Boise Remodeling Co · Boise Handyman Co · Boise Cabinet Co · Boise ADU Co (launching soon)",
  );
  assert.equal(PUBLIC_REGISTRATION, "Idaho Registered Contractor #8381215");
  assert.equal(PUBLIC_REGISTRATION.includes("("), false);
  assert.equal(IDAHO_DOPL_LICENSE_SEARCH, "https://edopl.idaho.gov/OnlineServices/?link=PubSearch");
  assert.match(LLMS_CONTACT, /Nick Perkins/);
  assert.match(LLMS_CONTACT, /4031 W Wapoot St, Meridian, ID 83646/);
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
    new Function("require", "exports", "React", compile(new URL(`../${id.slice(2)}.tsx`, import.meta.url)))(load, exported, React);
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
  assert.match(linked, /title="Look up registration 8381215 on Idaho DOPL"/);
  assert.match(linked, /aria-label="Verify with Idaho DOPL: look up registration 8381215, opens in a new tab"/);
  assert.match(linked, /Verify with Idaho DOPL/);
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
});

test("the registration line is linked in the footer and plain text on funnel pages", () => {
  const identity = readFileSync("components/PublicIdentity.tsx", "utf8");
  assert.equal(IDAHO_DOPL_LICENSE_SEARCH, "https://edopl.idaho.gov/OnlineServices/?link=PubSearch");
  assert.match(identity, /href=\{IDAHO_DOPL_LICENSE_SEARCH\}/);
  assert.match(identity, /target="_blank"/);
  assert.match(identity, /rel="noopener noreferrer"/);
  assert.match(identity, /title="Look up registration 8381215 on Idaho DOPL"/);
  assert.match(identity, /aria-label="Verify with Idaho DOPL: look up registration 8381215, opens in a new tab"/);
  assert.equal(identity.includes("process.env"), false);
  assert.match(identity, /\{PUBLIC_REGISTRATION\}/);
  assert.equal(identity.includes("Idaho contractor registration"), false);
  const plain = [
    "app/estimate/p5-preview/page.tsx",
    "app/estimate/scope/page.tsx",
  ];
  for (const file of plain) {
    assert.match(readFileSync(file, "utf8"), /linkRegistration=\{false\}/, file);
  }
  assert.match(readFileSync("app/estimate/page.tsx", "utf8"), /from "\.\/p5-preview\/page"/);
  for (const file of ["app/HomePageClient.tsx", "app/sitemap/page.tsx", "app/legal/layout.tsx", "app/quote/QuoteLanding.tsx", "app/quote/thanks/page.tsx"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /<PublicIdentity\b/, file);
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

test("homepage keeps the existing claims and adds the location subhead", () => {
  const home = readFileSync("app/HomePageClient.tsx", "utf8");
  assert.equal(TRUSTED_H1, "Boise’s Trusted Home Specialists");
  assert.match(home, /SHOW_UNPROVEN_TRUSTED \? TRUSTED_H1 : PLAIN_H1/);
  assert.match(home, /Serving Boise, Meridian and the Treasure Valley/);
  assert.match(home, /visibleFoundingBadges\(\)/);
  assert.match(home, /100\+ projects/);
  assert.match(home, /Bonded and insured/);
  assert.equal(home.includes("Jared"), false);
  const trustAt = home.indexOf('className="trust-strip"');
  const howAt = home.indexOf('className="how-p5"');
  const aboutAt = home.indexOf('id="about"');
  assert.ok(trustAt >= 0 && howAt > trustAt && aboutAt > howAt, "How P5 works sits after the trust strip and before about");
  for (const line of [
    "How P5 works",
    "Own install crew",
    "Bonded & insured",
    "Manufacturer warranties passed through",
    "Install dates confirmed in writing",
    "Written update every week",
    "Free in-home consultation, no pressure",
    "Public representative: Nick Perkins",
  ]) {
    assert.equal(home.includes(line) || readFileSync("app/site.ts", "utf8").includes(line), true, line);
  }
});
