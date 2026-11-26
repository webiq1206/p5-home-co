import assert from "node:assert/strict";
import test from "node:test";
import { netQuotePrice } from "../lib/p5/netPricingPolicy.ts";
import { stageWonderlyBid, wonderlyFeeForPrice, evaluateWonderlyFunding } from "../tools/wonderlyBidPolicy.ts";

const base = netQuotePrice({ jobClass: "complex-remodel", direct: 60_000, otherCostDollars: 22_000, otherCostRate: 0 });
const eligibleEvidence = {
  signedTermsId: "terms-1", quoteChannel: "physical",
  eligibleQuoteChannel: { kind: "physical", evidenceId: "signed-method-1" },
} as const;
const input = {
  service: "whole-home", confirmedWholeHomeScope: true, lead: { kind: "wonderly", leadId: "partner-1", sourceRecordId: "crm-1" },
  base, baseCostBasis: { confirmed: true, excludesWonderlyFee: true }, evidence: eligibleEvidence,
} as const;
function model(value: ReturnType<typeof stageWonderlyBid>) {
  if (value.kind !== "wonderly-model") throw new Error("Expected a Wonderly model");
  return value;
}

test("direct price remains exactly the existing economy object; claims do not establish attribution", () => {
  const direct = stageWonderlyBid({ ...input, lead: { kind: "direct", sourceRecordId: "known-direct" } });
  assert.equal(direct.kind === "direct" && direct.base, base);
  for (const lead of [{ kind: "unresolved" }, { kind: "conflict" }, { kind: "wonderly", leadId: "", sourceRecordId: "utm" }, { kind: "direct", sourceRecordId: "" }] as const) {
    assert.deepEqual(stageWonderlyBid({ ...input, lead }), { kind: "blocked", reason: "attribution-unresolved" });
  }
});
test("only confirmed whole-home projects enter the pilot", () => {
  for (const service of ["remodel", "handyman", "kitchen", "bathroom", "cabinet-install", "new-construction", "adu", "re10", "change-order"]) {
    assert.deepEqual(stageWonderlyBid({ ...input, service }), { kind: "blocked", reason: "outside-whole-home-pilot" });
  }
  assert.equal(stageWonderlyBid({ ...input, confirmedWholeHomeScope: false }).kind, "blocked");
});
test("the exact contract boundaries select the fee tier from the final price", () => {
  for (const [cents, basisPoints, laterDay] of [
    [10_000_000, 1400, 60], [10_000_001, 1300, 60], [20_000_000, 1300, 60], [20_000_001, 1200, 90],
    [30_000_000, 1200, 90], [30_000_001, 1100, 90], [50_000_000, 1100, 90], [50_000_001, 1000, 90],
  ]) {
    const result = wonderlyFeeForPrice(cents, true);
    assert.equal(result.feeBps, basisPoints);
    assert.deepEqual(result.signedSchedule.map(due => due.dayAfterCustomerAcceptance), [15, laterDay]);
    assert.equal(wonderlyFeeForPrice(cents, false).feeBps, 1400);
  }
});
test("channel eligibility requires corroboration; unknown route keeps conservative modeled fee", () => {
  const conservative = model(stageWonderlyBid({ ...input, evidence: { signedTermsId: "terms-1", quoteChannel: "unresolved" } }));
  assert.equal(conservative.feeBps, 1400);
  assert.equal(conservative.priceCents, 12_424_300);
  assert(conservative.blockers.includes("quote-channel-unverified"));
  const candidate = model(stageWonderlyBid(input));
  assert.equal(candidate.feeBps, 1300);
  assert.equal(candidate.priceCents, 12_238_900);
  assert(candidate.netMargin >= 0.2);
  assert(candidate.netMargin < 0.20001);
});
test("quote cannot replace the complex-remodel policy with a generic discount", () => {
  assert.equal(stageWonderlyBid({ ...input, base: { ...base, netTarget: 0.15 } }).kind, "blocked");
  assert.equal(stageWonderlyBid({ ...input, baseCostBasis: { confirmed: true, excludesWonderlyFee: false } }).kind, "blocked");
});
test("unfunded or front-loaded obligations do not pass even if modeled net is sound", () => {
  const candidate = model(stageWonderlyBid(input));
  const fee = candidate.feeCents / 2;
  const funding = [
    { clearedCustomerCentsToDate: 4_000_000, jobCostsPaidCentsToDate: 0, workReserveCentsUntilNextCollection: 3_500_000, cumulativeWonderlyFeeDueCents: fee },
    { clearedCustomerCentsToDate: candidate.priceCents, jobCostsPaidCentsToDate: 8_200_000, workReserveCentsUntilNextCollection: 0, cumulativeWonderlyFeeDueCents: candidate.feeCents },
  ];
  assert(!evaluateWonderlyFunding(funding, candidate.feeCents));
  const goodFunding = [{ ...funding[0], clearedCustomerCentsToDate: 5_000_000 }, funding[1]];
  assert(evaluateWonderlyFunding(goodFunding, candidate.feeCents, candidate.priceCents));
  assert(!evaluateWonderlyFunding(goodFunding, candidate.feeCents, candidate.priceCents-100));
  assert(!evaluateWonderlyFunding(goodFunding.slice(0, 1), candidate.feeCents));
  assert(!evaluateWonderlyFunding(goodFunding.toReversed(), candidate.feeCents));
  assert(model(stageWonderlyBid({ ...input, funding: goodFunding })).blockers.includes("written-deposit-protection-missing"));
  assert.deepEqual(model(stageWonderlyBid({ ...input, funding: goodFunding, evidence: { ...eligibleEvidence, depositProtectionAddendum: { evidenceId: "amended-timing", termsId: "terms-1" } } })).blockers, []);
});
