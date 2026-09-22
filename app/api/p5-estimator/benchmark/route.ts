import {runReadBenchmark} from '@/lib/p5/readBenchmark';
import {draftCredentials} from '@/lib/p5/store';
import {protectRequest,json,failed,limitedBody} from '@/lib/p5/http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;
/** Reader benchmark for a QA draft's own upload: one reader setup per request (lib/p5/readBenchmark.ts). */
export async function POST(request:Request){
  try{
    protectRequest(request,20);const {id,key}=draftCredentials(request);
    const body=JSON.parse(new TextDecoder().decode(await limitedBody(request,2000)));
    return json(await runReadBenchmark(id,key,body));
  }catch(error){return failed(error);}
}
