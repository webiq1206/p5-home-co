import {instructionPrompts} from './clarifications.ts';
import {ESTIMATOR_BRAND} from './brand.ts';
import {SCOPE_FIELDS,mergeScopeFacts,requiredScopeQuestions,validateAnswer,type ScopeAnswers,type ScopeField,type ScopeExtraction,type ScopeConflict} from './scope.ts';

export interface ScopeQuestion {field:ScopeField;label:string;reason:string;values?:string[];conflict?:boolean;instructionId?:string;detail?:string}
export function sameAnswer(field:ScopeField,a:string,b:string){
  if(SCOPE_FIELDS[field].kind==='number')return Number(a.replaceAll(',',''))===Number(b.replaceAll(',',''));
  return a.trim().toLowerCase()===b.trim().toLowerCase();
}
/** Re-read source-derived values from the current documents; keep actual visitor answers. */
export function manualScopeAnswers(current:ScopeAnswers,previous:ScopeExtraction|null,resolutions:ScopeAnswers={}){
  if(!previous)return {...current};
  const extracted=deriveScopeAnswers(mergeScopeFacts({},previous).answers);
  const answers={...current};
  for(const key of Object.keys(extracted) as ScopeField[]){
    if(!resolutions[key]&&current[key]!==undefined&&sameAnswer(key,current[key]!,extracted[key]!))delete answers[key];
  }
  return answers;
}
/** Only arithmetic on explicit dimensions. Photos never supply an assumed scale. */
export function deriveScopeAnswers(input:ScopeAnswers){
  const answers={...input};
  if(!answers.sqft?.trim()&&answers.length?.trim()&&answers.width?.trim()){
    const area=Number(answers.length.replaceAll(',',''))*Number(answers.width.replaceAll(',',''));
    if(Number.isFinite(area)&&area>0&&area<=1000000)answers.sqft=String(Math.round(area*100)/100);
  }
  return answers;
}
/** A source fact may suppress a question only after local validation, with
 * enough confidence to price it and without an unresolved field conflict.
 * validateExtraction normally performs the same evidence/basis gating before
 * this function is reached; keeping the guard here protects direct callers. */
