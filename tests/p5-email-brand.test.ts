/**
 * A non-P5 submission keeps that site's branding. The From header is the only
 * P5 Home Co identity. Shared mail files must not hardcode the parent name or URL.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildEstimateDocument, type EstimateBrand } from "../lib/p5/estimateDocument.ts";
import { customerLayout, customerText } from "../lib/p5/estimateEmail.ts";
import { emailBrandFrom, renderEmail, type BrandSource } from "../lib/p5/emailKit.ts";

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
    assert.doesNotMatch(source, /P5 Home Co|p5homeco\.com|#ceb391/, file);
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
});
