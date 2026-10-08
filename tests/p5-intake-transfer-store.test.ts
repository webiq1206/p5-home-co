import test from 'node:test';
import {reconcileQuestionMemory,currentQuestionEntries,readQuestionMemory} from '../lib/p5/intakeQuestionMemory.ts';
import {emptyIntakeDetails,intakeUnresolved} from '../lib/p5/intakeContract.ts';
import {SCOPE_FIELDS,type ScopeAnswers} from '../lib/p5/scope.ts';
import type {IntakeRow} from '../lib/p5/intakeStore.ts';
import assert from 'node:assert/strict';
import {isolatedDatabase} from './fixtures/p5-pglite.ts';
import {REGISTER_DRAFT_UPLOAD_SQL} from '../lib/p5/intakeTransferGuards.ts';
import {intakeTransferStore,transferSecretHash,transferredFileId,requireTransferBundle,requireTransferReceipt,TRANSFER_KEY,IMPORT_KEY,TRANSFER_ADMISSION_MS,IntakeTransferConflict,type TransferBinding} from '../lib/p5/intakeTransferStore.ts';
import {sourceIdentity,assertCompleteSourceCoverage} from '../lib/p5/documentServiceClient.ts';
const source='12345678-1234-4234-8234-123456789abc',destination='12345678-1234-4234-8234-123456789abd';
const fileId='12345678-1234-4234-8234-123456789abf';
test('duplicate-name evidence labels survive transfer, retry and a return to the original site',()=>{
 const files=[{id:fileId,name:'fictional-plan.pdf',type:'application/pdf',size:1,sha256:transferSecretHash('one'),status:'stored' as const},{id:'87654321-1234-4234-8234-123456789abf',name:'fictional-plan.pdf',type:'application/pdf',size:2,sha256:transferSecretHash('two'),status:'stored' as const}];
 const copied=files.map(f=>({...f,id:transferredFileId(f.id,destination)}));const names=files.map(f=>sourceIdentity(f,files));
 assert.deepEqual(copied.map(f=>sourceIdentity(f,copied)),names);assert.notEqual(copied[0].id,files[0].id);assert.equal(transferredFileId(fileId,destination),copied[0].id);
 const returned=copied.map(f=>({...f,id:transferredFileId(f.id,source)}));assert.deepEqual(returned.map(f=>sourceIdentity(f,returned)),names);assert.notEqual(returned[0].id,files[0].id);
 const extraction={summary:'[QA] Fictional plans',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],documentCoverage:{pages:names.map(source=>({source,page:1,sheet:'',revision:'',status:'read' as const,notes:[]})),expectedPages:2,complete:true}};
 assert.doesNotThrow(()=>assertCompleteSourceCoverage(extraction as import('../lib/p5/scope.ts').ScopeExtraction,copied.map(f=>sourceIdentity(f,copied)),names.map(source=>({source,page:1})),true));
});
const binding=():TransferBinding=>({transferId:'12345678-1234-4234-8234-123456789abe',projectId:`handyman:${source}`,sourceSite:'handyman',destinationSite:'remodeling',sourceOrigin:'https://boisehandyman.co',sourceDraftId:source,sourceRevision:1,destinationDraftId:destination,destinationKeyHash:transferSecretHash('a'.repeat(64)),grantHash:transferSecretHash('b'.repeat(64))});
test('an unprepared transfer seed can be retired durably before a late prepare reaches its draft',async()=>{
 const x=await database();try{
  await x.addFile();const before=(await x.query('SELECT payload FROM p5_estimator_drafts WHERE id=$1',[source]))[0].payload;
  await x.store.abandon(source,binding().transferId,1);await x.store.abandon(source,binding().transferId,1);
  const [saved]=await x.query('SELECT revision,status,payload FROM p5_estimator_drafts WHERE id=$1',[source]);assert.equal(saved.revision,2);assert.equal(saved.status,'draft');assert.deepEqual(saved.payload,before);
  await assert.rejects(x.store.prepare(binding()));assert.equal(await x.store.readSource(source),null);assert.equal((await x.query('SELECT * FROM p5_estimator_files')).length,1);
  await x.store.prepare({...binding(),transferId:'12345678-1234-4234-8234-123456789ab1',sourceRevision:2});
 }finally{await x.db.close();}
});
test('retiring a seed after preparation cancels only before destination claim',async()=>{
 for(const claimed of [false,true]){const x=await database();try{
  await x.seal();if(claimed)await x.store.claim(binding());
  if(claimed){await assert.rejects(x.store.abandon(source,binding().transferId,1),/already begun/);assert.equal((await x.store.readSource(source))!.state,'importing');}
  else {await x.store.abandon(source,binding().transferId,1);await x.store.abandon(source,binding().transferId,1);assert.equal((await x.store.readSource(source))!.state,'cancelled');await assert.rejects(x.store.prepare(binding()),/cancelled/);}
 }finally{await x.db.close();}}
});
async function database(){
 const db=await isolatedDatabase();let now=Date.parse('2099-01-02T12:00:00Z');
 await db.exec(`CREATE TABLE p5_estimator_drafts(id uuid PRIMARY KEY,key_hash text,revision integer,brand text,status text,payload jsonb,updated_at timestamptz DEFAULT now());
 CREATE TABLE p5_estimator_work(draft_id uuid REFERENCES p5_estimator_drafts(id),work_key text,payload jsonb,updated_at timestamptz DEFAULT now(),PRIMARY KEY(draft_id,work_key));
 CREATE TABLE p5_estimator_files(id uuid PRIMARY KEY,draft_id uuid REFERENCES p5_estimator_drafts(id),name text,mime_type text,size_bytes integer,sha256 text,created_at timestamptz DEFAULT now(),UNIQUE(draft_id,sha256));`);
 const query=async(s:string,v:unknown[]=[])=> (await db.query<IntakeRow>(s,v)).rows;
 await query("INSERT INTO p5_estimator_drafts VALUES($1,'owner',1,'handyman','draft',$2::jsonb,now())",[source,JSON.stringify({text:'[QA] Fictional kitchen remodel with cabinets.',answers:{service:'kitchen'},contact:{name:'[QA] Fictional',email:'inquiry@example.invalid',phone:''},intake:{projectId:`handyman:${source}`,originSite:'handyman',transcript:[{id:'toy',role:'user',text:'Keep the existing fictional floor.',at:1}],supportingServices:['cabinetry']}})]);
 const store=intakeTransferStore(query,()=>now);
 const seal=async()=>{await store.prepare(binding());return (await store.seal(binding())).bundle!;};
 const addFile=async(id=source,file=fileId)=>query("INSERT INTO p5_estimator_files VALUES($1,$2,'fictional-scope.txt','text/plain',1,$3,now())",[file,id,transferSecretHash('x')]);
 return {db,query,store,seal,addFile,advance:()=>{now+=TRANSFER_ADMISSION_MS+1;}};
}
test('prepare freezes before sealing; SQL JSON order preserves verified scope, conversation, contact and manifest',async()=>{
 const x=await database();try{
  await x.addFile();const p=await x.store.prepare(binding());assert.equal(p.state,'freezing');assert.equal(p.bundle,undefined);
  assert.equal((await x.query('SELECT status FROM p5_estimator_drafts WHERE id=$1',[source]))[0].status,'intake-transferring');
  const sealed=await x.store.seal(binding());const bundle=requireTransferBundle(sealed.bundle!);assert.equal(bundle.files.length,1);
  assert.equal((bundle.payload.contact as {email:string}).email,'inquiry@example.invalid');assert.equal((bundle.payload.intake as {transcript:Array<{text:string}>}).transcript[0].text,'Keep the existing fictional floor.');
  assert.equal((await x.store.seal(binding())).bundle!.digest,bundle.digest);
 }finally{await x.db.close();}
});
test('lost prepare/seal responses and concurrent repeats retain exactly one immutable transfer',async()=>{
 const x=await database();try{
  await Promise.all([x.store.prepare(binding()),x.store.prepare(binding())]);
  const bundles=await Promise.all([x.store.seal(binding()),x.store.seal(binding())]);assert.equal(bundles[0].bundle!.digest,bundles[1].bundle!.digest);
  assert.equal((await x.query('SELECT * FROM p5_estimator_work WHERE work_key=$1',[TRANSFER_KEY])).length,1);
  await assert.rejects(x.store.prepare({...binding(),destinationSite:'construction'}),IntakeTransferConflict);
 }finally{await x.db.close();}
});
test('expired admission preserves frozen ownership; authenticated renewal resumes the same transfer',async()=>{
 const x=await database();try{
  const bundle=await x.seal();x.advance();await assert.rejects(x.store.claim(binding()),/resumed/);
  assert.equal((await x.query('SELECT status FROM p5_estimator_drafts WHERE id=$1',[source]))[0].status,'intake-transferring');
  await x.store.renew(binding());assert.equal((await x.store.claim(binding())).digest,bundle.digest);
  x.advance();await assert.rejects(x.store.cancel(binding()),/already begun/);await assert.rejects(x.store.claim(binding()),/resumed/);
  await x.store.renew(binding());assert.equal((await x.store.claim(binding())).digest,bundle.digest);
 }finally{await x.db.close();}
});
test('cancel is allowed before claim only, retains original bytes, and cannot replay the cancelled grant',async()=>{
 const x=await database();try{
  await x.addFile();await x.seal();await x.store.cancel(binding());await x.store.cancel(binding());
  assert.equal((await x.query('SELECT status FROM p5_estimator_drafts WHERE id=$1',[source]))[0].status,'draft');
  assert.equal((await x.query('SELECT * FROM p5_estimator_files WHERE draft_id=$1',[source])).length,1);
  await assert.rejects(x.store.claim(binding()));await assert.rejects(x.store.prepare(binding()),/cancelled/);
  const fresh={...binding(),transferId:'12345678-1234-4234-8234-123456789ab1'};await x.store.prepare(fresh);await x.store.seal(fresh);await x.store.claim(fresh);await assert.rejects(x.store.cancel(fresh),/already begun/);
 }finally{await x.db.close();}
});
test('destination remains uneditable until every file is present; lost ready acknowledgement reuses one draft and receipt',async()=>{
 const x=await database();try{
  await x.addFile();const bundle=await x.seal();await x.store.claim(binding());
  await Promise.all([x.store.beginImport(bundle),x.store.beginImport(bundle)]);
  assert.equal((await x.query('SELECT status FROM p5_estimator_drafts WHERE id=$1',[destination]))[0].status,'intake-importing');
  await assert.rejects(x.store.completeImport(bundle),/files have not/);
  await x.addFile(destination,'12345678-1234-4234-8234-123456789ab2');const receipt=await x.store.completeImport(bundle);
  assert.equal(receipt.binding.projectId,binding().projectId);assert.equal(receipt.files.length,1);assert.deepEqual(await x.store.completeImport(bundle),receipt);
  assert.equal((await x.query('SELECT * FROM p5_estimator_work WHERE work_key=$1',[IMPORT_KEY])).length,1);
  x.advance();await assert.rejects(x.store.cancel(binding()),/already begun/);await x.store.acknowledge(binding(),receipt);
  assert.equal((await x.query('SELECT status FROM p5_estimator_drafts WHERE id=$1',[source]))[0].status,'intake-transferred');
  assert.equal((await x.query('SELECT * FROM p5_estimator_files WHERE draft_id=$1',[source])).length,1);
  assert.deepEqual(await x.store.acknowledge(binding(),receipt),receipt);
 }finally{await x.db.close();}
});
test('destination identity collision never overwrites an unrelated project',async()=>{
 const x=await database();try{
  const bundle=await x.seal();await x.query("INSERT INTO p5_estimator_drafts VALUES($1,'other-owner',7,'remodeling','draft','{\"text\":\"[QA] unrelated project\"}',now())",[destination]);
  await assert.rejects(x.store.beginImport(bundle),/already in use/);
  const [row]=await x.query('SELECT key_hash,revision,payload FROM p5_estimator_drafts WHERE id=$1',[destination]);assert.equal(row.key_hash,'other-owner');assert.equal(row.revision,7);assert.equal(row.payload.text,'[QA] unrelated project');
 }finally{await x.db.close();}
});
test('changed snapshots, destination credentials, missing files and forged ready receipts fail closed',async()=>{
 const x=await database();try{
  const bundle=await x.seal();assert.throws(()=>requireTransferBundle({...bundle,payload:{...bundle.payload,text:'changed'}}),/verification/);
  await assert.rejects(x.store.claim({...binding(),destinationKeyHash:transferSecretHash('c'.repeat(64))}),/does not match/);
  await x.store.claim(binding());await x.store.beginImport(bundle);const receipt=await x.store.completeImport(bundle);
  assert.throws(()=>requireTransferReceipt({...receipt,digest:'0'.repeat(64)},bundle),/not confirmed/);
  await assert.rejects(x.store.acknowledge(binding(),{...receipt,binding:{...binding(),projectId:`p5:${source}`}}),/not confirmed/);
  assert.equal((await x.store.readSource(source))!.state,'importing');
 }finally{await x.db.close();}
});
test('an already accepted source request blocks transfer and keeps its existing delivery work',async()=>{
 const x=await database();try{
  await x.query("INSERT INTO p5_estimator_work VALUES($1,'intake-submission-v1','{\"accepted\":true}',now())",[source]);
  await x.query("INSERT INTO p5_estimator_work VALUES($1,'intake-delivery-v1:1','{\"status\":\"pending\"}',now())",[source]);
  await x.store.prepare(binding());await assert.rejects(x.store.seal(binding()),/already has a submitted request/);
  assert.equal((await x.query('SELECT status FROM p5_estimator_drafts WHERE id=$1',[source]))[0].status,'draft');
  assert.equal((await x.query("SELECT * FROM p5_estimator_work WHERE work_key='intake-delivery-v1:1'")).length,1);
 }finally{await x.db.close();}
});
test('destination import metadata failure rolls back the destination draft too',async()=>{
 const x=await database();try{
  const bundle=await x.seal();await x.db.exec("ALTER TABLE p5_estimator_work ADD CONSTRAINT synthetic_import_failure CHECK(work_key<>'intake-import-v2')");
  await assert.rejects(x.store.beginImport(bundle));assert.equal((await x.query('SELECT * FROM p5_estimator_drafts WHERE id=$1',[destination])).length,0);
 }finally{await x.db.close();}
});

