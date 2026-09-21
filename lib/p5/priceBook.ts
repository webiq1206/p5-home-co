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
 */
export function serviceContext(service?:string|null):{flags:number;remodel:boolean}{
  switch(service){
    case 'new-construction':case 'adu':return {flags:NC,remodel:false};
    case 'addition':return {flags:NC|RM,remodel:false};
    case 'kitchen':case 'bathroom':case 'whole-home':return {flags:RM,remodel:true};
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
export const PRICE_BOOK_PERCENTAGE=PRICE_BOOK.filter(row=>!UNITS[row[4]]||!COST_TYPES[row[5]]);
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
    description:`${item} (${kind.includes}${assembly}${selection}${tierNote}${remodelNote}; ${section}, ${division}).${detail}`.slice(0,480),
    type:kind.type,unit:UNITS[uom],amount,
    source:`${PRICE_BOOK_SOURCE}, ${TIER_LABEL[tier]}${withPremium?' remodel':''} direct cost`,
    basis:'owner-average-cost',
  };
}
/** Every line that applies to this project's service, priced at its finish tier. */
export function priceBookRates(answers:{service?:string|null;finish?:string|null}):PlanningRate[]{
  const {flags,remodel}=serviceContext(answers.service);
  const tier=finishTier(answers.finish);
  return PRICE_BOOK_RATEABLE.filter(row=>(row[8]&flags)!==0).map(row=>priceBookRate(row,tier,remodel));
}
export function priceBookSummary(){
  return {source:PRICE_BOOK_SOURCE,lines:PRICE_BOOK.length,rateable:PRICE_BOOK_RATEABLE.length,percentage:PRICE_BOOK_PERCENTAGE.length};
}
