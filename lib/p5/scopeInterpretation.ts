import type {ScopeExtraction} from './scope.ts';

/** Reconcile only an evidenced whole/part relationship. This never measures a
 * drawing, guesses an area, or erases competing measurements. Source takeoffs
 * stay intact so the reviewer can see the original values. */
export function reconcileDocumentHierarchy(extraction:ScopeExtraction,text:string):ScopeExtraction{
 const next=structuredClone(extraction);
 const explicitMultiple=/\b(?:main|primary|separate)\s+(?:house|home)\b|\b(?:two|multiple)\s+(?:homes|houses|buildings)\b|\b(?:additional|another|separate)\s+(?:building|structure|ADU)\b/i.test(text);
 const verticalAdu=/\b(?:ADU|dwelling|studio)\b[^.;\n]{0,40}\b(?:above|over)\s+(?:its\s+|a\s+|the\s+)?garage\b/i.test(text);
 // Page readers can label the garage and the dwelling as separate buildings.
 // A customer's explicit above/over relationship places them in one structure;
 // it does not merge a separate main home or another requested building.
 const otherBuilding=(next.instructions?.buildings||[]).some(label=>! /\b(?:ADU|garage|dwelling|studio)\b/i.test(label)||/\b(?:main|primary|pool|shed|barn|workshop)\b/i.test(label));
 const oneStackedStructure=verticalAdu&&!explicitMultiple&&!otherBuilding;
 const multi=explicitMultiple||otherBuilding||Boolean(next.instructions?.separateBuildings&&!oneStackedStructure);
 if(oneStackedStructure&&next.instructions)next.instructions.separateBuildings=false;
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

/** A building footprint is not a measured installation area for selected work.
 * Preserve the quoted footprint while withholding the unsupported component
 * measurement, including a takeoff copied from the same statement. */
export function separateFootprintFromInstallation(extraction:ScopeExtraction,text:string):ScopeExtraction{
 const next=structuredClone(extraction);
 const disputed=new Set<string>();
 const explicitArea=(value:string)=>{
   const number=value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
   const unit='(?:SF|square feet|sq\\.?\\s*ft)';
   const material='(?:(?:new|installed|replacement|bathroom|ceramic|porcelain|LVP|LVT)\\s+)*(?:flooring|floor tile|tile flooring|tile)';
   return new RegExp('\\b'+number+'\\s*'+unit+'\\s+(?:of\\s+)?'+material+'\\b|\\b'+material+'\\s*(?:area\\s*)?(?:is|=|:|of)?\\s*'+number+'\\s*'+unit+'\\b','i');
 };

 next.facts=next.facts.map(f=>{
  if(!['flooringSqft','tileSqft'].includes(f.field)||!Number.isFinite(Number(f.value)))return f;
  const footprint=next.facts.some(p=>p.field==='sqft'&&p.value===f.value);
  const role=/\b(?:house|home|bathroom|room|kitchen)\b/i.test(f.evidence);
  const authority=/typed|submitted/i.test(f.source)?text:f.evidence;
  const entire=/\b(?:all (?:the )?floors?|entire floor(?:ing)?|flooring throughout)\b/i.test(authority);
  if(!footprint||!role||explicitArea(f.value).test(authority)||entire)return f;
  disputed.add(f.value);
  next.clarifications=[...(next.clarifications||[]),{field:'flooringSqft',question:'How many square feet of flooring will actually be replaced? The stated room or home size may include retained areas.',reason:'Building footprint does not establish the included installation area.'}];
  return {...f,field:'otherDetails',basis:'inferred',confidence:Math.min(f.confidence,.6),value:'Installation area remains unmeasured. Source describes project footprint: '+f.evidence};
 });
 next.takeoffs=next.takeoffs?.map(t=>t.quantity!==null&&disputed.has(String(t.quantity))&&/\bfloor(?:ing)?|floor tile\b/i.test(t.component+' '+t.description)&&/\b(?:house|home|bathroom|room|kitchen)\b/i.test(t.evidence)&&!explicitArea(String(t.quantity)).test(t.evidence)
  ?{...t,quantity:null,basis:'uncertain',evidence:t.evidence+'; previously assigned '+t.quantity+' '+t.unit+' was a project footprint, not a measured installation area.',issues:[...t.issues,'Confirm included installation area; project footprint alone does not establish it.']}:t);
 return next;
}

/** Correct a field identity only when its own quoted evidence identifies the
 * narrower count. A bathroom count does not establish the home's room count. */
export function normalizeCountSubjects(extraction:ScopeExtraction):ScopeExtraction{
 const next=structuredClone(extraction);
 next.facts=next.facts.map(f=>f.field==='rooms'&&/\bbedrooms?\b/i.test(f.evidence)&&!/(?<!bed)(?<!bath)\brooms?\b|\btotal rooms\b/i.test(f.evidence)?{...f,field:'otherDetails',value:f.evidence}:f.field==='rooms'&&/\bbathrooms?\b/i.test(f.evidence)&&!/(?<!bath)\brooms?\b|\b(?:bedrooms?|living room|kitchen|total rooms)\b/i.test(f.evidence)?{...f,field:'bathrooms'}:f);
 return next;
}

/** A window, door or shower size belongs to that component. A reader may
 * correctly read 3 x 4 feet but assign it to the global project footprint.
 * Keep its source evidence without creating an unrelated 12 SF project. */
export function normalizeDimensionSubjects(extraction:ScopeExtraction):ScopeExtraction{
 const next=structuredClone(extraction);
 const fixture=/\b(?:windows?|doors?|shower|vanity|cabinets?|countertops?)\b/i;
 const project=/\b(?:room|bathroom|kitchen|home|house|building|project|ADU)\s+(?:area|footprint|dimensions?|measures?)\b|\b(?:area|footprint|dimensions?)\s+of\s+(?:the\s+)?(?:room|bathroom|kitchen|home|house|building|project|ADU)\b|\b\d[\d,.]*\s*(?:SF|square feet|sq\.?\s*ft)\s+(?:room|bathroom|kitchen|home|house|building|project|ADU)\b/i;
 next.facts=next.facts.map(f=>['length','width','sqft'].includes(f.field)&&fixture.test(f.evidence)&&!project.test(f.evidence)
  ?{...f,field:'otherDetails',value:'Component dimensions: '+f.evidence}:f);
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
 const assumedSite=next.facts.some(f=>f.field==='site'&&/\b(?:assum\w*|must|shall|required|design(?:ed)?)\b/i.test(f.evidence+' '+f.value));
 let siteNeedsConfirmation=false;
 next.facts=next.facts.map(f=>{
  if(f.field==='site'&&(assumedSite&&(/\b(?:assum\w*|must|shall|required|design(?:ed)?)\b/i.test(f.evidence+' '+f.value)||/\b(?:site work within|compacted earth|site management|discharge water|not shown|missing|not specified)\b/i.test(f.evidence+' '+f.value))||/\b(?:granular fill|splash block|under (?:the )?slab|no site[\s\S]{0,35}(?:data|info)|site[\s\S]{0,35}(?:not detailed|must be provided))\b/i.test(f.evidence+' '+f.value))&&!/\b(?:observed|survey confirms|soil report confirms|customer confirms|owner confirms|existing site is)\b/i.test(f.evidence+' '+f.value)){
   siteNeedsConfirmation=true;
   return {...f,field:'otherDetails',value:'Site design requirement or assumption, not verified site conditions: '+f.value};
  }
  // Preserve conditional requirements wherever they occur, including a
  // capitalized WHEN USING note after its equipment subject.
  if(/\b(?:if|when)\s+(?:using|used|installed|the|a|an|gas|appliances|located)\b/i.test(f.evidence)&&! /\b(?:if|when)\b/i.test(f.value))return {...f,value:f.evidence,basis:'inferred',confidence:Math.min(f.confidence,.6)};
  return f;
 });
 if(siteNeedsConfirmation){
  next.clarifications=[...(next.clarifications||[]),{field:'site',question:'Do the actual site slope, soil and access match the design assumptions? Describe any differences, or say what is still unknown.',reason:'Plan design assumptions do not establish the construction site conditions.'}];
 }
 return next;
}
