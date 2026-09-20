import { ESTIMATOR_BRAND } from "./brand.ts";
import { DraftError } from "./store.ts";
const buckets=new Map<string,{count:number;until:number}>();
function configuredOrigins() {
  const values=[`https://${ESTIMATOR_BRAND.domain}`,`https://www.${ESTIMATOR_BRAND.domain}`,process.env.APP_BASE_URL,process.env.REPLIT_DEV_DOMAIN];
  return new Set(values.flatMap(value=>{
    if(!value)return [];
    try{return [new URL(value.includes("://")?value:`https://${value}`).origin];}catch{return [];}
  }));
}
export function protectRequest(request:Request,limit=60) {
  const origin=request.headers.get("origin");const url=new URL(request.url);
  const localPreview=process.env.NODE_ENV==="development" && origin==="http://terminal.local:4173";
  if(origin && !localPreview && origin!==url.origin && !configuredOrigins().has(origin))throw new DraftError("Request origin is not allowed.",403);
  // Limits follow the project, not the network: an office, a carrier NAT or a
  // family shares one address, and one customer answering twenty questions
  // saves far more often than an abusive client needs to be allowed to.
  // The address bucket stays as a much higher ceiling against abuse. Replit's
  // proxy appends the real client address last; earlier entries are client-supplied.
  const address=(request.headers.get("x-forwarded-for")||"unknown").split(",").at(-1)!.trim()||"unknown";
  const project=(request.headers.get("x-p5-draft-id")||"").slice(0,64);const now=Date.now();
  if(buckets.size>10000)for(const [k,v]of buckets)if(v.until<now)buckets.delete(k);
  const spend=(key:string,ceiling:number)=>{const b=buckets.get(key);if(!b||b.until<now){buckets.set(key,{count:1,until:now+600000});return;}if(++b.count>ceiling)throw new DraftError("Your project is saved. Please wait a minute, then continue.",429);};
  const perProject=Math.max(limit,600);
  if(project)spend(`${url.pathname}:${request.method}:project:${project}`,perProject);
  spend(`${url.pathname}:${request.method}:address:${address}`,project?perProject*10:Math.max(limit,120));
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
  const message=code==="analysis-unconfigured"?"Automatic scope review is temporarily unavailable. Your saved work is intact; continue manually or try again later.":code==="analysis-busy"?"Scope review is busy. Your work is saved. Please try again shortly.":"We could not finish this step. Your existing work is intact. Please try again.";
  return json({error:message},503);
}
