import type {ScopeExtraction} from './scope.ts';
import type {ScopeField} from './scopeFields.ts';

const NUMERIC_COMPONENTS:Partial<Record<ScopeField,RegExp>>={
 fixtureCount:/\b(?:handles?|levers?)\b/i,
 cabinetBaseLf:/\b(?:base|lower)\s+cabinets?\b/i,
 cabinetUpperLf:/\b(?:upper|wall)\s+cabinets?\b/i,
 cabinetTallLf:/\b(?:tall|pantry)\s+cabinets?\b/i,
 garageSqft:/\bgarage\b/i,
 coveredOutdoorSqft:/\b(?:porch|covered outdoor)\b/i,
 countertopSqft:/\bcountertops?\b/i,
 flooringSqft:/\b(?:flooring|LVP)\b/i,
 tileSqft:/\b(?:tile|backsplash)\b/i,
 wallTileSqft:/\b(?:shower|wall)\s+(?:wall\s+)?tile\b/i,
 trimLf:/\b(?:baseboard|trim)\b/i,
};
const normalize=(value:string)=>value.toLowerCase().replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/g,word=>String(['one','two','three','four','five','six','seven','eight','nine','ten'].indexOf(word)+1)).replace(/\bby\b/g,'x').replace(/\s*x\s*/g,'x').replace(/\s+/g,' ').trim();
const revisionClauses=(text:string)=>text.split(/(?<=[.!?])\s+|\n|;/).flatMap(original=>{
 const normalized=normalize(original);
 const at=normalized.search(/\b(?:change|revise|update|correct)\b/);
 if(at<0||/\b(?:not|never|don't|do not)\s*$/.test(normalized.slice(0,at)))return [];
 const clause=normalized.slice(at);
 if(/\b(?:maybe|possibly|either)\b|\bto\s+(?:exactly\s+)?\d+\s+or\s+\d+/.test(clause))return [];
 return [{original,clause}];
});
/** Text fields can contain several unchanged components. Resolve only a
 * named, explicit edit whose new quantity is actually present in the retained
 * field. A fabricated quote or an explanation saying "superseded" is not enough. */
function textRevisionValues(extraction:ScopeExtraction,text:string):Map<ScopeField,{value:string;component:RegExp;other?:RegExp}>{
 const accepted=new Map<ScopeField,{value:string;component:RegExp;other?:RegExp}>();
 const kinds:{field:ScopeField;component:RegExp;unit:RegExp;quantity:(value:string)=>string[]}[]=[
  {field:'plumbing',component:/\bsewer\b/i,unit:/^(?:lf|linear feet)$/,quantity:value=>[...value.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:lf|linear feet)\s+sewer\b|\bsewer(?:\s+extension)?\s*(?:of|to|:)?\s*(\d+(?:\.\d+)?)\s*(?:lf|linear feet)\b/g)].map(m=>m[1]||m[2])},
  {field:'fixtures',component:/\b(?:levers?|handles?)\b/i,unit:/^$/,quantity:value=>[...value.matchAll(/\b(\d+)\s+(?:owner[- ]supplied\s+|matching\s+|passage\s+|interior\s+|door\s+)*(?:levers?|handles?)\b/g)].map(m=>m[1])},
  {field:'taskList',component:/\bdrywall\b/i,unit:/^(?:inches|inch|in)$/,quantity:value=>[...value.matchAll(/\b(\d+(?:\.\d+)?x\d+(?:\.\d+)?)\s*(?:inch|inches|in)\b/g)].map(m=>m[1])},
  {field:'otherDetails',component:/\bdrywall\b/i,unit:/^(?:inches|inch|in)$/,quantity:value=>[...value.matchAll(/\b(\d+(?:\.\d+)?\s*x\s*\d+(?:\.\d+)?)\s*(?:inch|inches|in)\b/g)].map(m=>m[1])},
 ];
 for(const {clause} of revisionClauses(text)){
  if(!/^\s*(?:please\s+)?(?:change|revise|update|correct)\b/.test(clause))continue;
  const claim=clause.match(/\bto\s+(?:exactly\s+)?(\d+(?:\.\d+)?(?:\s*x\s*\d+(?:\.\d+)?)?)\s*(lf|sf|linear feet|square feet|inches|inch|in)?\b/);
  if(!claim)continue;
  for(const kind of kinds){
   if(!kind.component.test(clause)||!kind.unit.test(claim[2]||''))continue;
   const facts=extraction.facts.filter(f=>f.field===kind.field&&f.basis==='stated'&&f.confidence>=.85&&kind.component.test(f.value));
   const valid=facts.filter(f=>{const values=[...new Set(kind.quantity(normalize(f.value)))];return values.length===1&&values[0]===claim[1];});
   if(valid.length===1)accepted.set(kind.field,{value:valid[0].value,component:kind.component,...(kind.field==='plumbing'?{other:/\b(?:water|gas|faucet|toilet|sink|shower)\b/i}:kind.field==='fixtures'?{other:/\b(?:faucet|toilet|sink|shower)\b/i}:{})});
  }
  if(/\b(?:LVP|flooring)\b/i.test(clause)&&/^(?:sf|square feet)$/.test(claim[2]||'')){
   for(const field of ['taskList','demolition'] as ScopeField[]){
    const valid=extraction.facts.filter(f=>f.field===field&&f.basis==='stated'&&f.confidence>=.85&&/\b(?:LVP|flooring)\b/i.test(f.value)&&new RegExp('\\b'+claim[1]+'\\s*(?:SF|square feet)\\b','i').test(f.value));
    if(valid.length===1)accepted.set(field,{value:valid[0].value,component:/\b(?:LVP|flooring|retained floor)\b/i,other:/\b(?:tile|doors?|cabinets?|fixtures?|walls?)\b/i});
   }
  }
  // Wall height and perimeter can share the detail field with unchanged paint
  // areas. An explicit perimeter in the tile revision resolves that detail only.
  if(/\bshower\s+wall\s+tile\b/.test(clause)){
   const perimeter=clause.match(/\b(\d+(?:\.\d+)?)\s*lf\s+(?:tiled\s+)?wall perimeter\b/);
   if(perimeter){
    const valid=extraction.facts.filter(f=>f.field==='otherDetails'&&f.basis==='stated'&&f.confidence>=.85&&new RegExp('\\b'+perimeter[1]+'\\s*lf\\s+(?:tiled\\s+)?(?:wall\\s+)?perimeter\\b').test(normalize(f.value)));
    if(valid.length===1)accepted.set('otherDetails',{value:valid[0].value,component:/\b(?:perimeter|shower wall)\b/i,other:/\bpaint\b/i});
   }
  }
 }
 return accepted;
}

