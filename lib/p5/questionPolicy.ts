import {query} from './database.ts';
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

/** Request-local snapshot: repeated evaluations share one read without serving
 * a stale price book to the next request. Rejections are not cached globally. */
export function costQuestionReader(read=()=>query("SELECT payload FROM p5_estimator_policy WHERE id='current'")){
  let policy:ReturnType<typeof read>|undefined;
  return async(answers:ScopeAnswers):Promise<ScopeField[]>=>{
    const [row]=await (policy??=read());
    const book=row?.payload?.costBooks?.find((b:any)=>b.service===answers.service);
    return questionFieldsForBook(answers,book);
  };
}
export async function costQuestionFields(answers:ScopeAnswers):Promise<ScopeField[]>{
  return costQuestionReader()(answers);
}
