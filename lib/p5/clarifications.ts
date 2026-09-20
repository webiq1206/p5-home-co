import {questionContext,scopePromptApplies} from './dynamicQuestions.ts';
import {atomicInstructionQuestions,textBenchTopChoices,cabinetQuestionField} from './atomicQuestions.ts';
import type {ScopeAnswers,ScopeExtraction,ScopeField} from './scope.ts';
import type {ScopeInstructions} from './instructions.ts';
import {isBenchTopClarificationQuestion,retainedBenchTopChoices,retainedChoiceValue} from './retainedClarification.ts';

export interface InstructionAnswer {id:string;question:string;answer:string}
export interface InstructionPrompt {id:string;question:string;detail?:string;values?:string[];field?:ScopeField;sourceQuestion?:string}
/** Preserve the original decision for saving and answer resolution. Helper text
 * is display context, never a replacement for the question. */
export function instructionPromptText(prompt:InstructionPrompt):string {
  if(prompt.sourceQuestion?.trim())return prompt.sourceQuestion;
  if(!prompt.detail?.trim())return prompt.question;
  if(prompt.detail.includes(prompt.question)||prompt.detail.includes('?'))return prompt.detail;
  return [prompt.question,prompt.detail].join(' ').trim();
}
export const questionKey=(text:string)=>text.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const serviceQuestion=(text:string)=>/which .*services|what .*remodel.*service|company.s scope|typical .*services|offered.*services|services.*offered|residential remodel|boise .*estimate|requested subset/i.test(text);
/** A contract deadline, closing date or who-pays question comes from the form the list was
 * written on. It changes nothing about what the work costs, so the customer is never asked. */
const contractQuestion=(text:string)=>/\b(?:business|calendar|working) days\b|\bdeadline\b|\bclosing date\b|\bclose of escrow\b|\bseller ha(?:s|ve)\b|\bbuyer ha(?:s|ve)\b|\bwho (?:pays|is paying)\b|\bblank on (?:the )?form\b/i.test(text);
const TOPIC_STOP=new Set(['what','which','should','would','could','there','their','this','that','with','from','have','does','need','needs','needed','page','please','include','included','about','being','your','will','into','than','then','them','they','were','when','where','whether']);
const topicStems=(text:string)=>new Set((text.toLowerCase().match(/[a-z]{4,}/g)||[]).filter(word=>!TOPIC_STOP.has(word)).map(word=>word.slice(0,5)));
const measuredQuestion=(text:string)=>/how (?:many|much|long|wide|tall|large)|square f|linear f|\bsq\.? ?ft\b|\blf\b|\bsf\b/i.test(text);
/** Two wordings of one decision ("is the chimney cap repair structural or cosmetic?" asked
 * once per page of the document). A measured quantity is never treated as a repeat: base
 * and wall cabinet lengths share almost every word and are different answers. */
export function sameDecision(a:string,b:string):boolean{
  if(measuredQuestion(a)||measuredQuestion(b))return false;
  // Compare the questions themselves; a shared helper sentence ("This affects cost.") is not a shared subject.
  const asked=(text:string)=>text.includes('?')?text.slice(0,text.indexOf('?')):text;
  const left=topicStems(asked(a)),right=topicStems(asked(b));
  const shared=[...left].filter(stem=>right.has(stem)).length;
  return shared>=3&&shared/Math.min(left.size,right.size)>=0.55;
}
const answeredQuestions=(answers:ScopeAnswers)=>[...(answers.estimatingInstructions||'').matchAll(/^Question: (.+)$/gm)].map(match=>match[1]);
const RESPONSIBILITY_CHOICES=['Labor only','Materials only','Labor and materials'] as const;

/** Split a stored paragraph into questions. A trailing statement such as
 * "This affects repair cost." is context for the question before it, not a
 * question of its own, so it rides along as detail instead of becoming a card. */
const questionParts=(raw:string)=>{
  const parts=(raw.match(/[^?]+\??/g)||[]).map(part=>part.trim()).filter(Boolean);
  const merged:string[]=[];
  for(const part of parts){
    if(!part.endsWith('?')&&merged.length)merged[merged.length-1]+=' '+part;
    else merged.push(part);
  }
  return merged;
};
const normalizeQuestionPart=(part:string)=>part.replace(/\s+/g,' ').trim();

