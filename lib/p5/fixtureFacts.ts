import type {ExtractedFact,ScopeConflict} from './scope.ts';

const TYPES=[/\bwater[ -]heaters?\b/i,/\bexhaust fans?\b/i,/\b(?:toilets?|water closets?)\b/i,/\burinals?\b/i,/\blavator(?:y|ies)\b/i,/\bshowers?\b/i,/\bmop\s+sinks?\b/i,/\blobby\s+sinks?\b/i,/\b(?:drinking\s+)?fountains?\b/i];
/** A global scalar cannot represent independent fixture schedules. Retain their
 * original counts and evidence as descriptive facts; never sum unlike groups. */
export function separateFixtureFacts(facts:ExtractedFact[],conflicts:ScopeConflict[]){
 const counts=facts.filter(f=>f.field==='fixtureCount');
 if(counts.length<2)return {facts,conflicts};
 const groups=counts.map(f=>{
  const direct=TYPES.flatMap((type,index)=>type.test(f.evidence)?[index]:[]);
  if(direct.length)return direct;
  // A page can put its item names in the Fixtures fact and only "three
  // scheduled fixtures" in the count evidence. Use that matching schedule,
  // never an unrelated numeric mention elsewhere in the document.
  const words=['zero','one','two','three','four','five','six','seven','eight','nine','ten'];
  const number=Number(f.value);
  if(!Number.isInteger(number)||number<1||number>10||!/scheduled fixtures/i.test(f.evidence))return [];
  const count=new RegExp(`\\b(?:${number}|${words[number]}) scheduled fixtures\\b`,'i');
  const candidates=facts.filter(other=>other.field==='fixtures'&&other.source===f.source&&count.test(other.value))
    .map(other=>TYPES.flatMap((type,index)=>type.test(other.value)?[index]:[])).filter(group=>group.length);
  return new Set(candidates.map(group=>group.join(','))).size===1?candidates[0]:[];
 });
 if(groups.some(group=>!group.length))return {facts,conflicts};
 // Different counts with any shared fixture type might be a real revision or
 // contradiction. Keep the normal clarification in that case.
 if(counts.some((f,i)=>counts.some((other,j)=>i!==j&&f.value!==other.value&&groups[i].some(type=>groups[j].includes(type)))))return {facts,conflicts};
 if(new Set(groups.map(group=>group.join(','))).size<2)return {facts,conflicts};
 return {facts:facts.map(f=>f.field==='fixtureCount'?{...f,field:'fixtures' as const,value:`${f.evidence} (stated count: ${f.value})`}:f),conflicts:conflicts.filter(c=>c.field!=='fixtureCount')};
}
