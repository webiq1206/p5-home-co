import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SETTINGS,
  brandsWithoutSendAs,
  sendAsForBrand,
} from "../app/lib/leads/settings.ts";

const S = DEFAULT_SETTINGS;

test("the four verified Gmail aliases resolve to their exact configured identity", () => {
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

test("brands with no verified alias resolve to null so the send is blocked", () => {
  assert.equal(sendAsForBrand(S, "Boise Construction Co"), null);
  assert.equal(sendAsForBrand(S, "Boise Handyman Co"), null);
});

test("the brands that cannot send are reported for the health screen", () => {
  assert.deepEqual(brandsWithoutSendAs(S).sort(), [
    "Boise Construction Co",
    "Boise Handyman Co",
  ]);
});

test("no alias silently falls back to another brand's address", () => {
  const addresses = Object.values(S.brandEmailAliases).map((a) => a.address);
  assert.equal(new Set(addresses).size, addresses.length, "each brand has its own address");
});
