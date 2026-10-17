import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import {
  IDAHO_DOPL_PUBLIC_SEARCH,
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
  assert.equal(IDAHO_DOPL_PUBLIC_SEARCH, "https://edopl.idaho.gov/OnlineServices/?link=PubSearch");
  assert.match(LLMS_CONTACT, /Nick Perkins/);
  assert.match(LLMS_CONTACT, /4031 W Wapoot St, Meridian, ID 83646/);
  assert.match(LLMS_CONTACT, /hello@p5homeco\.com/);
  assert.equal(PUBLIC_NAP.includes("Jared") || SISTER_LINE.includes("Jared") || LLMS_CONTACT.includes("Jared"), false);
});

test("the visible registration phrase links to the Idaho DOPL public search", () => {
  const identity = readFileSync("components/PublicIdentity.tsx", "utf8");
  const quote = readFileSync("app/quote/QuoteLanding.tsx", "utf8");
  const schema = readFileSync("app/structuredData.ts", "utf8");
  for (const source of [identity, quote]) {
    assert.match(source, /href=\{IDAHO_DOPL_PUBLIC_SEARCH\}/);
    assert.match(source, /rel="noopener"/);
    assert.match(source, /\{PUBLIC_REGISTRATION\}/);
  }
  assert.equal(schema.includes(IDAHO_DOPL_PUBLIC_SEARCH), false);
  assert.equal(schema.includes(PUBLIC_REGISTRATION), false);
  assert.match(schema, /identifier: CONTRACTOR_REGISTRATION/);
});

test("the registration line links to DOPL unless doplLink is off", () => {
  const require = createRequire(import.meta.url);
  const source = readFileSync(new URL("../components/PublicIdentity.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exported: { default?: React.ComponentType<{ tone?: "inherit" | "ink"; doplLink?: boolean }> } = {};
  new Function("require", "exports", "React", compiled)(
    (id: string) => id === "@/app/publicIdentity"
      ? require(new URL("../app/publicIdentity.ts", import.meta.url).pathname)
      : require(id),
    exported,
    React,
  );
  const PublicIdentity = exported.default!;
  const linked = renderToStaticMarkup(React.createElement(PublicIdentity, {}));
  const plain = renderToStaticMarkup(React.createElement(PublicIdentity, { doplLink: false, tone: "ink" }));
  const registrationLink = `<a href="${IDAHO_DOPL_PUBLIC_SEARCH}" target="_blank" rel="noopener">${PUBLIC_REGISTRATION}</a>`;
  assert.equal(linked.includes(registrationLink), true);
  assert.equal(plain.includes(IDAHO_DOPL_PUBLIC_SEARCH), false);
  assert.equal(plain.includes(`<p class="public-registration">${PUBLIC_REGISTRATION}</p>`), true);
  assert.match(plain, /public-identity-ink/);

  const quote = readFileSync("app/quote/QuoteLanding.tsx", "utf8");
  const thanks = readFileSync("app/quote/thanks/page.tsx", "utf8");
  assert.match(quote, /<PublicIdentity doplLink=\{false\} \/>/);
  assert.match(thanks, /<PublicIdentity tone="ink" doplLink=\{false\} \/>/);
  for (const file of ["app/HomePageClient.tsx", "app/legal/layout.tsx"]) {
    assert.equal(readFileSync(file, "utf8").includes("doplLink={false}"), false, file);
  }
});

test("every public page renders the shared identity block", () => {
  for (const file of pages) {
    assert.match(readFileSync(file, "utf8"), /<PublicIdentity\b/, file);
  }
});

test("homepage keeps the existing claims and adds the location subhead", () => {
  const home = readFileSync("app/HomePageClient.tsx", "utf8");
  assert.equal(TRUSTED_H1, "Boise’s Trusted Home Specialists");
  assert.match(home, /SHOW_UNPROVEN_TRUSTED \? TRUSTED_H1 : PLAIN_H1/);
  assert.match(home, /Serving Boise, Meridian and the Treasure Valley/);
  assert.match(home, /Est\. 2020/);
  assert.match(home, /100\+ projects/);
  assert.match(home, /Bonded and insured/);
  assert.equal(home.includes("Jared"), false);
});
