import {DraftError} from './store.ts';
import {json,limitedBody,protectRequest,failed} from './http.ts';
import {inspectQaSavedReading,applyQaSavedReading} from './qaSavedReading.ts';

/** Authentication is supplied by the route's existing administrator session.
 * Keeping this boundary injectable lets isolated tests prove denial before I/O. */
export function qaSavedReadingHandlers(authorize:()=>Promise<{id:string}>,operations={inspect:inspectQaSavedReading,apply:applyQaSavedReading}){
  return {
    GET:async(request:Request)=>{try{
      await authorize();
      return json(await operations.inspect(new URL(request.url).searchParams.get('case')));
    }catch(error){return failed(error);}},
    POST:async(request:Request)=>{try{
      const actor=await authorize();
      if(request.headers.get('origin')!==new URL(request.url).origin)throw new DraftError('Use the signed-in QA recovery page.',403);
      protectRequest(request);
      const raw=JSON.parse(new TextDecoder().decode(await limitedBody(request,2048)));
      if(!raw||Object.keys(raw).sort().join(',')!=='case,operation,revision')throw new DraftError('Invalid saved-reading action.',400);
      return json(await operations.apply(raw.case,raw.revision,raw.operation,actor.id));
    }catch(error){return failed(error);}},
  };
}
