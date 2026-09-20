import {instructionPrompts,instructionPromptText} from './clarifications.ts';
import {resolveInstructionAnswer} from './clarificationAnswer.ts';
import {deriveScopeAnswers,reconcileScope,scopeQuestionsForBrand as scopeQuestions} from "./adaptive.ts";
import {costQuestionFields} from "./questionPolicy.ts";
import { ESTIMATOR_BRAND } from "./brand.ts";
import { draftCredentials, readDraft, saveDraft, DraftError } from "./store.ts";
import { SCOPE_FIELDS, SCOPE_TEXT_LIMIT, validateAnswer, validateExtraction, type ScopeAnswers, type ReviewedScope } from "./scope.ts";
import {answersForEditedScope,answersForReplacedScope,normalizeScopeText,scopeFingerprint,scopeTextChanged} from './scopeReplacement.ts';
import { failed,json,limitedBody,protectRequest } from "./http.ts";
import {draftEvents,recordEvent} from './events.ts';
import {query} from './database.ts';
import {customerPresentation,HIDE_CUSTOMER_UNIT_RATES} from './presentation.ts';

function stable(value:unknown):string{return JSON.stringify(value,(key,item)=>item&&typeof item==="object"&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);}
function withoutInstructions(answers:ScopeAnswers){const copy={...answers};delete copy.estimatingInstructions;return copy;}
function sameClarificationPrefix(value:string|undefined,current:string|undefined,record:{question:string;answer:string}){
  if(value===current)return true;
  if(current===undefined)return false;
  const suffix=`Question: ${record.question}\nAnswer: ${record.answer}`;
  return current===[value,suffix].filter(Boolean).join('\n\n');
}

/**
 * A lost clarification response may be retried with its old revision. This
 * only recognizes the exact prior operation; any other answer, text, contact
 * or wizard change remains a normal optimistic-concurrency conflict.
 */
export function clarificationRetryMatches(existing:{status:string;text:string;answers:ScopeAnswers;contact:{name:string;email:string;phone:string};wizard?:{skipped:string[];resolutions:ScopeAnswers;sourceVersion?:string;instructionAnswers?:{id:string;question:string;answer:string}[]}},raw:any,incomingText:string,answers:ScopeAnswers,contact:{name:string;email:string;phone:string}){
  const value=raw?.clarification as {id?:unknown;answer?:unknown}|undefined;
  if(existing.status!=="draft"||!value||typeof value.id!=="string"||typeof value.answer!=="string"||normalizeScopeText(existing.text)!==incomingText)return false;
  const answer=String(value.answer).trim();
  const record=(existing.wizard?.instructionAnswers||[]).slice().reverse().find(item=>item.id===value.id&&item.answer===answer);
  if(!record)return false;
  if(stable(withoutInstructions(answers))!==stable(withoutInstructions(existing.answers)))return false;
  if(!sameClarificationPrefix(answers.estimatingInstructions,existing.answers.estimatingInstructions,record))return false;
  if(stable(contact)!==stable(existing.contact))return false;
  const incomingWizard=raw.wizard;
  if(incomingWizard){
    const incomingHistory=Array.isArray(incomingWizard.instructionAnswers)?incomingWizard.instructionAnswers:[];
    const priorHistory=(existing.wizard?.instructionAnswers||[]).filter(item=>!(item.id===record.id&&item.answer===record.answer));
    if(stable(incomingHistory)!==stable(priorHistory))return false;
    const incomingSkipped=Array.isArray(incomingWizard.skipped)?incomingWizard.skipped:[];
    if(stable(incomingSkipped)!==stable(existing.wizard?.skipped||[]))return false;
    const incomingResolutions=parseAnswers(incomingWizard.resolutions||{});
    const existingResolutions=existing.wizard?.resolutions||{};
    if(stable(withoutInstructions(incomingResolutions))!==stable(withoutInstructions(existingResolutions)))return false;
    if(!sameClarificationPrefix(incomingResolutions.estimatingInstructions,existingResolutions.estimatingInstructions,record))return false;
    if(incomingWizard.sourceVersion!==undefined&&incomingWizard.sourceVersion!==existing.wizard?.sourceVersion)return false;
  }
  return raw.reviewed!==true&&raw.scopeReplacement!==true&&raw.replaceScope!==true;
}