test('small-file registration and source freeze preserve both serialization orders',async()=>{
 for(const uploadFirst of [true,false]){
  const x=await database();try{
   await x.db.exec('ALTER TABLE p5_estimator_files ADD COLUMN data_base64 text;ALTER TABLE p5_estimator_files ADD COLUMN storage_bucket text;ALTER TABLE p5_estimator_files ADD COLUMN storage_key text');
   const register=()=>x.query(REGISTER_DRAFT_UPLOAD_SQL,[fileId,source,'fictional-scope.txt','text/plain',1,transferSecretHash('x'),'eA==',null,null]);
   if(uploadFirst)await register();await x.store.prepare(binding());if(!uploadFirst)await register();
   const bundle=(await x.store.seal(binding())).bundle!;assert.equal(bundle.files.length,uploadFirst?1:0);
   assert.equal((await x.query('SELECT * FROM p5_estimator_files WHERE draft_id=$1',[source])).length,uploadFirst?1:0);
  }finally{await x.db.close();}
 }
});

test('a prepare retry racing cancellation cannot freeze the source behind a cancelled grant',async()=>{
 const x=await database();try{
  await x.seal();let cancelOnce=true;
  const racing=intakeTransferStore(async(sql,values)=>{const rows=await x.query(sql,values);if(cancelOnce&&sql.startsWith('SELECT payload FROM p5_estimator_work')){cancelOnce=false;await x.store.cancel(binding());}return rows;});
  await assert.rejects(racing.prepare(binding()),/cancelled/);
  assert.equal((await x.query('SELECT status FROM p5_estimator_drafts WHERE id=$1',[source]))[0].status,'draft');
  assert.equal((await x.store.readSource(source))!.state,'cancelled');
 }finally{await x.db.close();}
});
test('transfer identity comes from the source; QA restrictions cannot become an unrestricted destination',async()=>{
 const x=await database();try{
  await assert.rejects(x.store.prepare({...binding(),projectId:`p5:${destination}`}));
  assert.equal((await x.query('SELECT status FROM p5_estimator_drafts WHERE id=$1',[source]))[0].status,'draft');
  await x.query("INSERT INTO p5_estimator_work VALUES($1,'qa-no-provider-v1','{\"providerCallsAllowed\":0}',now())",[source]);
  await x.store.prepare(binding());await assert.rejects(x.store.seal(binding()),/restricted QA/);
  assert.equal((await x.query("SELECT * FROM p5_estimator_work WHERE work_key='qa-no-provider-v1'")).length,1);
  assert.equal((await x.query('SELECT status FROM p5_estimator_drafts WHERE id=$1',[source]))[0].status,'draft');
  assert.equal((await x.query('SELECT * FROM p5_estimator_drafts WHERE id=$1',[destination])).length,0);
 }finally{await x.db.close();}
});

