import {createHash} from "node:crypto";
import { analyzeScope } from "./extraction.ts";
import { prepareAnalysisFiles,verifyUpload } from "./documents";
import { SCOPE_BATCH_LIMIT,SCOPE_TEXT_LIMIT } from "./scope.ts";
import { draftCredentials,readDraft,readUploads,saveUpload,saveDraft,DraftError } from "./store";
import { failed,json,limitedBody,protectRequest } from "./http";
import { ESTIMATOR_BRAND } from "./brand";
export async function postScope(request:Request){
  try{
    protectRequest(request,20);const {id,key}=draftCredentials(request);const draft=await readDraft(id,key);
    if(!draft)throw new DraftError("Save your draft before analyzing.",404);
    const bytes=await limitedBody(request,SCOPE_BATCH_LIMIT+200000);
    const form=await new Response(bytes as BodyInit,{headers:{"Content-Type":request.headers.get("content-type")||""}}).formData();
    const text=String(form.get("text")??draft.text);if(text.length>SCOPE_TEXT_LIMIT)throw new DraftError("Please shorten the scope to 24,000 characters.");
    const files=form.getAll("files");if(files.length>12)throw new DraftError("Use up to 12 supporting documents.");
    const incoming=[];const known=new Set(draft.uploads.map(f=>f.sha256));
    for(const file of files){
      if(!(file instanceof File))throw new DraftError("Invalid file.");
      const verified=verifyUpload(file.name,Buffer.from(await file.arrayBuffer()));
      const digest=createHash("sha256").update(verified.data).digest("hex");
      if(!known.has(digest)){known.add(digest);incoming.push(verified);}
    }
    if(incoming.length+draft.uploads.length>12)throw new DraftError("Use up to 12 supporting documents.");
    if(incoming.reduce((n,f)=>n+f.data.length,0)+draft.uploads.reduce((n,f)=>n+f.size,0)>SCOPE_BATCH_LIMIT)throw new DraftError("Use up to 22 MB of supporting documents per estimate.",413);
    for(const file of incoming)await saveUpload(id,key,file);
    if(form.get("analyze")==="false")return json({draft:await readDraft(id,key),analysis:null});
    const stored=await readUploads(id,key);if(stored.reduce((n,f)=>n+f.data.length,0)>SCOPE_BATCH_LIMIT)throw new DraftError("Use up to 22 MB of supporting documents per estimate.",413);
    const {readable,manualReview}=await prepareAnalysisFiles(stored);
    if(!text.trim()&&!readable.length)throw new DraftError(manualReview.join(" ")||"Add a scope or a document to analyze.");
    const result=await analyzeScope(text,readable,draft.answers);
    result.extraction.reviewNotes.push(...manualReview);
    const saved=await saveDraft(id,key,ESTIMATOR_BRAND.id,{text,answers:draft.answers,extraction:result.extraction,reviewed:null,contact:draft.contact},draft.revision);
    return json({draft:saved,analysis:result});
  }catch(error){return failed(error);}
}
