import {ProcessingDeadlineError,PROCESSING_PAUSED,isProcessingDeadline} from './processingBudget.ts';
import {applyCabinetIntent} from "./projectIntent.ts";
import {advanceAnalysis} from "./analysisWork.ts";
import {queuedJob} from './backgroundJobs.ts';
import {manualScopeAnswers,reconcileScope,scopeQuestionsForBrand as scopeQuestions} from "./adaptive.ts";
import {costQuestionFields} from "./questionPolicy.ts";
import {createHash} from "node:crypto";
import { analyzeScope } from "./extraction.ts";
import { prepareAnalysisFiles,verifyUpload } from "./documents.ts";
import { SCOPE_BATCH_LIMIT,SCOPE_TEXT_LIMIT,SCOPE_FILE_COUNT,SCOPE_UPLOAD_HELP,SCOPE_FIELDS } from "./scope.ts";
import { draftCredentials,readDraft,readUploads,saveUpload,saveDraft,DraftError } from "./store.ts";
import {answersForEditedScope,normalizeScopeText,scopeFingerprint,scopeTextChanged,sourceSnapshot,sourceSnapshotsEqual} from "./scopeReplacement.ts";
import { failed,json,limitedBody,protectRequest } from "./http.ts";
import { ESTIMATOR_BRAND } from "./brand.ts";
import {recordEvent,describeError} from './events.ts';
import {blockingReviewNote} from './costBook.ts';

