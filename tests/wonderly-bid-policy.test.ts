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
const first = { installmentId: "fee-1", scheduleEvidenceId: "contract-billing-1", dueDate: "2026-12-16" };
const second = { installmentId: "fee-2", scheduleEvidenceId: "contract-billing-2", dueDate: "2027-01-30" };
const fundedEvidence = {
  ...eligibleEvidence, depositProtectionAddendum: { evidenceId: "amended-timing", termsId: "terms-1" },
} as const;
function fundingFixture() {
  const candidate = model(stageWonderlyBid(input));
  const installmentCents = candidate.feeCents / 2;
  const schedule = {
    customerAcceptanceDate: "2026-12-01", acceptanceEvidenceId: "customer-acceptance-1", signedTermsId: "terms-1",
    installments: [{ ...first, installmentCents }, { ...second, installmentCents }],
  };
  const snapshots = schedule.installments.map((installment, index) => ({
    installmentId: installment.installmentId, dueDate: installment.dueDate, installmentCents,
    clearedReceiptsEvidenceId: "receipt-" + index, workCommitmentEvidenceId: "commitment-" + index,
    clearedAsOfDate: installment.dueDate, workCommitmentAsOfDate: installment.dueDate,
    clearedCustomerCentsToDate: index === 0 ? 5_000_000 : candidate.priceCents,
    jobCostsPaidCentsToDate: index === 0 ? 0 : 8_200_000,
    workReserveCentsUntilNextCollection: index === 0 ? 3_500_000 : 0,
    cumulativeWonderlyFeeDueCents: installmentCents * (index+1),
  }));
  return { candidate, schedule, snapshots };
}
test("unfunded or front-loaded obligations do not pass even if modeled net is sound", () => {
  const { candidate, schedule, snapshots } = fundingFixture();
  const evaluate = (rows: typeof snapshots, supplied = schedule, ev = eligibleEvidence) =>
    evaluateWonderlyFunding(rows, supplied, candidate.priceCents, candidate, ev);
  assert(!evaluate([{ ...snapshots[0], clearedCustomerCentsToDate: 4_000_000 }, snapshots[1]]));
  assert(evaluate(snapshots));
  assert(!evaluate(snapshots.slice(0, 1)));
  assert(!evaluate(snapshots.toReversed()));
  assert(!evaluateWonderlyFunding(snapshots, schedule, candidate.priceCents-100, candidate, eligibleEvidence));
  assert(model(stageWonderlyBid({ ...input, funding: snapshots, fundingSchedule: schedule })).blockers.includes("written-deposit-protection-missing"));
  assert.deepEqual(model(stageWonderlyBid({ ...input, funding: snapshots, fundingSchedule: schedule, evidence: fundedEvidence })).blockers, []);
});
test("a fully funded final row cannot hide the missing first debit", () => {
  const { candidate, schedule, snapshots } = fundingFixture();
  assert(!evaluateWonderlyFunding(snapshots.slice(1), schedule, candidate.priceCents, candidate, fundedEvidence));
  assert(!evaluateWonderlyFunding(snapshots.slice(1), { ...schedule, installments: schedule.installments.slice(1) }, candidate.priceCents, candidate, fundedEvidence));
  assert(model(stageWonderlyBid({ ...input, funding: snapshots.slice(1), fundingSchedule: schedule, evidence: fundedEvidence })).blockers.includes("funding-not-established"));
});
test("each actual date, ID, installment amount, and work commitment need positive evidence", () => {
  const { candidate, schedule, snapshots } = fundingFixture();
  const evaluate = (rows: typeof snapshots, supplied = schedule) =>
    evaluateWonderlyFunding(rows, supplied, candidate.priceCents, candidate, fundedEvidence);
  for (const patch of [
    { installmentId: "not-in-contract" }, { installmentCents: 0 }, { dueDate: "2026-12-17" },
    { clearedAsOfDate: "2026-12-15" }, { clearedReceiptsEvidenceId: "" },
    { workCommitmentEvidenceId: "" }, { workCommitmentAsOfDate: "2026-12-15" },
  ]) assert(!evaluate([{ ...snapshots[0], ...patch }, snapshots[1]]));
  assert(!evaluate(snapshots, { ...schedule, customerAcceptanceDate: "2026-11-31" }));
  assert(!evaluate(snapshots, { ...schedule, acceptanceEvidenceId: "" }));
  assert(!evaluateWonderlyFunding(snapshots, undefined, candidate.priceCents, candidate, fundedEvidence));
  assert(!evaluate(snapshots, { ...schedule, installments: [{ ...schedule.installments[0], scheduleEvidenceId: "" }, schedule.installments[1]] }));
});
test("deferrals must match written approval and use exact later funding checkpoint dates", () => {
  const { candidate, schedule, snapshots } = fundingFixture();
  const dueDate = "2026-12-22";
  const installment = { ...schedule.installments[0], dueDate, deferredByEvidenceId: "amended-timing" };
  const deferred = { ...schedule, installments: [installment, schedule.installments[1]] };
  const rows = [{ ...snapshots[0], dueDate, clearedAsOfDate: dueDate, workCommitmentAsOfDate: dueDate }, snapshots[1]];
  assert(evaluateWonderlyFunding(rows, deferred, candidate.priceCents, candidate, fundedEvidence));
  assert(!evaluateWonderlyFunding(rows, deferred, candidate.priceCents, candidate, eligibleEvidence));
  assert(!evaluateWonderlyFunding(snapshots, deferred, candidate.priceCents, candidate, fundedEvidence));
});
