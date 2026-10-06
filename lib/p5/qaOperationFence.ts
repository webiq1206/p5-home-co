import {query} from './database.ts';
import {DraftError} from './store.ts';
import {isOperatorQaCase,QA_OPERATION_KEY} from './qaCases.ts';
import {qaOperationContext} from './qaOperationContext.ts';

/** Other cases/tenants do not acquire an operator capability or an extra query.
 * An expired request context is never allowed to write after its lease ends. */
export async function assertQaOperationAccess(id:string,read=query){
  const operation=qaOperationContext();
  if(operation&&(!operation.active||operation.draftId!==id||!isOperatorQaCase(id)))throw new DraftError('The QA operation identity changed.',409);
  if(!isOperatorQaCase(id))return;
  const [lease]=await read('SELECT lease_token,(lease_until>now()) AS active FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[id,QA_OPERATION_KEY]);
  if(operation?(!lease?.active||lease.lease_token!==operation.leaseToken):lease?.active)throw new DraftError('This QA case has an active or expired operator action. Inspect its saved state before continuing.',409);
  if(!operation){
    const [held]=await read("SELECT 1 FROM p5ds_qa_calls c JOIN p5ds_qa_intents i ON i.request_hash=c.request_hash AND i.run_id=c.run_id WHERE i.run_id='p5-acceptance-20261004' AND i.tenant='p5homeco.com' AND i.project=$1 AND c.status IN ('permitted','in_flight','unknown') LIMIT 1",['qa-paid-'+id]);
    if(held)throw new DraftError('This QA case retains an unresolved provider reservation.',409);
  }
}

/** Only small database writes belong here. Provider/transport work must happen
 * outside this transaction. Locking the draft serializes lease acquisition and
 * all normal mutations of these six existing synthetic cases. */
export async function withQaWriteFence<T>(id:string,work:()=>Promise<T>){
  if(!isOperatorQaCase(id)&&!qaOperationContext())return work();
  const {scopedTransaction}=await import('./database.ts');
  return scopedTransaction(async read=>{
    await read('SELECT id FROM p5_estimator_drafts WHERE id=$1 FOR UPDATE NOWAIT',[id]);
    await assertQaOperationAccess(id,read);
    return work();
  });
}
