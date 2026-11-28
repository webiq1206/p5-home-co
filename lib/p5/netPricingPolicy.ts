/** Internal estimate economics for new work. Money inputs are dollars, rates are fractions of revenue. */
import {activePricing} from "./pricingContext.ts";
export const LEGACY_NET_POLICY_VERSION = "P5-NET15-2026-11-24";
export const STANDING_NET_POLICY_VERSION = "P5-STANDING-2026-11-25";
export const NET_POLICY_VERSION = "P5-BID-2026-11-25";
export const isNetPricingVersion = (version?: string) =>
  version === NET_POLICY_VERSION || version === STANDING_NET_POLICY_VERSION || version === LEGACY_NET_POLICY_VERSION;
export const MINIMUM_NET_MARGIN = 0.15;

const HISTORICAL_POLICIES = {
  "builder-cabinets": [0.25, 0.22, 0.25],
  "retail-cabinets": [0.30, 0.27, 0.30],
  "installed-cabinets": [0.32, 0.30, 0.30],
  "same-layout-kitchen": [0.30, 0.28, 0.18],
  "standard-remodel": [0.32, 0.30, 0.18],
  "complex-remodel": [0.35, 0.35, 0.20],
  "short-service": [0.40, 0.35, 0.18],
  "simple-addition": [0.32, 0.30, 0.18],
  "verified-conversion": [0.32, 0.30, 0.18],
  "protected": [0, 0, 0.20],
} as const;
/** Released from the cost book Pricing Policy tab. A null concession floor protects the class. */
export const JOB_POLICIES = {
  "builder-cabinets": [0.25, null, 0.22],
  "retail-cabinets": [0.3, null, 0.3],
  "installed-cabinets": [0.32, null, 0.3],
  "same-layout-kitchen": [0.3, 0.28, 0.18],
  "standard-remodel": [0.32, 0.3, 0.18],
  "complex-remodel": [0.35, null, 0.2],
  "short-service": [0.4, 0.35, 0.18],
  "simple-addition": [0.32, 0.3, 0.18],
  "verified-conversion": [0.32, 0.3, 0.18],
  "protected": [0, null, 0.2],
} as const;
export type JobClass = keyof typeof JOB_POLICIES;
type PolicyRow = readonly [gross: number, concessionGross: number | null, net: number];
/** The class schedule of the approved release in scope; the compiled schedule otherwise. */
export function releasedJobPolicies(): Readonly<Record<JobClass, PolicyRow>> {
  return activePricing()?.snapshot.rules.jobPolicies ?? JOB_POLICIES;
}
/** Rush floors of the approved release in scope: all rush work, and rush cabinets. */
export function releasedRushFloors(): { rush: number; rushCabinet: number } {
  const rules = activePricing()?.snapshot.rules;
  return { rush: rules?.rushMinNet ?? 0.25, rushCabinet: rules?.rushCabinetMinNet ?? 0.3 };
}

/** Entered by staff on a new version. Amounts must exclude costs already in direct cost.
 * A lower tier additionally needs all five positive checks. A missing check defaults to target. */
export type ReviewedJobTerms = {
  jobClass: JobClass;
  otherCostDollars: number;
  otherCostRate: number;
  costSource: string;
  approvedSameScopePrice?: number;
  rush?: boolean;
  bundledVisit?: boolean;
  builder?: { priorBookedProjects: number; steady: boolean };
  ownerConcession?: { netTarget: number; approvedBy: string };
  competitive?: {
    costsVerified: boolean; scopeDefined: boolean; capacityOrRepeat: boolean;
    ownerReturnConfirmed: boolean; cashCovered: boolean;
    reason: string;
  };
};

export function defaultJobClass(service: string, scope: string, risks: readonly string[] = []): JobClass {
  const protectedWork = /second[- ]stor|underpinn|uncertain foundation|major structural|unknown utilit/i.test(scope) ||
    risks.some(risk => ["unknown-utilities","soil-slope","incomplete-plans"].includes(risk));
  if (["new-construction","construction","rush","change-order","addition","adu"].includes(service)) return "protected";
  if (/cabinet/.test(service)) return /install/.test(service) ? "installed-cabinets" : "retail-cabinets";
  if (service === "handyman" || service === "re10") return "short-service";
  if (service === "kitchen") return /same[- ]layout|existing layout|existing footprint|keep.{0,12}layout/i.test(scope) && !protectedWork ? "same-layout-kitchen" : "complex-remodel";
  if (service === "whole-home" || protectedWork || /structural|moving walls|layout chang/i.test(scope)) return "complex-remodel";
  return "standard-remodel";
}

