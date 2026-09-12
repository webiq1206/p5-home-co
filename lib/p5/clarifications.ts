import type {ScopeAnswers,ScopeExtraction} from './scope.ts';

export interface InstructionAnswer {id:string;question:string;answer:string}
export interface InstructionPrompt {id:string;question:string;detail?:string;values?:string[]}
export const questionKey=(text:string)=>text.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const serviceQuestion=(text:string)=>/which .*services|what .*remodel.*service|company.s scope|typical .*services|offered.*services|services.*offered|residential remodel|boise .*estimate|requested subset/i.test(text);

/** One question per card, including older extractions that stored paragraphs. */
export function instructionPrompts(extraction:ScopeExtraction|null,answers:ScopeAnswers):InstructionPrompt[]{
  const result:InstructionPrompt[]=[];
  for(const raw of extraction?.instructions?.questions||[]){
    for(const part of raw.match(/[^?]+\??/g)||[]){
      const full=part.replace(/\s+/g,' ').trim();if(!full)continue;
      // Filter each question separately so a legacy paragraph cannot lose a real scope decision.
      if(serviceQuestion(full))continue;
      const id=questionKey(full);
      if(result.some(q=>q.id===id))continue;
      const question=full.length<=240?full:'What should we include for this part of your project?';
      const values=/labor.only/i.test(full)&&/materials.only/i.test(full)?['Labor only','Materials only','Labor and materials']:
        /include or exclude|include.*or.*exclude/i.test(full)?['Include it','Exclude it']:undefined;
      result.push({id,question,...(question!==full?{detail:full}:{}),values});
    }
  }
  return result;
}

/** Answers remain scope data for the pricing audit, with original pages intact. */
export function clarificationContext(extraction:ScopeExtraction,question:string,answer:string){
  return JSON.stringify({
    task:'Resolve only this answered scope question using the answer below. Return the complete updated instructions, preserving every unrelated inclusion, exclusion, responsibility, building and floor. Remove this question when answered. Never ask it again because a page was not reuploaded. This is a clarification of a document review already completed. Do not produce page records, takeoffs, or unreadable-file notes. If the answer is insufficient, return one short, specific follow-up explaining the missing decision.',
    previousInstructions:extraction.instructions,question,answer,
  });
}
