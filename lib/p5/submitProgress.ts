import {CLIENT_BUDGET_MS,remainingBudget,withinDeadline} from './processingBudget.ts';
import type {ProcessingStatus} from './processingStatus';
/** Continue server-saved pricing stages without creating a second submission. */
export async function completeSubmission(send:()=>Promise<Response>,progress:(message:string,status?:ProcessingStatus)=>void,wait:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms)),deadline=Date.now()+CLIENT_BUDGET_MS){
 for(;;){
  const response=await withinDeadline(send,deadline);const data=await withinDeadline(()=>response.json(),deadline);
  if(response.status===202&&data.pending){progress(data.message||'Continuing your estimate...',data.processing);await withinDeadline(()=>wait(Math.min(1500,Math.max(500,Number(data.retryAfterMs)||1000),remainingBudget(deadline))),deadline);continue;}
  if(!response.ok)throw new Error(data.error||'Your estimate could not be completed. Your saved work is intact; please retry.');
  if(!data.result)throw new Error('Your pricing progress is saved. Please retry to continue.');
  return data;
 }
}
