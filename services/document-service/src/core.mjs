import {createHash,createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
export const VERSION='p5-documents-2026-09-17-v1';
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export const documentId=(tenant,project,digest)=>hash(stable([VERSION,tenant,project,digest]));
export const jobId=(tenant,project,kind,input)=>hash(stable([VERSION,tenant,project,kind,input]));
export class ServiceError extends Error{
  constructor(code,status=400,retryMs=0){super(code);this.code=code;this.status=status;this.retryMs=retryMs;}
}
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
 const keys=new Set();
 for(const [id,key] of Object.entries(tenants)){identifier(id,'tenant');if(typeof key!=='string'||key.length<32)throw new ServiceError('weak-tenant-key',500);if(keys.has(key))throw new ServiceError('duplicate-tenant-key',500);keys.add(key);}
 if(!env.DOCUMENT_DATABASE_URL)throw new ServiceError('missing-document-database',500);
 const provider=env.DOCUMENT_PROVIDER||'anthropic';if(!['anthropic','gemini','openai'].includes(provider))throw new ServiceError('unsupported-provider',500);
 const key=env[{'anthropic':'ANTHROPIC_API_KEY','gemini':'GEMINI_API_KEY','openai':'OPENAI_API_KEY'}[provider]];
 if(!key||!env.DOCUMENT_MODEL)throw new ServiceError('missing-provider-configuration',500);
 return {tenants,databaseUrl:env.DOCUMENT_DATABASE_URL,provider,key,model:env.DOCUMENT_MODEL,verifyModel:env.DOCUMENT_VERIFY_MODEL||env.DOCUMENT_MODEL,
 bindHost:env.DOCUMENT_BIND_HOST||'0.0.0.0',poolMax:integer('DOCUMENT_DATABASE_POOL_MAX',Math.max(6,Number(env.DOCUMENT_PROVIDER_SLOTS||12)+Number(env.DOCUMENT_PARSER_SLOTS||2)),2,64),uploadSlots:integer('DOCUMENT_UPLOAD_SLOTS',4,1,4),
 port:integer('PORT',8080,1,65535),maxBytes:integer('DOCUMENT_MAX_BYTES',50*1024*1024,1048576,250*1024*1024),maxPages:integer('DOCUMENT_MAX_PAGES',200,1,2000),
 slots:integer('DOCUMENT_PROVIDER_SLOTS',12,1,48),parserSlots:integer('DOCUMENT_PARSER_SLOTS',2,1,8),rpm:integer('DOCUMENT_REQUESTS_PER_MINUTE',60,1,5000),tpm:integer('DOCUMENT_TOKENS_PER_MINUTE',600000,10000,20000000),
 callMs:integer('DOCUMENT_CALL_TIMEOUT_MS',40000,5000,120000),parseMs:integer('DOCUMENT_PARSE_TIMEOUT_MS',60000,5000,180000),jobMs:integer('DOCUMENT_JOB_TIMEOUT_MS',300000,60000,1200000),
 maxOutput:integer('DOCUMENT_MAX_OUTPUT_TOKENS',10000,1024,32000),retentionDays:integer('DOCUMENT_RETENTION_DAYS',30,1,365),maxTenantBytes:integer('DOCUMENT_TENANT_STORAGE_BYTES',2*1024*1024*1024,50*1024*1024,100*1024*1024*1024),maxQueue:integer('DOCUMENT_TENANT_MAX_QUEUED',30,1,500),
 instance:randomUUID()};
}
export const cleanText=value=>String(value||'').normalize('NFKC').replace(/\s+/g,' ').trim();
export function validateEvidence(value,pages){
 if(!value||!Array.isArray(value.pages)||value.pages.length!==pages.length)throw new ServiceError('incomplete-page-manifest',422);
 const seen=new Set();
 for(const record of value.pages){
  const page=pages.find(p=>p.page===record.page);if(!page||seen.has(record.page))throw new ServiceError('invalid-page-reference',422);seen.add(record.page);
  if(!['read','partial','unreadable'].includes(record.status)||!Array.isArray(record.facts)||!Array.isArray(record.items)||!Array.isArray(record.regions)||!Array.isArray(record.notes))throw new ServiceError('invalid-page-record',422);
  if(record.regions.length>12)throw new ServiceError('too-many-unresolved-regions',422);
  for(const r of record.regions){if(![r.x,r.y,r.width,r.height].every(Number.isFinite)||r.x<0||r.y<0||r.width<=0||r.height<=0||r.x+r.width>1.001||r.y+r.height>1.001)throw new ServiceError('invalid-region',422);}
  for(const f of [...record.facts,...record.items]){
   if(!f.evidence?.trim()||!['stated','calculated','visual','uncertain'].includes(f.basis))throw new ServiceError('unsupported-evidence',422);
   // Exact text quotes can be checked without asking a second model. Visual
   // readings stay explicitly visual and trigger independent verification.
   if(f.basis==='stated'&&page.textQuality>=.9&&!cleanText(page.text).includes(cleanText(f.evidence)))throw new ServiceError('quote-not-in-source',422);
   if(f.quantity!==undefined&&f.quantity!==null&&(!Number.isFinite(f.quantity)||f.quantity<0))throw new ServiceError('invalid-quantity',422);
  }
  if(record.regions.length)record.status='partial';
 }
 return value;
}
export function publicJob(row){
 const created=new Date(row.created_at).getTime(),elapsed=Date.now()-created;
 return {id:row.id,state:row.state,kind:row.kind,progress:row.progress||{},elapsedMs:elapsed,targetMs:60000,targetExceeded:elapsed>60000,error:row.error_code||undefined,
 ...(row.state==='complete'?{result:row.result}:{}),version:VERSION};
}
