// QA-only helpers. Production never imports this module or opens this database.
import {PGlite} from '@electric-sql/pglite';
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {DDL} from '../src/store.mjs';
import {ServiceError,hash} from '../src/core.mjs';

export async function privateJson(file,value){
 await mkdir(dirname(file),{recursive:true,mode:0o700});
 await writeFile(file+'.tmp',JSON.stringify(value,null,2),{mode:0o600});
 await rename(file+'.tmp',file);
}

/** PGlite has one connection. Hold its queue for the WHOLE SQL transaction. */
export async function isolatedPool(directory){
 const db=new PGlite(directory);await db.waitReady;
 let queue=Promise.resolve();
 const acquire=async()=>{let release;const current=new Promise(resolve=>{release=resolve;});const prior=queue;queue=current;await prior;return release;};
 const query=async(sql,params=[])=>{
  if(sql===DDL){await db.exec(sql);return {rows:[],rowCount:0};}
  const result=await db.query(sql,params);
  return {...result,rowCount:result.rowCount??(result.rows.length||result.affectedRows||0)};
 };
 return {
  query:async(sql,params)=>{const release=await acquire();try{return await query(sql,params);}finally{release();}},
  connect:async()=>{const unlock=await acquire();let released=false;return {query,release:()=>{if(!released){released=true;unlock();}}};},
  end:async()=>{const release=await acquire();try{await db.close();}finally{release();}}
 };
}

// Anthropic standard Sonnet 5 prices verified 2026-09-18. Estimates, not invoices.
// https://platform.claude.com/docs/en/about-claude/pricing
const cost=usage=>((usage.input_tokens||0)*2+(usage.output_tokens||0)*10+
 (usage.cache_creation_input_tokens||0)*2.5+(usage.cache_read_input_tokens||0)*.2)/1e6;
const safeUsage=usage=>Object.fromEntries(['input_tokens','output_tokens','cache_creation_input_tokens','cache_read_input_tokens'].map(k=>[k,Number.isSafeInteger(usage?.[k])&&usage[k]>=0?usage[k]:0]));

/** Reserve before sending. Unknown/timeout charges retain their full reservation.
 * The provider token counter is an estimate, so this is NOT a billing hard cap. */