export function validateReviewedTerms(value: ReviewedJobTerms): ReviewedJobTerms {
  if (!value || !Object.hasOwn(JOB_POLICIES, value.jobClass) || !value.costSource?.trim() ||
      !Number.isFinite(value.otherCostDollars) || value.otherCostDollars < 0 ||
      !Number.isFinite(value.otherCostRate) || value.otherCostRate < 0 || value.otherCostRate >= 0.85 ||
      (value.approvedSameScopePrice !== undefined && (!Number.isFinite(value.approvedSameScopePrice) || value.approvedSameScopePrice <= 0))) {
    throw new Error("Document the job class, cost basis and valid nonduplicating expense allocations.");
  }
  if (value.builder && (!Number.isSafeInteger(value.builder.priorBookedProjects) || value.builder.priorBookedProjects < 0 ||
      typeof value.builder.steady !== "boolean")) throw new Error("Enter the number of distinct prior booked cabinet projects.");
  return value;
}

export type QuoteEconomics = {
  jobClass: JobClass; direct: number; otherCostDollars: number; otherCostRate: number;
  fixedSell?: number; protectedPrice?: number; competitive?: ReviewedJobTerms["competitive"];
  bundledVisit?: boolean;
  builder?: ReviewedJobTerms["builder"];
  ownerConcession?: ReviewedJobTerms["ownerConcession"];
  policyVersion?: string;
  minimumNetTarget?: number; minimumGrossTarget?: number;
};

/** One calculation for the numeric estimator and the native Google Sheets formula writer. */
export function bidLimits<T>(direct:T, otherDollars:T, otherRate:T, net:T, gross:T, math:{
  one:T; add:(a:T,b:T)=>T; subtract:(a:T,b:T)=>T; divide:(a:T,b:T)=>T;
}) {
  const {one,add,subtract,divide}=math;
  return {
    net:divide(add(direct,otherDollars),subtract(subtract(one,otherRate),net)),
    gross:divide(direct,subtract(one,gross)),
  };
}
const numericMath = {one:1, add:(a:number,b:number)=>a+b, subtract:(a:number,b:number)=>a-b, divide:(a:number,b:number)=>a/b};

