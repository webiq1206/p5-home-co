import {createHash} from 'node:crypto';
import {PRICE_BOOK,PRICE_BOOK_SOURCE,type PriceBookRow} from './priceBookData.ts';
import type {PlanningRate} from './planningBooks.ts';

/**
 * The owner's master price book, resolved for one project.
 *
 * The book holds every line once with four finish-tier prices, a remodel premium, the labor share
 * and flags for where the line applies (new construction, remodel, handyman, cabinets, RE-10,
 * commercial and residential TI). Every figure is a DIRECT COST: no overhead, profit or
 * contingency. The estimator applies the owner's margin policy once, after direct costs, so a
 * price here must never carry margin of its own.
 *
 * For a given project this module picks the lines that apply to its service, prices each at the
 * finish tier the customer chose, adds the remodel premium where the work is in an existing home,
 * and describes each line so the mapping stage knows exactly what the price includes.
 */
export type FinishTier='builder'|'mid'|'high'|'luxury';
/** The estimator's finish values, mapped to the book's four tiers. 'refresh' is the value the
 * selector has always stored for its lowest tier; the book calls that tier Builder Grade. */
export const FINISH_TIER:Record<string,FinishTier>={refresh:'builder','mid-range':'mid','high-end':'high',luxury:'luxury'};
export const TIER_LABEL:Record<FinishTier,string>={builder:'Builder Grade',mid:'Mid-Range',high:'High-End',luxury:'Luxury'};
/** The book's own default when no finish is chosen is Mid-Range. */
export const finishTier=(finish?:string|null):FinishTier=>FINISH_TIER[String(finish||'')]||'mid';

// Flag bits, in the order scripts/p5-build-price-book.mjs writes them.
const NC=1,RM=2,HM=4,CAB=8,RE10=16;
/**
 * Which lines a service draws on, and whether the work is in an existing home (so the remodel
 * premium applies). RE-10 repairs are priced as remodel work, as the book states. Handyman and
 * cabinet lines are priced at base direct cost, as their tabs in the book are. A change order or
 * rush job can modify any kind of residential work, so it sees all of it.
 *
 * These flags order the book; they never hide a line (see priceBookRates).
 */
export function serviceContext(service?:string|null):{flags:number;remodel:boolean}{
  switch(service){
    case 'new-construction':case 'adu':return {flags:NC,remodel:false};
    case 'addition':return {flags:NC|RM,remodel:false};
    case 'kitchen':case 'bathroom':case 'whole-home':case 'remodel':return {flags:RM,remodel:true};
    case 're10':return {flags:RE10,remodel:true};
    case 'handyman':return {flags:HM,remodel:false};
    case 'cabinet-product':case 'cabinet-install':return {flags:CAB,remodel:false};
    default:return {flags:NC|RM|HM|CAB|RE10,remodel:false};
  }
}
/** Book units, as the estimator's catalog spells them. A percentage is not a dollar price and is
 * never offered as a unit rate: an 8% design fee would otherwise price at eight cents. */
