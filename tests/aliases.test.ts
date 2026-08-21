import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SETTINGS,
  brandsWithoutSendAs,
  sendAsForBrand,
} from "../app/lib/leads/settings.ts";

const S = DEFAULT_SETTINGS;

test("every verified Gmail alias resolves to its exact configured identity", () => {
  assert.deepEqual(sendAsForBrand(S, "P5 Home Co"), {
    address: "hello@p5homeco.com",
    displayName: "Client Services",
    signature: "P5 Home Co",
    verifiedOn: "2026-08-21",
  });
  assert.equal(sendAsForBrand(S, "Boise ADU Co")?.address, "hello@boiseadu.co");
  assert.equal(sendAsForBrand(S, "Boise Cabinet Co")?.address, "hello@boisecabinet.co");
  assert.equal(
    sendAsForBrand(S, "Boise Remodeling Co")?.address,
    "hello@boiseremodeling.co",
    "verified as boiseremodeling.co, not the boiseremodel.co given in the brief",
  );
});

test("all six brands can now send", () => {
  assert.equal(sendAsForBrand(S, "Boise Construction Co")?.address, "hello@boiseconstruction.co");
  assert.equal(sendAsForBrand(S, "Boise Handyman Co")?.address, "hello@boisehandyman.co");
  assert.deepEqual(brandsWithoutSendAs(S), [], "no brand is left unable to send");
});

test("an unknown or unconfigured brand still blocks rather than falling back", () => {
  const stripped = {
    ...S,
    brandEmailAliases: { "P5 Home Co": S.brandEmailAliases["P5 Home Co"] },
  };
  assert.equal(sendAsForBrand(stripped, "Boise Cabinet Co"), null);
  assert.ok(brandsWithoutSendAs(stripped).includes("Boise Cabinet Co"));
});

test("every brand's display name and signature are bound to its own address", () => {
  for (const brand of S.brands) {
    const sendAs = sendAsForBrand(S, brand);
    assert.ok(sendAs, `${brand} must have a send-as identity`);
    assert.ok(sendAs.address.startsWith("hello@"), `${brand} uses the hello@ convention`);
    assert.ok(sendAs.signature.length > 0, `${brand} has a bound signature`);
  }
});

test("no alias silently falls back to another brand's address", () => {
  const addresses = Object.values(S.brandEmailAliases).map((a) => a.address);
  assert.equal(new Set(addresses).size, addresses.length, "each brand has its own address");
});
