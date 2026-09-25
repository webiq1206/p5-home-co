import {instructionPrompts,instructionPromptText} from './clarifications.ts';
import {ESTIMATOR_BRAND} from './brand.ts';
import {SCOPE_FIELDS,mergeScopeFacts,validateAnswer,type ScopeAnswers,type ScopeField,type ScopeExtraction,type ScopeConflict} from './scope.ts';
import {dynamicScopeFields,questionContext,scopeFieldApplies,scopePromptApplies} from './dynamicQuestions.ts';
import {serviceEvidenceSupports} from './serviceSignals.ts';

export interface ScopeQuestion {field:ScopeField;label:string;reason:string;values?:string[];conflict?:boolean;instructionId?:string;detail?:string;handoff?:{label:string;url:string}}
export function sameAnswer(field:ScopeField,a:string,b:string){
  if(SCOPE_FIELDS[field].kind==='number')return Number(a.replaceAll(',',''))===Number(b.replaceAll(',',''));
  return a.trim().toLowerCase()===b.trim().toLowerCase();
}
/** Source-derived answers are replaced on reread; deliberate visitor corrections are retained. */
export function manualScopeAnswers(current:ScopeAnswers,previous:ScopeExtraction|null,resolutions:ScopeAnswers={}){
  if(!previous)return {...current};
  const extracted=deriveScopeAnswers(mergeScopeFacts({},previous).answers);
  const answers={...current};
  for(const key of Object.keys(extracted) as ScopeField[]){if(!resolutions[key]&&current[key]!==undefined&&sameAnswer(key,current[key]!,extracted[key]!))delete answers[key];}
  return answers;
}
export function deriveScopeAnswers(input:ScopeAnswers){
  const answers={...input};
  if(!answers.sqft?.trim()&&answers.length?.trim()&&answers.width?.trim()){
    const area=Number(answers.length.replaceAll(',',''))*Number(answers.width.replaceAll(',',''));
    if(Number.isFinite(area)&&area>0&&area<=1000000)answers.sqft=String(Math.round(area*100)/100);
  }
  return answers;
}
function isValidatedSuppliedFact(fact:ScopeExtraction['facts'][number],conflicts:ScopeConflict[]){
  // The project type is a classification the customer sees and can change on
  // the review screen, not a measured fact. A stated type this company offers
  // is accepted at a lower bar so an obvious bathroom job is not asked its type.
  const floor=fact.field==='service'&&fact.basis==='stated'&&(ESTIMATOR_BRAND.services as readonly string[]).includes(fact.value)?.7:.85;
  // A policy-changing type (RE-10, rush, change order) needs the customer's own words behind it.
  // Live P5 (2026-09-25): a flooring request was "stated" as re10 with the flooring sentence as
  // evidence and issued at one firm RE-10 price. Without a signal the type is asked, not assumed.
  if(fact.field==='service'&&!serviceEvidenceSupports(fact.value,fact.evidence))return false;
  return Number.isFinite(fact.confidence)&&fact.confidence>=floor&&Boolean(fact.value?.trim())&&fact.basis!=='visual'&&fact.basis!=='inferred'&&!validateAnswer(fact.field,fact.value)&&!conflicts.some(conflict=>conflict.field===fact.field);
}
export function reconcileScope(current:ScopeAnswers,extraction:ScopeExtraction,resolutions:ScopeAnswers={}){
  const unresolvedConflicts=extraction.conflicts.filter(c=>!resolutions[c.field]||!sameAnswer(c.field,resolutions[c.field]!,current[c.field]||''));
  const normalized={...extraction,facts:extraction.facts.filter(f=>isValidatedSuppliedFact(f,unresolvedConflicts)).map(f=>({...f,value:current[f.field]&&sameAnswer(f.field,current[f.field]!,f.value)?current[f.field]!:f.value})),conflicts:unresolvedConflicts};
  const resolvedFacts=normalized.facts.filter(f=>!resolutions[f.field]||!sameAnswer(f.field,resolutions[f.field]!,current[f.field]||''));
  const merged=mergeScopeFacts(current,{...normalized,facts:resolvedFacts});
  const answers=deriveScopeAnswers(merged.answers);
  const conflicts=merged.conflicts.filter((c,i,all)=>all.findIndex(v=>v.field===c.field)===i);
  if(current.sqft&&current.length&&current.width){const calculated=deriveScopeAnswers({...current,sqft:''}).sqft;if(calculated&&!sameAnswer('sqft',current.sqft,calculated)&&!resolutions.sqft)conflicts.push({field:'sqft',values:[current.sqft,calculated],explanation:'The stated area differs from length multiplied by width. Which area is being estimated?'});}
  for(const conflict of conflicts)if(!current[conflict.field]?.trim())delete answers[conflict.field];
  return {answers,conflicts};
}
const remodels=['kitchen','bathroom','whole-home'];
const builds=['addition','adu','new-construction'];
export const finishServices=[...remodels,...builds,'cabinet-product','cabinet-install'];
export function finishOptionsForService(service?:string):string[]{
  // Every service offers all four of the price book's tiers. Builder Grade was once hidden for new
  // builds and cabinets, but it is the book's production-builder spec: exactly the tier a spec home
  // or a stock-cabinet job is priced at, so hiding it priced those jobs a tier too high.
  void service;
  return [...SCOPE_FIELDS.finish.options];
}
/** One shared scope-aware queue for the browser and server. A catalog dependency is
 * not permission to ask about an excluded trade or repeat a supplied measurement. */
