import type {CostRule,EstimatorConfiguration,ScopePriceResolution} from './costBook.ts';
import type {ReviewedScope,ScopeExtraction} from './scope.ts';
import {PRICE_BOOK} from './priceBookData.ts';
import {finishTier,priceBookRate,serviceContext} from './priceBook.ts';
import {suggestedTrade} from './trades.ts';

/**
 * Deterministic corrections to a priced scope, applied after the model's mapping and audit and
 * before the integrity checks. Each one repairs a defect that was observed live and that the
 * model stages did not catch on their own; each is disclosed as an item to confirm so the
 * customer and the estimator can see exactly what the code changed.
 *
 * 1. A complete assembly (Project Assemblies, division 90) is priced once. Live Construction ADU
 *    (2026-09-25): "ADU, new detached (600 SF)" was charged six times, once per component task
 *    (foundation, framing, HVAC, finishes, debris), with a complete kitchen assembly on top, for
 *    $1.5M on a 600 SF unit. A whole-unit assembly also covers its own components; only the work
 *    outside the unit (site, utilities, permits, fees, design) stays separate.
 * 2. Building labels the pricing step invented are dropped when the customer described one
 *    building. Live Remodeling (2026-09-25): "Boise home" and "Main home" became two building
 *    totals for two showers in one house.
 * 3. Debris haul-off is not charged twice. When every removal line already includes haul-off and
 *    dump fees, a separate junk-removal or dumpster line for the same debris is removed.
 * 4. Reconnecting to existing plumbing is reconnection labor, not a rough-in-plus-finish package
 *    per fixture. Live Remodeling (2026-09-25): "reconnect the existing plumbing" priced at
 *    $3,148 per shower as rough + finish.
 * 5. Protection and cleanup added as supporting work are scaled to the job. Live P5 and Cabinet
 *    (2026-09-25): a one-room flooring job and a 20 LF cabinet install each drew the whole-house
 *    "Dust / floor protection" package at about half the price of the requested work itself.
 */
export interface CorrectionLine {id:string;description:string;category:string;unit:string;quantity:number;unitCost:number;building?:string;floor?:string}
export interface CorrectionTask {id:string;description:string;origin?:string;basis?:string}
export interface CorrectionMappedTask {id:string;description:string;existingLineIds:string[]}
export interface CorrectionInput {
  scope:ReviewedScope;
  inventoryTasks:CorrectionTask[];
  mappingTasks:CorrectionMappedTask[];
  lines:CorrectionLine[];
  resolution:ScopePriceResolution;
  pricingExtraction?:ScopeExtraction|null;
  configuration:EstimatorConfiguration;
  now:Date;
}
export interface CorrectionResult {coveredTaskIds:string[];notes:string[]}

