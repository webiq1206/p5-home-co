import {analyzeBatch} from './extraction.ts';
import {clarificationContext,exactResponsibilityChoice,instructionPrompts,instructionPromptText,isResponsibilityPrompt,questionKey,removeInstructionPrompt,type InstructionAnswer} from './clarifications.ts';
import {applyRetainedBenchTopAnswer,isBenchTopClarificationQuestion,reconcileClarificationTakeoffs} from './retainedClarification.ts';
import {DraftError} from './store.ts';
import {SCOPE_TEXT_LIMIT,type ScopeAnswers,type ScopeExtraction} from './scope.ts';

export async function resolveInstructionAnswer(extraction:ScopeExtraction|null,answers:ScopeAnswers,raw:unknown,prior:InstructionAnswer[]=[],request=fetch,sourceText=''){
  const value=raw as {id?:unknown;answer?:unknown};
  if(typeof value?.id!=='string'||typeof value.answer!=='string'||!value.answer.trim()||value.answer.length>SCOPE_TEXT_LIMIT)throw new DraftError('Enter an answer to continue.');
  const prompt=instructionPrompts(extraction,answers,sourceText).find(q=>q.id===value.id);
  const answer=value.answer.trim();
  // Retries can arrive with either the already-updated extraction or a stale
  // copy that still contains the answered prompt. Return the prior result
  // without invoking a provider or appending a duplicate history record.
  if(prior.some(p=>p.id===value.id&&p.answer===answer))return {extraction,answers,history:prior};
  if(!prompt||!extraction){
    throw new DraftError('This question has changed. Refresh your saved project to continue.',409);
  }
  const question=instructionPromptText(prompt);
   // The source document has already been retained and reviewed. Cabinet-top
   // alternatives are therefore resolved locally from that extraction rather
   // than sent back through a provider (and, importantly, never trigger a PDF
   // reread). An incomplete or conflicting reply gets one concise follow-up.
   // When the document carries no structured bench-top choices, the answer is taken like any other
   // clarification below. Live Cabinet (2026-09-22): every reply was refused with "the retained document
   // does not provide the bench top choices", so the customer could never get past the question.
   const benchTop=isBenchTopClarificationQuestion(question)?applyRetainedBenchTopAnswer(extraction,answers,question,answer):null;
   if(benchTop&&!(benchTop.status==='ambiguous'&&/does not provide the bench top choices/.test(benchTop.question))){
     const resolved=benchTop;
     if(resolved.status==='ambiguous')throw new DraftError(resolved.question);
     const combined=[answers.estimatingInstructions,`Question: ${question}\nAnswer: ${answer}`].filter(Boolean).join('\n\n');
     if(combined.length>SCOPE_TEXT_LIMIT)throw new DraftError('Upload the additional scope notes as a document to preserve them in full.');
     const cleanedExtraction=resolved.extraction.instructions
       ?{...resolved.extraction,instructions:removeInstructionPrompt(resolved.extraction.instructions,prompt.id)}
       :resolved.extraction;
     const instructions=cleanedExtraction.instructions;
     if(instructions){
       const repeated=instructions.questions.find(q=>questionKey(q)===prompt.id);
       if(repeated)throw new DraftError('Please make the scope decision explicit, such as what to include or exclude. Your answer is saved in this tab.');
       instructions.questions=[...new Set([...instructionPrompts(extraction,answers,sourceText).filter(q=>q.id!==prompt.id).map(instructionPromptText),...instructions.questions])];
     }
     const record={id:prompt.id,question,answer};
     return {extraction:cleanedExtraction,answers:{...resolved.answers,estimatingInstructions:combined},history:[...prior,record]};
   }
  const responsibility=exactResponsibilityChoice(answer);
  if(responsibility&&isResponsibilityPrompt(prompt)&&extraction.instructions){
    const instructions=removeInstructionPrompt({...extraction.instructions},prompt.id);
    instructions.laborOnly=responsibility.laborOnly;
    instructions.materialsOnly=responsibility.materialsOnly;
    const combined=[answers.estimatingInstructions,`Question: ${question}\nAnswer: ${answer}`].filter(Boolean).join('\n\n');
    if(combined.length>SCOPE_TEXT_LIMIT)throw new DraftError('Upload the additional scope notes as a document to preserve them in full.');
    const record={id:prompt.id,question,answer};
    return {
      extraction:{...extraction,instructions},
      answers:{...answers,estimatingInstructions:combined},
      history:[...prior,record],
    };
  }
   const result=await analyzeBatch(clarificationContext(extraction,question,answer,answers),[],answers,request,60000);
  if(!result.extraction.instructions)throw new DraftError('Your answer is still here. We could not save its scope update. Please retry.',503);
  const instructions=result.extraction.instructions;
  // Owner rule (2026-09-21): never ask the same question twice. The customer's reply is kept word for
  // word in the estimating instructions below and priced from; a reply that settles nothing (for
  // example no count) is priced as an allowance to confirm, not asked again. So the re-read may not add
  // questions: live, "How many fixtures?" answered without a number came back as a new question
  // reading "Answer did not specify a count.?" and then blocked the estimate. Only questions the
  // customer has not been asked yet remain.
  instructions.questions=[...new Set(instructionPrompts(extraction,answers,sourceText).filter(q=>q.id!==prompt.id).map(instructionPromptText))];
   const changedFacts=result.extraction.facts||[];
   const changedFields=new Set(changedFacts.map(fact=>fact.field));
   const conflictedFields=new Set((result.extraction.conflicts||[]).map(conflict=>conflict.field));
   const facts=[
     ...extraction.facts.filter(fact=>!changedFields.has(fact.field)||changedFacts.some(next=>next.field===fact.field&&next.value===fact.value)),
     ...changedFacts.filter(next=>!extraction.facts.some(previous=>previous.field===next.field&&previous.value===next.value)),
   ];
   const updatedAnswers={...answers};
   for(const fact of changedFacts)if(fact.confidence>=.85&&!conflictedFields.has(fact.field))updatedAnswers[fact.field]=fact.value;
   const takeoffs=reconcileClarificationTakeoffs(extraction.takeoffs,result.extraction.takeoffs,changedFacts);
   // A clarification can introduce a contradiction or another focused question.
   // Retain those decisions instead of silently treating the reply as resolved.
   const conflicts=[...extraction.conflicts.filter(conflict=>!changedFields.has(conflict.field)&&!conflictedFields.has(conflict.field)),...result.extraction.conflicts];
   // A follow-up from re-reading an answer is kept only where the answer itself contradicts something
   // (a real, different decision); any other follow-up would be the same question again.
   const clarifications=[...(extraction.clarifications||[]).filter(item=>!changedFields.has(item.field)),...(result.extraction.clarifications||[]).filter(item=>conflictedFields.has(item.field))];
  const record={id:prompt.id,question,answer};
  const combined=[answers.estimatingInstructions,`Question: ${question}\nAnswer: ${answer}`].filter(Boolean).join('\n\n');
  if(combined.length>SCOPE_TEXT_LIMIT)throw new DraftError('Upload the additional scope notes as a document to preserve them in full.');
    return {unresolvedFields:[...conflictedFields],extraction:{...extraction,instructions,facts,conflicts,clarifications,...(takeoffs?{takeoffs}:{})},answers:{...updatedAnswers,estimatingInstructions:combined},history:[...prior,record]};
}
