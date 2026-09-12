import {analyzeBatch} from './extraction';
import {clarificationContext,instructionPrompts,questionKey,type InstructionAnswer} from './clarifications';
import {DraftError} from './store';
import {SCOPE_TEXT_LIMIT,type ScopeAnswers,type ScopeExtraction} from './scope';

export async function resolveInstructionAnswer(extraction:ScopeExtraction|null,answers:ScopeAnswers,raw:unknown,prior:InstructionAnswer[]=[],request=fetch){
  const value=raw as {id?:unknown;answer?:unknown};
  if(typeof value?.id!=='string'||typeof value.answer!=='string'||!value.answer.trim()||value.answer.length>SCOPE_TEXT_LIMIT)throw new DraftError('Enter an answer to continue.');
  const answer=String(value.answer).trim();
  const previous=prior.find(p=>p.id===value.id);
  const removeAnsweredPrompt=(source:ScopeExtraction|null)=>{
    if(!source?.instructions)return source;
    const instructions={...source.instructions};
    instructions.questions=instructions.questions.flatMap(rawQuestion=>rawQuestion.match(/[^?]+\??/g)||[]).filter(rawQuestion=>questionKey(rawQuestion)!==value.id);
    return {...source,instructions};
  };
  // Retries are safe even when the provider retained the answered prompt.
  if(previous){
    if(previous.answer===answer)return {extraction:removeAnsweredPrompt(extraction),answers,history:prior};
    throw new DraftError('This question has already been answered. Refresh your saved project to continue.',409);
  }
  const prompts=instructionPrompts(extraction,answers);
  const prompt=prompts[0];
  if(!prompt||prompt.id!==value.id||!extraction){
    throw new DraftError('This question has changed. Refresh your saved project to continue.',409);
  }
  const question=prompt.detail||prompt.question;
  const result=await analyzeBatch(clarificationContext(extraction,question,answer),[],answers,request,60000);
  if(!result.extraction.instructions)throw new DraftError('Your answer is still here. We could not save its scope update. Please retry.',503);
  const instructions={...result.extraction.instructions};
  // Providers occasionally echo the answered question. Remove that one
  // question, but retain every unrelated prompt they returned.
  instructions.questions=instructions.questions.flatMap(rawQuestion=>rawQuestion.match(/[^?]+\??/g)||[]).filter(rawQuestion=>questionKey(rawQuestion)!==prompt.id);
  // Preserve other unanswered questions even if a provider omitted them.
  instructions.questions=[...new Set([...prompts.slice(1).map(q=>q.detail||q.question),...instructions.questions])];
  const record={id:prompt.id,question,answer};
  const combined=[answers.estimatingInstructions,`Question: ${question}\nAnswer: ${answer}`].filter(Boolean).join('\n\n');
  if(combined.length>SCOPE_TEXT_LIMIT)throw new DraftError('Upload the additional scope notes as a document to preserve them in full.');
  return {extraction:{...extraction,instructions},answers:{...answers,estimatingInstructions:combined},history:[...prior,record]};
}
