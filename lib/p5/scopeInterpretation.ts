import type {ScopeExtraction} from './scope.ts';

/** Reconcile only an evidenced whole/part relationship. This never measures a
 * drawing, guesses an area, or erases competing measurements. Source takeoffs
 * stay intact so the reviewer can see the original values. */
export function reconcileDocumentHierarchy(extraction:ScopeExtraction,text:string):ScopeExtraction{
 const next=structuredClone(extraction);
 const multi=next.instructions?.separateBuildings||/\b(?:main|primary|separate)\s+(?:house|home)\b|\b(?:two|multiple)\s+(?:homes|houses|buildings)\b/i.test(text);
 if(!multi&&/\bADU\b|accessory dwelling unit/i.test(text)){
  const types=next.facts.filter(f=>f.field==='service');
  if(types.some(f=>f.value==='adu')&&types.every(f=>['adu','new-construction'].includes(f.value))){
   next.facts=next.facts.filter(f=>f.field!=='service'||f.value==='adu');
   next.conflicts=next.conflicts.filter(c=>c.field!=='service'||c.values.some(v=>!['adu','new-construction'].includes(v)));
  }
 }
 const areas=next.facts.filter(f=>f.field==='sqft'&&f.confidence>=.85&&['stated','calculated'].includes(f.basis||'')&&Number(f.value)>0);
 const living=areas.filter(f=>/\b(?:living|conditioned|habitable)\b/i.test(f.evidence)&&!/\b(?:total|combined)\b[^.;]{0,30}\b(?:garage|building)\b/i.test(f.evidence));
 const garages=next.facts.filter(f=>f.field==='garageSqft'&&f.confidence>=.85&&f.basis!=='visual'&&f.basis!=='inferred'&&Number(f.value)>0);
 const livingValues=[...new Set(living.map(f=>Number(f.value)))],garageValues=[...new Set(garages.map(f=>Number(f.value)))];
 if(!multi&&livingValues.length===1&&garageValues.length===1){
  const area=livingValues[0],total=area+garageValues[0];
  const combined=areas.filter(f=>Number(f.value)===total&&/\b(?:total|combined|gross)\b/i.test(f.evidence));
  if(combined.length&&areas.every(f=>[area,total].includes(Number(f.value)))){
   next.facts=next.facts.filter(f=>!combined.includes(f));
   next.conflicts=next.conflicts.filter(c=>c.field!=='sqft'||c.values.some(v=>![area,total].includes(Number(v))));
   next.reviewNotes.push(`Area reconciliation: ${area} SF living area plus ${garageValues[0]} SF garage equals ${total} SF combined building area. Living and garage remain separate quantities.`);
  }
 }
 return next;
}

/** Missing evidence is a question, not a customer exclusion. Conditional
 * plan notes remain conditional and cannot become confirmed site facts. */
export function groundDocumentConditions(extraction:ScopeExtraction,text:string):ScopeExtraction{
 const next=structuredClone(extraction);
 const explicitUtilityExclusion=text.split(/[.;\n]/).some(part=>/\b(?:exclude|excluding|no)\b/i.test(part)&&/\butilit(?:y|ies)|water.*connection|sewer.*connection/i.test(part));
 if(next.instructions&&!explicitUtilityExclusion){
  const missing=next.instructions.exclusions.filter(note=>! /\b(?:exclude|excluding|by others)\b/i.test(note)&&/\b(?:utilit(?:y|ies)|water|sewer|gas|electric)\b/i.test(note)&&/\b(?:unknown|not (?:shown|specified|provided|determined)|missing|unconfirmed)\b/i.test(note));
  if(missing.length){
   next.instructions.exclusions=next.instructions.exclusions.filter(note=>!missing.includes(note));
   next.instructions.questions.push('What utility connections or extensions are needed, and what are their approximate lengths? If unknown, we can show a separate allowance.');
   next.reviewNotes.push('Utility work is not excluded merely because its route or length is missing. Confirm the requested connections or use a disclosed allowance.');
  }
 }
 next.facts=next.facts.map(f=>/^\s*(?:when|if)\b/i.test(f.evidence)&&!/^\s*(?:when|if)\b/i.test(f.value)?{...f,value:f.evidence,basis:'inferred',confidence:Math.min(f.confidence,.6)}:f);
 return next;
}
