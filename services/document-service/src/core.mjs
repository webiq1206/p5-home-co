import {createHash,createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
export const VERSION='p5-documents-gpt41-2026-09-26-v2';
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export const documentId=(tenant,project,digest)=>hash(stable([VERSION,tenant,project,digest]));
export const jobId=(tenant,project,kind,input)=>hash(stable([VERSION,tenant,project,kind,input]));
export class ServiceError extends Error{
  constructor(code,status=400,retryMs=0){super(code);this.code=code;this.status=status;this.retryMs=retryMs;}
}
export const providerCallLimit=config=>config.provider==='anthropic'?Math.max(config.callMs,config.streamMs??120000):config.callMs;
export function identifier(value,label='identifier'){
 if(typeof value!=='string'||! /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value))throw new ServiceError(`invalid-${label}`);
 return value;
}
export function signature(secret,method,path,tenant,timestamp,nonce,bodyHash){
 return createHmac('sha256',secret).update([method,path,tenant,timestamp,nonce,bodyHash].join('\n')).digest('hex');
}
export function signedHeaders(secret,method,path,tenant,body=Buffer.alloc(0),now=Date.now()){
 const timestamp=String(now),nonce=randomUUID(),digest=hash(body);
 return {'x-p5-tenant':tenant,'x-p5-time':timestamp,'x-p5-nonce':nonce,'x-p5-body-sha256':digest,'x-p5-signature':signature(secret,method,path,tenant,timestamp,nonce,digest)};
}
export function verifyHeaders(keys,method,path,headers,now=Date.now()){
 const tenant=headers['x-p5-tenant'],time=headers['x-p5-time'],nonce=headers['x-p5-nonce'],digest=headers['x-p5-body-sha256'],sig=headers['x-p5-signature'];
 if(!Object.hasOwn(keys,tenant)||!/^\d{13}$/.test(time||'')||Math.abs(now-Number(time))>90000||! /^[a-f0-9-]{36}$/.test(nonce||'')||! /^[a-f0-9]{64}$/.test(digest||'')||! /^[a-f0-9]{64}$/.test(sig||''))throw new ServiceError('unauthorized',401);
 const expected=signature(keys[tenant],method,path,tenant,time,nonce,digest);
 if(!timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(sig,'hex')))throw new ServiceError('unauthorized',401);
 return {tenant,nonce,digest};
}
export async function mapLimit(values,limit,fn,signal){
 const result=new Array(values.length);let at=0;
 await Promise.all(Array.from({length:Math.min(limit,values.length)},async()=>{while(at<values.length){signal?.throwIfAborted();const i=at++;result[i]=await fn(values[i],i);}}));
 return result;
}
export function groupPages(pages,maxChars=24000,maxPages=4){
 const groups=[];let current=[],size=0;
 for(const page of pages){const weight=(page.text||'').length;const drawing=page.kind!=='text';
  if(current.length&&(drawing||size+weight>maxChars||current.length>=maxPages)){groups.push(current);current=[];size=0;}
  current.push(page);size+=weight;
  if(drawing){groups.push(current);current=[];size=0;}
 }
 if(current.length)groups.push(current);return groups;
}
export function readConfig(env=process.env){
 const integer=(key,fallback,min,max)=>{const n=Number(env[key]||fallback);if(!Number.isInteger(n)||n<min||n>max)throw new ServiceError(`invalid-config-${key}`,500);return n;};
 let tenants;try{tenants=JSON.parse(env.P5_DOCUMENT_TENANTS_JSON||'{}');}catch{throw new ServiceError('invalid-tenant-config',500);}
 if(!tenants||Array.isArray(tenants)||!Object.keys(tenants).length)throw new ServiceError('missing-tenant-keys',500);
 const authorized=['p5homeco.com','boiseconstruction.co','boiseremodeling.co','boisehandyman.co','boisecabinet.co'];
 if(env.P5_DOCUMENT_REQUIRE_ALL_TENANTS==='true'&&(Object.keys(tenants).length!==authorized.length||authorized.some(id=>!(id in tenants))))throw new ServiceError('incomplete-tenant-config',500);
 const keys=new Set();
 for(const [id,key] of Object.entries(tenants)){if(!authorized.includes(id))throw new ServiceError('unauthorized-tenant',500);identifier(id,'tenant');if(typeof key!=='string'||key.length<32)throw new ServiceError('weak-tenant-key',500);if(keys.has(key))throw new ServiceError('duplicate-tenant-key',500);keys.add(key);}
 if(!env.DOCUMENT_DATABASE_URL)throw new ServiceError('missing-document-database',500);
 const provider='openai';
 const integrated=Boolean(env.AI_INTEGRATIONS_OPENAI_API_KEY&&env.AI_INTEGRATIONS_OPENAI_BASE_URL);
 const key=integrated?env.AI_INTEGRATIONS_OPENAI_API_KEY:env.OPENAI_API_KEY;
 if(!key)throw new ServiceError('missing-provider-configuration',500);
 const endpoint=(integrated?env.AI_INTEGRATIONS_OPENAI_BASE_URL:env.OPENAI_BASE_URL||'https://api.openai.com/v1').replace(/\/+$/,'');
 return {tenants,databaseUrl:env.DOCUMENT_DATABASE_URL,provider,key,endpoint,model:'gpt-4.1',verifyModel:'gpt-4.1',
 bindHost:env.DOCUMENT_BIND_HOST||'0.0.0.0',poolMax:integer('DOCUMENT_DATABASE_POOL_MAX',Math.max(6,Number(env.DOCUMENT_PROVIDER_SLOTS||12)+Number(env.DOCUMENT_PARSER_SLOTS||2)),2,64),uploadSlots:integer('DOCUMENT_UPLOAD_SLOTS',4,1,4),
  port:integer('PORT',8080,1,65535),maxBytes:integer('DOCUMENT_MAX_BYTES',250*1024*1024,1048576,250*1024*1024),maxPages:integer('DOCUMENT_MAX_PAGES',250,1,250),
 slots:integer('DOCUMENT_PROVIDER_SLOTS',12,1,48),parserSlots:integer('DOCUMENT_PARSER_SLOTS',2,1,8),rpm:integer('DOCUMENT_REQUESTS_PER_MINUTE',60,1,5000),tpm:integer('DOCUMENT_TOKENS_PER_MINUTE',600000,10000,20000000),
 callMs:integer('DOCUMENT_CALL_TIMEOUT_MS',40000,5000,120000),streamMs:integer('DOCUMENT_STREAM_TIMEOUT_MS',360000,5000,600000),parseMs:integer('DOCUMENT_PARSE_TIMEOUT_MS',60000,5000,180000),jobMs:integer('DOCUMENT_JOB_TIMEOUT_MS',900000,60000,1200000),
 reviewMaxOutput:integer('DOCUMENT_REVIEW_MAX_OUTPUT_TOKENS',32000,1024,32000),maxOutput:integer('DOCUMENT_MAX_OUTPUT_TOKENS',10000,1024,32000),retentionDays:integer('DOCUMENT_RETENTION_DAYS',30,1,365),maxTenantBytes:integer('DOCUMENT_TENANT_STORAGE_BYTES',2*1024*1024*1024,50*1024*1024,100*1024*1024*1024),maxQueue:integer('DOCUMENT_TENANT_MAX_QUEUED',30,1,500),
 instance:randomUUID()};
}
export const cleanText=value=>String(value||'').normalize('NFKC').replace(/\s+/g,' ').trim();
/** An ellipsis may omit source text, but cannot invent or reorder it. */
export function sourceQuoteMatches(text,quote){
 const source=cleanText(text),value=cleanText(quote);
 if(!value)return false;
 if(source.includes(value))return true;
 const parts=value.split(/\.{3}|\u2026/).map(s=>s.trim());
 if(parts.length<2||parts.some(s=>s.length<12||s.split(/\s+/).length<2))return false;
 let end=0;
 for(const part of parts){const at=source.indexOf(part,end);if(at<0)return false;end=at+part.length;}
 return true;
}
const durationFields=/^(?:projectmonths|duration|projectduration|constructionduration)$/i;
const issueDate=/\b(?:issued?|drawing)\s*date\b|\bissued\s+for\b|\b(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b|\b\d{1,2}[-/.]\d{1,2}[-/.](?:19|20)\d{2}\b|\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2}\b|\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*,?\s+(?:19|20)?\d{2}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},\s+(?:19|20)\d{2}\b/i;
const absentValue=/\b(?:not\s+(?:stated|specified|provided|shown)|unknown|unavailable|n\/?a|none|blank|redacted)\b/i;
const unresolvedText=/\b(?:uncertain|unresolved|ambiguous|conflict(?:ing)?|contradict(?:ory|ion)?|verify|confirm(?:ation)?|unclear|illegible|not\s+legible|cannot\s+be\s+confirmed|needs?\s+clarification)\b/i;
const resolvedIssue=/\b(?:no\s+(?:unresolved\s+)?(?:conflicts?|issues?|ambigu(?:ity|ities))\s+(?:remain|are\s+left)|(?:conflicts?|issues?|ambigu(?:ity|ities))\s+(?:have\s+been|were|are)\s+(?:resolved|verified|confirmed)|verification\s+(?:is\s+)?complete)\b/gi;
export function noteHasUnresolvedIssue(note,sourceText=''){
  const source=cleanText(sourceText).toLowerCase();
  const active=String(note||'').replace(resolvedIssue,' ').replace(/\b(?:the\s+)?(?:general\s+)?(?:contractor|builder|installer|subcontractor)\s+(?:shall|must|is\s+required\s+to)\s+(?:verify|confirm)\b[^.!?;\n]*/gi,clause=>{
    // A quoted construction obligation is readable source information. Only
    // clear its verification verb when this page contains the exact clause;
    // other uncertainty words and structured findings remain authoritative.
    return source.includes(cleanText(clause).toLowerCase())?clause.replace(/\b(?:verify|confirm)\b/gi,' '):clause;
  });
  return unresolvedText.test(active)||/\b(?:conflicts|ambiguities|contradictions|uncertainties)\s+(?:remain|persist)\b/i.test(active);
}
const assemblyMeasurement=/\b(?:assembly|floor\s*\/?\s*truss|floor[-\s]?truss|truss|joist|roof\s+depth|floor\s+depth|deck\s+depth|slab\s+depth|structural\s+depth)\b/i;
function isDurationField(field){return durationFields.test(String(field||'').replace(/[\s_-]+/g,''));}
export function durationSourceError(field, evidence, value){
  if(!isDurationField(field))return null;
  // A citation may include an issue date beside a genuine duration. Require
  // the exact month value to be explicitly labelled before accepting it.
  const months=String(value??'').trim().match(/^(\d+(?:\.\d+)?)\s*(?:months?)?$/i);
  if(months){
   const durations=String(evidence??'').matchAll(/\b(?:project|construction|building|build)\s+duration\s*(?::|=|is|of)?\s*(\d+(?:\.\d+)?)\s*months?\b/gi);
   for(const match of durations){
    const prefix=String(evidence).slice(0,match.index).split(/[.;\n]/).at(-1)||'';
    if(!/\b(?:no|not)\s*$/i.test(prefix)&&Number(match[1])===Number(months[1]))return null;
   }
  }
  if(issueDate.test(`${evidence} ${value}`))return 'invalid-project-duration-source';
  if(absentValue.test(`${evidence} ${value}`))return 'absent-source-fact';
  return null;
}
export function retainInvalidDurationsAsUncertain(result){
 const copy=structuredClone(result);
 for(const page of copy.pages||[])for(let i=0;i<(page.facts||[]).length;i++){
  const fact=page.facts[i];
  if(durationSourceError(fact.field,fact.evidence,fact.value)!=='invalid-project-duration-source')continue;
  page.facts[i]={field:'otherDetails',value:`The drawing issue date (${fact.value}) does not establish project duration.`,
   evidence:'Limitation: a drawing issue date is not a construction-duration statement.',basis:'uncertain'};
  page.status='partial';page.notes.push('Project duration remains unresolved; a drawing issue date was retained only as an explicit limitation.');
 }
 return copy;
}
export function measurementNeedsClarification(f){
  if(!f||typeof f!=='object')return false;
  const field=String(f.field||'');
  const component=String(f.component||'');
  const description=String(f.description||'');
  const text=`${description} ${component} ${f.evidence||''}`;
  const roomHeightClaim=/(?:ceiling|room|wall|floor[-\s]?to[-\s]?floor|clear|headroom)\s*(?:height|dimension|elevation)|\b(?:ceiling|room|wall)\s+height\b/i.test(`${field} ${description}`);
  const assemblyClaim=assemblyMeasurement.test(`${field} ${component} ${description}`);
  return roomHeightClaim&&assemblyClaim;
}
/** Only explicit missing-number recovery on reliable native text is redundant.
 * Drawings, scans and regions with a second legibility/scope concern stay open. */