export function materialScopeFields(answers:ScopeAnswers,pricedFields:ScopeField[]=[],extraction:ScopeExtraction|null=null,sourceText=''):ScopeField[]{
  return dynamicScopeFields(deriveScopeAnswers(answers),extraction,pricedFields,sourceText);
}
const detailQuestions:Partial<Record<ScopeField,string>>={
  cabinetRoom:'Which room are the cabinets for?',cabinetBaseLf:'How many linear feet of base cabinets are needed?',
  cabinetUpperLf:'How many linear feet of wall cabinets are needed?',cabinetTallLf:'How many linear feet of tall cabinets are needed? Enter 0 if there are none.',
  garageIncluded:'Does the new home estimate include a garage?',garageSqft:'How many square feet is the included garage?',
  coveredOutdoorSqft:'How many square feet of covered outdoor space are included?',laborHours:'How many hours should this hourly work allowance cover?',
  projectMonths:'What construction duration should this estimate allow for?',rooms:'How many rooms are included?',bathrooms:'How many bathrooms are included?',stories:'How many stories are included?',
  flooringSqft:'About how many square feet of flooring are being installed?',tileSqft:'How many square feet of tile are included? Keep floor, wall and backsplash areas clear in your answer.',
  demolitionSqft:'About how large is the area being demolished?',trimLf:'About how many linear feet of trim or baseboard are included?',
};
export function questionReason(field:ScopeField,answers:ScopeAnswers):string{
  const service=answers.service||'';
  if(field==='service')return 'What work would you like estimated?';
  if(field==='taskList')return 'What work should be included? Describe the items, quantities and any work to leave out.';
  if(field==='sqft')return builds.includes(service)?'About how many square feet of living space are included? Keep garage and outdoor areas separate.':'About how large is the area being worked on?';
  if(field==='finish')return builds.includes(service)?'What level of finishes should we budget for this build?':'What finish level should we budget for the unspecified selections?';
  return detailQuestions[field]||`What should we use for ${SCOPE_FIELDS[field].label.toLowerCase()}?`;
}
function choiceValues(field:ScopeField,answers:ScopeAnswers){
  const definition=SCOPE_FIELDS[field];if(definition.kind!=='choice')return undefined;
  if(field==='finish')return finishOptionsForService(answers.service);
  return definition.options.filter(v=>field!=='service'||(ESTIMATOR_BRAND.services as readonly string[]).includes(v));
}
export function questionForField(field:ScopeField,answers:ScopeAnswers):ScopeQuestion{
  const values=choiceValues(field,answers);return {field,label:SCOPE_FIELDS[field].label,reason:questionReason(field,answers),...(values?.length?{values}:{})};
}
/** Words a customer question must share with the measured field it was filed
 * under. The reader chooses both the question and the field; when they
 * disagree (a crawl-space area filed under "Demolition area") the heading says
 * only that a detail is needed, rather than naming the wrong thing. */
