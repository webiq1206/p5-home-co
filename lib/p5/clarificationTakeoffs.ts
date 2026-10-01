import {readTakeoffs,type Takeoff} from './documentLedger.ts';
import {explicitAnswerNumbers} from './answerParsing.ts';

export type TakeoffRevisionContext={prior:Takeoff[];answer:string};
/** A clarification can amend known work, but cannot manufacture new document
 * evidence. Keep physical identity and units server-owned and attribute the
 * changed quantity to the actual answer, with page zero for typed evidence. */
export function clarificationTakeoffUpdates(raw:unknown,context:TakeoffRevisionContext):Takeoff[]{
 const prior=new Map(context.prior.map(item=>[item.id,item]));
 const seen=new Set<string>();
 return readTakeoffs(raw||[]).flatMap(item=>{
  const original=prior.get(item.id);
  if(!original||seen.has(item.id)||context.prior.filter(priorItem=>priorItem.id===item.id).length!==1)throw new Error('clarification-takeoff-identity-invalid');
  seen.add(item.id);
  if(item.unit.trim().toLowerCase()!==original.unit.trim().toLowerCase())throw new Error('clarification-takeoff-unit-changed');
  if(item.quantity===original.quantity)return [];
  // Numeric corrections require that exact amount in the customer's answer.
  // A model's inferred number cannot become a stated customer quantity.
  const numbers=explicitAnswerNumbers(context.answer);
  if(item.quantity!==null&&!numbers.includes(item.quantity))throw new Error('clarification-quantity-evidence-unverified');
  return [{...original,quantity:item.quantity,basis:item.quantity===null?'uncertain' as const:'stated' as const,evidence:context.answer,
   sources:[{source:'typed scope',page:0,sheet:'',revision:''}],supersedes:[],issues:item.quantity===null?['Actual work quantity is unresolved after the customer clarification; use an explicit allowance, not the prior measurement.']:[]}];
 });
}
