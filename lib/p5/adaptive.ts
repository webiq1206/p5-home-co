import {SCOPE_FIELDS,mergeScopeFacts,requiredScopeQuestions,validateAnswer,type ScopeAnswers,type ScopeField,type ScopeExtraction,type ScopeConflict} from './scope.ts';

export interface ScopeQuestion {field:ScopeField;label:string;reason:string;values?:string[];conflict?:boolean}
export function sameAnswer(field:ScopeField,a:string,b:string){
  if(SCOPE_FIELDS[field].kind==='number')return Number(a.replaceAll(',',''))===Number(b.replaceAll(',',''));
  return a.trim().toLowerCase()===b.trim().toLowerCase();
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
export function reconcileScope(current:ScopeAnswers,extraction:ScopeExtraction,resolutions:ScopeAnswers={}){
  const normalized={...extraction,facts:extraction.facts.map(f=>({...f,value:current[f.field]&&sameAnswer(f.field,current[f.field]!,f.value)?current[f.field]!:f.value})),conflicts:extraction.conflicts.filter(c=>!resolutions[c.field]||!sameAnswer(c.field,resolutions[c.field]!,current[c.field]||''))};
  const resolvedFacts=normalized.facts.filter(f=>!resolutions[f.field]||!sameAnswer(f.field,resolutions[f.field]!,current[f.field]||''));
  const merged=mergeScopeFacts(current,{...normalized,facts:resolvedFacts});
  const answers=deriveScopeAnswers(merged.answers);
  const conflicts=merged.conflicts.filter((c,i,all)=>all.findIndex(v=>v.field===c.field)===i);
  if(current.sqft&&current.length&&current.width){
    const calculated=deriveScopeAnswers({...current,sqft:''}).sqft;
    if(calculated&&!sameAnswer('sqft',current.sqft,calculated)&&!resolutions.sqft)conflicts.push({field:'sqft',values:[current.sqft,calculated],explanation:'The stated area differs from length multiplied by width. Which area is being estimated?'});
  }
  return {answers,conflicts};
}
const remodels=['kitchen','bathroom','whole-home'];
const builds=['addition','adu','new-construction'];
export function materialScopeFields(answers:ScopeAnswers,pricedFields:ScopeField[]=[]):ScopeField[]{
  const service=answers.service;
  const required=requiredScopeQuestions(answers);
  if(service&&builds.includes(service)&&answers.garageIncluded==='yes'&&!answers.garageSqft?.trim())required.push('garageSqft');
  if(service&&[...remodels,...builds].includes(service)){
    if(!answers.materials&&!answers.finish)required.push('finish');
    // One description captures the work, including retained and changed items.
    if(!answers.taskList&&!answers.demolition&&!answers.structural&&!answers.otherDetails)required.push('taskList');
  }
  return [...new Set([...required,...pricedFields])].filter(k=>!answers[k]?.trim());
}
export function scopeQuestions(input:ScopeAnswers,extraction:ScopeExtraction|null,conflicts:ScopeConflict[]=[],skipped:ScopeField[]=[],pricedFields:ScopeField[]=[]):ScopeQuestion[]{
  const answers=deriveScopeAnswers(input);
  const relevant=new Set<ScopeField>(['service',...materialScopeFields(answers,pricedFields),...pricedFields]);
  // An uncertain stated quantity is more useful as one clarification than a blank form.
  const uncertain=(extraction?.facts||[]).filter(f=>f.confidence<.85&&f.confidence>=.4&&!answers[f.field]?.trim()&&(relevant.has(f.field)||SCOPE_FIELDS[f.field].kind==='number'));
  const questions:ScopeQuestion[]=conflicts.map(c=>({field:c.field,label:SCOPE_FIELDS[c.field].label,reason:c.explanation,values:c.values,conflict:true}));
  for(const fact of uncertain)if(!questions.some(q=>q.field===fact.field)&&!skipped.includes(fact.field))questions.push({field:fact.field,label:SCOPE_FIELDS[fact.field].label,reason:`We found “${fact.value}” in ${fact.source}. Is that correct?`,values:[fact.value]});
  for(const q of extraction?.clarifications||[])if(!(q.field==='finish'&&answers.materials)&&!(['address','location','schedule','urgency'].includes(q.field)&&!pricedFields.includes(q.field))&&!answers[q.field]?.trim()&&!skipped.includes(q.field)&&!questions.some(x=>x.field===q.field))questions.push({field:q.field,label:SCOPE_FIELDS[q.field].label,reason:q.question});
  for(const field of relevant)if(!answers[field]?.trim()&&!questions.some(q=>q.field===field)&&!skipped.includes(field))questions.push({field,label:SCOPE_FIELDS[field].label,reason:field==='service'?'What would you like help with?':field==='taskList'?'What work should be included? A short list with quantities is enough.':field==='sqft'?(builds.includes(answers.service||'')?'About how many square feet of living space are included? Keep garage and outdoor areas separate.':'About how large is the area being worked on?'):field==='finish'?'This helps us allow for the materials you have in mind.':'This detail affects the work and its cost.'});
  return questions;
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
  if(!answers.finish&&!answers.materials&&[...remodels,...builds].includes(answers.service||''))notes.push('Finish selections need an itemized allowance or confirmation before a firm price.');
  if(answers.length&&answers.width&&answers.sqft&&sameAnswer('sqft',answers.sqft,deriveScopeAnswers({...answers,sqft:''}).sqft||'0'))notes.push(`Project area calculated from ${answers.length} × ${answers.width} feet. Confirm irregular areas during the site visit.`);
  for(const k of skipped)if(!answers[k])notes.push(`${SCOPE_FIELDS[k].label}: not yet known; requires an allowance or pricing review.`);
  return notes;
}
