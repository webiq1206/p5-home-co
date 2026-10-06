import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import {qaBrokerEnvironment} from './qaBrokerConfiguration.ts';
import {ESTIMATOR_BRAND} from './brand.ts';
import {qaOperationContext,type QaIntent} from './qaOperationContext.ts';
import {assertQaOperationAccess} from './qaOperationFence.ts';

export const QA_PAID_KEY='qa-bounded-provider-v1';
type Context={draftId:string};
const current=new AsyncLocalStorage<Context>();
export const qaPaidContext=()=>current.getStore();
export class QaPaidHold extends Error {status=422;code='qa-paid-review-required';capturedIntent?:QaIntent;}
// Both broker guards stop before provider dispatch. Preserve their idle review
// time without forgiving provider work, uncertain charges or receipt failures.
export const isQaReviewWait=(error:unknown)=>error instanceof QaPaidHold
 &&['qa-exact-request-review-required','qa-server-tools-not-budgeted'].includes(error.message);
/** Server-owned markers only. The public draft API never creates this policy.
 * Inherited context cannot be cleared by an inner helper missing identity. */
export async function withQaPaidDraft<T>(draftId:string|undefined,work:()=>Promise<T>):Promise<T>{
 const operator=qaOperationContext();
 if(operator&&(!operator.active||draftId!==operator.draftId))throw new QaPaidHold('QA operator identity changed.');
 const inherited=current.getStore();
 if(inherited){if(draftId&&draftId!==inherited.draftId)throw new QaPaidHold('QA project identity changed.');return work();}
 if(!draftId)return work();
 const {query}=await import('./database.ts');
 const rows=await query('SELECT work_key FROM p5_estimator_work WHERE draft_id=$1 AND work_key IN ($2,$3)',[draftId,QA_PAID_KEY,'qa-no-provider-v1']);
 if(rows.some(r=>r.work_key==='qa-no-provider-v1'))throw new QaPaidHold('This QA draft permits deterministic pricing only.');
 if(operator&&!rows.some(r=>r.work_key===QA_PAID_KEY))throw new QaPaidHold('The bounded QA marker is missing.');
 return rows.some(r=>r.work_key===QA_PAID_KEY)?current.run({draftId},work):work();
}
export async function qaDocumentProject(draftId:string){
 const context=current.getStore();
 if(context&&context.draftId!==draftId)throw new QaPaidHold('QA project identity changed.');
 return context?'qa-paid-'+draftId:draftId;
}
/** Every site QA provider boundary goes to the SAME authenticated document
 * service ledger. Provider credentials/headers never leave the website here.
 * Ordinary customer requests retain their original transport. */
export async function qaProviderFetch(request:typeof fetch,input:Parameters<typeof fetch>[0],init?:RequestInit):Promise<Response>{
 const operator=qaOperationContext();
 if(operator){
  const pending=(operator.brokerQueue||Promise.resolve()).then(()=>{
   if(!operator.active)throw new QaPaidHold('The QA operator phase ended.');
   if(operator.stopped)throw operator.stopped;
   return qaProviderFetchImpl(request,input,init);
  });
  operator.brokerQueue=pending.then(()=>undefined,error=>{operator.stopped=error instanceof Error?error:new QaPaidHold('The QA operator phase stopped.');});
  return pending;
 }
 return qaProviderFetchImpl(request,input,init);
}
async function qaProviderFetchImpl(request:typeof fetch,input:Parameters<typeof fetch>[0],init?:RequestInit):Promise<Response>{
 const context=current.getStore();if(!context){if(qaOperationContext())throw new QaPaidHold('The QA broker context is required.');return request(input,init);}
 await assertQaOperationAccess(context.draftId);
 if(String(input)!=='https://api.anthropic.com/v1/messages'||init?.method!=='POST'||typeof init.body!=='string')throw new QaPaidHold('This QA request uses an unsupported provider boundary.');
 const parsed=JSON.parse(init.body);
 const {documentServiceConfiguration,documentServiceHeaders}=await import('./documentServiceClient.ts');
 const config=documentServiceConfiguration(qaBrokerEnvironment(process.env,ESTIMATOR_BRAND.domain));
 const path='/v1/projects/'+encodeURIComponent('qa-paid-'+context.draftId)+'/qa-provider';
 // The immutable request hash is a dedupe identity, never permission to spend.
 // Only a server-provisioned one-use native review permits the exact intent.
 const boundary='site:'+createHash('sha256').update(JSON.stringify(parsed.system||'')).digest('hex');
 const operator=qaOperationContext();
 const body=Buffer.from(JSON.stringify({boundary,body:parsed,...(operator?{control:operator.control}:{})}));
 const response=await fetch(config.origin.origin+config.origin.pathname.replace(/\/$/,'')+path,{method:'POST',headers:{...documentServiceHeaders('POST',path,config.tenant,config.secret,body),'content-type':'application/json'},body,redirect:'error',signal:init.signal});
 if(!response.ok){let code='qa-provider-held',capturedIntent:QaIntent|undefined;try{const value=await response.json();code=value.error||code;capturedIntent=value.capturedIntent;}catch{}const hold=new QaPaidHold(code);if(operator&&capturedIntent){operator.capturedIntent=capturedIntent;hold.capturedIntent=capturedIntent;}throw hold;}
 return response;
}
