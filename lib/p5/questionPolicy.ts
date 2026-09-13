import {query} from './database';
import {SCOPE_FIELDS,type ScopeAnswers,type ScopeField} from './scope.ts';
import {planningQuestionFields} from './planningBooks.ts';

/** Evaluate one already-loaded book without another policy read. The policy
 * remains the source of truth; this pure step only filters its conditional
 * fields and keeps malformed field names from becoming customer questions. */
export function questionFieldsForBook(answers:ScopeAnswers,book:any):ScopeField[]{
  if(book?.mode==='owner-planning')return planningQuestionFields(answers);
  const fields=new Set<ScopeField>();
  const rules=Array.isArray(book?.rules)?book.rules:[];
  for(const rule of rules){
    if(!rule||typeof rule!=='object')continue;
    const condition=rule.when;
    if(condition){
      const field=condition.field as ScopeField;
      if(typeof field!=='string'||!Object.hasOwn(SCOPE_FIELDS,field))continue;
      const answer=answers[field];
      if(typeof answer!=='string'||!answer.trim())fields.add(field);
      if(answer!==condition.equals)continue;
    }
    const quantityField=rule.quantity?.field as ScopeField|undefined;
    if(quantityField&&Object.hasOwn(SCOPE_FIELDS,quantityField))fields.add(quantityField);
  }
  return [...fields];
}

export async function costQuestionFields(answers:ScopeAnswers):Promise<ScopeField[]>{
  const [policy]=await query("SELECT payload FROM p5_estimator_policy WHERE id='current'");
  const book=policy?.payload?.costBooks?.find((b:any)=>b.service===answers.service);
  return questionFieldsForBook(answers,book);
}
