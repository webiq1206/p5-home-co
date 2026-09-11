import {reconcileScope,scopeQuestions,manualScopeAnswers} from "./adaptive";
import {costQuestionFields} from "./questionPolicy";
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
    const requested:string[]=[];const incoming=[];const known=new Set(draft.uploads.map(f=>f.sha256));
    for(const file of files){
      if(!(file instanceof File))throw new DraftError("Invalid file.");
      let verified;try{verified=verifyUpload(file.name,Buffer.from(await file.arrayBuffer()));}catch(error){throw new DraftError(error instanceof Error?error.message:"Invalid upload.");}
      const digest=createHash("sha256").update(verified.data).digest("hex");
      requested.push(digest);
      if(!known.has(digest)){known.add(digest);incoming.push(verified);}
    }
    if(incoming.length+draft.uploads.length>12)throw new DraftError("Use up to 12 supporting documents.");
    if(incoming.reduce((n,f)=>n+f.data.length,0)+draft.uploads.reduce((n,f)=>n+f.size,0)>SCOPE_BATCH_LIMIT)throw new DraftError("Use up to 22 MB of supporting documents per estimate.",413);
    for(const file of incoming)await saveUpload(id,key,file);
    if(form.get("analyze")==="false")return json({draft:await readDraft(id,key),analysis:null});
    const stored=await readUploads(id,key);if(stored.reduce((n,f)=>n+f.data.length,0)>SCOPE_BATCH_LIMIT)throw new DraftError("Use up to 22 MB of supporting documents per estimate.",413);
    const version=createHash("sha256").update(JSON.stringify([text,stored.map(f=>createHash("sha256").update(f.data).digest("hex"))])).digest("hex");
    const resolutions=draft.wizard?.sourceVersion===version?draft.wizard.resolutions:{};
    const visitorAnswers=manualScopeAnswers(draft.answers,draft.extraction,draft.wizard?.resolutions);
    let analysis=null;let warning="";
    try{
      const {readable,manualReview}=await prepareAnalysisFiles(stored);
      if(!text.trim()&&!readable.length&&!Object.values(draft.answers).some(v=>v?.trim()))throw new Error(manualReview.join(" ")||"Add a project description or a document.");
      analysis=await analyzeScope(text,readable,visitorAnswers);
      analysis.extraction.reviewNotes.push(...manualReview);
      const unread=analysis.extraction.reviewNotes.filter(note=>/saved for manual review|could not read|automatic read failed/.test(note));
      if(unread.length)warning="Some files need review before pricing. "+unread.join(" ");
    }catch(error){
      console.error("[p5-scope-analysis]",error instanceof Error?error.message:"analysis failed");
      warning="Your files are saved, but automatic reading could not finish. You can retry without uploading again, or add the key details below. Unread documents will need review before pricing.";
    }
    const extraction=analysis?.extraction||draft.extraction;
    const merged=analysis?reconcileScope(visitorAnswers,analysis.extraction,resolutions):{answers:draft.answers,conflicts:[]};
    const wizard={skipped:draft.wizard?.skipped||[],resolutions,sourceVersion:analysis?version:draft.wizard?.sourceVersion};
    // Partial analysis is visible and prevents unread documents from being priced.
    const safeExtraction=warning?{summary:extraction?.summary||text,facts:extraction?.facts||[],conflicts:extraction?.conflicts||[],missingInformation:extraction?.missingInformation||[],reviewNotes:[...new Set([...(extraction?.reviewNotes||[]),warning])]}:extraction;
    const saved=await saveDraft(id,key,ESTIMATOR_BRAND.id,{text,answers:merged.answers,extraction:safeExtraction,reviewed:null,contact:draft.contact,wizard},draft.revision);
    if(requested.some(digest=>!saved.uploads.some(file=>file.sha256===digest)))throw new DraftError("Some files could not be confirmed. Please retry; duplicate files will not be added twice.",503);
    const pricedFields=await costQuestionFields(saved.answers);
    return json({draft:saved,analysis,warning,conflicts:merged.conflicts,pricedFields,questions:scopeQuestions(saved.answers,safeExtraction,merged.conflicts,wizard.skipped,pricedFields)});
  }catch(error){return failed(error);}
}
