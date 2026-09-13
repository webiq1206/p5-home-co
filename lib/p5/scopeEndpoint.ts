import {ProcessingDeadlineError,PROCESSING_PAUSED} from './processingBudget.ts';
import {applyCabinetIntent} from "./projectIntent";
import {advanceAnalysis} from "./analysisWork";
import {queuedJob} from './backgroundJobs';
import {reconcileScope,scopeQuestions,manualScopeAnswers} from "./adaptive";
import {costQuestionFields} from "./questionPolicy";
import {createHash} from "node:crypto";
import { analyzeScope } from "./extraction.ts";
import { prepareAnalysisFiles,verifyUpload } from "./documents";
import { SCOPE_BATCH_LIMIT,SCOPE_TEXT_LIMIT,SCOPE_FILE_COUNT,SCOPE_UPLOAD_HELP } from "./scope.ts";
import { draftCredentials,readDraft,readUploads,saveUpload,saveDraft,DraftError } from "./store";
import { removeInstructionAnswerBlocks } from "./clarifications";
import { failed,json,limitedBody,protectRequest } from "./http";
import { ESTIMATOR_BRAND } from "./brand";
export async function postScope(request:Request){
  try{
    protectRequest(request,1000);const {id,key}=draftCredentials(request);let draft=await readDraft(id,key);
    if(!draft)throw new DraftError("Save your draft before analyzing.",404);
    const bytes=await limitedBody(request,24*1024*1024);
    const form=await new Response(bytes as BodyInit,{headers:{"Content-Type":request.headers.get("content-type")||""}}).formData();
    const text=String(form.get("text")??draft.text);if(text.length>SCOPE_TEXT_LIMIT)throw new DraftError("Upload this scope as a document so every section can be processed.");
    const files=form.getAll("files");if(files.length>SCOPE_FILE_COUNT)throw new DraftError(SCOPE_UPLOAD_HELP);
    const requested:string[]=[];const incoming=[];const known=new Set(draft.uploads.map(f=>f.sha256));
    for(const file of files){
      if(!(file instanceof File))throw new DraftError("Invalid file.");
      let verified;try{verified=verifyUpload(file.name,Buffer.from(await file.arrayBuffer()));}catch(error){throw new DraftError(error instanceof Error?error.message:"Invalid upload.");}
      const digest=createHash("sha256").update(verified.data).digest("hex");
      requested.push(digest);
      if(!known.has(digest)){known.add(digest);incoming.push(verified);}
    }
    if(incoming.length+draft.uploads.length>SCOPE_FILE_COUNT)throw new DraftError(SCOPE_UPLOAD_HELP);
    if(incoming.reduce((n,f)=>n+f.data.length,0)+draft.uploads.reduce((n,f)=>n+f.size,0)>SCOPE_BATCH_LIMIT)throw new DraftError(SCOPE_UPLOAD_HELP,413);
    for(const file of incoming)await saveUpload(id,key,file);
    if(incoming.length){draft=await readDraft(id,key);if(!draft)throw new DraftError("Saved project could not be restored. Please retry.",503);}
    if(form.get("analyze")==="false")return json({draft:await readDraft(id,key),analysis:null});
    const checkpointed=form.get("resumable")==="true"&&process.env.P5_OBJECT_STORAGE_ENABLED==="true";
    const stored=checkpointed?[]:await readUploads(id,key);if(stored.reduce((n,f)=>n+f.data.length,0)>SCOPE_BATCH_LIMIT)throw new DraftError(SCOPE_UPLOAD_HELP,413);
    const priorInstructionAnswers=draft.wizard?.instructionAnswers||[];
    const cleanedText=removeInstructionAnswerBlocks(text,priorInstructionAnswers);
    const cleanedInstructions=removeInstructionAnswerBlocks(draft.answers.estimatingInstructions||"",priorInstructionAnswers);
    const uploadVersion=draft.uploads.map(f=>f.sha256);
    const version=createHash("sha256").update(JSON.stringify([cleanedText,cleanedInstructions,uploadVersion])).digest("hex");
    const legacyVersion=createHash("sha256").update(JSON.stringify([text,uploadVersion])).digest("hex");
     const sourceMatches=draft.wizard?.sourceVersion===version||(cleanedInstructions===""&&draft.wizard?.sourceVersion===legacyVersion);
     const sourceChanged=Boolean(draft.wizard?.sourceVersion&&!sourceMatches);
     const resolutions=sourceMatches?draft.wizard?.resolutions||{}:{};
     const instructionAnswers=sourceChanged?[]:draft.wizard?.instructionAnswers||[];
     const sourceAnswers={...draft.answers};
     if(sourceAnswers.estimatingInstructions)sourceAnswers.estimatingInstructions=cleanedInstructions;
     const visitorAnswers=applyCabinetIntent(cleanedText,ESTIMATOR_BRAND.services,manualScopeAnswers(sourceAnswers,draft.extraction,sourceChanged?{}:draft.wizard?.resolutions)).answers;
    let analysis=null;let warning="";let jobTiming:Record<string,unknown>|undefined;
    try{
      if(checkpointed){
        const background=form.get('background')==='true';
        const job=background?await queuedJob({kind:'analysis',draft,text:cleanedText,answers:visitorAnswers},form.get('retry')==='true'):null;
        if(job&&job.state!=='complete')return json({pending:job.state!=='failed',progress:job.progress,processing:job.processing,timing:{queuedAt:job.createdAt,workerStartedAt:job.startedAt},...(job.state==='failed'?{error:job.progress}:{})},job.state==='failed'?503:200);
        const step=job?job.result:await advanceAnalysis(draft,cleanedText,visitorAnswers,fetch,form.get("retry")==="true");
        if(step.pending)return json(step);
        if(job)jobTiming={queuedAt:job.createdAt,workerStartedAt:job.startedAt,modelStartedAt:step.timing?.modelStartedAt,modelCompletedAt:step.timing?.modelCompletedAt,completedAt:job.completedAt};
        analysis=step.analysis;
      }else{
      const {readable,manualReview}=await prepareAnalysisFiles(stored);
      if(!cleanedText.trim()&&!readable.length&&!Object.values(draft.answers).some(v=>v?.trim()))throw new Error(manualReview.join(" ")||"Add a project description or a document.");
      analysis=await analyzeScope(cleanedText,readable,visitorAnswers);
      analysis.extraction.reviewNotes.push(...manualReview);
      }
      const unread=analysis.extraction.reviewNotes.filter((note:string)=>/saved for manual review|could not read|automatic read failed|automatic reading could not finish|unread section requires review|unreadable|partial/.test(note));
      if(unread.length)warning="Some files need review before pricing. "+unread.join(" ");
    }catch(error){
      if(error instanceof ProcessingDeadlineError)throw new DraftError(PROCESSING_PAUSED,503);
      console.error("[p5-scope-analysis]",error instanceof Error?error.message:"analysis failed");
      warning="Your files are saved, but automatic reading could not finish. You can retry without uploading again, or add the key details below. Unread documents will need review before pricing.";
    }
    if(analysis)analysis.extraction=applyCabinetIntent(cleanedText,ESTIMATOR_BRAND.services,visitorAnswers,analysis.extraction).extraction!;
    const extraction=analysis?.extraction||draft.extraction;
    const merged=analysis?reconcileScope(visitorAnswers,analysis.extraction,resolutions):{answers:draft.answers,conflicts:[]};
     const wizard={instructionAnswers,skipped:draft.wizard?.skipped||[],resolutions,sourceVersion:analysis?version:draft.wizard?.sourceVersion};
    // Partial analysis is visible and prevents unread documents from being priced.
    const safeExtraction=warning?{...extraction,summary:extraction?.summary||cleanedText,facts:extraction?.facts||[],conflicts:extraction?.conflicts||[],missingInformation:extraction?.missingInformation||[],reviewNotes:[...new Set([...(extraction?.reviewNotes||[]),warning])]}:extraction;
    const saved=await saveDraft(id,key,ESTIMATOR_BRAND.id,{text:cleanedText,answers:merged.answers,extraction:safeExtraction,reviewed:null,contact:draft.contact,wizard},draft.revision);
    if(requested.some(digest=>!saved.uploads.some(file=>file.sha256===digest)))throw new DraftError("Some files could not be confirmed. Please retry; duplicate files will not be added twice.",503);
    const pricedFields=await costQuestionFields(saved.answers);
    return json({draft:saved,analysis,warning,timing:jobTiming,conflicts:merged.conflicts,pricedFields,questions:scopeQuestions(saved.answers,safeExtraction,merged.conflicts,wizard.skipped,pricedFields)});
  }catch(error){return failed(error);}
}
