import { test } from "node:test";
import assert from "node:assert/strict";

import { inferLeadSource, mergeAttribution } from "../app/quote/attribution.ts";

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