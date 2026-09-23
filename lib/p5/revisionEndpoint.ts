import {draftCredentials,readDraft,DraftError} from './store.ts';
import {json,failed,protectRequest,limitedBody} from './http.ts';
import {startRevision} from './estimateRevisions.ts';
import {recordEvent} from './events.ts';
/** POST /api/p5-estimator/revise {change}: reopen a saved estimate as its next revision (estimateRevisions.ts). */
export async function postRevision(request:Request){
  try{
    protectRequest(request,20);const {id,key}=draftCredentials(request);
    const draft=await readDraft(id,key);if(!draft)throw new DraftError('Estimate not found.',404);
    const body=JSON.parse(new TextDecoder().decode(await limitedBody(request,8000))||'{}') as {change?:unknown};
    const opened=await startRevision(id,typeof body.change==='string'?body.change:'');
    void recordEvent({draftId:id,estimator:String(draft.answers?.service||'')||null,kind:'analysis',stage:'revision',code:'opened',outcome:'ok',message:`Revision ${opened.revision} opened from ${opened.previous}.`});
    return json(opened);
  }catch(error){return failed(error);}
}
