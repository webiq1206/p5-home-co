import {protectQaAction} from './qaOrigin.ts';
import {DraftError} from './store.ts';
import {json,failed,limitedBody} from './http.ts';
import {inspectQaContinuation,continueQaCase,qaSavedPdf} from './qaContinuation.ts';

export function qaContinuationHandlers(authorize:()=>Promise<{id:string}>){
  return {
    GET:async(request:Request)=>{try{
      await authorize();const url=new URL(request.url);
      if(url.searchParams.get('pdf')==='1')return await qaSavedPdf(url.searchParams.get('case'),url.searchParams.get('revision'));
      return json(await inspectQaContinuation(url.searchParams.get('case')));
    }catch(error){return failed(error);}},
    POST:async(request:Request)=>{try{
      const actor=await authorize();
      protectQaAction(request,'Use the signed-in QA continuation page.');
      const body=JSON.parse(new TextDecoder().decode(await limitedBody(request,8000)));
      if(!body||Object.keys(body).some(key=>!['case','token','action','questionId','answer'].includes(key)))throw new DraftError('Invalid QA continuation action.',400);
      return json(await continueQaCase(body,actor.id));
    }catch(error){return failed(error);}},
  };
}
