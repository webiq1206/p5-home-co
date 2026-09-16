import fs from 'node:fs';
const edit=(file,oldText,newText)=>{
 const text=fs.readFileSync(file,'utf8');
 if(text.includes(newText))return;
 if(!text.includes(oldText))throw new Error(`Inspect changed integration point in ${file}: ${oldText.slice(0,100)}`);
 fs.writeFileSync(file,text.replaceAll(oldText,newText));
};
edit('lib/p5/clarifications.ts','export interface InstructionPrompt {id:string;question:string;detail?:string;values?:string[];field?:ScopeField}',`export interface InstructionPrompt {id:string;question:string;detail?:string;values?:string[];field?:ScopeField;sourceQuestion?:string}
/** Preserve the original decision for saving and answer resolution. Helper text
 * is display context, never a replacement for the question. */
export function instructionPromptText(prompt:InstructionPrompt):string {
  if(prompt.sourceQuestion?.trim())return prompt.sourceQuestion;
  if(!prompt.detail?.trim())return prompt.question;
  if(prompt.detail.includes(prompt.question)||prompt.detail.includes('?'))return prompt.detail;
  return [prompt.question,prompt.detail].join(' ').trim();
}`);
edit('lib/p5/clarifications.ts','instructionPrompts(extraction:ScopeExtraction|null,answers:ScopeAnswers):InstructionPrompt[]',"instructionPrompts(extraction:ScopeExtraction|null,answers:ScopeAnswers,sourceText=''):InstructionPrompt[]");
edit('lib/p5/clarifications.ts','result.push({id,question,...(field?','result.push({id,question,sourceQuestion:full,...(field?');
edit('lib/p5/clarifications.ts','  return result.filter(q=>scopePromptApplies(q.field,q.detail||q.question,questionContext(answers,extraction)));','  const context=questionContext(answers,extraction,sourceText);\n  return result.filter(q=>scopePromptApplies(q.field,instructionPromptText(q),context));');
edit('lib/p5/clarifications.ts','const text=(prompt.detail||prompt.question).replace','const text=instructionPromptText(prompt).replace');
edit('lib/p5/adaptive.ts','import {instructionPrompts}','import {instructionPrompts,instructionPromptText}');
edit('lib/p5/adaptive.ts','instructionPrompts(extraction,answers)','instructionPrompts(extraction,answers,sourceText)');
edit('lib/p5/adaptive.ts','q.detail||q.question,context','instructionPromptText(q),context');
edit('lib/p5/adaptive.ts',"f.confidence<.85&&f.confidence>=.4&&!answers[f.field]?.trim()&&relevant.has(f.field)","Number.isFinite(f.confidence)&&f.confidence<.85&&f.confidence>=.4&&f.basis!=='visual'&&f.basis!=='inferred'&&!validateAnswer(f.field,f.value)&&!answers[f.field]?.trim()&&relevant.has(f.field)");
edit('lib/p5/clarificationAnswer.ts','exactResponsibilityChoice,instructionPrompts,isResponsibilityPrompt','exactResponsibilityChoice,instructionPrompts,instructionPromptText,isResponsibilityPrompt');
edit('lib/p5/clarificationAnswer.ts','prior:InstructionAnswer[]=[],request=fetch)',"prior:InstructionAnswer[]=[],request=fetch,sourceText='')");
edit('lib/p5/clarificationAnswer.ts','instructionPrompts(extraction,answers)','instructionPrompts(extraction,answers,sourceText)');
edit('lib/p5/clarificationAnswer.ts','const question=prompt.detail||prompt.question;','const question=instructionPromptText(prompt);');
edit('lib/p5/clarificationAnswer.ts','.map(q=>q.detail||q.question)','.map(instructionPromptText)');
edit('lib/p5/draftEndpoint.ts','import {instructionPrompts}','import {instructionPrompts,instructionPromptText}');
edit('lib/p5/draftEndpoint.ts','resolveInstructionAnswer(extraction,answers,raw.clarification,wizard.instructionAnswers)','resolveInstructionAnswer(extraction,answers,raw.clarification,wizard.instructionAnswers,undefined,incomingText)');
edit('lib/p5/draftEndpoint.ts','instructionPrompts(extraction,answers).map(q=>q.detail||q.question)','instructionPrompts(extraction,answers,incomingText).map(instructionPromptText)');
edit('lib/p5/dynamicQuestions.ts',"import type {ScopeAnswers, ScopeExtraction, ScopeField} from './scope.ts';","import {validateAnswer,type ScopeAnswers,type ScopeExtraction,type ScopeField} from './scope.ts';");
edit('lib/p5/dynamicQuestions.ts',`function sourceAnswered(context: QuestionContext, field: ScopeField): boolean {
  if (context.answers[field]?.trim()) return true;
  if (context.extraction?.conflicts.some(c => c.field === field)) return false;
  return Boolean(context.extraction?.facts.some(f => f.field === field && f.confidence >= .85
    && f.value?.trim() && f.basis !== 'visual' && f.basis !== 'inferred'));
}`,`function validQuestionValue(field:ScopeField,value:string|undefined):boolean {
  if(!value?.trim()||validateAnswer(field,value))return false;
  return !['sqft','length','width','rooms','stories'].includes(field)||Number(value.replaceAll(',',''))>0;
}
function sourceAnswered(context: QuestionContext, field: ScopeField): boolean {
  // Validated visitor corrections win. Source-only facts must be valid and
  // agree before they can suppress a required question.
  if (validQuestionValue(field,context.answers[field])) return true;
  if (context.extraction?.conflicts.some(c => c.field === field)) return false;
  const facts=(context.extraction?.facts||[]).filter(f => f.field === field
    && Number.isFinite(f.confidence) && f.confidence >= .85
    && validQuestionValue(field,f.value) && f.basis !== 'visual' && f.basis !== 'inferred');
  const normalize=(value:string)=>{
    const numeric=Number(value.replaceAll(',',''));
    return Number.isFinite(numeric)?String(numeric):value.trim().toLowerCase();
  };
  return facts.length>0 && new Set(facts.map(f=>normalize(f.value))).size===1;
}`);
edit('lib/p5/dynamicQuestions.ts',`  if (scopeFieldApplies('finish', context) && !answers.materials?.trim()
    && !extraction?.facts.some(f => f.field === 'materials' && f.confidence >= .85 && f.value.trim())) fields.add('finish');`,"  if (scopeFieldApplies('finish', context) && !sourceAnswered(context,'materials')) fields.add('finish');");
const version='lib/p5/version.ts';
const current=fs.readFileSync(version,'utf8');
if(!/export const ESTIMATOR_VERSION=/.test(current))throw new Error('Inspect estimator version declaration.');
fs.writeFileSync(version,current.replace(/export const ESTIMATOR_VERSION='[^']+';/,"export const ESTIMATOR_VERSION='2026-09-16.1-question-context';"));
console.log('Applied canonical question persistence, shared project context and validated question evidence.');
