/**
 * Which of the currently open questions the customer should actually see.
 *
 * Owner rule (2026-09-21): slim the questions down, and never ask the same question twice, on every
 * estimator. Live, a 27-page permit set produced 18 questions, 3 of them repeats: each re-read of
 * the documents raised the same gap in new words, and the page asked again.
 *
 * - A question already asked (same wording, nearly the same wording, or the same answer field) is
 *   never asked again, whatever the documents say later. Free-form "other details" questions are
 *   matched by wording only, because different ones share that field.
 * - Questions whose answer changes the price come first and are never capped.
 * - Everything else is capped at MAX_OTHER_QUESTIONS for the whole project.
 */
export const MAX_OTHER_QUESTIONS=6;
interface Question {field:string;label:string;reason:string;conflict?:boolean;handoff?:unknown}
interface AskedEntry {kind?:string;text:string;label?:string}
const words=(value:string)=>new Set(value.toLowerCase().replace(/[^a-z0-9 ]+/g,' ').split(/\s+/).filter(word=>word.length>2));
/** Nearly the same question: most of the words of the shorter one appear in the other. */
function similar(a:string,b:string){
  const x=words(a),y=words(b);if(!x.size||!y.size)return false;
  let shared=0;for(const w of x)if(y.has(w))shared++;
  return shared/Math.min(x.size,y.size)>=0.8;
}
const FREE_FORM=new Set(['otherDetails','taskList','estimatingInstructions']);
export function unaskedQuestions<Q extends Question>(questions:readonly Q[],transcript:readonly AskedEntry[]|undefined,pricedFields:readonly string[]=[]):Q[]{
  const asked=(transcript||[]).filter(entry=>entry.kind==='question');
  const askedLabels=new Set(asked.map(entry=>(entry.label||'').trim().toLowerCase()).filter(Boolean));
  const priced=new Set(pricedFields);
  // The review step can still require a price question, a contradiction or a handoff (draftEndpoint.ts);
  // hiding one of those left a customer blocked by a question they could not see.
  const required=(question:Q)=>priced.has(question.field)||Boolean(question.conflict)||Boolean(question.handoff);
  const fresh=questions.filter(question=>{
    if(required(question))return true;
    if(asked.some(entry=>similar(entry.text,question.reason)))return false;
    if(!FREE_FORM.has(question.field)&&askedLabels.has(question.label.trim().toLowerCase()))return false;
    return true;
  });
  // Within one round, the same field or near-identical wording is offered once.
  const unique=fresh.filter((question,index)=>required(question)||!fresh.slice(0,index).some(other=>(!FREE_FORM.has(question.field)&&other.field===question.field)||similar(other.reason,question.reason)));
  const pricing=unique.filter(required);
  const others=unique.filter(question=>!required(question));
  // Every question already asked counts against the cap, so the total a customer sees stays small.
  return [...pricing,...others.slice(0,Math.max(0,MAX_OTHER_QUESTIONS-asked.length))];
}
