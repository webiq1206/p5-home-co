import {createHash,randomBytes} from 'node:crypto';
import {query} from './database.ts';
import {handoffForService} from './adaptive.ts';
import {ESTIMATOR_BRAND} from './brand.ts';
import {SCOPE_TEXT_LIMIT,SCOPE_FILE_COUNT,SCOPE_FILE_LIMIT,SCOPE_BATCH_LIMIT} from './scope.ts';

/**
 * Carrying a project from one sister company's estimator to another's.
 *
 * The sending site's server posts the customer's scope text and answers to the receiving site,
 * which keeps them under a random single-use code for 30 minutes and returns the code. The customer
 * is sent to the receiving estimator with only that opaque code in the link; the page claims it
 * once and starts from the carried scope. No scope, contact or answer ever appears in a URL, and a
 * code can be used once. Files are not carried (each site keeps its own storage), and the customer
 * is told to attach them again.
 *
 * Rows live in the existing p5_estimator_policy table as `handoff:<sha256 of code>`, so no schema
 * change is needed and a copy of the database never exposes a usable code.
 */
export const CONTINUATION_MINUTES=30;
const MAX_TEXT=SCOPE_TEXT_LIMIT,MAX_ANSWERS=100,MAX_ANSWER=SCOPE_TEXT_LIMIT;
export const CONTINUATION_BODY_LIMIT=2*SCOPE_TEXT_LIMIT;
export interface Continuation {text:string;answers:Record<string,string>;from:string;fromName:string;requiredFiles?:Array<{name:string;size:number}>}
const rowId=(code:string)=>`handoff:${createHash('sha256').update(code).digest('hex')}`;
/** Preserve accepted scope in full. Oversize input is refused, never silently truncated. */
export function cleanContinuation(value:unknown):Continuation|null{
  if(!value||typeof value!=='object')return null;
  const v=value as Record<string,unknown>;
  const text=typeof v.text==='string'?v.text:'';
  if(text.length>MAX_TEXT)return null;
  const answers:Record<string,string>={};
  const entries=v.answers&&typeof v.answers==='object'?Object.entries(v.answers):[];
  if(entries.length>MAX_ANSWERS)return null;
  for(const [key,answer] of entries){
    if(typeof answer==='string'&&answer.length>MAX_ANSWER)return null;
    if(/^[a-zA-Z][a-zA-Z0-9]{0,40}$/.test(key)&&typeof answer==='string'&&answer.trim())answers[key]=answer;
  }
  const requiredFiles:Array<{name:string;size:number}>=[];
  if(v.requiredFiles!==undefined){
    if(!Array.isArray(v.requiredFiles)||v.requiredFiles.length>SCOPE_FILE_COUNT)return null;
    for(const file of v.requiredFiles){
      if(!file||typeof file.name!=='string'||!file.name.trim()||file.name.length>500||!Number.isSafeInteger(file.size)||file.size<=0||file.size>SCOPE_FILE_LIMIT)return null;
      if(!requiredFiles.some(f=>f.name===file.name&&f.size===file.size))requiredFiles.push({name:file.name,size:file.size});
    }
    if(requiredFiles.reduce((n,f)=>n+f.size,0)>SCOPE_BATCH_LIMIT)return null;
  }
  const from=typeof v.from==='string'&&/^[a-z0-9.-]{3,80}$/.test(v.from)?v.from:'';
  const fromName=typeof v.fromName==='string'?v.fromName.slice(0,80):'';
  if(!text.trim()&&!Object.keys(answers).length&&!requiredFiles.length)return null;
  if(JSON.stringify({text,answers,requiredFiles}).length>CONTINUATION_BODY_LIMIT-2000)return null;
  return {text,answers,from,fromName,...(requiredFiles.length?{requiredFiles}:{})};
}
/** Receiving side: keep a carried project under a new single-use code. */
export async function createContinuation(value:unknown):Promise<string|null>{
  const payload=cleanContinuation(value);
  if(!payload)return null;
  const code=randomBytes(24).toString('base64url');
  await query(`DELETE FROM p5_estimator_policy WHERE id LIKE 'handoff:%' AND updated_at<now()-interval '${CONTINUATION_MINUTES} minutes'`);
  await query("INSERT INTO p5_estimator_policy (id,version,payload,updated_by) VALUES ($1,1,$2,'handoff')",[rowId(code),JSON.stringify(payload)]);
  return code;
}
/** Receiving side: use a code once. A used, expired or unknown code returns null. */
export async function claimContinuation(code:unknown):Promise<Continuation|null>{
  if(typeof code!=='string'||!/^[A-Za-z0-9_-]{32}$/.test(code))return null;
  const [row]=await query(`DELETE FROM p5_estimator_policy WHERE id=$1 AND updated_at>now()-interval '${CONTINUATION_MINUTES} minutes' RETURNING payload`,[rowId(code)]);
  return row?cleanContinuation(row.payload):null;
}
/** Sending side: carry this project to the company that estimates the service. Returns the link to
 * send the customer to, or null (the caller then falls back to the plain estimator link). */
export async function sendContinuation(service:string,value:unknown,fetcher:typeof fetch=fetch):Promise<{url:string;carried:boolean}|null>{
  const route=handoffForService(service);
  if(!route)return null;
  const payload=cleanContinuation({...(value as object),from:ESTIMATOR_BRAND.domain,fromName:ESTIMATOR_BRAND.name});
  if(!payload)return {url:route.url,carried:false};
  try{
    const origin=new URL(route.url).origin;
    const response=await fetcher(`${origin}/api/p5-estimator/handoff`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'create',...payload}),signal:AbortSignal.timeout(8000)});
    const data=response.ok?await response.json() as {code?:unknown}:null;
    if(typeof data?.code!=='string'||!/^[A-Za-z0-9_-]{32}$/.test(data.code))return {url:route.url,carried:false};
    return {url:`${route.url}?continue=${data.code}`,carried:true};
  }catch{return {url:route.url,carried:false};}
}
