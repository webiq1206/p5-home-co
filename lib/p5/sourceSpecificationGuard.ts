import type {AnalysisFile} from './extraction.ts';
import type {ScopeExtraction} from './scope.ts';

export interface SpecificationSource {text:string; gaps:('siding'|'drywall')[]}
const compact=(text:string)=>text.toLowerCase().replace(/[^a-z0-9]/g,'');
export function specificationSource(text:string):SpecificationSource{
 const clean=text.replace(/\s+/g,' ');
 return {text,gaps:[...(/\bT\s*[-–]\s*(?=or\b|[.,;]|$)/i.test(clean)?['siding' as const]:[]),...(/\bLevel\s+(?=(?:finish|finishing|drywall)\b)/i.test(clean)?['drywall' as const]:[])]};
}
/** A local text check supplements the complete visual page review. It never
 * fills a redaction or treats an absent text layer as a completed review. */
export async function readSpecificationSource(files:AnalysisFile[]):Promise<SpecificationSource|null>{
 if(!files.length||files.some(file=>file.type!=='application/pdf'||file.detailViews||!file.data.subarray(0,1024).includes(Buffer.from('%PDF-'))))return null;
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const texts:string[]=[];
 for(const file of files){
  const task=getDocument({data:new Uint8Array(file.data),useSystemFonts:true});
  try{
   const doc=await task.promise;
   for(let page=1;page<=doc.numPages;page++){
    const content=await(await doc.getPage(page)).getTextContent();
    const text=content.items.map(item=>'str' in item?item.str:'').join(' ');
    if(text.trim().length<80)return null;
    texts.push(text);
   }
  }finally{await task.destroy();}
 }
 return specificationSource(texts.join('\n'));
}
export function unsupportedSpecifications(extraction:ScopeExtraction,source:SpecificationSource|null):string[]{
 if(!source?.gaps.length)return [];
 const text=JSON.stringify(extraction),supported=compact(source.text),missing:string[]=[];
 const patterns=[...(source.gaps.includes('siding')?[/\bT\s*-?\s*\d+\s*[-–]\s*\d+\b/gi]:[]),...(source.gaps.includes('drywall')?[/\bLevel\s*\d+(?:\.\d+)?\b/gi]:[])];
 for(const pattern of patterns)for(const match of text.matchAll(pattern))if(!supported.includes(compact(match[0])))missing.push(match[0]);
 return [...new Set(missing)];
}
export const specificationHint=(source:SpecificationSource|null)=>source?.gaps.length?'LOCAL SOURCE CHECK: The supplied PDF has a blank or redacted numbered material specification. Preserve its visible material description, responsibility and exclusion, but leave the missing designation unspecified. Never restore familiar product numbers or finish levels from general knowledge. A blank is not zero.':'';
export class UnsupportedSpecificationError extends Error{
 readonly specifications:string[];
 constructor(specifications:string[]){super('A redacted material specification could not be verified. Its missing designation must remain unspecified.');this.specifications=specifications;}
}
