/**
 * Server-side Wonderly bid policy candidate. Keep this internal and do not
 * invoke it from URL parameters, cookies, or a public estimate request body.
 * Use an authoritative lead lookup, verified scope, and the existing P5
 * economy snapshot. Nothing here enrolls a lead or executes a payment.
 * Change orders are not new bids. Related increases inherit project origin
 * and require a separate signed-terms workflow (14% within five business days);
 * this module never releases, invoices, or pays a change-order fee.
 */
import { NET_POLICY_VERSION, type NetQuote } from "../lib/p5/netPricingPolicy.ts";

export const WONDERLY_POLICY_VERSION = "P5-WONDERLY-PILOT-2026-11-26";
const SCALE = 1_000_000n;
const MAX_CENTS = 10_000_000_000; // $100 million; sanity bound, not a quote cap policy.
const TIERS = [
  { minCents: 1, maxCents: 10_000_000, feeBps: 1400, laterDay: 60 },
  { minCents: 10_000_001, maxCents: 20_000_000, feeBps: 1300, laterDay: 60 },
  { minCents: 20_000_001, maxCents: 30_000_000, feeBps: 1200, laterDay: 90 },
  { minCents: 30_000_001, maxCents: 50_000_000, feeBps: 1100, laterDay: 90 },
  { minCents: 50_000_001, maxCents: MAX_CENTS, feeBps: 1000, laterDay: 90 },
] as const;

export type VerifiedLead =
  | { kind: "direct"; sourceRecordId: string }
  | { kind: "wonderly"; leadId: string; sourceRecordId: string }
  | { kind: "unresolved" | "conflict" };

export type WonderlyEvidence = {
  /** Immutable IDs for verified source records, not customer-entered settings. */
  signedTermsId: string;
  eligibleQuoteChannel?: { kind: "physical" | "wonderly"; evidenceId: string };
  /** Terms force a written exception for use of another quote platform. */
  thirdPartyQuoteApprovalId?: string;
  quoteChannel: "physical" | "wonderly" | "third-party" | "unresolved";
  /** The quote is not releasable under default automatic debit timing. */
  depositProtectionAddendum?: { evidenceId: string; termsId: string };
};
export type FundingInstallment = {
  installmentId: string;
  scheduleEvidenceId: string;
  dueDate: string;
  installmentCents: number;
  deferredByEvidenceId?: string;
};
export type FundingSchedule = {
  signedTermsId: string;
  customerAcceptanceDate: string;
  acceptanceEvidenceId: string;
  installments: readonly FundingInstallment[];
};
export type FundingCheckpoint = {
  installmentId: string;
  dueDate: string;
  installmentCents: number;
  clearedReceiptsEvidenceId: string;
  clearedAsOfDate: string;
  workCommitmentEvidenceId: string;
  workCommitmentAsOfDate: string;
  clearedCustomerCentsToDate: number;
  jobCostsPaidCentsToDate: number;
  workReserveCentsUntilNextCollection: number;
  cumulativeWonderlyFeeDueCents: number;
};

const identified = (id: unknown): id is string => typeof id === "string" && !!id.trim();
const validCents = (n: number) => Number.isSafeInteger(n) && n >= 0 && n <= MAX_CENTS;
const roundUp = (num: bigint, den: bigint) => (num + den - 1n) / den;
function toCents(dollars: number) {
  const cents = Math.round(dollars * 100);
  if (!validCents(cents) || !Number.isFinite(dollars) || dollars < 0 || Math.abs(cents / 100 - dollars) > 1e-7) {
    throw new Error("Expected job costs and approved price at cent precision");
  }
  return cents;
}
function percent(rate: number) {
  if (!Number.isFinite(rate) || rate < 0 || rate >= 1) throw new Error("Invalid project margin or cost rate");
  // Cost and margin constraints round in the conservative direction.
  return BigInt(Math.ceil(rate * Number(SCALE) - 1e-8));
}
export function wonderlyFeeForPrice(priceCents: number, qualifiedChannel: boolean) {
  if (!validCents(priceCents) || priceCents === 0) throw new Error("Expected a positive quote at cent precision");
  const tier = qualifiedChannel
    ? TIERS.find(candidate => priceCents >= candidate.minCents && priceCents <= candidate.maxCents)!
    : TIERS[0];
  // Reserve up to one cent on each separate debit rather than rounding the total down.
  const installmentCents = Number(roundUp(BigInt(priceCents) * BigInt(tier.feeBps), 20_000n));
  return { feeBps: tier.feeBps, feeCents: 2 * installmentCents, signedSchedule: [
    { dayAfterCustomerAcceptance: 15, installmentCents },
    { dayAfterCustomerAcceptance: tier.laterDay, installmentCents },
  ] };
}

