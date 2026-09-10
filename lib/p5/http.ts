import { ESTIMATOR_BRAND } from "./brand";
import { DraftError } from "./store";
const buckets=new Map<string,{count:number;until:number}>();
export function protectRequest(request:Request,limit=60) {
  const origin=request.headers.get("origin");const url=new URL(request.url);
  if(origin && origin!==url.origin && origin!==`https://${ESTIMATOR_BRAND.domain}`)throw new DraftError("Request origin is not allowed.",403);
  const key=`${url.pathname}:${request.method}:${(request.headers.get("x-forwarded-for")||"unknown").split(",")[0]}`;const now=Date.now();
  if(buckets.size>10000)for(const [k,v]of buckets)if(v.until<now)buckets.delete(k);
  const b=buckets.get(key);if(!b||b.until<now)buckets.set(key,{count:1,until:now+600000});
  else if(++b.count>limit)throw new DraftError("Please wait a few minutes before trying again.",429);
}
export async function limitedBody(request:Request,max:number) {
  const declared=Number(request.headers.get("content-length")||0);if(declared>max)throw new DraftError("Request is too large.",413);
  const reader=request.body?.getReader();if(!reader)return new Uint8Array();
  const chunks:Uint8Array[]=[];let length=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>max){await reader.cancel();throw new DraftError("Request is too large.",413);}chunks.push(value);}}finally{reader.releaseLock();}
  const data=new Uint8Array(length);let at=0;for(const chunk of chunks){data.set(chunk,at);at+=chunk.length;}return data;
}
export function json(data:unknown,status=200){return Response.json(data,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});}
export function failed(error:unknown){
  if(error instanceof DraftError)return json({error:error.message},error.status);
  console.error("[p5-estimator]",error instanceof Error?error.message:"request failed");
  const code=error instanceof Error?error.message:"";
  const message=code==="analysis-unconfigured"?"Automatic scope review is temporarily unavailable. Your saved work is intact; add what you know below or retry the document review.":code==="analysis-busy"?"Scope review is busy. Your work is saved. Please try again shortly.":"We could not finish this step. Your existing work is intact. Please try again.";
  return json({error:message},503);
}