/** A verbatim, explicit customer revision resolves that one quantity. Merely
 * mentioning a different number, or a model calling a source "typed", does
 * not establish precedence. Original document takeoffs remain as provenance. */
export function applyExplicitTypedCorrections(extraction:ScopeExtraction,text:string):ScopeExtraction{
 const textAccepted=textRevisionValues(extraction,text);
 const directFacts:ScopeExtraction['facts']=[];
 for(const {original,clause} of revisionClauses(text)){
  const claim=clause.match(/\bto\s+(?:exactly\s+)?(\d+(?:\.\d+)?)\s*(LF|SF|linear feet|square feet|handles?|levers?)?\b/i);
  if(!claim)continue;
  for(const [field,component] of Object.entries(NUMERIC_COMPONENTS) as [ScopeField,RegExp][]){
   if(!component.test(clause))continue;
   const unit=claim[2]||'';
   const validUnit=(field==='fixtureCount'?/^(?:handles?|levers?)?$/i:/Lf$/.test(field)?/^(LF|linear feet)$/i:/^(SF|square feet)$/i).test(unit);
   if(!validUnit)continue;
   // Derive an omitted correction from the customer's own words, but keep an
   // inconsistent extracted typed value visible for review instead of hiding it.
   if(extraction.facts.some(f=>f.field===field&&/typed|submitted\s*scope/i.test(f.source)))continue;
   // A wall-tile revision must not replace the legacy combined tile total.
   if(field==='tileSqft'&&NUMERIC_COMPONENTS.wallTileSqft!.test(clause))continue;
   directFacts.push({field,value:claim[1],basis:'stated',confidence:1,source:'typed scope',evidence:original.trim()});
  }
 }
 if(directFacts.length)extraction={...extraction,facts:[...extraction.facts,...directFacts]};
 const accepted=new Map<ScopeField,string>();
 for(const fact of [...extraction.facts].sort((a,b)=>text.lastIndexOf(a.evidence)-text.lastIndexOf(b.evidence))){
  const component=NUMERIC_COMPONENTS[fact.field];
  if(!component||fact.basis!=='stated'||fact.confidence<.85||!/typed|submitted\s*scope/i.test(fact.source))continue;
  const clauses=revisionClauses(text).map(({clause})=>clause);
  const value=Number(fact.value);if(!Number.isFinite(value)||value<0)continue;
  const matches=clauses.filter(clause=>component.test(clause)&&/\b(?:change|revise|update|correct)\b/i.test(clause));
  const valid=matches.some(clause=>{
   const numbers=[...clause.matchAll(/\bto\s+(?:exactly\s+)?(\d+(?:\.\d+)?)\s*(LF|SF|linear feet|square feet|handles?|levers?)?\b/gi)];
   return numbers.length===1&&Number(numbers[0][1])===value&&(fact.field==='fixtureCount'?/^(?:handles?|levers?)?$/i:/Lf$/.test(fact.field)?/^(LF|linear feet)$/i:/^(SF|square feet)$/i).test(numbers[0][2]||'');
  });
  if(valid)accepted.set(fact.field,fact.value);
 }
 const excludedBacksplash=/\bexclude\s+(?:all\s+)?backsplash\b/i.test(text)&&/\b(?:demolition|supply|installation)\b/i.test(text)
  &&extraction.instructions?.exclusions.some(note=>/\bbacksplash\b/i.test(note));
 if(!accepted.size&&!textAccepted.size&&!excludedBacksplash)return extraction;
 return {...extraction,facts:extraction.facts.filter(fact=>{
   if(accepted.has(fact.field))return fact.value===accepted.get(fact.field);
   const revision=textAccepted.get(fact.field);
   return !revision||!revision.component.test(fact.value)||fact.value===revision.value;
  }),conflicts:extraction.conflicts.filter(conflict=>{
   if(accepted.has(conflict.field))return false;
   const revision=textAccepted.get(conflict.field);
   const focus=revision?.component.test(conflict.explanation)?conflict.explanation:[conflict.explanation,...conflict.values].join(' ');
   if(revision&&revision.component.test(focus)&&!revision.other?.test(focus))return false;
   return !(excludedBacksplash&&['tileSqft','demolition'].includes(conflict.field)&&/\bbacksplash\b/i.test(conflict.explanation)&&/exclud|retain|supersed|updat/i.test(conflict.explanation));
  })};
}