const ASSEMBLY_MARKER='complete assembly, do not add its component lines';
const WHOLE_UNIT_SECTIONS=/Whole-House New Build|Additions & ADUs|Whole-House & Conversions/;
const WHOLE_UNIT_ITEMS=/new home construction|\bADU\b|addition|suite|second-story|whole-home renovation|garage conversion|attic conversion|basement finishing|detached garage/i;
/** Work a whole-unit assembly does not include, by the book's own division and section names. */
const OUTSIDE_WHOLE_UNIT=/Pre-Construction & Fees|Permits|Impact Fee|Design & Engineering|Survey|Earthwork|Excavation|Grading|Site (?:Work|Prep|Clearing|Utilities|Improvements)|Utilit|Sewer|Septic|Well\b|Water (?:service|line|meter|lateral)|Service (?:extension|lateral)|Trench|Landscap|Exterior Improvements|Driveway|Sidewalk|Fenc|Existing Conditions|Demolition|Tree|Land\b|Temporary Facilities|Cleaning & Waste|Dumpster/i;
/** Task wording for work a whole-unit assembly includes, and for work that stays outside it. */
const COMPONENT_TASK=/\b(?:foundation|slab|footings?|fram(?:e|ing)|roof(?:ing)?|envelope|siding|cladding|insulat\w*|air[- ]seal\w*|drywall|paint\w*|floor(?:ing)?|finish(?:es)?|trim|casing|cabinet\w*|kitchen|bath(?:room)?|plumbing|electrical system|wiring|hvac|mini-?split|heating|cooling|ventilat\w*|windows?|doors?|life-safety|smoke|carbon|egress|clean(?:up|ing)?|protect\w*|debris|haul)\b/i;
const OUTSIDE_TASK=/\b(?:site (?:prep\w*|work|clearing|grading|layout)|excavat\w*|grad(?:e|ing) the|utilit(?:y|ies)|sewer|septic|well\b|water (?:line|service|main|lateral)|(?:electrical|power) service|trench\w*|permits?|fees?|impact|design|engineer\w*|architect\w*|survey\w*|land\b|lot\b|driveway|sidewalk|landscap\w*|fenc\w*|tree)\b/i;
const HAUL_OFF_INCLUDED=/removal labor with haul-off and dump fees/i;
const DEMOLITION_LIKE=/\b(?:demo(?:lition)?|removal|remove|tear-?(?:out|off))\b/i;
const DEBRIS_TASK=/\b(?:debris|haul|junk|dumpster|dispos\w*|waste)\b/i;
const DEBRIS_LINE=/\b(?:junk|dumpster|debris|disposal|landfill|haul|waste)\b/i;
const RECONNECT=/\b(?:re-?connect(?:ion|ing|ed)?|hook(?:ing|ed)?\s+(?:back\s+)?up|tie(?:d|ing)?\s+(?:back\s+)?in(?:to)?)\b[^.]{0,80}\bexisting\b|\bexisting\b[^.]{0,60}\b(?:re-?connect(?:ion|ing|ed)?|hook(?:ing|ed)?\s+(?:back\s+)?up|tie(?:d|ing)?\s+(?:back\s+)?in(?:to)?)\b/i;
const RELOCATE=/\brelocat\w*|\bmov(?:e|ing)\s+(?:the\s+|a\s+)?(?:drain|plumbing|supply|toilet|sink|shower|tub|fixture)|\bnew\s+(?:drain|supply|plumbing)\s+(?:location|run|line)|\brough-?in\b|\badd(?:ing)?\s+(?:a\s+|an\s+|new\s+)?(?:bathroom|fixture|shower|sink|toilet)/i;
const ROUGH_AND_FINISH=/^(?:Plumbing per fixture, rough \+ finish|Rough-in only, per fixture)\b/;
const PROTECT_OR_CLEAN=/\bprotect\w*|\bdust\b|\bmask(?:ing)?\b|\bclean(?:ing|up|-up)?\b|\bbroom\b|\bfloor protection\b/i;
const SUPPORTING_SHARE=0.15;

const hasMarker=(d:string)=>d.includes(ASSEMBLY_MARKER);
/** Where a book line's own text begins inside "task description: item (what it includes; section, division)". */
const BOOK_INCLUDES=/\((?:installed price|labor with consumables|operator labor|removal labor|labor only;|material only;|rental or service|fee or professional|trip, call)/;
/** The book line a rule resolved to: its text after the task description. */
function ratePart(description:string):string{
  const marker=BOOK_INCLUDES.exec(description)?.index??-1;
  const start=description.lastIndexOf(': ',marker<0?description.length:marker);
  return start<0?description:description.slice(start+2);
}
const itemOf=(description:string)=>{const rate=ratePart(description);const at=rate.indexOf(' (');return (at<0?rate:rate.slice(0,at)).trim();};
const sectionOf=(description:string)=>{const m=/; ([^;()]+), ([^;()]+)\)\.?/.exec(ratePart(description));return m?{section:m[1].trim(),division:m[2].trim()}:{section:'',division:''};};
const money=(n:number)=>`$${Math.round(n).toLocaleString('en-US')}`;
const direct=(rule:CostRule)=>(rule.unitCost||0)*(rule.quantity.fixed||0);
const sameBuilding=(a?:string,b?:string)=>!a||!b||a.trim().toLowerCase()===b.trim().toLowerCase();
const placeholderBuilding=(b?:string)=>!b||/^(unspecified(?: building)?|unknown|not specified|n\/a|none|same|whole project)$/i.test(b.trim());