/** Guard multipart analysis/upload requests before they can mutate files. */
export function guardScopeRequestRevision(storedRevision:number,requestedRevision:unknown,storedText:string,incomingText:string){
  const supplied=requestedRevision!==undefined&&requestedRevision!==null&&String(requestedRevision).trim()!=="";
  const changed=scopeTextChanged(storedText,incomingText);
  if(supplied){
    const revision=Number(requestedRevision);
    if(!Number.isInteger(revision)||revision<0)throw new DraftError("Invalid draft revision.",409);
    if(revision!==storedRevision)throw new DraftError("This project was updated elsewhere. Refresh to continue.",409);
  }else if(changed){
    throw new DraftError("This project was updated elsewhere. Refresh to continue.",409);
  }
  return {changed,supplied};
}
export function guardUploadedSourceSnapshot(expectedRevision:number,rereadRevision:number,expectedSource:ReturnType<typeof sourceSnapshot>,rereadSource:ReturnType<typeof sourceSnapshot>){
  if(rereadRevision!==expectedRevision||!sourceSnapshotsEqual(expectedSource,rereadSource))throw new DraftError("This project changed while its files were uploading. The files are saved; refresh before continuing.",409);
}
export async function postScope(request:Request){
  try{
    protectRequest(request,1000);const {id,key}=draftCredentials(request);let draft=await readDraft(id,key);
    if(!draft)throw new DraftError("Save your draft before analyzing.",404);
    const bytes=await limitedBody(request,24*1024*1024);
    const form=await new Response(bytes as BodyInit,{headers:{"Content-Type":request.headers.get("content-type")||""}}).formData();
    const text=normalizeScopeText(String(form.get("text")??draft.text));if(text.length>SCOPE_TEXT_LIMIT)throw new DraftError("Upload this scope as a document so every section can be processed.");
    if(form.get("scopeFingerprint")!==null&&form.get("scopeFingerprint")!==scopeFingerprint(text))throw new DraftError("The project source fingerprint does not match its text. Refresh before continuing.",409);
    // Validate the caller's snapshot before reading, storing or replacing
    // anything. Legacy clients may upload only when they send the same source
    // text; a missing revision must never authorize a source rewrite.
    const requestIdentity=guardScopeRequestRevision(draft.revision,form.get("revision"),draft.text,text);
    const analyzedMismatch=Boolean(draft.analyzedFingerprint&&draft.extraction&&draft.analyzedFingerprint!==scopeFingerprint(text));
    const sourceChanged=requestIdentity.changed||analyzedMismatch;
    // Keep the authored source snapshot from the request's validated read.
    // Uploads may race another tab; the reread below must not be allowed to
    // launder that newer revision into this request's old source.
    const expectedSource=sourceSnapshot(draft);
    let analysisDraft=draft;
    const files=form.getAll("files");if(files.length>SCOPE_FILE_COUNT)throw new DraftError(SCOPE_UPLOAD_HELP);
    const requested:string[]=[];const incoming=[];const known=new Set(analysisDraft.uploads.map(f=>f.sha256));
    for(const file of files){
      if(!(file instanceof File))throw new DraftError("Invalid file.");
      let verified;try{verified=verifyUpload(file.name,Buffer.from(await file.arrayBuffer()));}catch(error){throw new DraftError(error instanceof Error?error.message:"Invalid upload.");}
      const digest=createHash("sha256").update(verified.data).digest("hex");
      requested.push(digest);
      if(!known.has(digest)){known.add(digest);incoming.push(verified);}
    }
    if(incoming.length+analysisDraft.uploads.length>SCOPE_FILE_COUNT)throw new DraftError(SCOPE_UPLOAD_HELP);
    if(incoming.reduce((n,f)=>n+f.data.length,0)+analysisDraft.uploads.reduce((n,f)=>n+f.size,0)>SCOPE_BATCH_LIMIT)throw new DraftError(SCOPE_UPLOAD_HELP,413);
    for(const file of incoming)await saveUpload(id,key,file);
    const reread=await readDraft(id,key);if(!reread)throw new DraftError("Saved project could not be restored. Please retry.",503);
    guardUploadedSourceSnapshot(draft.revision,reread.revision,expectedSource,sourceSnapshot(reread));
    draft=reread;
    // PUT normally performs this invalidation first. Repeat it at the
    // analysis boundary so a direct/replayed analysis request cannot reuse
    // an extraction or wizard decision from another source text.
    if(sourceChanged){
      const resetAnswers=answersForEditedScope(draft.answers,draft.extraction,draft.wizard?.resolutions||{},draft.analyzedAnswers);
      const resetWizard={skipped:[],resolutions:{},sourceVersion:undefined,instructionAnswers:[]};
      const reset=await saveDraft(id,key,ESTIMATOR_BRAND.id,{text,answers:resetAnswers,extraction:null,reviewed:null,contact:draft.contact,wizard:resetWizard,analyzedFingerprint:undefined,analyzedAnswers:undefined},draft.revision);
      draft=reset;analysisDraft=reset;
    }else analysisDraft=draft;
    if(form.get("analyze")==="false")return json({draft:await readDraft(id,key),analysis:null});
    const checkpointed=form.get("resumable")==="true"&&process.env.P5_OBJECT_STORAGE_ENABLED==="true";
    const stored=checkpointed?[]:await readUploads(id,key);if(stored.reduce((n,f)=>n+f.data.length,0)>SCOPE_BATCH_LIMIT)throw new DraftError(SCOPE_UPLOAD_HELP,413);
    const version=createHash("sha256").update(JSON.stringify([text,analysisDraft.uploads.map(f=>f.sha256)])).digest("hex");
    const resolutions=analysisDraft.wizard?.sourceVersion===version?analysisDraft.wizard.resolutions:{};
    // Only visitor-authored answers shape the read. Facts the previous read
    // derived from these same documents are re-derived, so a retry after a
    // partial read keeps the same work key and never re-bills finished pages.
    const visitorAnswers=applyCabinetIntent(text,ESTIMATOR_BRAND.services,manualScopeAnswers(analysisDraft.answers,analysisDraft.extraction,analysisDraft.wizard?.resolutions||{})).answers;
    let analysis=null;let warning="";
    try{
      if(checkpointed){
        const background=form.get('background')==='true';
        const job=background?await queuedJob({kind:'analysis',draft:analysisDraft,text,answers:visitorAnswers},form.get('retry')==='true'):null;
        if(job&&job.state!=='complete')return json({pending:job.state!=='failed',progress:job.progress,processing:job.processing,revision:draft.revision,draftRevision:draft.revision,...(job.state==='failed'?{error:job.progress}:{})},job.state==='failed'?503:200);
        const step=job?job.result:await advanceAnalysis(analysisDraft,text,visitorAnswers,fetch,form.get("retry")==="true");
         if(step.pending)return json({...step,revision:draft.revision,draftRevision:draft.revision});
        analysis=step.analysis;
      }else{
      const {readable,manualReview}=await prepareAnalysisFiles(stored);
      if(!text.trim()&&!readable.length&&!Object.values(analysisDraft.answers).some(v=>v?.trim()))throw new Error(manualReview.join(" ")||"Add a project description or a document.");
      analysis=await analyzeScope(text,readable,visitorAnswers);
      analysis.extraction.reviewNotes.push(...manualReview);
      }
      // Only content that was not read blocks the estimate. A page the reader
      // finished with some values blank or redacted is a note to confirm, the
      // same rule the pricing engine applies.
      const unread=[...new Set(analysis.extraction.reviewNotes.filter((note:string)=>blockingReviewNote(note)))];
      if(unread.length)warning="Some files need review before pricing. "+unread.join(" ");
    }catch(error){
      if(isProcessingDeadline(error))throw new DraftError(PROCESSING_PAUSED,503);
      console.error("[p5-scope-analysis]",error instanceof Error?error.message:"analysis failed");
      const detail=describeError(error);
      void recordEvent({draftId:id,estimator:visitorAnswers.service||null,kind:'analysis',stage:'scope-request',code:detail.code,status:detail.status,message:detail.message,outcome:'failed'});
      warning="Your files are saved, but automatic reading could not finish. You can retry without uploading again, or add the key details below. Unread documents will need review before pricing.";
    }
    if(analysis)analysis.extraction=applyCabinetIntent(text,ESTIMATOR_BRAND.services,visitorAnswers,analysis.extraction).extraction!;
    const extraction=analysis?.extraction||analysisDraft.extraction;
    const merged=analysis?reconcileScope(visitorAnswers,analysis.extraction,resolutions):{answers:analysisDraft.answers,conflicts:[]};
    const wizard={instructionAnswers:sourceChanged?[]:analysisDraft.wizard?.instructionAnswers||[],skipped:sourceChanged?[]:analysisDraft.wizard?.skipped||[],resolutions,sourceVersion:analysis?version:sourceChanged?undefined:analysisDraft.wizard?.sourceVersion};
    // Partial analysis is visible and prevents unread documents from being priced.
    const safeExtraction=warning?{...extraction,summary:extraction?.summary||text,facts:extraction?.facts||[],conflicts:extraction?.conflicts||[],missingInformation:extraction?.missingInformation||[],reviewNotes:[...new Set([...(extraction?.reviewNotes||[]),warning])]}:extraction;
    const analyzedAnswers=analysis?JSON.stringify(Object.entries(merged.answers).filter(([field,value])=>SCOPE_FIELDS[field as keyof typeof SCOPE_FIELDS].kind==='text'&&value?.trim()).sort(([a],[b])=>a.localeCompare(b))):undefined;
    const saved=await saveDraft(id,key,ESTIMATOR_BRAND.id,{text,answers:merged.answers,extraction:safeExtraction,reviewed:null,contact:analysisDraft.contact,wizard,analyzedFingerprint:analysis?scopeFingerprint(text):undefined,analyzedAnswers},draft.revision);
    if(requested.some(digest=>!saved.uploads.some(file=>file.sha256===digest)))throw new DraftError("Some files could not be confirmed. Please retry; duplicate files will not be added twice.",503);
    const pricedFields=await costQuestionFields(saved.answers);
    return json({draft:saved,analysis,warning,conflicts:merged.conflicts,pricedFields,questions:scopeQuestions(saved.answers,safeExtraction,merged.conflicts,wizard.skipped,pricedFields,text)});
  }catch(error){
    if(error instanceof DraftError&&error.status===409){try{const {id}=draftCredentials(request);void recordEvent({draftId:id,kind:'draft',stage:'scope-revision',status:409,code:'revision-conflict',message:error.message,outcome:'failed'});}catch{}}
    return failed(error);
  }
}
