import {readTakeoffs,type Takeoff} from './documentLedger.ts';
import {explicitAnswerNumbers} from './answerParsing.ts';

export type TakeoffRevisionContext={prior:Takeoff[];answer:string};
/** A correction selects existing work; it does not regenerate its identity,
 * description, unit or evidence. Both providers receive this bounded contract. */
export function clarificationTakeoffSchema(context:TakeoffRevisionContext){
 const ids=context.prior.map(item=>item.id).filter((id,_,all)=>all.filter(value=>value===id).length===1);
 return {type:'array',maxItems:ids.length,items:{type:'object',properties:{id:{type:'string',enum:ids.length?ids:['no-existing-takeoff']},quantity:{type:['number','null']}},required:['id','quantity'],additionalProperties:false}};
}
/** A clarification can amend known work, but cannot manufacture new document
 * evidence. Keep physical identity and units server-owned and attribute the
 * changed quantity to the actual answer, with page zero for typed evidence. */
export function clarificationTakeoffUpdates(raw:unknown,context:TakeoffRevisionContext):Takeoff[]{
 const prior=new Map(context.prior.map(item=>[item.id,item]));
 const seen=new Set<string>();
 if(!Array.isArray(raw))throw new Error('Invalid quantity takeoff');
 return raw.flatMap((value,index)=>{
  if(!value||typeof value!=='object'||typeof value.id!=='string')throw new Error(`clarification-takeoff-identity-invalid: missing-id at update ${index}`);
  const original=prior.get(value.id);
  if(!original)throw new Error(`clarification-takeoff-identity-invalid: unknown-id at update ${index}`);
  const reason=seen.has(value.id)?'duplicate-update':context.prior.filter(priorItem=>priorItem.id===value.id).length!==1?'ambiguous-prior-id':null;
  if(reason)throw new Error(`clarification-takeoff-identity-invalid: ${reason} at update ${index}`);
  seen.add(value.id);
  const compact=Object.keys(value).every(key=>key==='id'||key==='quantity');
  const item=readTakeoffs([compact?{...original,quantity:value.quantity,basis:value.quantity===null?'uncertain':'stated'}:value])[0];
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
