import type {ScopeAnswers,ScopeExtraction,ScopeConflict} from './scope.ts';

/** Conservative interpretation of authored text, not an alternative document reader.
 * It never invents prices, dimensions, file findings or service eligibility. */
export interface IntakeIntent {service?: string; clarification?: string; evidence: string; area?: string; land?: string}
const HOME=/\b(?:home|house|farm\s?house|town\s?house|townhome|residence|dwelling|barndominium)\b/;
const PART=/\b(?:driveways?|fences?|decks?|patios?|cabinets?|sheds?|garages?|basement|addition|wing|room|doors?|windows?|kitchens?|bathrooms?|baseboards?|trim|flooring|counters?|countertops?|roof|siding|plumbing|painting)\b/;
function normalize(text:string){return text.normalize('NFKC').toLowerCase().replace(/[’‘]/g,"'").replace(/\b(?:bild|bulid|biuld|buid)\b/g,'build').replace(/\bhosue\b/g,'house').replace(/\b(?:remodle|remodell|remodelingg)\b/g,'remodel').replace(/\b(?:additon|addtion)\b/g,'addition').replace(/\b(?:kitchn|kithcen)\b/g,'kitchen').replace(/\b(?:cabnets|cabients)\b/g,'cabinets').replace(/\b(sq|ft)\./g,'$1').replace(/square[- ](?:foot|feet)/g,'sqft');}
function currentClauses(text:string){
 return normalize(text).split(/[;\n.!?]|,(?!\d)|\bbut\b/).map(clause=>clause
  .replace(/\b(?:feel|look)\s+(?:just\s+)?like\b.*$/,'')
  .replace(/\b(?:not|no|without|exclude\w*|don't|do not|aren't|isn't)\b.*?(?=\b(?:only|just|instead)\b|$)/g,' '))
  .map(x=>x.trim()).filter(x=>x&&!/\b(?:maybe|possibly|next year|in the future|someday|eventually)\b/.test(x)&&!/^\s*(?:my |our )?(?:friend|neighbor|neighbour)\b/.test(x));
}
function classify(text:string):IntakeIntent {
 const clauses=currentClauses(text),positive=clauses.join('; '),evidence=text;
 const cabinet=/\bcabinets?|built[- ]ins?\b/.test(positive)||/\bboxes\b.*\b(?:doors|fronts)\b/.test(positive);
 const cabinetOnly=/\b(?:only|just|limited to)\b[^;]{0,70}\b(?:cabinets?|built[- ]ins?)\b|\bcabinet[s]?[- ]only\b/.test(positive);
 const newHome=clauses.some(clause=>{
  for(const match of clause.matchAll(/\b(?:build(?:ing)?|construct(?:ing)?|erect(?:ing)?)\s+([^;]{0,110}?)(home|house|farm\s?house|town\s?house|townhome|residence|dwelling|barndominium)\b/g)){
   if(!PART.test(match[1])&&!/\b(?:friend|neighbor|used to|previously|last year)\b/.test(clause.slice(0,match.index)))return true;
  }
  return /\b(?:new|custom|ground[- ]up)\s+(?:(?:modern|single[- ]family|detached)\s+)*(?:home|house|farm\s?house|residence|dwelling)\b|\bnew residential construction\b/.test(clause)&&!PART.test(clause.split(/\b(?:new|custom)\b/)[0]);
 });
 const addition=/\b(?:addition|bedroom wing|add (?:a |an )?(?:\d[\d,]*[- ]?(?:sqft|sf)\s+)?(?:bedroom|room|wing|second story|second storey)|extend (?:my |our |the )?(?:house|home))\b/.test(positive);
 const adu=/\b(?:adu|accessory dwelling)\b/.test(positive);
 const renovation=/\b(?:remodel\w*|renovat\w*|gut\w*|open\s+(?:the |my |our )?kitchen|move\s+(?:the |my |our |a )?sink|new layout|finish(?:ing)?\s+(?:my |our |the )?basement|build out\s+(?:my |our |the )?basement)\b/.test(positive);
 const kitchen=/\bkitchen\b/.test(positive)||(cabinet&&/\bcounter(?:s|tops?)\b/.test(positive)&&/\b(?:move|relocat\w*)\b.*\bsink\b/.test(positive)),bath=/\bbath(?:room)?\b/.test(positive);
 const repair=/\b(?:repair\w*|fix\w*|patch\w*|touch[- ]up|sagging|broken|sticking|drywall holes?|doorknob|door handle|leak\w*)\b/.test(positive);
 const install=/\binstall\w*\b/.test(positive),supplyOnly=/\bsupply[- ]only\b|\b(?:contractor|someone else)\s+installs?\b|\b(?:do not|don't|no|without)\s+install\w*\b/.test(normalize(text));
 const refacing=cabinet&&/\b(?:refac\w*|keep\s+(?:the )?boxes|replace\s+(?:the )?(?:doors|fronts))\b/.test(positive);
 const options=[newHome&&!cabinetOnly&&'new-construction',addition&&'addition',adu&&'adu',renovation&&!cabinetOnly&&'remodel'].filter(Boolean);
 if(/\b(?:or|whether|versus|vs)\b/.test(positive)&&options.length>1)return {evidence,clarification:'Are you planning a separate new home, adding to the existing home, or renovating it?'};
 if(cabinetOnly){
  if(supplyOnly)return {service:'cabinet-product',evidence};
  if(install||refacing)return {service:'cabinet-install',evidence};
  return {evidence,clarification:'Do you need cabinets supplied, installed, or your existing cabinets updated?'};
 }
 // Whole-project intent outranks the trades included in it.
 let service:string|undefined;
 if(newHome&&!renovation)service='new-construction';
 else if(newHome&&renovation)return {evidence,clarification:'Is the requested work a new home, work on the existing home, or both?'};
 else if(adu)service='adu';
 else if(addition)service='addition';
 else if(renovation)service=kitchen&&!bath?'kitchen':bath&&!kitchen?'bathroom':HOME.test(positive)?'whole-home':'remodel';
 else if(cabinet&&/\bcounter(?:s|tops?)\b/.test(positive)&&/\b(?:move|relocat\w*)\b.*\bsink\b/.test(positive))service='kitchen';
 else if(refacing)service='cabinet-install';
 else if(cabinet&&supplyOnly)service='cabinet-product';
 else if(cabinet&&install)service='cabinet-install';
 else if(repair)service='handyman';
 else if(cabinet)return {evidence,clarification:'Do you need cabinets supplied, installed, or your existing cabinets updated?'};
 if(!service)return {evidence,clarification:HOME.test(positive)?'Are you building a separate new home, adding space, or changing the home you already have?':'What would you like us to build, change, or repair?'};
 const result:IntakeIntent={service,evidence};
 if(['new-construction','addition','adu'].includes(service)){
  const areas=[...normalize(text).matchAll(/\b(\d[\d,]*(?:\.\d+)?)\s*(?:sqft|sq\s*ft|square feet|ft2|sf)\b/g)].map(m=>m[1].replaceAll(',',''));
  if(new Set(areas).size===1&&Number(areas[0])>0&&Number(areas[0])<=1000000&&!/\b(?:garage|under[- ]roof|combined|total including)\b/.test(positive))result.area=areas[0];
  const land=text.split(/[;\n]|(?<=[.!?])\s+(?=[A-Z])/).filter(clause=>/\b(?:land|lot)\b/i.test(clause));
  if(land.length)result.land=land.at(-1)!.trim();
 }
 return result;
}
export function interpretIntakeIntent(text:string):IntakeIntent {
 // A clear later correction controls; an amount-only correction keeps the project context.
 const markers=[...text.matchAll(/\b(?:actually|instead|correction|i meant)\b\s*[:,]?/gi)];
 if(markers.length){
  const marker=markers.at(-1)!,tail=text.slice(marker.index!+marker[0].length),current=classify(tail);
  if(current.service)return current;
  const combined=classify(text);
  const amount=normalize(tail).match(/^\s*(?:it's\s+|it is\s+|make (?:it|that)\s+)?(\d[\d,]*)\s*(?:(?:sqft|sf|ft2)\s*)?(?=,|and\b|$)/);
  const prior=classify(text.slice(0,marker.index));
  if(amount&&prior.area&&['new-construction','addition','adu'].includes(combined.service||''))combined.area=amount[1].replaceAll(',','');
  return combined;
 }
 return classify(text);
}
export function applyIntakeIntent(text:string,answers:ScopeAnswers,extraction:ScopeExtraction|null,resolutions:ScopeAnswers={}):{answers:ScopeAnswers;extraction:ScopeExtraction|null;clearServiceResolution?:boolean}{
 // These choices describe an inspection, urgency or an existing contract, not a competing trade.
 // Preserve them; their separate evidence and eligibility guards remain authoritative.
 if(['re10','rush','change-order'].includes(answers.service||''))return {answers,extraction};
 const intent=interpretIntakeIntent([text,answers.workContext,answers.taskList].filter(Boolean).join('\n'));
 const conflicts:ScopeConflict[]=[...(extraction?.conflicts||[])];
 const existingServiceConflict=conflicts.some(c=>c.field==='service');
 if(existingServiceConflict)return {answers,extraction};
 if(!intent.service)return {answers,extraction};
 const sameFamily=(a:string,b:string)=>['kitchen','bathroom','remodel','whole-home'].includes(a)&&['remodel','whole-home'].includes(b);
 if(answers.service&&answers.service!==intent.service&&!sameFamily(answers.service,intent.service)){
  const conflict={field:'service' as const,values:[answers.service,intent.service],explanation:'Your selected project type and current description describe different work. Which is the main project?'};
  return {answers,extraction:{...(extraction||{summary:'',facts:[],missingInformation:[],reviewNotes:[]}),conflicts:[...conflicts,conflict]},clearServiceResolution:true};
 }
 if(!answers.service&&Object.hasOwn(resolutions,'service'))return {answers,extraction};
 const next={...answers};
 const facts:ScopeExtraction['facts']=[];
 if(!answers.service){next.service=intent.service;facts.push({field:'service',value:intent.service,confidence:1,basis:'stated',source:'typed scope',evidence:intent.evidence.slice(0,4000)});}
 if(intent.area&&!answers.sqft&&!Object.hasOwn(resolutions,'sqft')){next.sqft=intent.area;facts.push({field:'sqft',value:intent.area,confidence:1,basis:'stated',source:'typed scope',evidence:intent.evidence.slice(0,4000)});}
 if(intent.land&&!answers.workContext&&!Object.hasOwn(resolutions,'workContext')){next.workContext=intent.land;facts.push({field:'workContext',value:intent.land,confidence:1,basis:'stated',source:'typed scope',evidence:intent.land});}
 if(!facts.length)return {answers,extraction};
 return {answers:next,extraction:{...(extraction||{summary:'',facts:[],conflicts:[],missingInformation:[],reviewNotes:[]}),facts:[...(extraction?.facts||[]).filter(f=>!facts.some(n=>n.field===f.field)),...facts]}};
}