test('a reopened historical estimate cannot establish a new lead owner through transfer',async()=>{
 for(const kind of ['version','outbox','history']){
  const x=await database();try{
   if(kind==='version')await x.query("INSERT INTO p5_estimator_work VALUES($1,'version-v1:1','{\"customer\":{\"saved\":true}}',now())",[source]);
   if(kind==='outbox'){await x.db.exec('CREATE TABLE p5_estimator_outbox(draft_id uuid,status text)');await x.query("INSERT INTO p5_estimator_outbox VALUES($1,'sent')",[source]);}
   if(kind==='history'){await x.db.exec('CREATE TABLE p5_estimator_history(draft_id uuid,revision integer)');await x.query('INSERT INTO p5_estimator_history VALUES($1,1)',[source]);}
   await x.store.prepare(binding());await assert.rejects(x.store.seal(binding()),/already has a submitted request/);
   assert.equal((await x.query('SELECT status FROM p5_estimator_drafts WHERE id=$1',[source]))[0].status,'draft');
   assert.equal((await x.store.readSource(source))!.state,'cancelled');
  }finally{await x.db.close();}
 }
});


test('actual sealed handoff preserves canonical unknown/declined history and selected unit address',async()=>{
 const x=await database();try{
  const memory={schema:1,entries:[{id:'unknown-timing',topic:'schedule',state:'unknown',value:'Not sure yet',source:'conversation:one',revision:1},{id:'declined-budget',topic:'budget',state:'declined',value:'Prefer not to say',source:'conversation:two',revision:1}]};
  const [row]=await x.query('SELECT payload FROM p5_estimator_drafts WHERE id=$1',[source]);
  const payload=row.payload as any;payload.intake.questionMemory=memory;payload.answers.address='1 Fictional Lane, Apt 2';
  await x.query('UPDATE p5_estimator_drafts SET payload=$2::jsonb WHERE id=$1',[source,JSON.stringify(payload)]);
  const bundle=await x.seal();await x.store.claim(binding());await x.store.beginImport(bundle);await x.store.completeImport(bundle);
  const [destinationRow]=await x.query('SELECT payload FROM p5_estimator_drafts WHERE id=$1',[destination]);
  const imported=destinationRow.payload as any;
  assert.deepEqual(imported.intake.questionMemory,memory);assert.equal(imported.answers.address,payload.answers.address);
 }finally{await x.db.close();}
});

