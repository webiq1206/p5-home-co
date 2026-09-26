import {randomUUID} from 'node:crypto';
import {documentId,jobId,hash,ServiceError,VERSION,providerCallLimit} from './core.mjs';
export const DDL=`
CREATE TABLE IF NOT EXISTS p5ds_documents (
 id text PRIMARY KEY,tenant text NOT NULL,project text NOT NULL,digest text NOT NULL,name text NOT NULL,
 bytes bytea NOT NULL,size_bytes bigint NOT NULL,state text NOT NULL DEFAULT 'queued',page_count integer,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),error_code text
);
CREATE TABLE IF NOT EXISTS p5ds_pages (
 document_id text NOT NULL REFERENCES p5ds_documents(id) ON DELETE CASCADE,page integer NOT NULL,
 native jsonb NOT NULL,image bytea NOT NULL,evidence jsonb,PRIMARY KEY(document_id,page)
);
CREATE TABLE IF NOT EXISTS p5ds_jobs (
 id text PRIMARY KEY,tenant text NOT NULL,project text NOT NULL,kind text NOT NULL,document_id text REFERENCES p5ds_documents(id) ON DELETE CASCADE,
 state text NOT NULL DEFAULT 'queued',priority integer NOT NULL DEFAULT 5,payload jsonb NOT NULL,progress jsonb NOT NULL DEFAULT '{}',result jsonb,
 attempts integer NOT NULL DEFAULT 0,available_at timestamptz NOT NULL DEFAULT now(),lease_until timestamptz,lease_token text,error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS p5ds_jobs_ready ON p5ds_jobs(state,available_at,lease_until);
CREATE TABLE IF NOT EXISTS p5ds_nonces(tenant text NOT NULL,nonce text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant,nonce));
CREATE TABLE IF NOT EXISTS p5ds_capacity(
 name text PRIMARY KEY,window_at timestamptz NOT NULL,requests integer NOT NULL,tokens bigint NOT NULL,cooldown_until timestamptz
);
CREATE TABLE IF NOT EXISTS p5ds_provider_leases(token text PRIMARY KEY,expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS p5ds_metrics(id bigserial PRIMARY KEY,job_id text NOT NULL,stage text NOT NULL,duration_ms integer NOT NULL,detail jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
`;
export class Store{
 constructor(pool,config){this.pool=pool;this.config=config;}
 async init(){await this.pool.query(DDL);}
 async transaction(fn){const c=await this.pool.connect();try{await c.query('BEGIN');const v=await fn(c);await c.query('COMMIT');return v;}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}
 async nonce(tenant,nonce){const r=await this.pool.query('INSERT INTO p5ds_nonces(tenant,nonce) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING nonce',[tenant,nonce]);return r.rowCount===1;}
 async putDocument(tenant,project,name,bytes){
  const digest=hash(bytes),id=documentId(tenant,project,digest);
  return this.transaction(async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['p5ds-quota:'+tenant]);
   const previous=await c.query('SELECT * FROM p5ds_documents WHERE id=$1 AND tenant=$2 AND project=$3',[id,tenant,project]);if(previous.rowCount)return {document:previous.rows[0],cached:true};
   await this.checkStorage(c,tenant,bytes.length);
   const queued=await c.query("SELECT count(*)::int AS n FROM p5ds_jobs WHERE tenant=$1 AND kind IN ('parse','review') AND state IN ('queued','running')",[tenant]);if(queued.rows[0].n>=this.config.maxQueue)throw new ServiceError('document-queue-full',429,5000);
   const r=await c.query('INSERT INTO p5ds_documents(id,tenant,project,digest,name,bytes,size_bytes) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[id,tenant,project,digest,name,bytes,bytes.length]);
   await this.enqueue(c,{id:jobId(tenant,project,'parse',id),tenant,project,kind:'parse',documentId:id,payload:{documentId:id},priority:bytes.length<1000000?0:5});
   return {document:r.rows[0],cached:false};
  });
 }
 async enqueue(c,job){return c.query('INSERT INTO p5ds_jobs(id,tenant,project,kind,document_id,payload,priority) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT DO NOTHING',[job.id,job.tenant,job.project,job.kind,job.documentId||null,JSON.stringify(job.payload),job.priority??5]);}
 async document(tenant,project,id,withBytes=false){const r=await this.pool.query(`SELECT ${withBytes?'*':'id,tenant,project,digest,name,size_bytes,state,page_count,error_code,created_at,updated_at'} FROM p5ds_documents WHERE id=$1 AND tenant=$2 AND project=$3`,[id,tenant,project]);if(!r.rowCount)throw new ServiceError('not-found',404);return r.rows[0];}
 async pages(id,numbers=null,images=false){
  return (await this.pool.query(`SELECT document_id,page,native,evidence${images?',image':''} FROM p5ds_pages WHERE document_id=$1${numbers?' AND page=ANY($2::integer[])':''} ORDER BY page`,numbers?[id,numbers]:[id])).rows;
 }
 async documentProgress(id){
  const r=await this.pool.query("SELECT count(*)::int AS parsed, count(evidence)::int AS checked,count(*) FILTER(WHERE evidence->>'status'='read')::int AS read FROM p5ds_pages WHERE document_id=$1",[id]);return r.rows[0];
 }
 async coverage(id){return (await this.pool.query("SELECT page,evidence->>'status' AS status,evidence->'notes' AS notes FROM p5ds_pages WHERE document_id=$1 ORDER BY page",[id])).rows;}

 async manifest(job,count){
  return this.transaction(async c=>{await this.fence(c,job);await c.query('UPDATE p5ds_documents SET page_count=$2 WHERE id=$1',[job.document_id,count]);});
 }
 async finalize(id,c=this.pool){
  // Run in the same transaction as the final page or parser checkpoint. A
  // process exit must not strand a prepared document with no runnable jobs.
  await c.query("UPDATE p5ds_documents d SET state='complete',updated_at=now() WHERE id=$1 AND state='prepared' AND page_count>0 AND page_count=(SELECT count(*) FROM p5ds_pages p WHERE p.document_id=d.id AND p.evidence IS NOT NULL)",[id]);
 }
 async metrics(tenant,project,id,kind){
  if(kind==='documents')await this.document(tenant,project,id);else{const job=await this.job(tenant,project,id);if(job.kind!=='review')throw new ServiceError('not-found',404);}
  const rows=await this.pool.query(`SELECT m.stage,m.duration_ms,m.detail,m.created_at,j.kind,j.attempts FROM p5ds_metrics m JOIN p5ds_jobs j ON j.id=m.job_id WHERE j.tenant=$1 AND j.project=$2 AND ${kind==='documents'?'j.document_id':'j.id'}=$3 ORDER BY m.id`,[tenant,project,id]);
  return {events:rows.rows,note:'Stage durations are accumulated work across parallel jobs, not additive customer wall time.'};
 }

 /** Attest persisted successful requests, never infer the returned model from configuration. */
 async modelEvidence(job){
  const documents=(job.payload?.documents||[]).map(d=>d.id);
  const {rows}=await this.pool.query(`SELECT j.id,j.document_id,m.detail FROM p5ds_jobs j LEFT JOIN p5ds_metrics m ON m.job_id=j.id AND m.stage IN ('read-provider','verify-provider','citation-provider','reconciliation-provider') WHERE j.tenant=$1 AND j.project=$2 AND j.state='complete' AND (j.id=$3 OR (j.kind='read' AND j.document_id=ANY($4::text[])))`,[job.tenant,job.project,job.id,documents]);
  const allowed=new Set(['gpt-4.1','gpt-4.1-2025-04-14']);
  const verified=rows.length>0&&documents.every(id=>rows.some(r=>r.document_id===id))&&rows.some(r=>r.id===job.id)&&rows.every(r=>r.detail?.provider==='openai'&&r.detail.model==='gpt-4.1'&&allowed.has(r.detail.responseModel));
  return {verified,requestedModel:'gpt-4.1',responseModels:[...new Set(rows.map(r=>r.detail?.responseModel).filter(Boolean))],calls:rows.filter(r=>r.detail).length};
 }
 async checkStorage(c,tenant,additional=0){
  const r=await c.query(`SELECT (coalesce(sum(size_bytes),0)+(SELECT coalesce(sum(octet_length(p.image)+pg_column_size(p.native)+coalesce(pg_column_size(p.evidence),0)),0) FROM p5ds_pages p JOIN p5ds_documents d ON d.id=p.document_id WHERE d.tenant=$1)+(SELECT coalesce(sum(pg_column_size(result)),0) FROM p5ds_jobs WHERE tenant=$1))::text AS used FROM p5ds_documents WHERE tenant=$1`,[tenant]);
  if(Number(r.rows[0].used)+additional>this.config.maxTenantBytes)throw new ServiceError('document-storage-quota',422);
 }
 async putPage(job,page){
  return this.transaction(async c=>{await this.fence(c,job);await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['p5ds-quota:'+job.tenant]);
   await c.query('INSERT INTO p5ds_pages(document_id,page,native,image) VALUES($1,$2,$3::jsonb,$4) ON CONFLICT(document_id,page) DO UPDATE SET native=excluded.native,image=excluded.image',[job.document_id,page.page,JSON.stringify({...page,image:undefined}),page.image]);
   await this.checkStorage(c,job.tenant);
   await c.query("UPDATE p5ds_documents SET state=CASE WHEN state='failed' THEN state ELSE 'parsing' END,updated_at=now() WHERE id=$1",[job.document_id]);
  });
 }
 async fence(c,job){const r=await c.query("SELECT id FROM p5ds_jobs WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_until>now() FOR UPDATE",[job.id,job.lease_token]);if(!r.rowCount)throw new ServiceError('lease-lost',409);}
 async claim(kinds){
  return this.transaction(async c=>{
   const r=await c.query("SELECT * FROM p5ds_jobs j WHERE kind=ANY($1::text[]) AND (kind!='read' OR NOT EXISTS(SELECT 1 FROM p5ds_documents d WHERE d.id=j.document_id AND d.state='failed')) AND ((state='queued' AND available_at<=now()) OR (state='running' AND lease_until<now())) ORDER BY priority-extract(epoch FROM(now()-created_at))/10,created_at FOR UPDATE SKIP LOCKED LIMIT 1",[kinds]);if(!r.rowCount)return null;
   const token=randomUUID();return (await c.query("UPDATE p5ds_jobs SET state='running',lease_token=$2,lease_until=now()+interval '90 seconds',attempts=attempts+1,updated_at=now() WHERE id=$1 RETURNING *",[r.rows[0].id,token])).rows[0];
  });
 }
 async renew(job){const r=await this.pool.query("UPDATE p5ds_jobs SET lease_until=now()+interval '90 seconds' WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_until>now()",[job.id,job.lease_token]);return r.rowCount===1;}
 async progress(job,progress){const r=await this.pool.query("UPDATE p5ds_jobs SET progress=$3::jsonb,updated_at=now() WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_until>now()",[job.id,job.lease_token,JSON.stringify(progress)]);if(!r.rowCount)throw new ServiceError('lease-lost',409);}
 async checkpoint(job,result){return this.transaction(async c=>{await this.fence(c,job);if(Buffer.byteLength(JSON.stringify(result))>8*1024*1024)throw new ServiceError('evidence-checkpoint-too-large',422);await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['p5ds-quota:'+job.tenant]);await c.query('UPDATE p5ds_jobs SET result=$3::jsonb,updated_at=now() WHERE id=$1 AND lease_token=$2',[job.id,job.lease_token,JSON.stringify(result)]);await this.checkStorage(c,job.tenant);job.result=result;});}
 async complete(job,result,extra){return this.transaction(async c=>{await this.fence(c,job);if(extra)await extra(c);await c.query("UPDATE p5ds_jobs SET state='complete',result=$3::jsonb,lease_until=null,lease_token=null,updated_at=now() WHERE id=$1 AND lease_token=$2",[job.id,job.lease_token,JSON.stringify(result)]);});}
 async fail(job,error){
  const code=error.code||'internal-processing-error';const transient=error.status===429||error.status>=500||['provider-timeout','parse-timeout'].includes(code);
  const waiting=code==='source-reading-pending';
  const retry=(waiting||transient&&job.attempts<3)&&Date.now()-new Date(job.created_at).getTime()<this.config.jobMs;
  const delay=Math.max(error.retryMs||0,Math.min(10000,500*2**job.attempts));
  await this.transaction(async c=>{
   const updated=await c.query("UPDATE p5ds_jobs SET state=$3,error_code=$4,available_at=now()+$5*interval '1 millisecond',lease_until=null,lease_token=null,updated_at=now() WHERE id=$1 AND lease_token=$2 AND lease_until>now() RETURNING id",[job.id,job.lease_token,retry?'queued':'failed',code,delay]);
   if(updated.rowCount&&!retry&&job.document_id)await c.query("UPDATE p5ds_documents SET state='failed',error_code=$2,updated_at=now() WHERE id=$1",[job.document_id,code]);
  });
 }
 async retry(tenant,project,id,kind){
  return this.transaction(async c=>{
   if(kind==='documents'){
    const d=await c.query('SELECT * FROM p5ds_documents WHERE id=$1 AND tenant=$2 AND project=$3 FOR UPDATE',[id,tenant,project]);if(!d.rowCount)throw new ServiceError('not-found',404);
    if(d.rows[0].state!=='failed')return;
    await c.query("UPDATE p5ds_jobs SET state='queued',attempts=0,available_at=now(),error_code=null,lease_token=null,lease_until=null,created_at=now() WHERE document_id=$1 AND state='failed'",[id]);
    const parse=await c.query("SELECT state FROM p5ds_jobs WHERE document_id=$1 AND kind='parse'",[id]);
    await c.query("UPDATE p5ds_documents SET state=$2,error_code=null,updated_at=now() WHERE id=$1",[id,parse.rows[0]?.state==='complete'?'prepared':'queued']);
    await this.finalize(id,c);
   }else{
    const r=await c.query("UPDATE p5ds_jobs SET state='queued',attempts=0,available_at=now(),error_code=null,lease_token=null,lease_until=null,created_at=now() WHERE id=$1 AND tenant=$2 AND project=$3 AND kind='review' AND state='failed' RETURNING id",[id,tenant,project]);
    if(!r.rowCount)throw new ServiceError('job-not-failed-or-not-found',409);
   }
  });
 }
 async reserve(tokens){
  return this.transaction(async c=>{
   await c.query("INSERT INTO p5ds_capacity(name,window_at,requests,tokens) VALUES('reader',now(),0,0) ON CONFLICT DO NOTHING");
   const r=await c.query("SELECT *,extract(epoch FROM(now()-window_at))*1000 AS age FROM p5ds_capacity WHERE name='reader' FOR UPDATE");let budget=r.rows[0];
   if(budget.cooldown_until&&new Date(budget.cooldown_until)>new Date())return null;
   if(Number(budget.age)>=60000){await c.query("UPDATE p5ds_capacity SET window_at=now(),requests=0,tokens=0 WHERE name='reader'");budget={requests:0,tokens:0};}
   await c.query('DELETE FROM p5ds_provider_leases WHERE expires_at<now()');
   const n=(await c.query('SELECT count(*)::int AS n FROM p5ds_provider_leases')).rows[0].n;
   if(n>=this.config.slots||budget.requests>=this.config.rpm||Number(budget.tokens)+tokens>this.config.tpm)return null;
   const token=randomUUID();await c.query('INSERT INTO p5ds_provider_leases(token,expires_at) VALUES($1,now()+$2*interval \'1 millisecond\')',[token,providerCallLimit(this.config)+15000]);
   await c.query("UPDATE p5ds_capacity SET requests=requests+1,tokens=tokens+$1 WHERE name='reader'",[tokens]);return token;
  });
 }
 async release(token){await this.pool.query('DELETE FROM p5ds_provider_leases WHERE token=$1',[token]);}
 async cooldown(ms){await this.pool.query("UPDATE p5ds_capacity SET cooldown_until=greatest(coalesce(cooldown_until,now()),now()+$1*interval '1 millisecond') WHERE name='reader'",[ms]);}
 async metric(job,stage,ms,detail={}){await this.pool.query('INSERT INTO p5ds_metrics(job_id,stage,duration_ms,detail) VALUES($1,$2,$3,$4::jsonb)',[job.id,stage,Math.round(ms),JSON.stringify(detail)]);}
 async job(tenant,project,id){const r=await this.pool.query('SELECT * FROM p5ds_jobs WHERE id=$1 AND tenant=$2 AND project=$3',[id,tenant,project]);if(!r.rowCount)throw new ServiceError('not-found',404);return r.rows[0];}
 async cleanup(){
  await this.pool.query("DELETE FROM p5ds_nonces WHERE created_at<now()-interval '5 minutes'");
  // No active project is purged while being processed.
  await this.pool.query("DELETE FROM p5ds_documents d WHERE updated_at<now()-$1*interval '1 day' AND NOT EXISTS(SELECT 1 FROM p5ds_jobs j WHERE j.tenant=d.tenant AND j.project=d.project AND j.state IN ('queued','running'))",[this.config.retentionDays]);
  await this.pool.query("DELETE FROM p5ds_jobs WHERE state IN ('complete','failed') AND updated_at<now()-$1*interval '1 day'",[this.config.retentionDays]);
  await this.pool.query("DELETE FROM p5ds_metrics WHERE created_at<now()-$1*interval '1 day'",[this.config.retentionDays]);
 }
}
