import test from 'node:test';
import type {IntakeRow} from '../lib/p5/intakeStore.ts';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {intakeAdminHandlers} from '../lib/p5/intakeAdmin.ts';
import {intakeStore} from '../lib/p5/intakeStore.ts';
import {emptyIntakeDetails} from '../lib/p5/intakeContract.ts';
import {routeIntake} from '../lib/p5/intakePolicy.ts';
import {DraftError} from '../lib/p5/store.ts';
import {ESTIMATOR_BUCKETS,uploadObjectKey} from '../lib/p5/objectStorage.ts';
const draftId='12345678-1234-4234-8234-123456789abc',fileId='12345678-1234-4234-8234-123456789abd';
const bytes=Buffer.from('[QA] fictional original file'),digest=createHash('sha256').update(bytes).digest('hex');
async function fixture(){
 const db=new PGlite();await db.exec(`CREATE TABLE p5_estimator_drafts(id uuid PRIMARY KEY,revision integer,brand text,status text);
 CREATE TABLE p5_estimator_work(draft_id uuid,work_key text,payload jsonb,updated_at timestamptz DEFAULT now(),PRIMARY KEY(draft_id,work_key));
 CREATE TABLE p5_estimator_files(id uuid PRIMARY KEY,draft_id uuid,name text,mime_type text,size_bytes integer,sha256 text,data_base64 text,storage_bucket text,storage_key text);`);
 const query=async(sql:string,values:unknown[]=[])=> (await db.query<IntakeRow>(sql,values)).rows;
 await query("INSERT INTO p5_estimator_drafts VALUES($1,1,'p5','draft')",[draftId]);
 await query('INSERT INTO p5_estimator_files VALUES($1,$2,$3,$4,$5,$6,$7,NULL,NULL)',[fileId,draftId,'fictional-scope.txt','text/plain',bytes.length,digest,bytes.toString('base64')]);
 const input={schema:1 as const,projectId:`p5:${draftId}`,draftId,revision:1,originSite:'p5' as const,currentSite:'p5' as const,contextVersion:1,contact:{name:'[QA] Fictional',email:'inquiry@example.invalid',phone:'',preferredContact:'email' as const},details:{...emptyIntakeDetails(),transcript:[{id:'toy',role:'user' as const,text:'[QA] Keep the fictional floor.',at:1}]},scope:{text:'[QA] Fictional kitchen scope',answers:{service:'kitchen'},extraction:null,uploads:[{id:fileId,name:'fictional-scope.txt',type:'text/plain',size:bytes.length,sha256:digest,status:'stored' as const}]},routing:routeIntake('p5','kitchen',['cabinetry']),unresolved:['Fictional site visit may be needed.']};
 await intakeStore(query,()=> '2099-01-02T12:00:00Z').save(input);
 const deps={site:'p5' as const,authorize:async()=>({id:'synthetic-admin'}),query,readBytes:async(row:Record<string,unknown>)=>Buffer.from(String(row.data_base64),'base64')};
 const handlers=intakeAdminHandlers(deps),url=(extra='')=>new Request(`https://p5homeco.com/api/admin/p5-intake?draftId=${draftId}&revision=1${extra}`);
 return {db,query,input,deps,handlers,url};
}
test('administrator authentication precedes all intake and file reads',async()=>{
 let reads=0;const handlers=intakeAdminHandlers({site:'p5',authorize:async()=>{throw new DraftError('Sign in.',403);},query:async()=>{reads++;return [];},readBytes:async()=>{reads++;return bytes;}});
 assert.equal((await handlers.get(new Request('https://p5homeco.com/api/admin/p5-intake'))).status,403);
 assert.equal((await handlers.file(new Request('https://p5homeco.com/api/admin/p5-intake/file'))).status,403);assert.equal(reads,0);
});
test('staff can read the immutable scope, conversation, routing and pending channels',async()=>{
 const x=await fixture();try{
  const list=await (await x.handlers.get(new Request('https://p5homeco.com/api/admin/p5-intake'))).json();assert.equal(list.requests.length,1);assert.equal(list.requests[0].fileCount,1);assert.equal(list.requests[0].scope,undefined);
  const result=await (await x.handlers.get(x.url())).json();assert.equal(result.snapshot.details.transcript[0].text,x.input.details.transcript[0].text);assert.equal(result.snapshot.routing.primaryTeam,'remodeling');assert.equal(result.delivery.team.recipient,'hello@p5homeco.com');assert.equal(result.delivery.team.status,'pending');
  assert.equal(result.snapshot.key,undefined);
 }finally{await x.db.close();}
});
test('another site administrator cannot read the saved request or file',async()=>{
 const x=await fixture();try{const other=intakeAdminHandlers({...x.deps,site:'cabinet'});assert.equal((await other.get(x.url())).status,404);assert.equal((await other.file(x.url('&fileId='+fileId))).status,404);assert.equal((await (await other.get(new Request('https://boisecabinet.co/api/admin/p5-intake'))).json()).requests.length,0);}finally{await x.db.close();}
});
test('file access binds exact submitted revision, manifest membership and original byte checksum',async()=>{
 const x=await fixture();try{
  const response=await x.handlers.file(x.url('&fileId='+fileId));assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('content-type'),'application/octet-stream');assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
  assert.equal((await x.handlers.file(x.url('&fileId='+draftId))).status,404);
  assert.equal((await x.handlers.file(new Request(`https://p5homeco.com/api/admin/p5-intake/file?draftId=${draftId}&revision=2&fileId=${fileId}`))).status,404);
  await x.query('UPDATE p5_estimator_files SET data_base64=$1 WHERE id=$2',[Buffer.from('corrupt').toString('base64'),fileId]);assert.equal((await x.handlers.file(x.url('&fileId='+fileId))).status,409);
 }finally{await x.db.close();}
});
test('changed metadata and foreign object locations never reach storage',async()=>{
 const x=await fixture();try{
  let reads=0;const handlers=intakeAdminHandlers({...x.deps,readBytes:async()=>{reads++;return bytes;}});
  await x.query("UPDATE p5_estimator_files SET name='changed.txt' WHERE id=$1",[fileId]);assert.equal((await handlers.file(x.url('&fileId='+fileId))).status,409);
  await x.query("UPDATE p5_estimator_files SET name='fictional-scope.txt',storage_bucket='foreign',storage_key='foreign/key' WHERE id=$1",[fileId]);assert.equal((await handlers.file(x.url('&fileId='+fileId))).status,409);assert.equal(reads,0);
 }finally{await x.db.close();}
});
test('verified resumable-upload and transferred object suffixes remain downloadable',async()=>{
 const x=await fixture();try{
  const storageKey=uploadObjectKey('p5homeco.com',draftId,digest)+'/12345678-1234-4234-8234-123456789abe';
  await x.query('UPDATE p5_estimator_files SET data_base64=NULL,storage_bucket=$1,storage_key=$2 WHERE id=$3',[ESTIMATOR_BUCKETS['p5homeco.com'],storageKey,fileId]);
  const handlers=intakeAdminHandlers({...x.deps,readBytes:async row=>{assert.equal(row.storage_key,storageKey);return bytes;}});
  const result=await handlers.file(x.url('&fileId='+fileId));assert.equal(result.status,200);assert.deepEqual(Buffer.from(await result.arrayBuffer()),bytes);
 }finally{await x.db.close();}
});
test('staff pagination reaches every saved request across tied timestamps without exposing another site',async()=>{
 const x=await fixture();try{
  await x.query(`INSERT INTO p5_estimator_drafts(id,revision,brand,status)
   SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,1,'p5','draft' FROM generate_series(1,204) n`);
  await x.query(`INSERT INTO p5_estimator_work(draft_id,work_key,payload,updated_at)
   SELECT d.id,w.work_key,jsonb_set(jsonb_set(w.payload,'{snapshot,draftId}',to_jsonb(d.id::text)),'{snapshot,projectId}',to_jsonb('p5:'||d.id::text)),w.updated_at
   FROM p5_estimator_drafts d CROSS JOIN p5_estimator_work w WHERE w.draft_id=$1 AND w.work_key='intake-submission-v1' AND d.id<>$1`,[draftId]);
  await x.query("UPDATE p5_estimator_work SET updated_at='2099-01-02T12:00:00.123456Z'");
  const found:string[]=[];let cursor:string|null=null;const lengths:number[]=[];
  do{
   const response=await x.handlers.get(new Request('https://p5homeco.com/api/admin/p5-intake'+(cursor?'?cursor='+cursor:'')));assert.equal(response.status,200);
   const body=await response.json();lengths.push(body.requests.length);found.push(...body.requests.map((r:{draftId:string})=>r.draftId));cursor=body.nextCursor;
   assert.ok(lengths.length<5);assert.equal(body.requests[0]?.cursorTime,undefined);
  }while(cursor);
  assert.deepEqual(lengths,[100,100,5]);assert.equal(new Set(found).size,205);assert.ok(found.includes(draftId));
  assert.equal((await (await intakeAdminHandlers({...x.deps,site:'cabinet'}).get(new Request('https://boisecabinet.co/api/admin/p5-intake'))).json()).requests.length,0);
  for(const bad of ['', 'not-a-cursor',Buffer.from(JSON.stringify(['2099-01-02T12:00:00.123456Z','foreign'])).toString('base64url')])assert.equal((await x.handlers.get(new Request('https://p5homeco.com/api/admin/p5-intake?cursor='+bad))).status,400);
  assert.equal((await x.handlers.get(x.url('&cursor=ignored'))).status,400);
 }finally{await x.db.close();}
});
