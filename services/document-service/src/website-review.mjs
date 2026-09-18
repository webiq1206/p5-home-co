import {FIELDS} from './fields.mjs';
import {ServiceError} from './core.mjs';

const optionalFields=new Set(['location','address','schedule','phasing']);
const normalized=text=>text.replace(/\s+/g,' ').trim().toLowerCase();

/** Website text fields may hold only part of a specification. An outstanding
 * source question needs its own answer, not a second value for that entire field.
 * Project saved reviews at the API boundary so old results need no AI reread. */
export function reviewForWebsite(result){
 const followups=(result.clarifications||[]).filter(q=>FIELDS[q.field]?.kind==='text'&&!optionalFields.has(q.field));
 if(!followups.length)return result;
 if(!Array.isArray(result.instructions?.questions))throw new ServiceError('invalid-review-schema',422);
 const questions=[...result.instructions.questions];
 for(const followup of followups){
  const question=followup.question.trim(),key=normalized(question);
  if(!key)throw new ServiceError('invalid-clarification',422);
  if(!questions.some(existing=>normalized(existing)===key||normalized(existing).startsWith(key+' '))){
   questions.push([question,followup.reason.trim()].filter(Boolean).join(' '));
  }
 }
 return {...result,clarifications:result.clarifications.filter(q=>!followups.includes(q)),instructions:{...result.instructions,questions}};
}
