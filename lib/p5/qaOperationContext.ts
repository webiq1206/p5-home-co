import {AsyncLocalStorage} from 'node:async_hooks';

export type QaIntent={requestHash:string;tenant:string;project:string;boundary:string;model:string;maximum:number};
export type QaControl={mode:'capture'}|{mode:'exact';expected:QaIntent};
export type QaOperation={draftId:string;leaseToken:string;actorId:string;control:QaControl;active:boolean;capturedIntent?:QaIntent;brokerQueue?:Promise<void>;stopped?:Error};
const operations=new AsyncLocalStorage<QaOperation>();
export const qaOperationContext=()=>operations.getStore();
/** Set only by the authenticated six-case controller, never by a header. */
export function withinQaOperation<T>(operation:QaOperation,work:()=>Promise<T>){
  if(operations.getStore())throw new Error('Nested QA operator contexts are not permitted.');
  return operations.run(operation,work);
}

/** Close capability immediately when the handler settles. Only transport already
 * admitted may finish; queued siblings cannot dispatch or write after failure. */
export async function withinQaOperationPhase<T>(operation:QaOperation,work:()=>Promise<T>){
  try{return await withinQaOperation(operation,work);}
  finally{
    operation.active=false;
    let queued;do{queued=operation.brokerQueue;await queued;}while(queued!==operation.brokerQueue);
  }
}
