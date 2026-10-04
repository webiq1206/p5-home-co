import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';

export const QA_PAID_KEY='qa-bounded-provider-v1';
type Context={draftId:string};
const current=new AsyncLocalStorage<Context>();
export const qaPaidContext=()=>current.getStore();
export class QaPaidHold extends Error {status=422;code='qa-paid-review-required';}
/** Server-owned markers only. The public draft API never creates this policy.
 * Inherited context cannot be cleared by an inner helper missing identity. */
export async function withQaPaidDraft<T>(draftId:string|undefined,work:()=>Promise<T>):Promise<T>{
 const inherited=current.getStore();
 if(inherited){if(draftId&&draftId!==inherited.draftId)throw new QaPaidHold('QA project identity changed.');return work();}
 if(!draftId)return work();
 const {query}=await import('./database.ts');
 const rows=await query('SELECT work_key FROM p5_estimator_work WHERE draft_id=$1 AND work_key IN ($2,$3)',[draftId,QA_PAID_KEY,'qa-no-provider-v1']);
 if(rows.some(r=>r.work_key==='qa-no-provider-v1'))throw new QaPaidHold('This QA draft permits deterministic pricing only.');
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
 const context=current.getStore();if(!context)return request(input,init);
 if(String(input)!=='https://api.anthropic.com/v1/messages'||init?.method!=='POST'||typeof init.body!=='string')throw new QaPaidHold('This QA request uses an unsupported provider boundary.');
 const parsed=JSON.parse(init.body);
 const {documentServiceConfiguration,documentServiceHeaders}=await import('./documentServiceClient.ts');
 const config=documentServiceConfiguration();
 const path='/v1/projects/'+encodeURIComponent('qa-paid-'+context.draftId)+'/qa-provider';
 // The immutable request hash is a dedupe identity, never permission to spend.
 // Only a server-provisioned one-use native review permits the exact intent.
 const boundary='site:'+createHash('sha256').update(JSON.stringify(parsed.system||'')).digest('hex');
 const body=Buffer.from(JSON.stringify({boundary,body:parsed}));
 const response=await fetch(config.origin.origin+config.origin.pathname.replace(/\/$/,'')+path,{method:'POST',headers:{...documentServiceHeaders('POST',path,config.tenant,config.secret,body),'content-type':'application/json'},body,redirect:'error',signal:init.signal});
 if(!response.ok){let code='qa-provider-held';try{code=(await response.json()).error||code;}catch{}throw new QaPaidHold(code);}
 return response;
}
