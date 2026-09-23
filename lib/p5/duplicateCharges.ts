/** Suspected double counts, computed from the priced lines themselves.
 *
 * Owner report 2026-09-22, from a live estimate: two separate requested repairs each priced an
 * "Exterior weatherproof receptacle" for the exterior, $1,011 and $506, with nothing saying so. The
 * audit stage can notice this, but a model opinion is deliberately non-blocking, so the customer saw
 * neither a merge nor a flag.
 *
 * FLAGGED, NEVER MERGED. A threshold confident enough to merge every real duplicate will eventually
 * eat "bedroom 1" against "bedroom 2", which is the silently-vanishing-scope bug wearing a hat.
 * Asking costs one line on the screen; merging wrongly removes work the customer asked for.
 *
 * The test is narrow on purpose, and every part of it is a fact rather than a judgement:
 *   - the two lines came from DIFFERENT requested items (one item priced across several assembly
 *     lines, or split across rooms, is ordinary and never flagged), and
 *   - they resolved to the SAME cost-book line, and
 *   - their locations overlap on a real word ("front exterior" against "exterior"; "kitchen"
 *     against "garage" does not).
 */

/** Words that place nothing, so they cannot make two locations "overlap". */
const EMPTY_PLACE_WORD=new Set(['the','and','or','at','in','on','of','a','an','all','area','areas','floor','level','not','specified','unspecified','unknown','none','various','tbd','na','n/a','same','residence','house','home','building','project','site','dwelling','property','main','existing','new']);
const placeWords=(...values:(string|null|undefined)[]):Set<string> =>
  new Set(values.flatMap(v=>String(v||'').toLowerCase().split(/[^a-z0-9]+/)).filter(w=>w&&!EMPTY_PLACE_WORD.has(w)));
/** "Replace the receptacles.: Exterior weatherproof receptacle." -> the cost-book line it resolved to.
 * The task text is authored prose and may contain its own colon, so the LAST separator is the join. */
const bookItem=(description:string):string=>{
  const at=description.lastIndexOf(': ');
  return (at<0?description:description.slice(at+2)).toLowerCase().replace(/[.\s]+$/,'').trim();
};
const requestedItem=(description:string):string=>{
  const at=description.lastIndexOf(': ');
  return (at<0?description:description.slice(0,at)).replace(/[.\s]+$/,'').trim();
};
const sentence=(text:string):string=>text?text.charAt(0).toUpperCase()+text.slice(1):text;

export interface ChargeLine{scopeTaskId?:string|null;description?:string|null;building?:string|null;floor?:string|null}
/** One line per suspected double count, addressed to the customer, naming both requested items. */
export function duplicateChargeNotes(lines:ChargeLine[]):string[]{
  const byBookItem=new Map<string,ChargeLine[]>();
  for(const line of lines){
    const item=bookItem(String(line.description||''));
    if(!item)continue;
    const group=byBookItem.get(item);
    if(group)group.push(line);else byBookItem.set(item,[line]);
  }
  const notes:string[]=[];
  for(const [item,group] of byBookItem){
    if(group.length<2)continue;
    for(let i=0;i<group.length;i++)for(let j=i+1;j<group.length;j++){
      const a=group[i],b=group[j];
      // Several lines under ONE requested item are how an assembly is priced, not a duplicate.
      const taskA=String(a.scopeTaskId||''),taskB=String(b.scopeTaskId||'');
      if(!taskA||!taskB||taskA===taskB)continue;
      const requestedA=requestedItem(String(a.description||'')),requestedB=requestedItem(String(b.description||''));
      if(!requestedA||!requestedB||requestedA.toLowerCase()===requestedB.toLowerCase())continue;
      const wordsA=placeWords(a.building,a.floor),wordsB=placeWords(b.building,b.floor);
      const shared=[...wordsA].filter(w=>wordsB.has(w));
      if(!shared.length)continue;
      const note=`Two requested items are both priced as "${sentence(item)}" in the same place (${shared.join(', ')}): "${requestedA}" and "${requestedB}". Confirm these are separate work and not the same item counted twice.`;
      if(!notes.includes(note))notes.push(note);
    }
  }
  return notes;
}
