import {query} from './database.ts';
import {json,failed,protectRequest} from './http.ts';
import {readDraftById,issueLinkKey,DraftError} from './store.ts';
import {drainEstimatorJobs} from './backgroundJobs.ts';
import {processOutbox} from './outbox.ts';
import {runDriver,validDriveToken} from './estimateDriver.ts';
import {verifyEstimateLink} from './estimateLinks.ts';
import {recordEvent} from './events.ts';
/** Finish every requested submission whose pricing is ready; the customer need not be on the page. */
export async function finishRequestedSubmissions(limit=4):Promise<number>{
  const rows=await query("SELECT draft_id,payload FROM p5_estimator_work WHERE work_key='submit-request-v1' AND payload->>'state'='pending' ORDER BY updated_at LIMIT $1",[limit]);
  let finished=0;
  for(const row of rows){
    const id=String(row.draft_id);const request=row.payload as {revision:number;notify?:boolean};
    const mark=(state:string,outcome:string)=>query("UPDATE p5_estimator_work SET payload=payload||jsonb_build_object('state',$2::text,'outcome',$3::text,'finishedAt',now()::text),updated_at=now() WHERE draft_id=$1 AND work_key='submit-request-v1' AND (payload->>'revision')::int=$4 AND payload->>'state'='pending'",[id,state,outcome,request.revision]);
    const draft=await readDraftById(id);
    if(!draft){await mark('done','missing');continue;}
    if(draft.status==='submitted'){await mark('done','submitted');continue;}
    if(draft.revision!==request.revision){await mark('done','superseded');continue;}
    const {completeSubmission}=await import('./submitEndpoint.ts');
    const response=await completeSubmission(id,draft,{background:true,retry:false,holdMs:0});
    if(response.status===202||response.status===408||response.status===429||response.status>=500)continue;
    const outcome=response.status===200?'estimate-saved':response.status===422?'needs-review':`http-${response.status}`;
    await mark('done',outcome);finished++;
    void recordEvent({draftId:id,estimator:String(draft.answers?.service||'')||null,kind:'pricing',stage:'background-finish',code:outcome,outcome:response.status===200?'ok':'failed',message:`Finished without the browser (${outcome}).`});
  }
  return finished;
}
/** POST /api/p5-estimator/drive: the estimate driver. Only the server's own signed request may run it. */
export async function postDrive(request:Request){
  try{
    if(!validDriveToken(request.headers.get('x-p5-drive')))return json({error:'Not found'},404);
    const result=await runEstimatorDriver();
    return json(result);
  }catch(error){return failed(error);}
}
/** Used by both the signed self-driver and the authenticated external recovery scheduler. */
export function runEstimatorDriver(){return runDriver({
  drainJobs:async()=>{void drainEstimatorJobs();},
  finishSubmissions:()=>finishRequestedSubmissions(),
  deliver:async()=>{await processOutbox({limit:12});},
});}
/** POST /api/p5-estimator/open {id,t}: a signed estimate link, exchanged for a key for this device. */
export async function postOpen(request:Request){
  try{
    protectRequest(request,30);
    const body=await request.json().catch(()=>({})) as {id?:string;t?:string};
    const id=String(body.id||''),token=String(body.t||'');
    if(!verifyEstimateLink(id,token))throw new DraftError('This estimate link is not valid or has expired. Contact us and we will send a new one.',403);
    const draft=await readDraftById(id);if(!draft)throw new DraftError('This estimate could not be found.',404);
    const key=await issueLinkKey(id);
    return json({id,key,revision:draft.revision,status:draft.status,service:draft.answers?.service||'',text:draft.text||'',answers:draft.answers||{},contact:draft.contact||{name:'',email:'',phone:''}});
  }catch(error){return failed(error);}
}