const UNITS:Record<string,string>={HR:'HR',SF:'SF',EA:'EA',LF:'LF',MO:'MO',DAY:'DAY',TON:'TON',SQ:'SQ',RL:'RL',W:'W',AC:'AC',CY:'CY'};
/** What each cost type includes, in the book's own terms, and how the estimator categorises it. */
const COST_TYPES:Record<string,{type:PlanningRate['type'];includes:string}>={
  'Labor + Material (Installed)':{type:'Subcontractor',includes:'installed price, labor and material together'},
  'Labor + Minor Materials':{type:'Subcontractor',includes:'labor with consumables included'},
  'Labor + Equipment':{type:'Subcontractor',includes:'operator labor and equipment'},
  'Labor + Disposal':{type:'Subcontractor',includes:'removal labor with haul-off and dump fees'},
  'Labor Only':{type:'Labor',includes:'labor only; price materials separately'},
  'Material Only':{type:'Material',includes:'material only; price installation separately'},
  'Equipment / Service':{type:'Equipment',includes:'rental or service charge'},
  'Fee / Professional Service':{type:'Other',includes:'fee or professional service'},
  'Service Fee':{type:'Other',includes:'trip, call, minimum or diagnostic charge'},
};
const round=(n:number)=>Math.round(n*100)/100;
const tierPrice=(row:PriceBookRow,tier:FinishTier)=>({builder:row[10],mid:row[11],high:row[12],luxury:row[13]})[tier];
/** Lines that can be offered as a unit rate at all. */
export const PRICE_BOOK_RATEABLE=PRICE_BOOK.filter(row=>UNITS[row[4]]&&COST_TYPES[row[5]]);
/** Lines the book prices as a percentage; carried by the estimator's own calculation instead. */
export const PRICE_BOOK_PERCENTAGE=PRICE_BOOK.filter(row=>row[5]==='Percentage'&&['% of const.','% of cost'].includes(row[4]));
export const PRICE_BOOK_INVALID=PRICE_BOOK.filter(row=>!PRICE_BOOK_RATEABLE.includes(row)&&!PRICE_BOOK_PERCENTAGE.includes(row));
if(PRICE_BOOK_INVALID.length)throw new Error('The price book contains unsupported units or cost types: '+PRICE_BOOK_INVALID.map(row=>row[0]).join(', '));
/** One line, priced for this project. */
export function priceBookRate(row:PriceBookRow,tier:FinishTier,remodel:boolean):PlanningRate{
  const [code,division,section,item,uom,costType,allowance,,,finishSensitive,,,,,premium,notes]=row;
  const kind=COST_TYPES[costType];
  const withPremium=remodel&&premium>0;
  const amount=round(tierPrice(row,tier)*(withPremium?1+premium:1));
  // Division 90 prices a whole assembly or project per unit; its parts must not be added to it.
  const assembly=code.startsWith('90-')?'; complete assembly, do not add its component lines':'';
  const selection=allowance==='Owner Selection Allowance'?`; owner selection allowance at ${TIER_LABEL[tier]}`:allowance==='Contractor Allowance'?'; contractor allowance':'';
  const tierNote=finishSensitive?`; ${TIER_LABEL[tier]} finish`:'';
  const remodelNote=withPremium?`; existing-home remodel premium ${Math.round(premium*100)}% included`:'';
  const detail=notes?` ${notes}`:'';
  return {
    code:`PB-${code}`,
    description:`${item} (${kind.includes}${assembly}${selection}${tierNote}${remodelNote}; ${section}, ${division}).${detail}`,
    type:kind.type,unit:UNITS[uom],amount,
    source:`${PRICE_BOOK_SOURCE}, ${TIER_LABEL[tier]}${withPremium?' remodel':''} direct cost`,
    basis:'owner-average-cost',
  };
}
/** A project-wide finish tier fills unselected details. It cannot replace an
 * explicitly requested product type with a different type from the book. */
export function specifiedShowerGlassRate(rate:PlanningRate,task:string,service?:string):PlanningRate{
 if(rate.code!=='PB-08-83-01'||!rate.source.startsWith(PRICE_BOOK_SOURCE))return rate;
 const specified=task.replace(/\b(?:not|no|exclude|excluding)\s+(?:semi[- ]frameless|custom frameless|frameless|framed)\b/gi,'');
 const custom=/\bcustom\s+frameless\b/i.test(specified),semi=/\bsemi[- ]frameless\b/i.test(specified);
 const frameless=/\bframeless\b/i.test(specified.replace(/\b(?:custom\s+frameless|semi[- ]frameless)\b/gi,''));
 const framed=/\bframed\b/i.test(specified);
 if([custom,semi,frameless,framed].filter(Boolean).length!==1)return rate;
 const tier:FinishTier=custom?'luxury':semi?'mid':frameless?'high':'builder';
 const row=PRICE_BOOK.find(row=>row[0]==='08-83-01')!;
 const selected=priceBookRate(row,tier,serviceContext(service).remodel);
 const label=custom?'Custom frameless':semi?'Semi-frameless':frameless?'Frameless':'Framed';
 return {...selected,description:`${label} shower glass enclosure (installed price, labor and material together; explicit enclosure type uses the book's ${TIER_LABEL[tier]} rate).`};
}
/** Cabinet supply and installation need separate costs. The master book
 * already supplies their labor share; expose that arithmetic as traceable
 * components without changing or replacing the original installed rate. */
