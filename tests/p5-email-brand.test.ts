/**
 * A non-P5 submission keeps that site's branding. The From header is the only
 * P5 Home Co identity. Shared mail files must not hardcode the parent name or URL.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildEstimateDocument, type EstimateBrand } from "../lib/p5/estimateDocument.ts";
import { customerLayout, customerText } from "../lib/p5/estimateEmail.ts";
import { emailBrandFrom, footerCityLine, internalDeliveryTo, renderEmail, tierNextStep, type BrandSource } from "../lib/p5/emailKit.ts";

const FROM = "From: P5 Home Co <hello@p5homeco.com>";
const SHARED = ["emailKit.ts", "estimateEmail.ts", "intakeEmail.ts", "outbox.ts", "reviewRequest.ts"];

const cabinet: BrandSource & EstimateBrand = {
  id: "cabinet",
  name: "Boise Cabinet Co",
  domain: "boisecabinet.co",
  email: "hello@boisecabinet.co",
  phone: "(208) 477-1169",
  accent: "#659b9a",
  ink: "#383837",
  logo: "/brand/boise-cabinet-co.png",
  consultationPath: "/quote",
  cityLine: "Meridian, ID 83646",
};

function bodyOnly(html: string, text: string): string {
  return `${FROM}\n${text}\n${html}`.split(FROM).join(" ");
}

test("shared mail files do not hardcode the parent name, URL, logo or accent", () => {
  for (const file of SHARED) {
    const source = readFileSync(new URL(`../lib/p5/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /P5 Home Co|#ceb391/, file);
    if (file !== "emailKit.ts") assert.doesNotMatch(source, /p5homeco\.com/, file);
  }
  const kit = readFileSync(new URL("../lib/p5/emailKit.ts", import.meta.url), "utf8");
  assert.equal(kit.match(/p5homeco\.com/g)?.length, 1);
  for (const file of SHARED) {
    const source = readFileSync(new URL(`../lib/p5/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /#ceb391|#a58c72/i, file);
  }
});

test("a cabinet estimate renders as Boise Cabinet Co, and P5 appears only in the From header", () => {
  const brand = emailBrandFrom(cabinet);
  const message = renderEmail({
    brand,
    preheader: "Your cabinet estimate from Boise Cabinet Co",
    title: "Your cabinet estimate",
    kicker: brand.name,
    blocks: [
      { type: "p", text: "Thanks for using the Instant Estimator at Boise Cabinet Co." },
      { type: "p", text: "The Boise Cabinet Co team" },
      { type: "schedule" },
    ],
  });
  const doc = buildEstimateDocument({
    id: "0f1e2d3c-4b5a-4000-8000-00000000abcd",
    result: { range: { low: 4000, high: 5200 } },
    brand: cabinet,
    issue: { service: "cabinet-product" },
    legalLine: "Boise Cabinet Co is the company on this estimate.",
  });
  const html = `${message.html}\n${customerLayout(doc, "<p>Scope</p>")}`;
  const text = `${message.text}\n${customerText(doc)}`;
  assert.match(`${FROM}\n${text}`, new RegExp(FROM.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const body = bodyOnly(html, text);
  assert.doesNotMatch(body, /P5 Home Co/);
  assert.doesNotMatch(body, /p5homeco\.com/);
  assert.match(html, /Boise Cabinet Co/);
  assert.match(html, /boisecabinet\.co/);
  assert.match(html, /#659b9a/i);
  assert.match(html, /\/brand\/boise-cabinet-co\.png/);
  assert.match(text, /The Boise Cabinet Co team/);
  assert.match(text, /Meridian, ID 83646/);
  assert.match(text, /\(208\) 477-1169/);
  assert.match(`${html}\n${text}`, /Boise Cabinet Co prepared this estimate\./);
  assert.match(`${html}\n${text}`, /Meridian, ID 83646/);
  assert.equal(footerCityLine("Meridian, ID 83646"), "Meridian, ID 83646");
  assert.equal(footerCityLine("123 Main St"), "");
  assert.equal(internalDeliveryTo("test", cabinet), "hello@p5homeco.com");
  assert.equal(internalDeliveryTo("alert", cabinet), "hello@p5homeco.com");
  assert.notEqual(cabinet.email, internalDeliveryTo("test", cabinet));
});

test("the three value tiers render different next steps, with the disclaimer and Schedule now", () => {
  const brand = emailBrandFrom(cabinet);
  const seen = new Set<string>();
  const cases = [
    { high: 5_000, needle: /quick visit/, also: /phone/ },
    { high: 20_000, needle: /home walkthrough/, also: /true bid/ },
    { high: 90_000, needle: /planning consultation/, also: /plans and permits/ },
  ] as const;
  for (const item of cases) {
    const sentence = tierNextStep(item.high);
    assert.equal(seen.has(sentence), false, sentence);
    seen.add(sentence);
    const message = renderEmail({
      brand,
      preheader: "Your cabinet estimate",
      title: "Your cabinet estimate",
      kicker: brand.name,
      blocks: [{ type: "schedule", note: sentence }],
    });
    assert.match(message.html, item.needle);
    assert.match(message.text, item.also);
    assert.match(message.html, /Schedule now/);
    assert.match(message.text, /We work hard to make that estimate as realistic as we can/);
    assert.match(message.html, /Boise Cabinet Co/);
    assert.match(message.html, /boisecabinet\.co/);
    assert.doesNotMatch(`${message.html}\n${message.text}`, /[—–]|showroom|\bshop\b|LLC/);
    assert.doesNotMatch(bodyOnly(message.html, message.text), /P5 Home Co|p5homeco\.com/);
    if (item.high < 10_000) assert.doesNotMatch(message.text, /planning consultation|home walkthrough/);
    else if (item.high > 75_000) assert.doesNotMatch(message.text, /quick visit|home walkthrough/);
    else assert.doesNotMatch(message.text, /quick visit|planning consultation/);
  }
  assert.equal(seen.size, 3);
});
