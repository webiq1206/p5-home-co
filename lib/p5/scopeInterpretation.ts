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
 const living=areas.filter(f=>/\b(?:living|conditioned|habitable|dwelling|studio)\b/i.test(f.evidence)&&!/\bgarage\b/i.test(f.evidence));
 const garages=next.facts.filter(f=>f.field==='garageSqft'&&f.confidence>=.85&&f.basis!=='visual'&&f.basis!=='inferred'&&Number(f.value)>0);
 const livingValues=[...new Set(living.map(f=>Number(f.value)))],garageValues=[...new Set(garages.map(f=>Number(f.value)))];
 if(!multi&&livingValues.length===1&&garageValues.length===1){
  const area=livingValues[0],total=area+garageValues[0];
  const combined=areas.filter(f=>Number(f.value)===total&&(/\b(?:total|combined|gross)\b/i.test(f.evidence)||/\b(?:ADU|dwelling|studio)\b[^.;]{0,35}\b(?:above|over)\s+(?:a\s+|the\s+)?garage\b/i.test(f.evidence)));
  if(combined.length&&areas.every(f=>[area,total].includes(Number(f.value)))){
   next.facts=next.facts.filter(f=>!combined.includes(f));
   next.conflicts=next.conflicts.filter(c=>c.field!=='sqft'||c.values.some(v=>![area,total].includes(Number(v))));
   next.reviewNotes.push(`Area reconciliation: ${area} SF living area plus ${garageValues[0]} SF garage equals ${total} SF combined building area. Living and garage remain separate quantities.`);
  }
 }
 return next;
}

/** Correct a field identity only when its own quoted evidence identifies the
 * narrower count. A bathroom count does not establish the home's room count. */
export function normalizeCountSubjects(extraction:ScopeExtraction):ScopeExtraction{
 const next=structuredClone(extraction);
 next.facts=next.facts.map(f=>f.field==='rooms'&&/\bbathrooms?\b/i.test(f.evidence)&&!/(?<!bath)\brooms?\b|\b(?:bedrooms?|living room|kitchen|total rooms)\b/i.test(f.evidence)?{...f,field:'bathrooms'}:f);
 return next;
}

/** Keep distinct surfaces in distinct fields. Legacy readers sometimes stored
 * floor plus shower tile in one total. Retain that total as source evidence,
 * but never let it stand in for a component measurement or revision. */
export function normalizeTileSubjects(extraction:ScopeExtraction):ScopeExtraction{
 const next=structuredClone(extraction);
 const wall=/\b(?:shower|wall)\s+(?:wall\s+)?tile\b|\btile\s+(?:on\s+)?(?:shower\s+)?walls?\b/i;
 const floor=/\bfloor(?:ing)?\b/i;
 const moved=next.facts.filter(f=>f.field==='tileSqft'&&wall.test(f.evidence)&&!floor.test(f.evidence));
 next.facts=next.facts.map(f=>moved.includes(f)?{...f,field:'wallTileSqft'}:f);
 if(moved.length&&!next.facts.some(f=>f.field==='tileSqft'))next.conflicts=next.conflicts.map(c=>c.field==='tileSqft'?{...c,field:'wallTileSqft'}:c);
 const bathroom=next.facts.some(f=>f.field==='service'&&f.value==='bathroom'&&f.confidence>=.7);
 for(const [field,pattern] of [['wallTileSqft',wall],...(bathroom?[['flooringSqft',floor]]:[])] as ['wallTileSqft'|'flooringSqft',RegExp][]){
  if(next.facts.some(f=>f.field===field))continue;
  const rows=(next.takeoffs||[]).filter(t=>pattern.test(t.description+' '+t.component)&&/\btile\b/i.test(t.description+' '+t.component)
   &&!t.issues.length&&['stated','calculated'].includes(t.basis)&&Number(t.quantity)>0&&/^(?:SF|sqft|square feet)$/i.test(t.unit));
  // Multiple rooms, alternate readings and repeated crops require their own
  // reconciliation; matching a noun alone is not proof they should be summed.
  if(rows.length!==1)continue;
  const row=rows[0];
  next.facts.push({field,value:String(row.quantity),confidence:1,basis:row.basis as 'stated'|'calculated',source:row.sources.map(s=>s.source+(s.page?` page ${s.page}`:'')).join('; '),evidence:row.evidence});
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
