/** Continue server-saved pricing stages without creating a second submission. */
export async function completeSubmission(send:()=>Promise<Response>,progress:(message:string)=>void,wait:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms))){
 for(let attempt=0;attempt<100;attempt++){
  const response=await send();const data=await response.json();
  if(response.status===202&&data.pending){progress(data.message||'Continuing your estimate...');await wait(Math.min(15000,Math.max(500,Number(data.retryAfterMs)||1500)));continue;}
  if(!response.ok)throw new Error(data.error||'Your estimate could not be completed. Your saved work is intact; please retry.');
  if(!data.result)throw new Error('Your pricing progress is saved. Please retry to continue.');
  return data;
 }
 throw new Error('Your pricing progress is saved. Please retry to continue the remaining check.');
}
