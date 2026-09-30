import {createHash} from 'node:crypto';

export interface CitationSource {id:string;text?:string;passages?:SourcePassage[];name?:string;kind?:string;status?:string}
export interface SourcePassage {id:string;start:number;end:number;text:string}
/** Partition, never summarize, the original source. Selecting a passage does
 * not establish that it supports a claim; that remains a semantic review. */
export function sourcePassages(source:Pick<CitationSource,'id'|'text'>):SourcePassage[]{
 const original=source.text||'',passages:SourcePassage[]=[];let start=0;
 while(start<original.length){
  let end=Math.min(original.length,start+640);
  if(end<original.length){
   const line=original.lastIndexOf('\n',end-1),space=original.lastIndexOf(' ',end-1);
   if(line>start+320)end=line+1;else if(space>start+320)end=space+1;
   // Do not split a Unicode code point at an otherwise unbroken boundary.
   if(/[\uD800-\uDBFF]/.test(original[end-1])&&/[\uDC00-\uDFFF]/.test(original[end]))end--;
  }
  const text=original.slice(start,end);
  const id='passage-'+createHash('sha256').update(JSON.stringify([source.id,start,end,text])).digest('hex').slice(0,24);
  passages.push({id,start,end,text});start=end;
 }
 return passages;
}
/** The provider sees all original characters once, with addressable passages.
 * Canonical saved sources keep their original text and hashes unchanged. */
export function projectSourceContext<T extends CitationSource>(sources:T[]){
 return sources.map(({text,...source})=>({...source,passages:sourcePassages({id:source.id,text})}));
}
export function sourcePassageIndex(sources:CitationSource[]){
 return new Map(sources.flatMap(source=>(source.text!==undefined?sourcePassages(source):source.passages||[]).map(passage=>[passage.id,{sourceId:source.id,quote:passage.text}] as const)));
}