function isValidatedSuppliedFact(fact:ScopeExtraction['facts'][number],conflicts:ScopeConflict[]){
  return Number.isFinite(fact.confidence)&&fact.confidence>=.85
    &&Boolean(fact.value?.trim())
    &&fact.basis!=='visual'&&fact.basis!=='inferred'
    &&!validateAnswer(fact.field,fact.value)
    &&!conflicts.some(conflict=>conflict.field===fact.field);
}
export function reconcileScope(current:ScopeAnswers,extraction:ScopeExtraction,resolutions:ScopeAnswers={}){
  const unresolvedConflicts=extraction.conflicts.filter(c=>!resolutions[c.field]||!sameAnswer(c.field,resolutions[c.field]!,current[c.field]||''));
  const normalized={...extraction,facts:extraction.facts.filter(f=>isValidatedSuppliedFact(f,unresolvedConflicts)).map(f=>({...f,value:current[f.field]&&sameAnswer(f.field,current[f.field]!,f.value)?current[f.field]!:f.value})),conflicts:unresolvedConflicts};
  const resolvedFacts=normalized.facts.filter(f=>!resolutions[f.field]||!sameAnswer(f.field,resolutions[f.field]!,current[f.field]||''));
  const merged=mergeScopeFacts(current,{...normalized,facts:resolvedFacts});
  const answers=deriveScopeAnswers(merged.answers);
  const conflicts=merged.conflicts.filter((c,i,all)=>all.findIndex(v=>v.field===c.field)===i);
  if(current.sqft&&current.length&&current.width){
    const calculated=deriveScopeAnswers({...current,sqft:''}).sqft;
    if(calculated&&!sameAnswer('sqft',current.sqft,calculated)&&!resolutions.sqft)conflicts.push({field:'sqft',values:[current.sqft,calculated],explanation:'The stated area differs from length multiplied by width. Which area is being estimated?'});
  }
  // mergeScopeFacts detects duplicate high-confidence values while merging.
  // Do not leave its first value in answers when no visitor answer exists:
  // that would make a conflict look resolved on the next question pass.
  for(const conflict of conflicts)if(!current[conflict.field]?.trim())delete answers[conflict.field];
  return {answers,conflicts};
}
const remodels=['kitchen','bathroom','whole-home'];
const builds=['addition','adu','new-construction'];
/** Services whose material pricing scales with the finish level. */
export const finishServices=[...remodels,...builds,'cabinet-product','cabinet-install'];
export function materialScopeFields(answers:ScopeAnswers,pricedFields:ScopeField[]=[]):ScopeField[]{
  const service=answers.service;
  const required=requiredScopeQuestions(answers);
  if(service&&builds.includes(service)&&answers.garageIncluded==='yes'&&!answers.garageSqft?.trim())required.push('garageSqft');
  // Finish level multiplies every material line (0.85 to 1.6), so it is asked
  // whenever it is not set, even when materials were described.
  if(service&&finishServices.includes(service)&&!answers.finish?.trim())required.push('finish');
  if(service&&[...remodels,...builds].includes(service)){
    // One description captures the work, including retained and changed items.
    if(!answers.taskList&&!answers.demolition&&!answers.structural&&!answers.otherDetails)required.push('taskList');
  }
  return [...new Set([...required,...pricedFields])].filter(k=>!answers[k]?.trim());
}
const detailQuestions:Partial<Record<ScopeField,string>>={
 cabinetRoom:'Which room are the cabinets for?',
 cabinetBaseLf:'How many linear feet of base cabinets are needed?',
 cabinetUpperLf:'How many linear feet of wall cabinets are needed?',
 cabinetTallLf:'How many linear feet of tall cabinets are needed?',
 garageSqft:'How many square feet is the garage?',
 coveredOutdoorSqft:'How many square feet of covered outdoor space are included?',
 laborHours:'How many total labor hours are included?',
 projectMonths:'How many months do you expect the work to take?',
 rooms:'How many rooms are included?',
 bathrooms:'How many bathrooms are included?',
 stories:'How many stories are included?',
};
/** Everyday wording for one missing detail. Shared by the question flow and the missing-detail links shown after Get my estimate. */
export function questionReason(field:ScopeField,answers:ScopeAnswers):string{
  const service=answers.service||"";
  if(field==="service")return "What would you like help with?";
  if(field==="taskList")return "What work should be included? A short list with quantities is enough.";
  if(field==="sqft")return builds.includes(service)?"About how many square feet of living space are included? Keep garage and outdoor areas separate.":"About how large is the area being worked on?";
  if(field==="finish")return "What finish level would you like?";
  return detailQuestions[field]||`What should we use for ${SCOPE_FIELDS[field].label.toLowerCase()}?`;
}
export function questionForField(field:ScopeField,answers:ScopeAnswers):ScopeQuestion{
  const definition=SCOPE_FIELDS[field];
  return {field,label:definition.label,reason:questionReason(field,answers),...(definition.kind==="choice"?{values:definition.options.filter(v=>field!=="service"||(ESTIMATOR_BRAND.services as readonly string[]).includes(v))}:{})};
}
export function scopeQuestions(input:ScopeAnswers,extraction:ScopeExtraction|null,conflicts:ScopeConflict[]=[],skipped:ScopeField[]=[],pricedFields:ScopeField[]=[]):ScopeQuestion[]{
  const answers=deriveScopeAnswers(input);
  const relevant=new Set<ScopeField>(['service',...materialScopeFields(answers,pricedFields),...pricedFields]);
  // A document that already lists the work with quantities answers the task question; asking again repeats what was supplied.
  if((extraction?.takeoffs?.length||0)>0)relevant.delete('taskList');
  // An uncertain stated quantity is more useful as one clarification than a blank form.
  const uncertain=(extraction?.facts||[]).filter(f=>f.confidence<.85&&f.confidence>=.4&&!answers[f.field]?.trim()&&relevant.has(f.field));
  const questions:ScopeQuestion[]=conflicts.map(c=>({field:c.field,label:SCOPE_FIELDS[c.field].label,reason:c.explanation,values:c.values,conflict:true}));
  questions.unshift(...instructionPrompts(extraction,answers).map(q=>({field:q.field||'estimatingInstructions' as const,label:q.field?SCOPE_FIELDS[q.field].label:'One scope detail',reason:q.question,detail:q.detail,values:q.values,...(!q.field?{instructionId:q.id}:{})})));
  for(const fact of uncertain)if(!questions.some(q=>q.field===fact.field)&&!skipped.includes(fact.field))questions.push({field:fact.field,label:SCOPE_FIELDS[fact.field].label,reason:`${SCOPE_FIELDS[fact.field].label}: we found “${fact.value}” in ${fact.source}. Is that correct?`,values:[fact.value]});
  for(const q of extraction?.clarifications||[])if(relevant.has(q.field)&&!(q.field==='finish'&&answers.materials)&&!(['address','location','schedule','urgency'].includes(q.field)&&!pricedFields.includes(q.field))&&!answers[q.field]?.trim()&&!skipped.includes(q.field)&&!questions.some(x=>x.field===q.field))questions.push({field:q.field,label:SCOPE_FIELDS[q.field].label,reason:SCOPE_FIELDS[q.field].kind==='number'?`Please confirm ${SCOPE_FIELDS[q.field].label.toLowerCase()}. Approximate is fine.`:q.question});
  for(const field of relevant)if(!answers[field]?.trim()&&!questions.some(q=>q.field===field)&&!skipped.includes(field))questions.push({field,label:SCOPE_FIELDS[field].label,reason:field==='service'?'What would you like help with?':field==='taskList'?'What work should be included? A short list with quantities is enough.':field==='sqft'?(builds.includes(answers.service||'')?'About how many square feet of living space are included? Keep garage and outdoor areas separate.':'About how large is the area being worked on?'):field==='finish'?'What finish level would you like?':detailQuestions[field]||`What should we use for ${SCOPE_FIELDS[field].label.toLowerCase()}?`});
  return questions.map(q=>{const definition=SCOPE_FIELDS[q.field];return {...q,...(!q.values?.length&&definition.kind==='choice'?{values:definition.options.filter(v=>q.field!=='service'||(ESTIMATOR_BRAND.services as readonly string[]).includes(v))}:{}),...(q.reason.length>240?{reason:`Please confirm ${q.label.toLowerCase()}.`,detail:q.reason}:{})};});
}
export function validateScopeAnswer(field:ScopeField,value:string){
  const error=validateAnswer(field,value);if(error)return error;
  if(['sqft','length','width','rooms','stories'].includes(field)&&value.trim()&&Number(value.replaceAll(',',''))<=0)return 'Enter a number greater than zero, or choose Not sure yet.';
  return null;
}
export function scopeAssumptions(answers:ScopeAnswers,skipped:ScopeField[]=[]){
  const notes:string[]=[];
  if(!answers.location&&!answers.address)notes.push('General service-area pricing; location, access and jurisdiction will be confirmed.');
  if(!answers.urgency)notes.push('Standard scheduling; priority or emergency work is not included.');
  if(!answers.finish&&finishServices.includes(answers.service||''))notes.push('Finish level not chosen; standard finishes are assumed until you select one.');
  if(answers.length&&answers.width&&answers.sqft&&sameAnswer('sqft',answers.sqft,deriveScopeAnswers({...answers,sqft:''}).sqft||'0'))notes.push(`Project area calculated from ${answers.length} × ${answers.width} feet. Confirm irregular areas during the site visit.`);
  for(const k of skipped)if(!answers[k])notes.push(`${SCOPE_FIELDS[k].label}: not yet known; requires an allowance or pricing review.`);
  return notes;
}

/** Resolve company scope before asking technical questions for another service. */
export function scopeQuestionsForBrand(...args:Parameters<typeof scopeQuestions>):ScopeQuestion[]{
 const service=args[0].service;
 if(service&&!(ESTIMATOR_BRAND.services as readonly string[]).includes(service))return [{
  field:'service',label:'Project type',reason:`Which part of this project should ${ESTIMATOR_BRAND.name} estimate?`,
  values:[...ESTIMATOR_BRAND.services],
  detail:'Choose the work you want this company to handle. Your complete project description and documents are retained.',
 }];
 // Different cabinet locations in a whole project are additive scope.
 if(service&&!service.startsWith('cabinet-')){
  const next=[...args] as Parameters<typeof scopeQuestions>;
  next[2]=(args[2]||[]).filter(conflict=>conflict.field!=='cabinetRoom');
  if(args[1])next[1]={...args[1],conflicts:args[1].conflicts.filter(conflict=>conflict.field!=='cabinetRoom')};
  return scopeQuestions(...next).filter(question=>question.field!=='cabinetRoom');
 }
 return scopeQuestions(...args);
}