export async function guardedSonnetFetch({file,limitUsd,maxCalls,request=fetch,onRequest=()=>{},onPause=()=>{}}){
 let state;
 try{state=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;state={version:1,model:'claude-sonnet-5',calls:[],tokenCountMs:0};}
 if(state.version!==1||state.model!=='claude-sonnet-5'||!Array.isArray(state.calls)||state.calls.some(c=>!Number.isFinite(c.reservedUsd)||c.reservedUsd<0))throw Error('Invalid saved QA cost ledger.');
 // A previous interrupted call may have incurred charges. Resuming the same
 // ledger must not issue more paid requests, even if its estimate is below cap.
 state.paused=Boolean(state.paused||state.calls.some(c=>['reserved','charge-unknown'].includes(c.status)));
 const checkPaused=()=>{if(state.paused)throw new ServiceError('qa-paused-unknown-provider-charge',422);};
 let persistence=Promise.resolve();
 const save=()=>{const snapshot=structuredClone(state);persistence=persistence.then(()=>privateJson(file,snapshot));return persistence;};
 const reserved=()=>state.calls.reduce((sum,c)=>sum+c.reservedUsd,0);
 const guarded=async(url,options)=>{
  checkPaused();options.signal?.throwIfAborted();
  const body=JSON.parse(options.body);
  if(url!=='https://api.anthropic.com/v1/messages'||body.model!=='claude-sonnet-5'||!Number.isSafeInteger(body.max_tokens)||body.max_tokens<1||body.max_tokens>10000)throw new ServiceError('qa-unapproved-provider-request',422);
  if(state.calls.length>=maxCalls)throw new ServiceError('qa-request-limit-reached',422);
  const started=performance.now();
  const countBody={model:body.model,system:body.system,messages:body.messages,...(body.tools?{tools:body.tools}:{}),...(body.tool_choice?{tool_choice:body.tool_choice}:{})};
  const counted=await request('https://api.anthropic.com/v1/messages/count_tokens',{...options,body:JSON.stringify(countBody),redirect:'error'});
  if(!counted.ok)throw new ServiceError('qa-token-count-http-'+counted.status,422);
  const count=await counted.json();
  if(!Number.isSafeInteger(count.input_tokens)||count.input_tokens<0)throw new ServiceError('qa-invalid-token-count',422);
  state.tokenCountMs+=Math.round(performance.now()-started);
  checkPaused();options.signal?.throwIfAborted();
  // Include an extra schema allowance, 20% input-count headroom and 2,048 tokens.
  const inputUpper=Math.ceil(count.input_tokens*1.2)+2048+Buffer.byteLength(JSON.stringify(body.output_config||{}));
  const estimate=(inputUpper*2.5+body.max_tokens*10)/1e6;
  if(state.calls.length>=maxCalls||reserved()+estimate>limitUsd)throw new ServiceError('qa-estimated-spend-limit-reached',422);
  const record={reservedUsd:estimate,estimatedInputTokens:count.input_tokens,maxOutputTokens:body.max_tokens,status:'reserved'};
  state.calls.push(record);await save();let sent=false,response;
  try{
   checkPaused();options.signal?.throwIfAborted();
   onRequest(state.calls.length);sent=true;
   response=await request(url,{...options,redirect:'error'});
   record.httpStatus=response.status;
   const responseText=await response.clone().text();
   // Persist the paid reply BEFORE schema/domain validation. No headers or keys
   // are written. A rejected citation remains available for free local replay.
   const responseFile=join('responses',String(state.calls.indexOf(record)+1).padStart(4,'0')+'.json');
   await privateJson(join(dirname(file),responseFile),{version:1,requestSha256:hash(options.body),request:body,httpStatus:response.status,responseText});
   record.responseFile=responseFile;
   const data=JSON.parse(responseText);
   if(data?.usage&&Number.isSafeInteger(data.usage.input_tokens)&&data.usage.input_tokens>=0&&Number.isSafeInteger(data.usage.output_tokens)&&data.usage.output_tokens>=0){
    record.usage=safeUsage(data.usage);record.estimatedActualUsd=cost(record.usage);
    record.reservedUsd=record.estimatedActualUsd;record.status='usage-reported';
   }else throw new ServiceError('qa-provider-usage-missing',422);
  }catch(error){
   if(!sent){record.status='not-sent';record.reservedUsd=0;await save();throw error;}
   record.status='charge-unknown';state.paused=true;
   const paused=new ServiceError('qa-paused-unknown-provider-charge',422);
   onPause(paused);await save();throw paused;
  }
  await save();return response;
 };
 return {request:guarded,summary:()=>({model:state.model,requests:state.calls.filter(c=>c.status!=='not-sent').length,estimatedUsd:reserved(),estimatedLimitUsd:limitUsd,maxRequests:maxCalls,tokenCountMs:state.tokenCountMs,unknownChargeRequests:state.calls.filter(c=>c.status!=='not-sent'&&!c.usage).length,paused:state.paused,usage:state.calls.map(c=>c.usage).filter(Boolean),note:'Standard-price estimate with guarded reservations, not an invoice or a guaranteed billing cap. Failed calls without usage retain their reserved estimate. Unknown charges pause this ledger before further requests.'})};
}

/** Independent targeted source checks. They are NOT exhaustive accuracy scoring. */
export function targetedChecks(id,result,pages){
 const checks=[{name:'Every source page verified',pass:result.pages?.length===pages&&result.pages.every((p,i)=>p.page===i+1&&p.status==='read')}];
 if(id==='short'){
  const included=[result.summary,...(result.instructions?.inclusions||[]),...(result.takeoffs||[]).map(t=>t.description)].join(' ');
  for(const [name,pattern] of [['Well',/\bwell\b/i],['Septic',/\bseptic\b/i],['Cabinetry',/\bcabinet/i],['Painting',/\bpaint/i],['Appliances',/\bappliance/i],['Fireplace',/\bfireplace/i]])checks.push({name:name+' scope retained',pass:pattern.test(included)});
  checks.push({name:'Redacted house/garage area not invented',pass:!(result.facts||[]).some(f=>['sqft','garageSqft'].includes(f.field))});
  const exclusions=(result.instructions?.exclusions||[]).join(' ');
  checks.push({name:'Land and financing excluded',pass:/\bland\b/i.test(exclusions)&&/\bfinanc/i.test(exclusions)});
  checks.push({name:'Specialty coatings remain excluded',pass:/wallpaper|limewash|decorative plaster|specialty coatings/i.test(exclusions)});
 }
 if(id==='plans')checks.push({name:'Scanned electrical sheet identity retained',pass:/\bA5\.1\b/i.test(result.pages?.find(p=>p.page===10)?.sheet||'')});
 return {exhaustive:false,precision:null,recall:null,quantityAccuracy:null,checks,passed:checks.every(c=>c.pass),note:'Targeted checks derived from the original source, independent of the extracting model. Full facts/quantities/responsibilities/revisions still need review; confidence scores are not accuracy.'};
}
