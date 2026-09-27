import type {ExtractedFact,ScopeConflict} from './scope.ts';

const TYPES=[/\bwater[ -]heaters?\b/i,/\bexhaust fans?\b/i,/\b(?:toilets?|water closets?)\b/i,/\burinals?\b/i,/\blavator(?:y|ies)\b/i,/\bshowers?\b/i,/\bmop\s+sinks?\b/i,/\blobby\s+sinks?\b/i,/\b(?:drinking\s+)?fountains?\b/i];
/** A global scalar cannot represent independent fixture schedules. Retain their
 * original counts and evidence as descriptive facts; never sum unlike groups. */
export function separateFixtureFacts(facts:ExtractedFact[],conflicts:ScopeConflict[]){
 const counts=facts.filter(f=>f.field==='fixtureCount');
 if(counts.length<2)return {facts,conflicts};
 const groups=counts.map(f=>TYPES.flatMap((type,index)=>type.test(f.evidence)?[index]:[]));
 if(groups.some(group=>!group.length))return {facts,conflicts};
 // Different counts with any shared fixture type might be a real revision or
 // contradiction. Keep the normal clarification in that case.
 if(counts.some((f,i)=>counts.some((other,j)=>i!==j&&f.value!==other.value&&groups[i].some(type=>groups[j].includes(type)))))return {facts,conflicts};
 if(new Set(groups.map(group=>group.join(','))).size<2)return {facts,conflicts};
 return {facts:facts.map(f=>f.field==='fixtureCount'?{...f,field:'fixtures' as const,value:`${f.evidence} (stated count: ${f.value})`}:f),conflicts:conflicts.filter(c=>c.field!=='fixtureCount')};
}