export function applyPricingCorrections(input:CorrectionInput):CorrectionResult{
  const {resolution,mappingTasks,inventoryTasks,lines,pricingExtraction,scope}=input;
  const notes:string[]=[];const covered=new Set<string>();
  const removed=new Set(resolution.removeLineIds||[]);
  const originOf=new Map(inventoryTasks.map(t=>[t.id,t.origin||'requested']));
  const taskDescription=(id:string)=>mappingTasks.find(t=>t.id===id)?.description||inventoryTasks.find(t=>t.id===id)?.description||id;
  const cover=(taskId:string|undefined,byLineId:string)=>{
    if(!taskId)return;
    const task=mappingTasks.find(t=>t.id===taskId);
    if(task&&!task.existingLineIds.includes(byLineId))task.existingLineIds.push(byLineId);
    covered.add(taskId);
  };
  const dropRule=(rule:CostRule)=>{resolution.rules=resolution.rules.filter(r=>r!==rule);};

  // 1. One complete assembly, priced once; a whole unit covers its own components.
  const assemblies=resolution.rules.filter(rule=>hasMarker(rule.description));
  const groups=new Map<string,CostRule[]>();
  for(const rule of assemblies){const key=`${itemOf(rule.description).toLowerCase()}|${placeholderBuilding(rule.building)?'':rule.building!.trim().toLowerCase()}`;const g=groups.get(key);if(g)g.push(rule);else groups.set(key,[rule]);}
  const kept:CostRule[]=[];
  for(const group of groups.values()){
    const order=(rule:CostRule)=>(originOf.get(rule.scopeTaskId||'')==='requested'?0:1)*10000+resolution.rules.indexOf(rule);
    const keep=[...group].sort((a,b)=>order(a)-order(b))[0];kept.push(keep);
    const extra=group.filter(rule=>rule!==keep);
    if(!extra.length)continue;
    for(const rule of extra){dropRule(rule);cover(rule.scopeTaskId,keep.id);}
    notes.push(`To confirm: the ${itemOf(keep.description)} assembly is priced once for the whole project; ${extra.length} other ${extra.length===1?'task referenced it and is':'tasks referenced it and are'} covered by that one price (${[...new Set(extra.map(r=>taskDescription(r.scopeTaskId||'')))].join('; ').slice(0,300)}).`);
  }
  for(const assembly of kept){
    const {section}=sectionOf(assembly.description);
    if(!WHOLE_UNIT_SECTIONS.test(section)||!WHOLE_UNIT_ITEMS.test(itemOf(assembly.description)))continue;
    const components=resolution.rules.filter(rule=>rule!==assembly&&!hasMarker(rule.description)&&sameBuilding(rule.building,assembly.building)&&!OUTSIDE_WHOLE_UNIT.test(ratePart(rule.description)));
    const roomAssemblies=resolution.rules.filter(rule=>rule!==assembly&&hasMarker(rule.description)&&sameBuilding(rule.building,assembly.building)&&!WHOLE_UNIT_SECTIONS.test(sectionOf(rule.description).section));
    const drop=[...components,...roomAssemblies];
    const total=drop.reduce((n,rule)=>n+direct(rule),0);
    for(const rule of drop){dropRule(rule);cover(rule.scopeTaskId,assembly.id);}
    // A component task the mapping left unpriced (roofing, insulation, the envelope) is inside the
    // unit's price too; otherwise it would be carried out of the total as "not priced" and the
    // finished unit shown as a partial estimate.
    const unpricedComponents=mappingTasks.filter(task=>task.id!==assembly.scopeTaskId&&!covered.has(task.id)
      &&!resolution.rules.some(rule=>rule.scopeTaskId===task.id)&&!task.existingLineIds.some(id=>lines.some(line=>line.id===id&&!removed.has(line.id)))
      &&COMPONENT_TASK.test(task.description)&&!OUTSIDE_TASK.test(task.description));
    for(const task of unpricedComponents)cover(task.id,assembly.id);
    if(!drop.length&&!unpricedComponents.length)continue;
    notes.push(`To confirm: the ${itemOf(assembly.description)} price is a complete assembly that already includes its structure, envelope, systems, finishes and cleanup${drop.length?`, so ${drop.length} component ${drop.length===1?'line':'lines'} (${money(total)} direct) ${drop.length===1?'was':'were'} removed so nothing is charged twice`:''}${unpricedComponents.length?`; ${unpricedComponents.length} component ${unpricedComponents.length===1?'item is':'items are'} covered by it rather than priced separately`:''}. Site work, utility connections, permits, fees and design stay separate.`);
  }

  // 2. One building described means one building priced.
  const instructions=pricingExtraction?.instructions;
  const named=new Set<string>([...(instructions?.buildings||[]),...(pricingExtraction?.takeoffs||[]).map(t=>t.building||'')].filter(b=>!placeholderBuilding(b)).map(b=>b.trim().toLowerCase()));
  if(!instructions?.separateBuildings&&named.size<2){
    const labelled=resolution.rules.filter(rule=>!placeholderBuilding(rule.building));
    const distinct=new Set(labelled.map(rule=>rule.building!.trim().toLowerCase()));
    if(distinct.size>1||distinct.size===1&&lines.some(line=>!placeholderBuilding(line.building)&&!distinct.has(line.building!.trim().toLowerCase()))){
      for(const rule of labelled)rule.building=undefined;
      notes.push(`To confirm: priced as one building; the building labels the pricing step added (${[...distinct].join(', ')}) were removed because the project describes one building.`);
    }
  }

  // 3. Haul-off that the removal lines already include is not charged again.
  const activeLines=lines.filter(line=>!removed.has(line.id));
  const removalLines=[...activeLines.map(l=>({id:l.id,description:l.description})),...resolution.rules.map(r=>({id:r.id,description:r.description}))].filter(l=>HAUL_OFF_INCLUDED.test(l.description)&&!DEBRIS_LINE.test(itemOf(l.description)));
  const demolitionLines=[...activeLines.map(l=>l.description),...resolution.rules.map(r=>r.description)].filter(d=>DEMOLITION_LIKE.test(ratePart(d))&&!DEBRIS_LINE.test(itemOf(d)));
  if(removalLines.length&&demolitionLines.every(d=>HAUL_OFF_INCLUDED.test(d))){
    // A debris task names debris, junk, waste or a dumpster; a bare "haul" or "dispose" counts only when the
    // task is not itself the removal ("remove the showers and haul them away" is the removal, priced above).
    const debrisTasks=inventoryTasks.filter(t=>(t.origin||'requested')==='required'&&(/\b(?:debris|junk|dumpster|waste)\b/i.test(t.description)||DEBRIS_TASK.test(t.description)&&!/\b(?:demolish|demolition|remove|removal|tear)\b/i.test(t.description)));
    const dropped:CostRule[]=[];
    for(const task of debrisTasks)for(const rule of resolution.rules.filter(r=>r.scopeTaskId===task.id&&DEBRIS_LINE.test(itemOf(r.description)))){dropped.push(rule);dropRule(rule);cover(task.id,removalLines[0].id);}
    if(dropped.length)notes.push(`To confirm: debris haul-off and dump fees are already included in the removal ${removalLines.length===1?'line':'lines'}, so the separate debris allowance (${money(dropped.reduce((n,r)=>n+direct(r),0))} direct) was removed and disposal is not charged twice.`);
  }

  // 4. Reconnecting existing plumbing is reconnection labor, not a rough-in package.
  const plumbingText=[scope.text,scope.answers.plumbing,scope.answers.taskList,scope.answers.installation,...(instructions?.inclusions||[])].filter(Boolean).join('\n');
  if(RECONNECT.test(plumbingText)&&!RELOCATE.test(plumbingText)){
    const row=PRICE_BOOK.find(r=>r[0]==='22-01-01');
    const packages=resolution.rules.filter(rule=>ROUGH_AND_FINISH.test(itemOf(rule.description)));
    if(row&&packages.length){
      const rate=priceBookRate(row,finishTier(scope.answers.finish),serviceContext(scope.answers.service).remodel);
      let hours=0;
      for(const rule of packages){
        const fixtures=Math.max(1,Math.round(rule.quantity.fixed||1));
        const index=resolution.rules.indexOf(rule);
        const replacement:CostRule={scopeTaskId:rule.scopeTaskId,id:`${rule.id}-reconnect`,description:`${rule.description.slice(0,Math.max(0,rule.description.lastIndexOf(': ')))||taskDescription(rule.scopeTaskId||'')}: ${rate.description}`,trade:suggestedTrade(rate.description),unit:'hour',quantity:{fixed:fixtures*2,factor:1},unitCost:rate.amount,allowance:true,quantityRange:{low:fixtures*1.5,high:fixtures*3},building:rule.building,floor:rule.floor,category:'field-labor',priceBasis:'direct-cost',estimatingBasis:rate.basis,evidence:{basis:'owner-estimating-schedule',reference:`${rate.source}; ${rate.code}; ALLOWANCE: about 2 hours of licensed plumber time per fixture to reconnect ${fixtures} fixture${fixtures===1?'':'s'} to existing supply and drain locations`,verifiedAt:input.now.toISOString(),validUntil:new Date(input.now.getTime()+92*86400000).toISOString()}};
        resolution.rules.splice(index,1,replacement);
        for(const task of mappingTasks)if(task.existingLineIds.includes(rule.id))task.existingLineIds=task.existingLineIds.map(id=>id===rule.id?replacement.id:id);
        hours+=fixtures*2;
      }
      notes.push(`To confirm: the request keeps the existing plumbing locations, so reconnection is priced as about ${hours} hours of licensed plumber time (an allowance) instead of a rough-in-plus-finish package per fixture. New or relocated plumbing would change this.`);
    }
  }

  // 5. Supporting protection and cleanup are scaled to the work they support.
  const supportingTasks=inventoryTasks.filter(t=>(t.origin||'requested')==='required'&&PROTECT_OR_CLEAN.test(t.description)&&!/\b(?:demoli\w*|remov\w*|haul\w*|debris|disposal)\b/i.test(t.description));
  if(supportingTasks.length){
    const supportingIds=new Set(supportingTasks.map(t=>t.id));
    const coreRules=resolution.rules.filter(rule=>!supportingIds.has(rule.scopeTaskId||''));
    const coreLines=lines.filter(line=>!removed.has(line.id)&&!supportingTasks.some(t=>mappingTasks.find(m=>m.id===t.id)?.existingLineIds.includes(line.id)));
    const core=coreRules.reduce((n,rule)=>n+direct(rule),0)+coreLines.reduce((n,line)=>n+line.unitCost*line.quantity,0);
    const cap=core*SUPPORTING_SHARE;
    if(cap>0)for(const task of supportingTasks){
      const rules=resolution.rules.filter(rule=>rule.scopeTaskId===task.id&&direct(rule)>0);
      const total=rules.reduce((n,rule)=>n+direct(rule),0);
      if(total<=cap)continue;
      const factor=cap/total;
      for(const rule of rules){
        rule.unitCost=Math.round(rule.unitCost*factor*100)/100;
        if(rule.unitCostRange)rule.unitCostRange={low:Math.round(rule.unitCostRange.low*factor*100)/100,high:Math.round(rule.unitCostRange.high*factor*100)/100};
        rule.allowance=true;
      }
      notes.push(`To confirm: ${task.description.replace(/[.\s]+$/,'')} is carried as an allowance of about ${Math.round(SUPPORTING_SHARE*100)}% of the priced work (${money(cap)} direct instead of ${money(total)}), because the catalog package it matched is sized for a whole house; confirm on site.`);
    }
  }

  resolution.assumptions.push(...notes);
  return {coveredTaskIds:[...covered],notes};
}
