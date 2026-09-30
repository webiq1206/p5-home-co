import {ServiceError} from './core.mjs';

/** Read-only P5 evidence retrieval. It starts no jobs and never reconciles,
 * filters, summarizes or repairs the source. Each response contains at most
 * one original page so large plan sets can be inspected without sampling. */
export async function projectSource(store,tenant,project,id,page=null){
 if(tenant!=='p5homeco.com')throw new ServiceError('not-found',404);
 const document=await store.document(tenant,project,id);
 const total=Number(document.page_count);
 if(page!==null&&(!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(total)||page>total))throw new ServiceError('invalid-source-page',400);
 const revision=document.updated_at instanceof Date?document.updated_at.toISOString():String(document.updated_at||'');
 const identity={version:'p5-page-evidence-v2',id,project,sha256:document.digest,name:document.name,state:document.state,revision,pageCount:Number.isSafeInteger(total)&&total>0?total:null};
 if(page===null){
  const pages=await store.coverage(id);
  return {...identity,pages:pages.map(p=>({page:p.page,status:p.status||'pending',notes:p.notes||[]})),complete:document.state==='complete'&&pages.length===total&&pages.every((p,index)=>p.page===index+1&&p.status==='read')};
 }
 const [saved]=await store.pages(id,[page]);
 if(!saved)throw new ServiceError('source-page-not-prepared',409);
 const native=saved.native||{};
 return {...identity,page:{number:page,native:{text:typeof native.text==='string'?native.text:'',textQuality:native.textQuality??null,kind:native.kind||'unknown',width:native.width??null,height:native.height??null,spanCoordinates:native.spanCoordinates||null,spans:native.spans||[]},readerObservation:saved.evidence||null}};
}
