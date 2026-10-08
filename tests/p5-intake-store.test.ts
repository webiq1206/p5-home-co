import test from 'node:test';
import type {IntakeRow} from '../lib/p5/intakeStore.ts';
import assert from 'node:assert/strict';
import {isolatedDatabase} from './fixtures/p5-pglite.ts';
import {intakeStore,deliveryKey,snapshotKey,IntakeConflict} from '../lib/p5/intakeStore.ts';
import {emptyIntakeDetails,intakeContact,intakeDetails,requireIntakeReceipt,type IntakeSnapshot} from '../lib/p5/intakeContract.ts';
import {routeIntake} from '../lib/p5/intakePolicy.ts';

const id='12345678-1234-4234-8234-123456789abc';
const clock=()=> '2099-01-02T12:00:00.000Z';
function request():Omit<IntakeSnapshot,'savedAt'>{return {schema:1,projectId:`p5:${id}`,originSite:'p5',currentSite:'p5',draftId:id,revision:1,contextVersion:0,
 contact:{name:'[QA] Fictional Request',email:'inquiry@example.invalid',phone:'',preferredContact:'email'},details:emptyIntakeDetails(),
 scope:{text:'A fictional kitchen project in Fictional Region. Budget unknown.',answers:{service:'kitchen'},extraction:null,uploads:[]},routing:routeIntake('p5','kitchen',['cabinetry']),unresolved:['Budget is not known yet.']};}
async function database(){const db=await isolatedDatabase();await db.exec(`
 CREATE TABLE p5_estimator_drafts(id uuid PRIMARY KEY,revision integer NOT NULL,brand text NOT NULL,status text NOT NULL);
 CREATE TABLE p5_estimator_work(draft_id uuid REFERENCES p5_estimator_drafts(id),work_key text,payload jsonb,updated_at timestamptz DEFAULT now(),PRIMARY KEY(draft_id,work_key));
 INSERT INTO p5_estimator_drafts VALUES('${id}',1,'p5','draft');`);
 const query=async(s:string,v:unknown[]=[])=> (await db.query<IntakeRow>(s,v)).rows;
 return {db,query,store:intakeStore(query,clock)};}
test('durable snapshot, current receipt and pending delivery work commit together',async()=>{
 const {db,query,store}=await database();try{
  const receipt=requireIntakeReceipt(await store.save(request()));assert.equal(receipt.team.primaryTeam,'remodeling');assert.equal(receipt.delivery.team,'pending');
  const rows=await query('SELECT work_key FROM p5_estimator_work');assert.equal(rows.length,3);
  assert.ok(rows.some(r=>r.work_key===snapshotKey(1)));assert.ok(rows.some(r=>r.work_key===deliveryKey(1)));
 }finally{await db.close();}
});
test('concurrent and lost-response retries retain one logical request and one delivery job',async()=>{
 const {db,query,store}=await database();try{
  const receipts=await Promise.all(Array.from({length:5},()=>store.save(request())));
  assert.ok(receipts.every(r=>JSON.stringify(r)===JSON.stringify(receipts[0])));
  let lost=true;const uncertain=intakeStore(async(s,v)=>{const rows=await query(s,v);if(s.startsWith('WITH owned')&&lost){lost=false;throw Error('synthetic lost acknowledgement');}return rows;},clock);
  await assert.rejects(uncertain.save(request()),/lost acknowledgement/);
  assert.deepEqual(await uncertain.save(request()),receipts[0]);assert.equal((await query('SELECT * FROM p5_estimator_work')).length,3);
 }finally{await db.close();}
});
test('same revision with different contact cannot silently reuse an earlier success',async()=>{
 const {db,store}=await database();try{await store.save(request());const changed=request();changed.contact.name='[QA] Changed Request';await assert.rejects(store.save(changed),IntakeConflict);}finally{await db.close();}
});
test('stale revision and a source frozen for transfer cannot create a submission',async()=>{
 const {db,query,store}=await database();try{
  const stale=request();stale.revision=2;await assert.rejects(store.save(stale),IntakeConflict);
  await query("INSERT INTO p5_estimator_work VALUES($1,'intake-transfer-lock-v2','{}',now())",[id]);
  await assert.rejects(store.save(request()),IntakeConflict);assert.equal(await store.read(id),null);
 }finally{await db.close();}
});
test('failure inserting delivery work rolls back the saved request',async()=>{
 const {db,query,store}=await database();try{
  await db.exec("ALTER TABLE p5_estimator_work ADD CONSTRAINT synthetic_delivery_failure CHECK (work_key NOT LIKE 'intake-delivery-v1:%')");
  await assert.rejects(store.save(request()));assert.equal((await query('SELECT * FROM p5_estimator_work')).length,0);
 }finally{await db.close();}
});
test('an edited revision retains project identity and immutable previous scope',async()=>{
 const {db,query,store}=await database();try{
  const first=await store.save(request());await query('UPDATE p5_estimator_drafts SET revision=2 WHERE id=$1',[id]);
  const next=request();next.revision=2;next.scope.text+=' Keep the existing floor.';
  const second=await store.save(next);assert.equal(second.projectId,first.projectId);assert.equal(second.revision,2);
  assert.equal((await store.read(id,1))?.revision,1);assert.equal((await store.read(id))?.revision,2);
 }finally{await db.close();}
});
test('contact preferences validate available channels without requiring both',()=>{
 assert.equal(intakeContact({name:'李',phone:'+1 (208) 555-0100',preferredContact:'phone'}).email,'');
 assert.throws(()=>intakeContact({name:'Fictional',email:'inquiry@example.invalid',preferredContact:'phone'}),/phone number/);
 assert.throws(()=>intakeContact({name:'Fictional',email:'bad'}),/valid email/);
 assert.throws(()=>intakeContact({name:'Fictional',phone:'+1 208 555 0100',preferredContact:'sms'}),/Choose/);
});
test('oversized conversation is rejected rather than silently truncated; forged receipt is rejected',()=>{
 assert.throws(()=>intakeDetails({...emptyIntakeDetails(),transcript:[{id:'x',role:'user',text:'x'.repeat(8*1024*1024+1),at:1}]}),/too long/);
 assert.throws(()=>requireIntakeReceipt({accepted:true}),/could not be confirmed/);
});