const FIELD_WORDS:Partial<Record<ScopeField,RegExp>>={demolitionSqft:/demol|tear[- ]?out|gutt?(?:ed|ing)\b/i,tileSqft:/tile|backsplash/i,flooringSqft:/floor/i,trimLf:/trim|baseboard|crown|casing|mould|mold/i,cabinetBaseLf:/cabinet|vanit/i,cabinetUpperLf:/cabinet/i,cabinetTallLf:/cabinet|pantry/i,garageSqft:/garage/i,coveredOutdoorSqft:/patio|porch|deck|outdoor|covered/i,countertopSqft:/counter|worktop|bench/i,sqft:/area|square|size|living|footage|large|big/i};
export const clarificationLabel=(field:ScopeField,question:string)=>FIELD_WORDS[field]&&!FIELD_WORDS[field]!.test(question)?'Project detail':SCOPE_FIELDS[field].label;
export function scopeQuestions(input:ScopeAnswers,extraction:ScopeExtraction|null,conflicts:ScopeConflict[]=[],skipped:ScopeField[]=[],pricedFields:ScopeField[]=[],sourceText=''):ScopeQuestion[]{
  const answers=deriveScopeAnswers(input);
  const context=questionContext(answers,extraction,sourceText);
  const applicableConflicts=conflicts.filter(c=>scopeFieldApplies(c.field,context));
  // Resolve the project type before calculating the next service-specific question.
  const serviceConflict=applicableConflicts.find(c=>c.field==='service');
  if(serviceConflict)return [{field:'service',label:SCOPE_FIELDS.service.label,reason:serviceConflict.explanation,values:serviceConflict.values,conflict:true}];
  if(!answers.service&&!applicableConflicts.length)return [questionForField('service',answers)];
  const relevant=new Set(materialScopeFields(answers,pricedFields,extraction,sourceText));
  const questions:ScopeQuestion[]=applicableConflicts.map(c=>({field:c.field,label:SCOPE_FIELDS[c.field].label,reason:c.explanation,values:c.values,conflict:true}));
  for(const q of instructionPrompts(extraction,answers,sourceText)){
    if(!scopePromptApplies(q.field,instructionPromptText(q),context))continue;
    if(q.field&&questions.some(existing=>existing.field===q.field))continue;
    // "Not sure yet" is an answer. Live Cabinet (2026-09-22): a document's cabinet-run question came back
    // four times after the customer skipped it, because this path did not check the skipped list.
    if(q.field&&skipped.includes(q.field))continue;
    questions.push({field:q.field||'estimatingInstructions',label:q.field?SCOPE_FIELDS[q.field].label:'One scope detail',reason:q.question,detail:q.detail,values:q.values,...(!q.field?{instructionId:q.id}:{})});
  }
  const uncertain=(extraction?.facts||[]).filter(f=>Number.isFinite(f.confidence)&&f.confidence<.85&&f.confidence>=.4&&f.basis!=='visual'&&f.basis!=='inferred'&&!validateAnswer(f.field,f.value)&&!answers[f.field]?.trim()&&relevant.has(f.field)&&(f.field!=='service'||serviceEvidenceSupports(f.value,f.evidence)));
  for(const fact of uncertain)if(!questions.some(q=>q.field===fact.field)&&!skipped.includes(fact.field))questions.push({field:fact.field,label:SCOPE_FIELDS[fact.field].label,reason:`${SCOPE_FIELDS[fact.field].label}: we found ${fact.value} in ${fact.source}. Is that correct?`,values:[fact.value]});
  // Keep the reader's project-specific wording, including which room or component
  // is missing. Replacing it with a generic numeric prompt loses that context.
  for(const q of extraction?.clarifications||[])if(relevant.has(q.field)&&!answers[q.field]?.trim()&&!skipped.includes(q.field)&&!questions.some(x=>x.field===q.field))questions.push({field:q.field,label:clarificationLabel(q.field,q.question),reason:SCOPE_FIELDS[q.field].kind==='number'&&clarificationLabel(q.field,q.question)!=='Project detail'&&!/how (?:many|much|long|wide|large)|number of|square feet|linear feet|footage/i.test(q.question)?questionReason(q.field,answers):q.question,detail:q.reason});
  for(const field of relevant)if(!questions.some(q=>q.field===field)&&!skipped.includes(field))questions.push(questionForField(field,answers));
  return questions.map(q=>{
    const allowed=choiceValues(q.field,answers);
    const values=q.field==='finish'?allowed:q.values?.length?q.values:allowed;
    return {...q,...(values?.length?{values}:{}),...(q.reason.length>240?{reason:`Please confirm ${q.label.toLowerCase()}.`,detail:q.reason}:{})};
  });
}
export function validateScopeAnswer(field:ScopeField,value:string){
  const error=validateAnswer(field,value);if(error)return error;
  if(['sqft','length','width','rooms','stories'].includes(field)&&value.trim()&&Number(value.replaceAll(',',''))<=0)return 'Enter a number greater than zero, or choose Not sure yet.';
  return null;
}
export function scopeAssumptions(answers:ScopeAnswers,skipped:ScopeField[]=[],extraction:ScopeExtraction|null=null,sourceText=''){
  const notes:string[]=[];
  if(!answers.location&&!answers.address)notes.push('General service-area pricing; location, access and jurisdiction will be confirmed.');
  if(!answers.urgency)notes.push('Standard scheduling; priority or emergency work is not included.');
  if(!answers.finish&&scopeFieldApplies('finish',questionContext(answers,extraction,sourceText)))notes.push(answers.materials?.trim()?'Specified materials control the scope; any unselected items require individually disclosed planning allowances.':'Finish level not chosen; standard finishes are assumed until you select one.');
  if(answers.length&&answers.width&&answers.sqft&&sameAnswer('sqft',answers.sqft,deriveScopeAnswers({...answers,sqft:''}).sqft||'0'))notes.push(`Project area calculated from ${answers.length} × ${answers.width} feet. Confirm irregular areas during the site visit.`);
  for(const k of skipped)if(!answers[k]&&scopeFieldApplies(k,questionContext(answers,extraction,sourceText)))notes.push(`${SCOPE_FIELDS[k].label}: not yet known; requires a disclosed, supported allowance before pricing.`);
  return notes;
}
/** Which sister company estimates each kind of work. Every site can send a project it does not
 * handle to the right one; Cabinet and Handyman used to have no route out at all, so a remodel or
 * new build typed there ended at a question listing only their own services. */
