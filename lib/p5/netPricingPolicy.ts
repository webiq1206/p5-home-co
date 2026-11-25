/** Internal estimate economics for new work. Money inputs are dollars, rates are fractions of revenue. */
export const LEGACY_NET_POLICY_VERSION = "P5-NET15-2026-11-24";
export const NET_POLICY_VERSION = "P5-STANDING-2026-11-25";
export const isNetPricingVersion = (version?: string) =>
  version === NET_POLICY_VERSION || version === LEGACY_NET_POLICY_VERSION;
export const MINIMUM_NET_MARGIN = 0.15;

export const JOB_POLICIES = {
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
export type JobClass = keyof typeof JOB_POLICIES;

/** Entered by staff on a new version. Amounts must exclude costs already in direct cost.
 * A lower tier additionally needs all five positive checks. A missing check defaults to target. */
export type ReviewedJobTerms = {
  jobClass: JobClass;
  otherCostDollars: number;
  otherCostRate: number;
  costSource: string;
  approvedSameScopePrice?: number;
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
  return value;
}

export type QuoteEconomics = {
  jobClass: JobClass; direct: number; otherCostDollars: number; otherCostRate: number;
  fixedSell?: number; protectedPrice?: number; competitive?: ReviewedJobTerms["competitive"];
  policyVersion?: string;
  minimumNetTarget?: number; minimumGrossTarget?: number;
};

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
  const jobClass = !legacy && input.jobClass === "builder-cabinets" && !verified
    ? "retail-cabinets" : input.jobClass;
  const rule=JOB_POLICIES[jobClass];
  const lowerTier=legacy && jobClass!=="protected" && verified;
  const normalNet = legacy && jobClass.endsWith("-cabinets") ? 0.18 : rule[2];
  const netTarget=Math.max(lowerTier?MINIMUM_NET_MARGIN:normalNet,input.minimumNetTarget??0);
  const grossTarget=Math.max(lowerTier?rule[1]:rule[0],input.minimumGrossTarget??0);
  if (!Number.isFinite(netTarget)||!Number.isFinite(grossTarget)||otherCostRate+netTarget>=1||grossTarget>=1)
    throw new Error("The selected margins and company cost rate leave no room to cover direct costs.");
  const netFloor=(direct+otherCostDollars)/(1-otherCostRate-netTarget);
  const grossFloor=direct/(1-grossTarget);
  const price=Math.ceil(Math.max(netFloor,grossFloor,fixedSell,protectedPrice)-1e-8);
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
  return netQuotePrice({policyVersion,jobClass,direct,otherCostDollars:reviewed?.otherCostDollars??0,
    otherCostRate:reviewed?.otherCostRate??rate,fixedSell,
    protectedPrice:Math.max(reviewed?.approvedSameScopePrice??0,jobClass==="protected"?oldPrice:0),
    competitive:reviewed?.competitive,minimumNetTarget:Math.max(requestedNet??0,service==="rush"?.25:0)});
}

/** The book retains historic back-solved costs. Never present those as actual wages. */
export function fixedBookCharge(rawCode:string): {price:number;hours?:number;zeroDirect?:boolean;visitMinimum?:boolean}|undefined {
  const code=rawCode.replace(/^PB-/,"");
  if (["01-01-01","01-01-02","01-01-03"].includes(code)) return {price:95,hours:1};
  if (code==="01-01-04") return {price:380,hours:4};
  if (code==="01-01-05") return {price:760,hours:8};
  if (code==="01-01-07") return {price:135,zeroDirect:true,visitMinimum:true};
  if (code==="01-01-08") return {price:50,zeroDirect:true};
  return undefined;
}

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