export function cabinetComponentRates(row:PriceBookRow,tier:FinishTier,remodel:boolean):PlanningRate[]{
  const share=row[7];
  if(!/^12-3/.test(row[0])||row[5]!=='Labor + Material (Installed)'||share===null||!Number.isFinite(share)||share<=0||share>=1)return [];
  const installed=priceBookRate(row,tier,remodel);
  const labor=round(installed.amount*share),material=round(installed.amount-labor);
  const item=row[3].replace(/, installed$/i,'');
  return ([['M','Material',material,'material only; excludes installation labor',1-share],['L','Labor',labor,'installation labor only; excludes product supply and all installation consumables; price screws, shims and fasteners as materials separately',share]] as const).map(([suffix,type,amount,includes,fraction])=>({
    ...installed,code:`${installed.code}-${suffix}`,type,amount,
    description:`${item} (${includes}; ${TIER_LABEL[tier]} finish; ${row[2]}, ${row[1]}). Component of ${installed.code}, calculated from the master book's stated ${round(share*100)}% labor share. Do not add to the complete installed line.`,
    source:`${installed.source}; ${installed.code} direct cost ${installed.amount} × ${round(fraction*100)}% ${type.toLowerCase()} share`,
  }));
}
/** Flooring procurement waste belongs to material, not installation labor.
 * Use only the labor share explicitly supplied by the owner's master book. */
export function flooringComponentRates(row:PriceBookRow,tier:FinishTier,remodel:boolean):PlanningRate[]{
 const share=row[7];
 if(!/^09-65-/.test(row[0])||row[5]!=='Labor + Material (Installed)'||share===null||!Number.isFinite(share)||share<=0||share>=1)return [];
 const installed=priceBookRate(row,tier,remodel),labor=round(installed.amount*share),material=round(installed.amount-labor);
 return ([['M','Material',material,'flooring material only; excludes installation labor',1-share],['L','Labor',labor,'flooring installation labor only; measured installed area, excludes material purchase and waste',share]] as const).map(([suffix,type,amount,includes,fraction])=>({...installed,code:`${installed.code}-${suffix}`,type,amount,
  description:`${row[3].replace(/, installed$/i,'')} (${includes}; ${TIER_LABEL[tier]} finish; ${row[2]}, ${row[1]}). Component of ${installed.code}, calculated from the master book's stated ${round(share*100)}% labor share. Do not add to the complete installed line.`,
  source:`${installed.source}; ${installed.code} direct cost ${installed.amount} × ${round(fraction*100)}% ${type.toLowerCase()} share`}));
}
/**
 * Every line in the book, priced at this project's finish tier.
 *
 * The owner performs every line whatever it is labelled, so the applicability flags never hide a
 * line: a scope that names a light fixture on an RE-10 must find the light fixture line even though
 * the book files it under remodel and handyman work. The match is made by meaning
 * (catalogSelection.ts). The flags only order the book, lines marked for this service first, so
 * that when two lines match a task equally well the one the owner files under this kind of work
 * is the one offered.
 */
export function priceBookRates(answers:{service?:string|null;finish?:string|null}):PlanningRate[]{
  const {flags,remodel}=serviceContext(answers.service);
  const tier=finishTier(answers.finish);
  const marked=PRICE_BOOK_RATEABLE.filter(row=>(row[8]&flags)!==0);
  const rest=PRICE_BOOK_RATEABLE.filter(row=>(row[8]&flags)===0);
  return [...marked,...rest].flatMap(row=>[priceBookRate(row,tier,remodel),...cabinetComponentRates(row,tier,remodel),...flooringComponentRates(row,tier,remodel)]);
}
/** A content hash of the whole book: it changes whenever any line, price or flag changes, so an
 * estimate that records it can always be traced to the exact prices it used. */
export const PRICE_BOOK_VERSION=createHash('sha256').update(JSON.stringify(PRICE_BOOK)).digest('hex').slice(0,12);
export function priceBookSummary(){
  return {source:PRICE_BOOK_SOURCE,version:PRICE_BOOK_VERSION,lines:PRICE_BOOK.length,rateable:PRICE_BOOK_RATEABLE.length,percentage:PRICE_BOOK_PERCENTAGE.length};
}
