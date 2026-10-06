import {ROBOTS_TAG} from '../../app/lib/privacy.ts';
import {publicOrigin} from '../../app/lib/public-url.ts';
import {configuredOrigins,protectRequest,json,failed} from './http.ts';
import {DraftError} from './store.ts';
import {inspectQaSavedEstimate,qaSavedEstimatePdf,savedEstimateRevision} from './qaSavedEstimate.ts';

/** Browser GETs commonly omit Origin. Require both Fetch Metadata and the
 * browser's same-origin Referer; proxy headers cannot expand the allowlist. */
function protectSavedEstimateRead(request:Request){
  const deny=()=>{throw new DraftError('Use the signed-in saved estimate page.',403);};
  if(request.headers.get('sec-fetch-site')!=='same-origin')deny();
  let referer:URL,target:URL;
  try{referer=new URL(request.headers.get('referer')||'');target=new URL(publicOrigin(request));}catch{return deny();}
  if(!['https:','http:'].includes(referer.protocol)||referer.username||referer.password
    ||target.username||target.password||target.pathname!=='/'||target.search||target.hash
    ||!configuredOrigins().has(target.origin)||referer.origin!==target.origin)deny();
  const origin=request.headers.get('origin');
  if(origin!==null&&origin!==target.origin)deny();
  protectRequest(request);
}
const privateResponse=(response:Response)=>{
  response.headers.set('Cache-Control','private, no-store');
  response.headers.set('X-Content-Type-Options','nosniff');
  response.headers.set('X-Robots-Tag',ROBOTS_TAG);
  return response;
};

/** The route supplies the existing administrator session before any state read. */
export function qaSavedEstimateHandlers(authorize:()=>Promise<{id:string}>,operations={inspect:inspectQaSavedEstimate,pdf:qaSavedEstimatePdf}){
  return {GET:async(request:Request)=>{
    try{
      await authorize();
      if(request.method!=='GET')return privateResponse(new Response(null,{status:405,headers:{Allow:'GET'}}));
      protectSavedEstimateRead(request);
      const params=new URL(request.url).searchParams;
      if([...params.keys()].some(key=>!['case','revision','pdf'].includes(key))
        ||params.getAll('case').length!==1||params.getAll('revision').length!==1||params.getAll('pdf').length>1
        ||(params.has('pdf')&&params.get('pdf')!=='1'))throw new DraftError('Invalid saved estimate request.',400);
      if(params.get('case')!=='case-1')throw new DraftError('Only the existing synthetic case 1 is available here.',404);
      const revision=savedEstimateRevision(params.get('revision'));
      return privateResponse(params.has('pdf')?await operations.pdf('case-1',revision):json(await operations.inspect('case-1',revision)));
    }catch(error){return privateResponse(failed(error));}
  }};
}