export function netQuotePrice(input: QuoteEconomics) {
  const {direct,otherCostDollars,otherCostRate,fixedSell=0,protectedPrice=0} = input;
  const amounts = [direct,otherCostDollars,otherCostRate,fixedSell,protectedPrice];
  if (!Object.hasOwn(JOB_POLICIES, input.jobClass) || amounts.some(x=>!Number.isFinite(x)||x<0))
    throw new Error("A valid project class and nonnegative job costs are required.");
  const version = input.policyVersion ?? NET_POLICY_VERSION;
  const legacy = version === LEGACY_NET_POLICY_VERSION;
  const approval=input.competitive;
  const verified = approval?.costsVerified===true && approval.scopeDefined===true &&
    approval.capacityOrRepeat===true && approval.ownerReturnConfirmed===true && approval.cashCovered===true && Boolean(approval.reason?.trim());
  // Builder stock pricing is only available after staff document the order terms.
  const current = version === NET_POLICY_VERSION;
  if (!isNetPricingVersion(version)) throw new Error("Unknown bid pricing version.");
  const relationship = input.builder;
  const qualifiedBuilder = verified && (!current || relationship?.steady === true ||
    (Number.isInteger(relationship?.priorBookedProjects) && (relationship?.priorBookedProjects ?? 0) >= 2));
  const jobClass = !legacy && input.jobClass === "builder-cabinets" && !qualifiedBuilder
    ? "retail-cabinets" : input.jobClass;
  const rule: PolicyRow = current ? releasedJobPolicies()[jobClass] : HISTORICAL_POLICIES[jobClass];
  const normalNet = legacy && jobClass.endsWith("-cabinets") ? 0.18 : rule[2];
  const decision = current ? input.ownerConcession : undefined;
  if (decision && (!verified || !decision.approvedBy?.trim() || rule[1] === null ||
      (jobClass === "short-service" && input.bundledVisit !== true) ||
      !Number.isFinite(decision.netTarget) || decision.netTarget < MINIMUM_NET_MARGIN || decision.netTarget >= normalNet))
    throw new Error("This private concession needs an eligible scope, verified terms, a named owner and an allowed net target.");
  const lowerTier = legacy ? jobClass !== "protected" && verified : Boolean(decision);
  const netTarget = Math.max(decision?.netTarget ?? (lowerTier ? MINIMUM_NET_MARGIN : normalNet), input.minimumNetTarget ?? 0);
  const grossTarget = Math.max(lowerTier ? rule[1] ?? rule[0] : rule[0], input.minimumGrossTarget ?? 0);
  if (!Number.isFinite(netTarget)||!Number.isFinite(grossTarget)||otherCostRate+netTarget>=1||grossTarget>=1)
    throw new Error("The selected margins and company cost rate leave no room to cover direct costs.");
  const limits=bidLimits(direct,otherCostDollars,otherCostRate,netTarget,grossTarget,numericMath);
  const price=Math.ceil(Math.max(limits.net,limits.gross,fixedSell,protectedPrice)-1e-8);
  const netProfit=price*(1-otherCostRate)-direct-otherCostDollars;
  return {version,jobClass,lowerTier,netTarget,grossTarget,direct,otherCostDollars,otherCostRate,
    price,netProfit,netMargin:price>0?netProfit/price:0};
}
/** Fractions of sales for costs outside budgeted overhead. A confirmed zero is valid. */
export type NetFinance = { interestRate?:number|null; companyTaxRate?:number|null; netCostSource?:string };
export function residualRate(finance:NetFinance, overhead:number) {
  const rates=[finance.interestRate,finance.companyTaxRate];
  if(rates.some(value=>value!=null && (!Number.isFinite(value)||value<0||value>=1))) throw new Error("Interest and company tax allocations must be between zero and one.");
  return {rate:overhead+(rates[0]??0)+(rates[1]??0), confirmed:rates.every(value=>value!=null)&&Boolean(finance.netCostSource?.trim())};
}
export type NetQuote = ReturnType<typeof netQuotePrice>;

/** Fixed unit prices may produce fractional dollars. Compare the actual cents to both unrounded requirements. */
export function checkFixedQuote(quote:NetQuote,price:number) {
  const netProfit=price*(1-quote.otherCostRate)-quote.direct-quote.otherCostDollars;
  const netMargin=price>0?netProfit/price:0;
  const grossMargin=price>0?(price-quote.direct)/price:0;
  return {meets:price>0 && netMargin+1e-10>=quote.netTarget && grossMargin+1e-10>=quote.grossTarget,
    quote:{...quote,price,netProfit,netMargin}};
}

/** Preserve exact totals by allocating integer cents cumulatively across flexible lines. */
export function allocatePrice(total: number, weights: readonly number[], scale=100): number[] {
  if (!Number.isFinite(total) || total < 0 || weights.some(x=>!Number.isFinite(x)||x<0)) throw new Error("Invalid price allocation.");
  const sum=weights.reduce((a,b)=>a+b,0);
  if (!sum) return weights.map(()=>0);
  let cumulative=0, previous=0;
  return weights.map(weight=>{
    cumulative+=weight;
    const through=Math.round(Math.round(total*scale)*cumulative/sum);
    const part=(through-previous)/scale;
    previous=through;
    return part;
  });
}

