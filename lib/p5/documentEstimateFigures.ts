/**
 * The figures of one document estimate, as P5 Home Co's lead intake reads them (`estimate`, kind
 * `document`; docs/lead-intake-contract.md in p5-home-co). One function builds them for both paths:
 * p5homeco.com, which makes the QuickBooks estimate in its own process, and a brand site, which posts
 * them to P5 (p5LeadIntake.ts). So the two cannot drift.
 *
 * CUSTOMER PRICES ONLY. Each line is the amount the customer pays for it (`sellingAmount`). No cost,
 * margin, markup, profit, contingency or overhead figure is read, and no field of that name is
 * returned: QuickBooks holds the customer's estimate, and internal figures stay on the site.
 *
 * Pure: no imports, no I/O. Shared: edit it in p5-home-co only and publish it with scripts/p5-sync.mjs.
 */

/** The intake reads at most this many lines in one estimate. */
export const DOCUMENT_ESTIMATE_MAX_LINES=60;

/** One line of the estimate as the intake reads it. `amount` is what the customer pays for the line. */
export interface DocumentEstimateLine {title:string;description?:string;quantity?:number;unit?:string;amount:number;division?:string}
/** The contract's `estimate` object for a document estimate. Customer amounts only. */
export interface DocumentEstimateBody {kind:'document';low:number;high:number;base:number;label:string;verified:true;lines:DocumentEstimateLine[]}

const round2=(value:number)=>Math.round(value*100)/100;
const OTHER_TRADE='Other Project Work';
const oneLine=(value:unknown,max:number)=>typeof value==='string'?value.replace(/\s+/g,' ').trim().slice(0,max):'';
const sumOf=(lines:DocumentEstimateLine[])=>round2(lines.reduce((sum,line)=>sum+line.amount,0));

/** One line per trade, same total. Empty when even that is more lines than one estimate carries. */
export function linesByTrade(lines:DocumentEstimateLine[]):DocumentEstimateLine[]{
  const byTrade=new Map<string,number>();
  for(const line of lines)byTrade.set(line.division??OTHER_TRADE,round2((byTrade.get(line.division??OTHER_TRADE)??0)+line.amount));
  const combined=[...byTrade].map(([trade,amount])=>({title:trade,amount,division:trade}));
  return combined.length>DOCUMENT_ESTIMATE_MAX_LINES?[]:combined;
}

/**
 * What the document estimator priced, as the contract's `estimate`, with what was adjusted on the way
 * (for P5's audit trail). The range is the one the customer was shown, `base` is the contract price,
 * and each line is that line's customer selling amount. Each amount is rounded to the cent; the cents
 * rounding moved go on the largest line, so the lines add up to the contract price. More lines than
 * one estimate carries become one line per trade, same total. Null when the customer was shown no
 * price. Cost, contingency, overhead and profit fields are never read.
 */
export function documentEstimate(record:unknown):{estimate:DocumentEstimateBody;notes:string[]}|null{
  const source=(record&&typeof record==='object'?record:{}) as {scope?:{answers?:{service?:unknown}};customer?:{range?:{low?:unknown;high?:unknown}|null};internal?:{contractPrice?:unknown;lines?:unknown}};
  const low=Number(source.customer?.range?.low),high=Number(source.customer?.range?.high),contract=Number(source.internal?.contractPrice);
  if(![low,high,contract].every(value=>Number.isFinite(value)&&value>0))return null;
  const base=round2(contract);
  const notes:string[]=[];
  let lines:DocumentEstimateLine[]=[];
  for(const entry of Array.isArray(source.internal?.lines)?source.internal.lines as Record<string,unknown>[]:[]){
    const amount=round2(Number(entry?.sellingAmount));
    const description=oneLine(entry?.description,Number.MAX_SAFE_INTEGER);
    if(!Number.isFinite(amount)||amount<=0||!description)continue;
    const quantity=Number(entry.quantity),unit=oneLine(entry.unit,20),trade=oneLine(entry.trade,80);
    lines.push({title:description.slice(0,200).trim(),...(description.length>200?{description:description.slice(0,1000).trim()}:{}),
      ...(Number.isFinite(quantity)&&quantity>0?{quantity}:{}),...(unit?{unit}:{}),amount,...(trade?{division:trade}:{})});
  }
  // Rounding can move at most a cent for each line that was priced, however they are grouped afterwards.
  const tolerance=0.01*lines.length;
  if(lines.length>DOCUMENT_ESTIMATE_MAX_LINES){
    notes.push(`${lines.length} lines were combined into one line per trade`);
    lines=linesByTrade(lines);
  }
  if(lines.length){
    const drift=round2(base-sumOf(lines));
    if(drift!==0&&Math.abs(drift)<=tolerance+1e-9){
      const largest=lines.reduce((a,b)=>b.amount>a.amount?b:a);
      largest.amount=round2(largest.amount+drift);
    }
  }
  const service=oneLine(source.scope?.answers?.service,120);
  return {estimate:{kind:'document',low:round2(low),high:round2(high),base,label:service?`Document estimate, ${service}`:'Document estimate',verified:true,lines},notes};
}

/** The contract's `estimate` object for one document estimator record, or null when its figures are not usable. */
export function documentEstimateBody(record:unknown):DocumentEstimateBody|null{return documentEstimate(record)?.estimate??null;}
