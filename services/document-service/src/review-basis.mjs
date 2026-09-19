
/** Missing provenance is never upgraded from model confidence. Only an exact
 * field/value match in unanimous, already validated evidence may restore it.
 * Otherwise retain the interpretation as inferred and unusable for auto-fill. */
export function normalizeReviewFactBasis(value,input){
 if(!value||!Array.isArray(value.facts))return value;
 const result=structuredClone(value),documents=Array.isArray(input?.documents)?input.documents:[];
 let restored=0,unconfirmed=0;
 for(const fact of result.facts){
  if(!fact||typeof fact!=='object'||Array.isArray(fact)||Object.hasOwn(fact,'basis'))continue;
  const eligible=documents.length===1?documents:documents.filter(doc=>typeof fact.source==='string'&&
   (fact.source===doc.source||fact.source.startsWith(doc.source+',')||fact.source.startsWith(doc.source+' ')));
  const matches=eligible.flatMap(doc=>(doc.pages||[]).flatMap(page=>(page.evidence?.facts||[])
   .filter(source=>source.field===fact.field&&source.value===fact.value)
   .map(source=>({source,document:doc.source,page:page.page}))));
  const bases=new Set(matches.map(match=>match.source.basis));
  const sourceValues=new Set(eligible.flatMap(doc=>(doc.pages||[]).flatMap(page=>(page.evidence?.facts||[]).filter(source=>source.field===fact.field).map(source=>source.value))));
  if(matches.length&&sourceValues.size===1&&bases.size===1&&['stated','calculated','visual'].includes(matches[0].source.basis)){
   const match=matches[0];fact.basis=match.source.basis;
   // Reuse the verified citation rather than the model's uncategorized paraphrase.
   fact.evidence=match.source.evidence;fact.source=match.document+', page '+match.page;restored++;
  }else{
   fact.basis='inferred';if(typeof fact.confidence==='number')fact.confidence=Math.min(fact.confidence,.2);unconfirmed++;
  }
 }
 if(Array.isArray(result.reviewNotes)&&(restored||unconfirmed))
  result.reviewNotes.push('Evidence classification was absent on '+(restored+unconfirmed)+' review facts. '+restored+' were restored from exact verified source facts; '+unconfirmed+' remain unconfirmed interpretations and cannot populate pricing answers automatically.');
 return result;
}
