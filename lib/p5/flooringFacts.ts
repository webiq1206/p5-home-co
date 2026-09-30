import type {ExtractedFact} from './scope.ts';
/** Keep a measured non-tile floor and a separate tile surface from sharing one charged area. */
export function separateFlooringFacts(facts:ExtractedFact[]):ExtractedFact[]{
 return facts.map(f=>{
  if(f.field!=='flooringSqft'||f.confidence<.85||f.basis==='inferred'||f.basis==='visual')return f;
  const areas=[...f.evidence.matchAll(/(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:SF|sq\.?\s*ft\.?|square\s+(?:feet|foot))\b\s*([^.;\n]*?)(?=\d+(?:,\d{3})*(?:\.\d+)?\s*(?:SF|sq\.?\s*ft\.?|square\s+(?:feet|foot))\b|$)/gi)].map(m=>({n:Number(m[1].replaceAll(',','')),label:m[2]}));
  const floor=areas.filter(a=>/\b(?:LVP|LVT|luxury vinyl|hardwood|laminate|carpet)\b/i.test(a.label)&&!/\b(?:tile|retain|untouched|exclude|waste)\b/i.test(a.label));
  const tile=areas.filter(a=>/\b(?:floor\s+tile|tile\s+floor(?:ing)?)\b/i.test(a.label)&&!/\b(?:wall|retain|untouched|exclude|waste)\b/i.test(a.label));
  if(areas.length!==2||floor.length!==1||tile.length!==1||Math.abs(Number(f.value)-floor[0].n-tile[0].n)>.01)return f;
  return {...f,value:String(floor[0].n),basis:'stated',evidence:`${f.evidence}. Non-tile flooring is ${floor[0].n} SF; the separate ${tile[0].n} SF tile surface is retained in tile scope.`};
 });
}
