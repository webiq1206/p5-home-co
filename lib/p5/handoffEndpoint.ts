import {protectRequest,limitedBody,json,failed} from './http.ts';
import {DraftError} from './store.ts';
import {createContinuation,claimContinuation,sendContinuation} from './handoff.ts';

/**
 * POST /api/p5-estimator/handoff
 *   {action:'send', service, text, answers}  from this site's own page: carry the project to the
 *                                             sister company and return the link to open.
 *   {action:'create', text, answers, from}    from a sister site's server: keep the project under a
 *                                             new single-use code and return the code.
 *   {action:'claim', code}                    from this site's own page: use a code once.
 * Browser requests from other origins are refused by protectRequest; a sister site's server sends
 * no Origin header. No response ever contains contact details, and nothing is put in a URL except
 * the opaque code.
 */
export async function handoffRequest(request:Request):Promise<Response>{
  try{
    protectRequest(request,30);
    const body=JSON.parse(new TextDecoder().decode(await limitedBody(request,64_000))) as Record<string,unknown>;
    if(body.action==='send'){
      if(typeof body.service!=='string')throw new DraftError('Choose the kind of project first.');
      const sent=await sendContinuation(body.service,{text:body.text,answers:body.answers});
      if(!sent)throw new DraftError('This project belongs with this company; no transfer is needed.');
      return json(sent);
    }
    if(body.action==='create'){
      const code=await createContinuation(body);
      if(!code)throw new DraftError('Nothing to carry over.');
      return json({code});
    }
    if(body.action==='claim'){
      const carried=await claimContinuation(body.code);
      if(!carried)return json({error:'This link has already been used or has expired. Describe your project below to start.'},404);
      return json({text:carried.text,answers:carried.answers,fromName:carried.fromName});
    }
    throw new DraftError('Unknown request.');
  }catch(error){return failed(error);}
}