function isoDate(value: string) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const time = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : NaN;
}

export function evaluateWonderlyFunding(
  checkpoints: readonly FundingCheckpoint[],
  schedule: FundingSchedule | undefined,
  priceCents: number,
  quoteFee: ReturnType<typeof wonderlyFeeForPrice>,
  evidence: WonderlyEvidence,
) {
  if (!schedule || !identified(schedule.signedTermsId) || schedule.signedTermsId !== evidence.signedTermsId ||
      !identified(schedule.acceptanceEvidenceId) || checkpoints.length !== quoteFee.signedSchedule.length ||
      schedule.installments.length !== quoteFee.signedSchedule.length || !validCents(priceCents) || priceCents <= 0) return false;
  const acceptanceTime = isoDate(schedule.customerAcceptanceDate);
  if (!Number.isFinite(acceptanceTime)) return false;
  const installmentIds = new Set<string>();
  let previous = { collected: 0, paid: 0, fee: 0, due: acceptanceTime };
  for (const [i, signed] of quoteFee.signedSchedule.entries()) {
    const installment = schedule.installments[i], item = checkpoints[i];
    if (!installment || !item) return false;
    const due = isoDate(installment.dueDate);
    const originalDue = acceptanceTime + signed.dayAfterCustomerAcceptance * 86_400_000;
    const amendment = evidence.depositProtectionAddendum;
    const validDeferral = identified(installment.deferredByEvidenceId) &&
      amendment?.termsId === evidence.signedTermsId && installment.deferredByEvidenceId === amendment?.evidenceId;
    if (!Number.isFinite(due) || due < originalDue || due < previous.due ||
        (due !== originalDue && !validDeferral) ||
        !identified(installment.installmentId) || installmentIds.has(installment.installmentId) ||
        !identified(installment.scheduleEvidenceId) || installment.installmentCents !== signed.installmentCents ||
        item.installmentId !== installment.installmentId || item.dueDate !== installment.dueDate ||
        item.installmentCents !== signed.installmentCents || item.clearedAsOfDate !== item.dueDate ||
        item.workCommitmentAsOfDate !== item.dueDate ||
        !identified(item.clearedReceiptsEvidenceId) || !identified(item.workCommitmentEvidenceId)) return false;
    installmentIds.add(installment.installmentId);
    const { clearedCustomerCentsToDate: collected, jobCostsPaidCentsToDate: paid,
      workReserveCentsUntilNextCollection: reserve, cumulativeWonderlyFeeDueCents: fee } = item;
    if (![collected, paid, reserve, fee].every(validCents) || collected < previous.collected ||
        paid < previous.paid || fee !== previous.fee + signed.installmentCents ||
        collected > priceCents || collected < paid + reserve + fee) return false;
    previous = { collected, paid, fee, due };
  }
  return previous.fee === quoteFee.feeCents;
}

export type WonderlyBidInput = {
  service: string;
  lead: VerifiedLead;
  confirmedWholeHomeScope: boolean;
  base: NetQuote;
  /** Confirmed all-in base cost basis, with no Wonderly referral fee already included. */
  baseCostBasis: { confirmed: boolean; excludesWonderlyFee: boolean };
  evidence?: WonderlyEvidence;
  /** Both schedule and checkpoint evidence come from authoritative internal records. */
  fundingSchedule?: FundingSchedule;
  funding?: readonly FundingCheckpoint[];
};

