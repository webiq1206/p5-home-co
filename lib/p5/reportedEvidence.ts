/** Restore a verbatim evidence line only from the paragraph containing that exact supplier URL.
 * Numeric prices, units, product compatibility and locality still pass the normal validators. */
export function restoreReportedEvidence<T>(raw:T,report:string|undefined,sameUrl:(a:string,b:readonly string[])=>boolean):T{
 if(!report||!raw||typeof raw!=='object')return raw;
 const data=structuredClone(raw) as any;
 if(!Array.isArray(data.rates))return raw;
 for(const rate of data.rates)for(const source of rate.sources||[]){
  if(typeof source.url!=='string'||typeof source.excerpt!=='string')continue;
  const candidates=report.split(/\n\s*\n/).flatMap(block=>{
   const urls=[...block.matchAll(/https:\/\/[^\s)>\]]+/g)].map(m=>m[0]);
   if(!urls.length||!urls.every(url=>sameUrl(source.url,[url])))return [];
   const lines=[...block.matchAll(/(?:^|\n)\s*(?:[-*]\s*)?(?:\*\*)?Evidence(?:\*\*)?\s*:\s*(?:\*\*)?([^\n]+)/gi)];
   return lines.map(m=>m[1].split(/\s+\(\[|\s+\(https?:|\s+https?:/)[0].trim()).filter(text=>/\$\s*\d/.test(text)&&text.split(/\s+/).length<=25);
  });
  const unique=[...new Set(candidates)];
  if(unique.length!==1)continue;
  // Matching the leading product words avoids borrowing a sibling product's citation.
  const words=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(Boolean);
  const old=words(source.excerpt),exact=words(unique[0]);
  if(old.slice(0,3).join(' ')!==exact.slice(0,3).join(' '))continue;
  source.excerpt=unique[0];
 }
 return data as T;
}