for(const middle of ['Not sure yet','Prefer not to share','April 2027'])test(`actual sealed handoff retains restored answer after ${middle} and staff current state`,async()=>{
 const x=await database();try{
  let memory=readQuestionMemory(undefined);
  for(const [i,value] of ['March 2027',middle,'March 2027'].entries())memory=reconcileQuestionMemory({revision:i+1,answers:{schedule:value},extraction:null,intake:{questionMemory:memory}});
  const [row]=await x.query('SELECT payload FROM p5_estimator_drafts WHERE id=$1',[source]);
  const payload=row.payload as {answers:ScopeAnswers;intake:ReturnType<typeof emptyIntakeDetails>};
  payload.answers.schedule='March 2027';payload.intake.questionMemory=memory;
  await x.query('UPDATE p5_estimator_drafts SET payload=$2::jsonb WHERE id=$1',[source,JSON.stringify(payload)]);
  const bundle=await x.seal();await x.store.claim(binding());await x.store.beginImport(bundle);await x.store.completeImport(bundle);
  const [destinationRow]=await x.query('SELECT payload FROM p5_estimator_drafts WHERE id=$1',[destination]);
  const imported=JSON.parse(JSON.stringify(destinationRow.payload)) as typeof payload;
  assert.deepEqual(imported.intake.questionMemory,memory);assert.equal(imported.answers.schedule,'March 2027');
  assert.equal(currentQuestionEntries(readQuestionMemory(imported.intake.questionMemory)).get('schedule')!.value,'March 2027');
  assert.ok(!intakeUnresolved({...imported,extraction:null},SCOPE_FIELDS).some(n=>n.includes('Requested schedule')));
  const edited=reconcileQuestionMemory({...imported,revision:1,answers:{...imported.answers,schedule:'May 2027'},extraction:null});
  assert.equal(currentQuestionEntries(edited).get('schedule')!.value,'May 2027','a destination revision restart must not freeze source-site decision time');
 }finally{await x.db.close();}
});