export function quoteForScope(service:string,scope:string,risks:readonly string[],direct:number,rate:number,
  fixedSell:number,oldPrice:number,terms?:ReviewedJobTerms,requestedNet?:number,policyVersion=NET_POLICY_VERSION) {
  const reviewed=terms?validateReviewedTerms(terms):undefined;
  let jobClass=reviewed?.jobClass??defaultJobClass(service,scope,risks);
  // A review can confirm a simple tie-in or verified conversion, but can never
  // reclassify a new home, second story or detached new build as discounted work.
  const validClasses: Record<string, readonly JobClass[]> = {
    "cabinet-product":["builder-cabinets","retail-cabinets"], "cabinet-install":["installed-cabinets"],
    kitchen:["same-layout-kitchen","complex-remodel"], bathroom:["standard-remodel","complex-remodel"],
    remodel:["standard-remodel","complex-remodel"], "whole-home":["complex-remodel"],
    handyman:["short-service"], re10:["short-service"], addition:["simple-addition","protected"], adu:["verified-conversion","protected"]
  };
  if (reviewed && !(validClasses[service]??["protected"]).includes(jobClass)) throw new Error("The reviewed job class does not match the service.");
  if (["new-construction","construction","rush","change-order"].includes(service) ||
      (["addition","adu"].includes(service) && (/second[- ]stor|detached|underpinn|uncertain foundation|unknown utilit|major structural|complex tie[- ]in/i.test(scope) || risks.some(r=>["unknown-utilities","soil-slope","incomplete-plans"].includes(r))))) jobClass="protected";
  if (service==="kitchen" && /structural|moving walls|load[- ]bearing|relocat(?:e|ing) (?:the )?(?:plumbing|utilities)/i.test(scope)) jobClass="complex-remodel";
  const rush = policyVersion === NET_POLICY_VERSION && reviewed?.rush === true;
  const rushCabinet = rush && (service.startsWith("cabinet") || (service === "rush" && /cabinet|built[- ]in/i.test(scope)));
  if (rush) jobClass="protected";
  return netQuotePrice({policyVersion,jobClass,direct,otherCostDollars:reviewed?.otherCostDollars??0,
    otherCostRate:reviewed?.otherCostRate??rate,fixedSell,
    protectedPrice:Math.max(reviewed?.approvedSameScopePrice??0,jobClass==="protected"?oldPrice:0),
    builder:reviewed?.builder,bundledVisit:reviewed?.bundledVisit,ownerConcession:reviewed?.ownerConcession,
    competitive:reviewed?.competitive,minimumNetTarget:Math.max(requestedNet??0,rushCabinet?releasedRushFloors().rushCabinet:(service==="rush" || rush)?releasedRushFloors().rush:0)});
}

/** The book retains historic back-solved costs. Never present those as actual wages. */
export function fixedBookCharge(rawCode:string): {price:number;hours?:number;zeroDirect?:boolean;visitMinimum?:boolean}|undefined {
  const code=rawCode.replace(/^PB-/,"");
  const shape=FIXED_CHARGES[code];
  if(!shape) return undefined;
  // The amount comes from the approved release; what kind of charge it is stays a rule of the engine.
  const released=activePricing()?.snapshot.rules.fixedCharges?.[code];
  return {...shape,price:released??shape.price};
}
/** Compiled fixed selling prices, as released from the cost book on 25 November 2026. */
export const FIXED_CHARGES:Readonly<Record<string,{price:number;hours?:number;zeroDirect?:boolean;visitMinimum?:boolean}>>={
  "01-01-01":{price:95,hours:1},"01-01-02":{price:95,hours:1},"01-01-03":{price:95,hours:1},
  "01-01-04":{price:380,hours:4},"01-01-05":{price:760,hours:8},
  "01-01-07":{price:135,zeroDirect:true,visitMinimum:true},"01-01-08":{price:50,zeroDirect:true},
};
/** The one-visit minimum and the all-in handyman hour of the release in scope. */
export const releasedVisitMinimum=():number=>fixedBookCharge("01-01-07")!.price;
export const releasedHandymanHour=():number=>fixedBookCharge("01-01-01")!.price;

/** Credit other fixed charges against the dispatch minimum before flexible scope is priced. */
export function creditVisitMinimum(amounts: (number | undefined)[], minimumIndexes: number[]) {
  if (!minimumIndexes.length) return;
  const charges = minimumIndexes.map(index => amounts[index] ?? 0);
  const totalMinimum = charges.reduce((sum, amount) => sum + amount, 0);
  const allFixed = amounts.reduce<number>((sum, amount) => sum + (amount ?? 0), 0);
  const balance = Math.max(0, totalMinimum - (allFixed - totalMinimum));
  const shares = allocatePrice(balance, charges);
  minimumIndexes.forEach((index, position) => { amounts[index] = shares[position]; });
}