const SERVICE_HOME:Record<string,{id:string;name:string;url:string;work:string}>={
  'new-construction':{id:'construction',name:'Boise Construction Co',url:'https://boiseconstruction.co/estimate',work:'new construction'},
  kitchen:{id:'remodeling',name:'Boise Remodeling Co',url:'https://boiseremodeling.co/estimate',work:'remodel work'},
  bathroom:{id:'remodeling',name:'Boise Remodeling Co',url:'https://boiseremodeling.co/estimate',work:'remodel work'},
  'whole-home':{id:'remodeling',name:'Boise Remodeling Co',url:'https://boiseremodeling.co/estimate',work:'remodel work'},
  addition:{id:'remodeling',name:'Boise Remodeling Co',url:'https://boiseremodeling.co/estimate',work:'additions'},
  adu:{id:'remodeling',name:'Boise Remodeling Co',url:'https://boiseremodeling.co/estimate',work:'ADUs'},
  'cabinet-product':{id:'cabinet',name:'Boise Cabinet Co',url:'https://boisecabinet.co/estimate',work:'cabinet supply and installation'},
  'cabinet-install':{id:'cabinet',name:'Boise Cabinet Co',url:'https://boisecabinet.co/estimate',work:'cabinet supply and installation'},
  handyman:{id:'handyman',name:'Boise Handyman Co',url:'https://boisehandyman.co/estimate',work:'repair and handyman work'},
  re10:{id:'handyman',name:'Boise Handyman Co',url:'https://boisehandyman.co/estimate',work:'inspection and RE-10 repairs'},
};
export function handoffForService(service:string){
  const home=SERVICE_HOME[service];
  if(!home||home.id===(ESTIMATOR_BRAND.id as string))return null;
  return {label:`Continue with ${home.name}`,url:home.url,reason:`${home.name} is the correct estimator for ${home.work}.`};
}
export function scopeQuestionsForBrand(...args:Parameters<typeof scopeQuestions>):ScopeQuestion[]{
  const service=args[0].service;
  // A genuine service conflict is a question, not permission to redirect based
  // on a stale default before the customer's project type is established.
  if((args[2]||[]).some(c=>c.field==='service'))return scopeQuestions(...args).filter(q=>q.field==='service');
  if(service&&!(ESTIMATOR_BRAND.services as readonly string[]).includes(service)){
    const handoff=handoffForService(service);if(handoff)return [{field:'service',label:'Right estimator',reason:handoff.reason,detail:'Open the correct estimator below. Your description and answers are carried over for you; attach any files again there.',handoff:{label:handoff.label,url:handoff.url}}];
    return [{field:'service',label:'Project type',reason:`Which part of this project should ${ESTIMATOR_BRAND.name} estimate?`,values:[...ESTIMATOR_BRAND.services],detail:'Choose the work you want this company to handle. Your complete project description and documents are retained.'}];
  }
  return scopeQuestions(...args);
}