export function stageWonderlyBid(input: WonderlyBidInput) {
  const { lead, base } = input;
  if (lead.kind === "direct" && identified(lead.sourceRecordId)) return { kind: "direct" as const, base };
  if (lead.kind !== "wonderly" || !identified(lead.leadId) || !identified(lead.sourceRecordId)) {
    return { kind: "blocked" as const, reason: "attribution-unresolved" };
  }
  if (input.service !== "whole-home" || !input.confirmedWholeHomeScope) {
    return { kind: "blocked" as const, reason: "outside-whole-home-pilot" };
  }
  if (!input.baseCostBasis.confirmed || !input.baseCostBasis.excludesWonderlyFee ||
      base.version !== NET_POLICY_VERSION || base.jobClass !== "complex-remodel" ||
      base.lowerTier || base.netTarget < 0.20 || base.grossTarget < 0.35) {
    return { kind: "blocked" as const, reason: "unverified-or-duplicated-cost-basis" };
  }
  const evidence = input.evidence;
  if (!evidence || !identified(evidence.signedTermsId)) return { kind: "blocked" as const, reason: "no-verified-terms" };
  const qualified = (evidence.quoteChannel === "physical" || evidence.quoteChannel === "wonderly") &&
    evidence.quoteChannel === evidence.eligibleQuoteChannel?.kind && identified(evidence.eligibleQuoteChannel.evidenceId);
  const direct = BigInt(toCents(base.direct));
  const costs = direct + BigInt(toCents(base.otherCostDollars));
  const rate = percent(base.otherCostRate);
  const net = percent(base.netTarget);
  const gross = percent(base.grossTarget);
  const sameScopeFloor = toCents(base.price);
  function modeledProfit(cents: number, feeCents: number) {
    const revenue = BigInt(cents);
    return revenue - costs - roundUp(revenue * rate, SCALE) - BigInt(feeCents);
  }
  function meets(cents: number) {
    const revenue = BigInt(cents);
    const fee = wonderlyFeeForPrice(cents, qualified);
    // Reserve 3 cents for charge rounding (two installments and one
    // residual-cost allocation). This linear bound is monotone per tier,
    // unlike testing actual debit rounding inside a binary search.
    const modeledProfitBound = (revenue - costs - 3n) * SCALE -
      revenue * (rate + BigInt(fee.feeBps) * 100n);
    return modeledProfitBound >= revenue * net && (revenue - direct) * SCALE >= revenue * gross;
  }
  let priceCents: number | undefined;
  const tiers = qualified ? TIERS : [{ minCents: 1, maxCents: MAX_CENTS }];
  for (const tier of tiers) {
    // Preserve the existing whole-dollar bidding convention.
    let low = Math.ceil(Math.max(tier.minCents, sameScopeFloor) / 100);
    let high = Math.floor(tier.maxCents / 100);
    if (low > high || !meets(high * 100)) continue;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (meets(middle * 100)) high = middle;
      else low = middle + 1;
    }
    priceCents = low * 100;
    break;
  }
  if (priceCents === undefined) return { kind: "blocked" as const, reason: "no-price-meets-policy" };
  const fee = wonderlyFeeForPrice(priceCents, qualified);
  const evidenceComplete = evidence.quoteChannel === "third-party"
    ? identified(evidence.thirdPartyQuoteApprovalId)
    : qualified;
  const addendum = evidence.depositProtectionAddendum;
  const blockers = [
    ...(!evidenceComplete ? ["quote-channel-unverified"] : []),
    ...(!identified(addendum?.evidenceId) || addendum?.termsId !== evidence.signedTermsId ? ["written-deposit-protection-missing"] : []),
    ...(!evaluateWonderlyFunding(input.funding ?? [], input.fundingSchedule, priceCents, fee, evidence) ? ["funding-not-established"] : []),
  ];
  const netProfitCents = Number(modeledProfit(priceCents, fee.feeCents));
  return {
    kind: "wonderly-model" as const, version: WONDERLY_POLICY_VERSION, signedTermsId: evidence.signedTermsId,
    priceCents, ...fee, netProfitCents, netMargin: netProfitCents / priceCents,
    netTarget: base.netTarget, grossTarget: base.grossTarget,
    blockers,
  };
}
