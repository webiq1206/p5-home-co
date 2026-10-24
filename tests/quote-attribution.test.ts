import { test } from "node:test";
import assert from "node:assert/strict";

import { captureAttribution, inferLeadSource, mergeAttribution } from "../app/quote/attribution.ts";

test("Google click identifiers accurately classify paid search", () => {
  assert.equal(inferLeadSource({ gclid: "click" }), "Paid Search");
  assert.equal(inferLeadSource({ gbraid: "click" }), "Paid Search");
  assert.equal(inferLeadSource({ wbraid: "click" }), "Paid Search");
  assert.equal(inferLeadSource({ utm_medium: "cpc" }), "Paid Search");
});

test("unattributed and social visits are not mislabeled as paid search", () => {
  assert.equal(inferLeadSource({}), "Organic Website");
  assert.equal(inferLeadSource({ utm_medium: "paid_social" }), "Social Media");
});

test("first touch survives while a later campaign replaces latest attribution", () => {
  const first = {
    first_gclid: "first-click",
    first_landing_page: "/quote?gclid=first-click",
    gclid: "first-click",
    landing_page: "/quote?gclid=first-click",
  };
  const latest = mergeAttribution(first, {
    utm_source: "newsletter",
    utm_medium: "email",
    landing_page: "/quote?utm_source=newsletter&utm_medium=email",
  });
  assert.equal(latest.first_gclid, "first-click");
  assert.equal(latest.gclid, undefined);
  assert.equal(latest.utm_source, "newsletter");
  assert.equal(latest.landing_page, "/quote?utm_source=newsletter&utm_medium=email");
});

test("earlier Google Ads landing-page click reaches the existing quote form", () => {
  const storage = new Map<string, string>([
    ["p5_attribution_first_v1", JSON.stringify({gclid:"gclid-first", landing_page:"/services"})],
    ["p5_attribution_latest_v1", JSON.stringify({gclid:"gclid-first", landing_page:"/services"})],
  ]);
  const keys = ["window", "document", "sessionStorage"] as const;
  const originals = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: {
      location: { search: "", pathname: "/quote", origin: "https://p5homeco.com" },
    } });
    Object.defineProperty(globalThis, "document", { configurable: true, value: { referrer: "" } });
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
    } });
    const captured = captureAttribution();
    assert.equal(captured.first_gclid, "gclid-first");
    assert.equal(captured.gclid, "gclid-first");
    assert.equal(captured.landing_page, "/services");
    assert.equal(inferLeadSource(captured), "Paid Search");
  } finally {
    for (let i = 0; i < keys.length; i++) {
      if (originals[i]) Object.defineProperty(globalThis, keys[i], originals[i]!);
      else Reflect.deleteProperty(globalThis, keys[i]);
    }
  }
});

test("paid social UTM source is not incorrectly classified as Google paid search", () => {
  assert.equal(inferLeadSource({utm_source:"facebook",utm_medium:"cpc"}), "Social Media");
  assert.equal(inferLeadSource({first_gclid:"earlier-ad"}), "Paid Search");
});
