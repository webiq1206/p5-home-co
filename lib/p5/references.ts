import {TRADE_CATEGORIES,type TradeCategory} from "./trades.ts";

/** Private historical evidence. This is deliberately separate from CostRule. */
export interface PriceReference {
  id:string; source:string; sourceDate:string; page:number; trade:TradeCategory;
  description:string; quantity:number; unit:string; unitPrice:number; extendedPrice:number;
  priceBasis:"customer-price"|"direct-cost"|"unknown";
  commercialStatus:"base"|"allowance"|"optional"|"alternate"|"excluded";
  location:string; conditions:string; warnings:string[];
}
export function validateReferences(raw:unknown):PriceReference[]{
  if(!Array.isArray(raw)||raw.length>3000)throw new Error("Use a reference list with no more than 3,000 items.");
  const ids=new Set<string>();
  return raw.map((value:unknown)=>{
    const r=value as PriceReference;
    if(!r||typeof r!=="object")throw new Error("Invalid price reference.");
    for(const key of ["id","source","description","unit","location","conditions"] as const)
      if(typeof r[key]!=="string"||r[key].length>4000||["id","source","description","unit"].includes(key)&&!r[key].trim())throw new Error(`Invalid reference ${key}.`);
    if(ids.has(r.id))throw new Error("Duplicate price reference identifier.");ids.add(r.id);
    if(!Number.isInteger(r.page)||r.page<1||!/^\d{4}-\d{2}-\d{2}$/.test(r.sourceDate)||!Number.isFinite(Date.parse(r.sourceDate)))throw new Error("A source date and page are required.");
    for(const key of ["quantity","unitPrice","extendedPrice"] as const)if(typeof r[key]!=="number"||!Number.isFinite(r[key])||r[key]<0)throw new Error(`Invalid reference ${key}.`);
    if(!(TRADE_CATEGORIES as readonly string[]).includes(r.trade)||!["customer-price","direct-cost","unknown"].includes(r.priceBasis)||!["base","allowance","optional","alternate","excluded"].includes(r.commercialStatus)||!Array.isArray(r.warnings)||r.warnings.some((w:unknown)=>typeof w!=="string"||w.length>4000))throw new Error("Invalid reference classification.");
    // A displayed unit price may be rounded. Preserve, rather than rewrite, totals.
    const warnings=[...r.warnings];
    if(Math.abs(r.quantity*r.unitPrice-r.extendedPrice)>Math.max(.02,r.quantity*.005+.005))warnings.push("The quantity, displayed rate and line total do not reconcile.");
    return {...r,warnings:[...new Set(warnings)]};
  });
}
export interface ComparableSelection {
  referenceId:string; costLineId:string; quantity:number; unit:string;
  scopeConfirmed:boolean; locationConfirmed:boolean; dateConfirmed:boolean;
  /** Independently justified adjustments, not a universal escalation multiplier. */
  adjustedCustomerUnitPrice:number; rationale:string;
}
export function comparableUnit(unit:string):string {
  const normalized=unit.trim().toUpperCase();
  return ({SQFT:"SF","SQ FT":"SF",SQYD:"SY",CUYD:"CY",HOUR:"HRS",HOURS:"HRS",HR:"HRS",EACH:"EA",PACKAGE:"LS","LUMP SUM":"LS"} as Record<string,string>)[normalized]||normalized;
}
export function validateComparisonLine(selection:ComparableSelection,line:{quantity:number;unit:string}){
  if(!selection||selection.quantity!==line.quantity||typeof selection.unit!=="string"||comparableUnit(selection.unit)!==comparableUnit(line.unit))throw new Error("Use the saved cost line's quantity and unit. Split or correct the reviewed scope before comparing a different quantity.");
}
export function compareReference(reference:PriceReference,selection:ComparableSelection,customerLinePrice:number){
  if(reference.priceBasis!=="customer-price")throw new Error("Customer-price comparisons require a confirmed customer selling-price basis.");
  if(reference.commercialStatus!=="base"||reference.quantity<=0||reference.unitPrice<=0||reference.warnings.length)throw new Error("Resolve optional scope, units, zero quantities and reference warnings before comparison.");
  if(!selection||selection.scopeConfirmed!==true||selection.locationConfirmed!==true||selection.dateConfirmed!==true||typeof selection.unit!=="string"||comparableUnit(selection.unit)!==comparableUnit(reference.unit)||!Number.isFinite(selection.quantity)||selection.quantity<=0||!Number.isFinite(selection.adjustedCustomerUnitPrice)||selection.adjustedCustomerUnitPrice<=0||typeof selection.rationale!=="string"||selection.rationale.trim().length<30||!Number.isFinite(customerLinePrice)||customerLinePrice<0)throw new Error("Confirm comparable scope, units, location, date and the reason for the adjusted selling price.");
  const comparablePrice=selection.quantity*selection.adjustedCustomerUnitPrice;
  const ratio=customerLinePrice/comparablePrice;
  return {referenceId:reference.id,costLineId:selection.costLineId,comparablePrice,customerLinePrice,ratio,status:ratio<.85?"below-reference":ratio>1.25?"above-reference":"within-review-band",rationale:selection.rationale,
    note:"Comparison only. No source selling price is added to direct costs, and profit is not reduced automatically."};
}
/** A target cost ceiling derived from a comparable selling price, not a supplier quote. */
export function referenceDirectCostBudget(customerUnitPrice:number,overheadRate:number,profitMargin:number,contingencyRate:number){
  if(!Number.isFinite(customerUnitPrice)||customerUnitPrice<=0||![overheadRate,profitMargin,contingencyRate].every(n=>Number.isFinite(n)&&n>=0)||overheadRate+profitMargin>=1)throw new Error("Invalid reference cost-budget inputs.");
  const divisor=1-overheadRate-profitMargin;
  return {maximumDirectUnitCost:customerUnitPrice*divisor/(1+contingencyRate),customerUnitPrice,overheadRate,profitMargin,contingencyRate,divisor,note:"Cost ceiling at the reviewed selling price. This is not an observed supplier, subcontractor or payroll cost. Confirm the actual cost before adding it to a direct-cost book."};
}