export function missingNumberRecovery(page,reason){
 if(page.kind!=='text'||!(page.textQuality>=.9))return false;
  const blank=/\$\s*[,_.]|\bR-\s*(?:attic|exterior|crawl)|(?:^|\s)-(?:ft|in|amp|year)\b/i.test(page.text||'');
  const missing=/\b(?:redacted|blanked|blank|not\s+(?:specified|provided|shown)|unspecified)\b/i.test(reason||'');
 const recovery=/\b(?:recover(?:able|y)?|closer inspection|verify for)\b/i.test(reason||'');
 const other=/\b(?:geometry|boundary|symbol|linework|handwrit\w*|dimension line|material note|revision|contradict\w*|unreadable text|faded|cut off|cropped|obscured|overlap\w*)\b/i.test(reason||'');
  const explicitAbsent=/\b(?:digits|numeric|amounts?|figures?|numbers?|values?|dimensions?|quantities?)\b/i.test(reason||'');
  const statedAbsent=/\b(?:not\s+(?:specified|provided|shown)|unspecified)\b/i.test(reason||'');
  return (blank&&missing||statedAbsent&&explicitAbsent)&&missing&&recovery&&!other&&explicitAbsent;
}
export function validateEvidence(value,pages){
 if(!value||!Array.isArray(value.pages)||value.pages.length!==pages.length)throw new ServiceError('incomplete-page-manifest',422);
 const seen=new Set();
 for(const record of value.pages){
  const page=pages.find(p=>p.page===record.page);if(!page||seen.has(record.page))throw new ServiceError('invalid-page-reference',422);seen.add(record.page);
  if(!['read','partial','unreadable'].includes(record.status)||!Array.isArray(record.facts)||!Array.isArray(record.items)||!Array.isArray(record.regions)||!Array.isArray(record.notes))throw new ServiceError('invalid-page-record',422);
  if(record.regions.length>12)throw new ServiceError('too-many-unresolved-regions',422);
   for(const f of record.facts){
    if(typeof f.field!=='string'||!f.field.trim()||typeof f.value!=='string'||!f.value.trim())throw new ServiceError('empty-source-fact',422);
    const durationError=durationSourceError(f.field,f.evidence,f.value);if(durationError)throw new ServiceError(durationError,422);
   }
  for(const r of record.regions){if(![r.x,r.y,r.width,r.height].every(Number.isFinite)||r.x<0||r.y<0||r.width<=0||r.height<=0||r.x+r.width>1.001||r.y+r.height>1.001)throw new ServiceError('invalid-region',422);}
  for(const f of [...record.facts,...record.items]){
   if(!f.evidence?.trim()||!['stated','calculated','visual','uncertain'].includes(f.basis))throw new ServiceError('unsupported-evidence',422);
   // Exact text quotes can be checked without asking a second model. Visual
   // readings stay explicitly visual and trigger independent verification.
   if(f.basis==='stated'&&page.textQuality>=.9&&!sourceQuoteMatches(page.text,f.evidence))throw new ServiceError('quote-not-in-source',422);
   if(f.quantity!==undefined&&f.quantity!==null&&(!Number.isFinite(f.quantity)||f.quantity<0))throw new ServiceError('invalid-quantity',422);
    const durationError=durationSourceError(f.field,f.evidence,f.value);if(durationError)throw new ServiceError(durationError,422);
     if(measurementNeedsClarification(f))f.basis='uncertain';
  }
  const missing=record.regions.filter(r=>missingNumberRecovery(page,r.reason));
  if(missing.length){
   record.regions=record.regions.filter(r=>!missing.includes(r));
    const absentReasons=missing.map(r=>{
     const reason=String(r.reason||'The source does not provide this value.').trim();
     const subject=reason.replace(/;\s*(?:verify|closer inspection)\b.*$/i,'').replace(/\bverify\b.*$/i,'').trim()||'The source does not provide this value.';
     return `Known absent source information: ${subject.slice(0,500)}`;
    });
    record.notes=[...new Set([...record.notes,...absentReasons,'Known absent values remain missing; no dimensions, ratings, quantities or prices were inferred.'])];
  }
   if(record.regions.length||record.facts.some(f=>f.basis==='uncertain')||record.items.some(f=>f.basis==='uncertain')||record.notes.some(note=>noteHasUnresolvedIssue(note,page.text||'')))record.status='partial';
 }
 return value;
}
export function elapsedMs(row,now=Date.now()){
 const end=['complete','failed'].includes(row.state)?new Date(row.updated_at).getTime():now;
 return Math.max(0,(Number.isFinite(end)?end:now)-new Date(row.created_at).getTime());
}
export function publicJob(row){
 const elapsed=elapsedMs(row);
 return {id:row.id,state:row.state,kind:row.kind,progress:row.progress||{},elapsedMs:elapsed,targetMs:60000,targetExceeded:elapsed>60000,error:row.error_code||undefined,
 ...(row.state==='complete'?{result:row.result}:{}),version:VERSION};
}
