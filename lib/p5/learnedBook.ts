import {createHash} from 'node:crypto';
import {query} from './database.ts';
import {PRICE_BOOK_RATEABLE} from './priceBook.ts';
import {meaningfulWords,conceptsOf} from './catalogSelection.ts';
import {unitKey,UNIT_REGISTRY,rateLocation,reusableUnitRate} from './unitRates.ts';
import {finishTier} from './priceBook.ts';
import type {CostRule} from './costBook.ts';
import type {PlanningRate} from './planningBooks.ts';

/**
 * Lines priced outside the owner's book, added to the book so the next estimate finds them.
 *
 * Owner rule (2026-09-21): anything priced outside the book is added to it dynamically, on every
 * estimator, but it MUST be positive nothing is duplicated. So a line is added only when:
 * - it was priced by a planning or market allowance (never a book line, never a saved owner rate);
 * - its unit is a known unit with a positive direct cost;
 * - no book line and no line already learned resembles it: same unit dimension and sharing most of
 *   its meaningful words or trade concepts. A possible match is a reason NOT to add; a missed
 *   addition costs one more allowance next time, a duplicate would price the same work twice.
 * Learned lines carry code PB-L-<hash>, are direct cost like the book, and are listed for the owner
 * (GET /api/p5-estimator/learned-book) to fold into the master spreadsheet.
 */
export interface LearningContext {location:string;finish?:string|null}
export interface LearnedLine {code:string;description:string;unit:string;amount:number;type:PlanningRate['type'];service:string;source:string;learnedAt:string;uses:number;
  version?:2;status?:'provisional'|'review-required';location?:string;finish?:string;rule?:CostRule;
}
/** Old records remain exportable, but missing provenance is never upgraded to owner approval. */
export function learnedCostRules(lines:readonly LearnedLine[],service:string,context:LearningContext,now=new Date()):CostRule[]{
  return lines.flatMap(line=>{
    if(line.version!==2||line.status!=='provisional'||line.service!==service||line.finish!==finishTier(context.finish)
      ||line.location!==rateLocation(context.location)||!line.rule)return [];
    const rate=reusableUnitRate(line.rule,context.location,now);
    return rate?[{...rate,id:line.code}]:[];
  });
}
const name=(description:string)=>{const cut=description.indexOf(' (');return (cut>0?description.slice(0,cut):description).replace(/^[^:]{0,120}:\s*/,'').trim();};
const dimension=(unit:string)=>UNIT_REGISTRY[unitKey(unit)]?.dimension;
function overlap(a:Set<string|number>,b:Set<string|number>){if(!a.size||!b.size)return 0;let n=0;for(const x of a)if(b.has(x))n++;return n/Math.min(a.size,b.size);}
/** True when the candidate could be the same work as an existing line. Deliberately generous. */
export function resemblesExisting(candidate:{description:string;unit:string},existing:readonly {description:string;unit:string}[]):boolean{
  const n=name(candidate.description),w=meaningfulWords(n),c=conceptsOf(n),d=dimension(candidate.unit);
  return existing.some(line=>{
    if(dimension(line.unit)!==d)return false;
    const other=name(line.description);
    if(other.toLowerCase()===n.toLowerCase())return true;
    return overlap(w,meaningfulWords(other))>=0.6||(c.size>0&&overlap(c,conceptsOf(other))>=1&&overlap(w,meaningfulWords(other))>=0.34);
  });
}
const TYPE:Record<string,PlanningRate['type']>={materials:'Material','field-labor':'Labor',subcontractors:'Subcontractor','equipment-rentals':'Equipment'};
/** The out-of-book lines of a finished estimate that are safe to add. */
export function learnableLines(rules:readonly CostRule[],service:string,draftId:string,known:readonly {description:string;unit:string}[],now=new Date(),context:LearningContext={location:''}):LearnedLine[]{
  const book=PRICE_BOOK_RATEABLE.map(row=>({description:row[3],unit:row[4]}));
  const accepted:LearnedLine[]=[];
  for(const rule of rules){
    if(!/^(?:repair-)?(?:planning|market)-\d+$/.test(rule.id))continue;
    const unitCost=(rule as {unitCost?:number}).unitCost;
    if(!(typeof unitCost==='number'&&Number.isFinite(unitCost)&&unitCost>0)||!dimension(rule.unit)||dimension(rule.unit)==='lump')continue;
    const candidate={description:name(rule.description),unit:rule.unit};
    if(!candidate.description||candidate.description.length<4)continue;
    const location=rateLocation(context.location),finish=finishTier(context.finish);
    const reusable=reusableUnitRate(rule,context.location,now);
    const sameContext=(line:{description:string;unit:string})=>{
      const learned=line as Partial<LearnedLine>;
      return learned.version===2&&(learned.status==='review-required'&&!reusable||learned.status==='provisional'&&Boolean(learned.rule&&reusableUnitRate(learned.rule,context.location,now)))&&learned.location===location&&learned.finish===finish&&learned.service===service;
    };
    if(resemblesExisting(candidate,[...book,...known.filter(sameContext),...accepted]))continue;
    const hash=createHash('sha256').update(JSON.stringify([candidate.description.toLowerCase(),unitKey(rule.unit),service,location,finish,rule.unitRateContext||null])).digest('hex').slice(0,10);
    accepted.push({version:2,status:reusable?'provisional':'review-required',location,finish,rule:reusable||structuredClone(rule),code:`PB-L-${hash}`,description:candidate.description,unit:UNIT_REGISTRY[unitKey(rule.unit)].label,amount:Math.round(unitCost*100)/100,type:TYPE[String(rule.category)]||'Other',service,source:`Learned from estimate ${draftId} (${rule.id}); direct cost`,learnedAt:now.toISOString(),uses:1});
  }
  return accepted;
}
export async function readLearnedLines():Promise<LearnedLine[]>{
  try{return (await query("SELECT payload FROM p5_estimator_policy WHERE id LIKE 'book-learned:%' ORDER BY updated_at")).map(row=>row.payload as LearnedLine);}
  catch{return [];}
}
export async function saveLearnedLines(rules:readonly CostRule[],service:string,draftId:string,context:LearningContext={location:''},now=new Date()):Promise<number>{
  const known=await readLearnedLines();
  const lines=learnableLines(rules,service,draftId,known,now,context);
  for(const line of lines)await query("INSERT INTO p5_estimator_policy (id,version,payload,updated_by) VALUES ($1,1,$2,'learned-book') ON CONFLICT (id) DO UPDATE SET version=p5_estimator_policy.version+1,payload=EXCLUDED.payload||jsonb_build_object('priorVersions',COALESCE(p5_estimator_policy.payload->'priorVersions','[]'::jsonb)||jsonb_build_array(p5_estimator_policy.payload-'priorVersions')),updated_at=now(),updated_by='learned-book'",[`book-learned:${line.code}`,JSON.stringify(line)]);
  if(lines.length)console.log(`[p5-book] learned ${lines.length} new line(s) from draft ${draftId}: ${lines.map(l=>l.description).join('; ').slice(0,300)}`);
  return lines.length;
}
/** Provisional learned records are reused through learnedCostRules, preserving their evidence.
 * This compatibility export deliberately cannot promote them into the approved owner catalog. */
export function learnedRates(_lines:readonly LearnedLine[]):PlanningRate[]{return [];}
