import {deriveScopeAnswers,reconcileScope,scopeQuestions} from "./adaptive";
import {costQuestionFields} from "./questionPolicy";
import { ESTIMATOR_BRAND } from "./brand";
import { draftCredentials, readDraft, saveDraft, DraftError } from "./store";
import { SCOPE_FIELDS, SCOPE_TEXT_LIMIT, validateAnswer, validateExtraction, type ScopeAnswers, type ReviewedScope } from "./scope.ts";
import { failed,json,limitedBody,protectRequest } from "./http";
export async function getDraft(request:Request){try{protectRequest(request);const {id,key}=draftCredentials(request);return json({draft:await readDraft(id,key)});}catch(error){return failed(error);}}
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
    const raw=JSON.parse(new TextDecoder().decode(await limitedBody(request,240000)));
    if(typeof raw.text!=="string"||raw.text.length>SCOPE_TEXT_LIMIT||!Number.isInteger(raw.revision)||raw.revision<0)throw new DraftError("Invalid draft.");
    const answers=deriveScopeAnswers(parseAnswers(raw.answers));const existing=await readDraft(id,key);
    const skipped=Array.isArray(raw.wizard?.skipped)?raw.wizard.skipped.filter((k:unknown)=>typeof k==="string"&&Object.hasOwn(SCOPE_FIELDS,k)&&k!=="service"):[];
    const resolutions=parseAnswers(raw.wizard?.resolutions||{});
    const wizard={skipped,resolutions,sourceVersion:existing?.wizard?.sourceVersion};
    // Provider extraction is immutable to public clients. Corrections live in answers.
    const extraction=existing?.extraction||null;
    const contact={name:String(raw.contact?.name||"").trim(),email:String(raw.contact?.email||"").trim().toLowerCase(),phone:String(raw.contact?.phone||"").trim()};
    if(contact.name.length>120||contact.email.length>200||contact.phone.length>40)throw new DraftError("Contact details are too long.");
    let reviewed:ReviewedScope|null=null;
    if(raw.reviewed===true){
      const unresolved=extraction?reconcileScope(answers,extraction,resolutions).conflicts:[];
      if(unresolved.length)throw new DraftError(`Confirm ${SCOPE_FIELDS[unresolved[0].field].label} before submitting.`);
      for(const conflict of extraction?.conflicts||[])if(!answers[conflict.field]?.trim())throw new DraftError(`Resolve ${SCOPE_FIELDS[conflict.field].label} before submitting.`);
      reviewed={text:raw.text,answers,extraction,uncertainFields:skipped,uploads:existing?.uploads||[],reviewedAt:new Date().toISOString(),
        corrections:Object.entries(answers).filter(([field,value])=>{const fact=extraction?.facts.find(f=>f.field===field);return fact&&fact.value!==value;}).map(([field,value])=>({field:field as keyof ScopeAnswers,previous:extraction!.facts.find(f=>f.field===field)!.value,value:value!})),
      };
    }
    const draft=await saveDraft(id,key,ESTIMATOR_BRAND.id,{text:raw.text,answers,extraction,reviewed,contact,wizard},raw.revision);
    const pricedFields=await costQuestionFields(answers);
    const conflicts=extraction?reconcileScope(answers,extraction,resolutions).conflicts:[];
    return json({draft,conflicts,questions:scopeQuestions(answers,extraction,conflicts,skipped,pricedFields),pricedFields});
  }catch(error){return failed(error);}
}
