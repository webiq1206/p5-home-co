import type {ExtractedFact,ScopeConflict} from './scope.ts';
/** A kitchen run and a separate measured vanity are different physical items. */
export function separateCabinetFacts(facts:ExtractedFact[],conflicts:ScopeConflict[]){
 const base=facts.filter(f=>f.field==='cabinetBaseLf'&&f.confidence>=.85);
 const vanities=base.filter(f=>/\bvanit(?:y|ies)\b/i.test(f.evidence)&&!/\b(?:kitchen|base cabinets?)\b/i.test(f.evidence));
 const runs=base.filter(f=>!vanities.includes(f)&&/\b(?:base|lower)\b/i.test(f.evidence)&&!/\bvanit(?:y|ies)\b/i.test(f.evidence));
 // Different widths of the same vanity still need a real customer correction.
 if(!vanities.length||!runs.length||new Set(vanities.map(f=>f.value)).size!==1||new Set(runs.map(f=>f.value)).size!==1)return {facts,conflicts};
 const separated=new Set([...vanities,...runs].map(f=>f.value));
 const kitchen=facts.some(f=>f.field==='cabinetRoom'&&f.value==='kitchen');
 const bathroom=facts.filter(f=>f.field==='cabinetRoom'&&f.value==='bathroom'&&/\bvanity\b/i.test(f.evidence));
 return {facts:facts.flatMap(f=>vanities.includes(f)?[{...f,field:'fixtures' as const,value:`Separate bathroom vanity: ${f.evidence}`}]:kitchen&&bathroom.includes(f)?[]:[f]),
  conflicts:conflicts.filter(c=>!(c.field==='cabinetBaseLf'&&c.values.length>1&&c.values.every(v=>separated.has(v)))&&!(kitchen&&bathroom.length&&c.field==='cabinetRoom'&&c.values.every(v=>['kitchen','bathroom'].includes(v))))};
}