export async function getDraft(request:Request){try{protectRequest(request);const {id,key}=draftCredentials(request);const draft=await readDraft(id,key);
  // The draft owner may read its own processing events (sanitized, no document
  // contents) so a failed read can be explained and verified from the browser.
  const withEvents=new URL(request.url).searchParams.get('events')==='1'&&draft;
  const [stored]=draft?.status==='submitted'?await query('SELECT customer_estimate FROM p5_estimator_drafts WHERE id=$1',[id]):[];
  return json({draft,...(stored?.customer_estimate?{result:customerPresentation(stored.customer_estimate,{hideUnitRates:HIDE_CUSTOMER_UNIT_RATES})}:{}),...(withEvents?{events:(await draftEvents(id)).map(e=>({at:e.createdAt,kind:e.kind,stage:e.stage,file:e.file,provider:e.provider,model:e.model,status:e.status,code:e.code,message:e.message,durationMs:e.durationMs,attempt:e.attempt,fallback:e.fallback,outcome:e.outcome}))}:{})});}catch(error){return failed(error);}}
export function parseAnswers(raw:unknown):ScopeAnswers {
  if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new DraftError("Invalid project answers.");
  const answers:ScopeAnswers={};
  for(const [field,value]of Object.entries(raw)){
    if(!Object.hasOwn(SCOPE_FIELDS,field)||typeof value!=="string")throw new DraftError("Invalid project answer.");
    const error=validateAnswer(field as keyof ScopeAnswers,value);if(error)throw new DraftError(error);
    answers[field as keyof ScopeAnswers]=value;
  }return answers;
}
export async function putDraft(request:Request){
  try{
    protectRequest(request);const {id,key}=draftCredentials(request);
    const raw=JSON.parse(new TextDecoder().decode(await limitedBody(request,24*1024*1024)));
    if(typeof raw.text!=="string"||raw.text.length>SCOPE_TEXT_LIMIT||!Number.isInteger(raw.revision)||raw.revision<0)throw new DraftError("Invalid draft.");
    const existing=await readDraft(id,key);
    const incomingText=normalizeScopeText(raw.text);
    if(raw.scopeFingerprint!==undefined&&raw.scopeFingerprint!==scopeFingerprint(incomingText))throw new DraftError("The project source fingerprint does not match its text. Refresh before continuing.",409);
    const analyzedMismatch=Boolean(existing?.analyzedFingerprint&&existing.extraction&&existing.analyzedFingerprint!==scopeFingerprint(incomingText));
    const sourceChanged=Boolean(existing&&(scopeTextChanged(existing.text,incomingText)||analyzedMismatch));
    const explicitReplacement=raw.scopeReplacement===true||raw.replaceScope===true||raw.scopeReplacement?.mode==="replace";
    const replacing=Boolean(existing&&(sourceChanged||explicitReplacement));
    let answers=deriveScopeAnswers(parseAnswers(raw.answers));
    let skipped=Array.isArray(raw.wizard?.skipped)?raw.wizard.skipped.filter((k:unknown)=>typeof k==="string"&&Object.hasOwn(SCOPE_FIELDS,k)&&k!=="service"):[];
    const resolutions=parseAnswers(raw.wizard?.resolutions||{});
    let wizard={skipped,resolutions,sourceVersion:existing?.wizard?.sourceVersion,instructionAnswers:existing?.wizard?.instructionAnswers||[]};
    const contact={name:String(raw.contact?.name||"").trim(),email:String(raw.contact?.email||"").trim().toLowerCase(),phone:String(raw.contact?.phone||"").trim()};
    if(contact.name.length>120||contact.email.length>200||contact.phone.length>40)throw new DraftError("Contact details are too long.");
    // A response can be lost after the server commits the clarification. If
    // the retry is byte-equivalent apart from the server's acknowledged
    // clarification mutation, return the current receipt before rejecting its
    // stale revision. Any substantive change still takes the 409 path below.
    if(existing&&raw.clarification&&!replacing&&clarificationRetryMatches(existing,raw,incomingText,answers,contact)){
      const currentAnswers=existing.answers,currentExtraction=existing.extraction,currentResolutions=existing.wizard?.resolutions||{};
      const pricedFields=await costQuestionFields(currentAnswers);
      const conflicts=currentExtraction?reconcileScope(currentAnswers,currentExtraction,currentResolutions).conflicts:[];
      return json({draft:existing,conflicts,questions:scopeQuestions(currentAnswers,currentExtraction,conflicts,existing.wizard?.skipped||[],pricedFields,existing.text),pricedFields});
    }
    if(existing&&raw.clarification&&!replacing&&existing.wizard?.instructionAnswers?.some(item=>item.id===raw.clarification?.id&&item.answer===String(raw.clarification?.answer||"").trim())){
      throw new DraftError('This clarification retry includes other changes. Refresh the saved project before continuing.',409);
    }
    // Provider extraction is immutable to public clients. Corrections live in answers.
    let extraction=existing?.extraction||null;
    if(replacing){
      // A changed source invalidates old analysis, but ordinary edits still
      // retain independently authored answers. Only an explicit replacement
      // requests the stronger blank-answer behavior.
      answers=explicitReplacement
        ? answersForReplacedScope(answers,existing?.extraction||null,existing?.wizard?.resolutions||{},existing?.analyzedAnswers)
        : answersForEditedScope(answers,existing?.extraction||null,existing?.wizard?.resolutions||{},existing?.analyzedAnswers);
      extraction=null;
      wizard={skipped:[],resolutions:{},sourceVersion:undefined,instructionAnswers:[]};
      skipped=[];
      if(raw.reviewed===true)throw new DraftError('Read the updated project before continuing.');
    }
    if(raw.clarification){
      if(replacing)throw new DraftError('This clarification belongs to the previous project text. Read the updated project before answering.',409);
      if(!existing||raw.revision!==existing.revision)throw new DraftError('Your project changed in another tab. Refresh to continue.',409);
      const resolved=await resolveInstructionAnswer(extraction,answers,raw.clarification,wizard.instructionAnswers,undefined,incomingText);
      extraction=resolved.extraction;answers=resolved.answers;wizard.instructionAnswers=resolved.history;
      // An earlier correction cannot resolve a new contradiction automatically.
      if('unresolvedFields' in resolved)for(const field of resolved.unresolvedFields||[])delete wizard.resolutions[field];
      wizard.resolutions.estimatingInstructions=answers.estimatingInstructions;
    }
    if(extraction?.instructions)extraction={...extraction,instructions:{...extraction.instructions,questions:instructionPrompts(extraction,answers,incomingText).map(instructionPromptText)}};
    let reviewed:ReviewedScope|null=null;
    if(raw.reviewed===true){
      if(extraction?.instructions?.questions.length)throw new DraftError('Answer the remaining scope question before continuing.');
      const unresolved=extraction?reconcileScope(answers,extraction,resolutions).conflicts:[];
      const dependencies=await costQuestionFields(answers);
      const remaining=scopeQuestions(answers,extraction,unresolved,skipped,dependencies,incomingText);
      if(remaining.length)throw new DraftError(remaining[0].handoff?'Use the matching company estimator for this project.':`Answer the remaining ${remaining[0].label.toLowerCase()} question before continuing.`);
      reviewed={text:incomingText,answers,extraction,uncertainFields:skipped,uploads:existing?.uploads||[],reviewedAt:new Date().toISOString(),
        corrections:Object.entries(answers).filter(([field,value])=>{const fact=extraction?.facts.find(f=>f.field===field);return fact&&fact.value!==value;}).map(([field,value])=>({field:field as keyof ScopeAnswers,previous:extraction!.facts.find(f=>f.field===field)!.value,value:value!})),
      };
    }
    const draft=await saveDraft(id,key,ESTIMATOR_BRAND.id,{text:incomingText,answers,extraction,reviewed,contact,wizard,analyzedFingerprint:replacing?undefined:existing?.analyzedFingerprint,analyzedAnswers:replacing?undefined:existing?.analyzedAnswers},raw.revision);
    const pricedFields=await costQuestionFields(answers);
    const conflicts=extraction?reconcileScope(answers,extraction,resolutions).conflicts:[];
    return json({draft,conflicts,questions:scopeQuestions(answers,extraction,conflicts,skipped,pricedFields,incomingText),pricedFields});
  }catch(error){
    if(error instanceof DraftError&&error.status===409){try{const {id}=draftCredentials(request);void recordEvent({draftId:id,kind:'draft',stage:'save-revision',status:409,code:'revision-conflict',message:error.message,outcome:'failed'});}catch{}}
    return failed(error);
  }
}