/** One question per card, including older extractions that stored paragraphs. */
export function instructionPrompts(extraction:ScopeExtraction|null,answers:ScopeAnswers,sourceText=''):InstructionPrompt[]{
  const result:InstructionPrompt[]=[],answered=answeredQuestions(answers);
  for(const raw of extraction?.instructions?.questions||[]){
    for(const part of questionParts(raw).flatMap(part=>atomicInstructionQuestions(part,answers,extraction?.conflicts))){
      const full=normalizeQuestionPart(part);if(!full)continue;
      // Filter each question separately so a legacy paragraph cannot lose a real scope decision.
      if(serviceQuestion(full)||contractQuestion(full))continue;
      const field=cabinetQuestionField(full);
      // One decision is asked once, however many pages or wordings raised it.
      if(!field&&(result.some(q=>!q.field&&sameDecision(instructionPromptText(q),full))||answered.some(q=>sameDecision(q,full))))continue;
      if(field&&answers[field]?.trim()&&!extraction?.conflicts.some(conflict=>conflict.field===field))continue;
      const id=questionKey(full);
      if(result.some(q=>q.id===id))continue;
      const trailing=full.match(/^(.*\?)\s+([^?]+)$/);
      const asked=trailing?trailing[1].trim():full;
      const question=asked.length<=240?asked:'What should we include for this part of your project?';
      const values=/^Who\b[^?]*\b(?:supply|supplies|provide|provides|purchase|purchases)\b[^?]*\?/i.test(asked)?["I'll supply all of them",'Please include all of them',"I'll supply some of them","I'm not sure yet"]:
        /labor.only/i.test(full)&&/materials.only/i.test(full)?['Labor only','Materials only','Labor and materials']:
        /include or exclude|include.*or.*exclude/i.test(full)?['Include it','Exclude it']:undefined;
       // A retained-document choice card is built from extraction evidence,
       // not from the wording of the question.  In particular, do not
       // hard-code material options into a generic "bench top" question.
       const retainedValues=isBenchTopClarificationQuestion(full)
         ?(extraction?retainedBenchTopChoices(extraction):[]).map(retainedChoiceValue)
         :undefined;
       result.push({id,question,sourceQuestion:full,...(field?{field}:{}),...(question!==asked?{detail:full}:trailing?{detail:trailing[2].trim()}:{}),values:/^Who should install the /i.test(full)?['Include installation in this estimate','Owner handles installation']:retainedValues?.length?retainedValues:values?.length?values:textBenchTopChoices(extraction,full)});
    }
  }
  const context=questionContext(answers,extraction,sourceText);
  return result.filter(q=>scopePromptApplies(q.field,instructionPromptText(q),context));
}

/** Only the three exact responsibility choices have a deterministic meaning. */
export function exactResponsibilityChoice(value:string):{laborOnly:boolean;materialsOnly:boolean}|null{
  if(value==='Labor only')return {laborOnly:true,materialsOnly:false};
  if(value==='Materials only')return {laborOnly:false,materialsOnly:true};
  if(value==='Labor and materials')return {laborOnly:false,materialsOnly:false};
  return null;
}

const SCOPED_RESPONSIBILITY_MARKER=/\b(?:kitchen|bath(?:room)?|cabinet(?:ry|s)?|trim|floor(?:ing)?|first|second|third|fourth|upper|lower|main|garage|building|wing|unit|room|bedroom|addition|adu|new construction|scope item|trade|component|section|phase|area|part|fixture|vanity|countertop|tile|plumbing|electrical|mechanical|structural|roof|door|window)\b/i;
const PROJECT_WIDE_RESPONSIBILITY_MARKER=/\b(?:project[- ]wide|whole project|entire project|overall project|for (?:the )?project|project responsibility|scope as a whole|overall scope)\b/i;

/** Local flags apply only to an unscoped canonical question or an explicit
 * project-wide question. A question that names a trade, building, floor or
 * component still needs provider interpretation before any global flag moves. */
export function isResponsibilityPrompt(prompt:InstructionPrompt){
  if(!(prompt.values?.length===RESPONSIBILITY_CHOICES.length
    && RESPONSIBILITY_CHOICES.every((choice,index)=>prompt.values?.[index]===choice)))return false;
  const text=instructionPromptText(prompt).replace(/\s+/g,' ').trim();
  const canonical=text.replace(/[?.!]+$/,'').toLowerCase();
  const exactCanonical=canonical==='labor only or materials only'
    ||canonical==='labor only, materials only, or labor and materials';
  if(SCOPED_RESPONSIBILITY_MARKER.test(text))return false;
  return exactCanonical||PROJECT_WIDE_RESPONSIBILITY_MARKER.test(text);
}

/** Remove one answered question while retaining unrelated clauses in a legacy
 * paragraph. Duplicate copies are removed together so retries cannot revive it. */
export function removeInstructionPrompt(instructions:ScopeInstructions,id:string):ScopeInstructions{
  const questions:string[]=[];
  for(const raw of instructions.questions){
    const remaining=questionParts(raw)
      .filter(part=>questionKey(normalizeQuestionPart(part))!==id)
      .map(normalizeQuestionPart)
      .filter(Boolean);
    if(remaining.length)questions.push(remaining.join(' '));
  }
  return {...instructions,questions:[...new Set(questions)]};
}

/** Answers remain scope data for the pricing audit, with original pages intact. */
export function clarificationContext(extraction:ScopeExtraction,question:string,answer:string,answers:ScopeAnswers={}){
  return JSON.stringify({
    task:'Resolve only this answered scope question using the answer below. Return the complete updated instructions and any directly changed structured facts, preserving every unrelated inclusion, exclusion, responsibility, building and floor. Remove this question when answered. Never ask it again because a page was not reuploaded. This is a clarification of a document review already completed. Do not reread or recreate pages or takeoffs, and do not return unreadable-file notes. If the answer is insufficient, return one short, specific follow-up explaining the missing decision. A fact update must be supported by the typed answer; retain source-backed facts that the answer did not change.',
    answerPolicy:'The answer is from the customer. Interpret a selected option and additional typed detail together. A material contradiction requires one short confirmation, not a silent choice. A later explicit correction replaces the earlier answer only for that item. Not sure is unknown, never yes, no, zero or permission for an undisclosed assumption. Keep installation quantity separate from supply quantity. For example, four door installations with three customer-supplied doors and one requested door means four installations and one supplied door. Keep removal and disposal separate. Preserve excluded trades. Do not infer field painting only from the word painted.',
    previousInstructions:extraction.instructions,previousFacts:extraction.facts,previousAnswers:answers,question,answer,
  });
}
