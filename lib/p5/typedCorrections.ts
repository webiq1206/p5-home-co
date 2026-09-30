import type {ScopeExtraction} from './scope.ts';
import type {ScopeField} from './scopeFields.ts';

const NUMERIC_COMPONENTS:Partial<Record<ScopeField,RegExp>>={
 cabinetBaseLf:/\b(?:base|lower)\s+cabinets?\b/i,
 cabinetUpperLf:/\b(?:upper|wall)\s+cabinets?\b/i,
 cabinetTallLf:/\b(?:tall|pantry)\s+cabinets?\b/i,
 garageSqft:/\bgarage\b/i,
 coveredOutdoorSqft:/\b(?:porch|covered outdoor)\b/i,
 countertopSqft:/\bcountertops?\b/i,
 flooringSqft:/\b(?:flooring|LVP)\b/i,
 trimLf:/\b(?:baseboard|trim)\b/i,
};

/** A verbatim, explicit customer revision resolves that one quantity. Merely
 * mentioning a different number, or a model calling a source "typed", does
 * not establish precedence. Original document takeoffs remain as provenance. */
export function applyExplicitTypedCorrections(extraction:ScopeExtraction,text:string):ScopeExtraction{
 const accepted=new Map<ScopeField,string>();
 for(const fact of [...extraction.facts].sort((a,b)=>text.lastIndexOf(a.evidence)-text.lastIndexOf(b.evidence))){
  const component=NUMERIC_COMPONENTS[fact.field];
  if(!component||fact.basis!=='stated'||fact.confidence<.85||!/typed/i.test(fact.source)||!fact.evidence.trim()||!text.includes(fact.evidence.trim()))continue;
  const clauses=fact.evidence.split(/(?<=[.!?])\s+|\n|;/);
  const value=Number(fact.value);if(!Number.isFinite(value)||value<0)continue;
  const matches=clauses.filter(clause=>component.test(clause)&&/\b(?:change|revise|update|correct)\b/i.test(clause));
  const valid=matches.some(clause=>{
   const numbers=[...clause.matchAll(/\bto\s+(\d+(?:\.\d+)?)\s*(LF|SF|linear feet|square feet)\b/gi)];
   return numbers.length===1&&Number(numbers[0][1])===value&&(/Lf$/.test(fact.field)?/^(LF|linear feet)$/i:/^(SF|square feet)$/i).test(numbers[0][2]);
  });
  if(valid)accepted.set(fact.field,fact.value);
 }
 if(!accepted.size)return extraction;
 return {...extraction,facts:extraction.facts.filter(fact=>!accepted.has(fact.field)||fact.value===accepted.get(fact.field)),
  conflicts:extraction.conflicts.filter(conflict=>!accepted.has(conflict.field))};
}
