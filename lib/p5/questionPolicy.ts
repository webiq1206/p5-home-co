import {query} from './database';
import {SCOPE_FIELDS,type ScopeAnswers,type ScopeField} from './scope.ts';
import {planningQuestionFields} from './planningBooks.ts';
export async function costQuestionFields(answers:ScopeAnswers):Promise<ScopeField[]>{
  const [policy]=await query("SELECT payload FROM p5_estimator_policy WHERE id='current'");
  const book=policy?.payload?.costBooks?.find((b:any)=>b.service===answers.service);
  if(book?.mode==='owner-planning')return planningQuestionFields(answers);
  const fields=new Set<ScopeField>();
  for(const rule of book?.rules||[]){
    if(rule.when){
      if(!answers[rule.when.field as ScopeField])fields.add(rule.when.field);
      if(answers[rule.when.field as ScopeField]!==rule.when.equals)continue;
    }
    if(rule.quantity?.field&&Object.hasOwn(SCOPE_FIELDS,rule.quantity.field))fields.add(rule.quantity.field);
  }
  return [...fields];
}
