import {createHash} from 'node:crypto';
import {query} from './database.ts';
import {readSavedSource,sourceIdentity} from './documentServiceClient.ts';
import {pdfjsAssetOptions} from './pdfjsAssets.ts';
import {pageTextFromItems} from './pdfText.ts';
import {SCOPE_MAX_PAGES} from './scope.ts';
import {DraftError,type Draft} from './store.ts';
import {projectHash} from './projectRecord.ts';
import {ESTIMATOR_BRAND} from './brand.ts';
import type {ProjectPageEvidence,ProjectPage} from './projectPageEvidence.ts';
type Unit={uploadId?:string;pages?:{page:number;source:string}[];result?:{extraction?:{documentCoverage?:{pages?:{page:number;status:string;notes:string[]}[]}}}};

/** Original digital text and geometry only. No OCR or semantic model call. */
export async function nativeProjectPdfPages(bytes:Buffer){
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const task=getDocument({data:new Uint8Array(bytes),...pdfjsAssetOptions(),disableFontFace:true} as any),pdf=await task.promise;
 const pages:ProjectPage['native'][]=[];
 try{
  if(pdf.numPages<1||pdf.numPages>SCOPE_MAX_PAGES)throw new DraftError('The saved PDF exceeds the supported page inventory.',422);
  for(let number=1;number<=pdf.numPages;number++){
   const page=await pdf.getPage(number),content=await page.getTextContent(),viewport=page.getViewport({scale:1});
   const spans=content.items.filter((item:any)=>typeof item.str==='string').map((item:any)=>({str:item.str,transform:item.transform,width:item.width,height:item.height,hasEOL:item.hasEOL}));
   const text=pageTextFromItems(spans,Infinity);
   pages.push({text,kind:text?'digital-text':'no-text-layer',textQuality:{method:'native-text-only',ocrPerformed:false},width:viewport.width,height:viewport.height,spanCoordinates:'PDF page points, not construction dimensions',spans});page.cleanup();
  }
  return pages;
 }finally{await task.destroy();}
}

/** Bridge an already-read local PDF into the same evidence contract as remote
 * documents. All overlapping saved observations remain interpretations, never
 * additive takeoffs or replacements for the immutable original page text. */
export async function loadLocalProjectPages(draft:Pick<Draft,'id'|'brand'|'uploads'>,dependencies={query,readSavedSource,nativePages:nativeProjectPdfPages}):Promise<ProjectPageEvidence>{
 if(ESTIMATOR_BRAND.domain!=='p5homeco.com'||draft.brand!==ESTIMATOR_BRAND.id)throw new DraftError('Page evidence is restricted to this P5 project.',403);
 const documents:ProjectPageEvidence['documents']=[],issues:string[]=[],seen=new Set<string>();let total=0;
 for(const upload of draft.uploads){
  if(upload.type!=='application/pdf'||seen.has(upload.sha256))continue;seen.add(upload.sha256);
  const rows=await dependencies.query("SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key LIKE 'analysis:v8:%' AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(payload->'units','[]'::jsonb)) u WHERE u->>'uploadId'=$2) ORDER BY work_key",[draft.id,upload.id]);
  const units=rows.flatMap(row=>((row.payload as {units?:Unit[]})?.units||[]).filter(unit=>unit.uploadId===upload.id));
  if(!units.length)continue;
  const {bytes}=await dependencies.readSavedSource(upload,draft.id);
  if(createHash('sha256').update(bytes).digest('hex')!==upload.sha256)throw new DraftError('The saved original failed its checksum check.',422);
  const native=await dependencies.nativePages(bytes);total+=native.length;
  if(total>SCOPE_MAX_PAGES)throw new DraftError('The combined original-page inventory exceeds the supported limit.',422);
  const name=sourceIdentity(upload,draft.uploads),pages:ProjectPage[]=native.map((page,index)=>{
   const number=index+1,sections=units.filter(unit=>unit.pages?.some(ref=>ref.page===number));
   const records=sections.flatMap(unit=>unit.result?.extraction?.documentCoverage?.pages?.filter(ref=>ref.page===number)||[]);
   const complete=sections.length>0&&sections.every(unit=>Boolean(unit.result)&&unit.result?.extraction?.documentCoverage?.pages?.some(ref=>ref.page===number&&ref.status==='read'))&&records.every(ref=>ref.status==='read');
   const notes=[...new Set(records.flatMap(record=>record.notes||[]))];
   if(!complete)notes.push('Saved local page interpretation is incomplete; native text alone does not verify all visual content.');
   return {number,native:page,status:complete?'read':'partial',notes,readerObservation:{origin:'saved-local-analysis',warning:'Historical, potentially scope-dependent interpretations. Verify against original page evidence and current customer instructions. Overlapping detail sections are not separate physical instances.',sections:sections.map(unit=>unit.result||null)}};
  });
  documents.push({fileId:upload.id,name,sha256:upload.sha256,revision:'local-native-v1:'+projectHash({sha256:upload.sha256,units}),pageCount:pages.length,pages});
 }
 return {documents,issues};
}
