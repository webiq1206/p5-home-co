import {CLIENT_BUDGET_MS,remainingBudget,withinDeadline} from './processingBudget.ts';
import type {ProcessingStatus} from './processingStatus.ts';
/** Continue server-saved pricing stages without creating a second submission.
 * A rejected submission keeps the server's structured reply on the error so
 * the interface can link the visitor to exactly what is missing. */
export async function completeSubmission(send:()=>Promise<Response>,progress:(message:string,status?:ProcessingStatus)=>void,wait:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms)),deadline=Date.now()+CLIENT_BUDGET_MS){
 let interruptions=0;
 const recover=async()=>{
  progress('The connection was interrupted. Your project is saved, and we are checking its pricing progress again.');
  const delay=Math.min(10000,1000*2**Math.min(interruptions++,3),remainingBudget(deadline));
  await withinDeadline(()=>wait(delay),deadline);
 };
 for(;;){
  let response:Response;
  try{response=await withinDeadline(send,deadline);}catch(error){
   if(!(error instanceof TypeError))throw error;
   await recover();continue;
  }
  const data=await withinDeadline(()=>response.json().catch(()=>null),deadline);
  if(!data||typeof data!=='object'){
   if(response.status===401||response.status===403)throw new Error('Your saved project could not be accessed. Please reopen your estimate link or contact our team.');
   if(response.status>=400&&response.status<500&&![408,425,429].includes(response.status))throw new Error('The site could not accept this request. Your project is saved. Please try again.');
   await recover();continue;
  }
  interruptions=0;
  if(response.status===202&&data.pending){progress(data.message||'Continuing your estimate...',data.processing);await withinDeadline(()=>wait(Math.min(1500,Math.max(500,Number(data.retryAfterMs)||1000),remainingBudget(deadline))),deadline);continue;}
  if(!response.ok){const failure=new Error(data.error||'Your estimate could not be completed. Your saved work is intact; please retry.');(failure as Error&{details?:unknown}).details=data;throw failure;}
  if(!data.result)throw new Error('Your pricing progress is saved. Please retry to continue.');
  return data;
 }
}
