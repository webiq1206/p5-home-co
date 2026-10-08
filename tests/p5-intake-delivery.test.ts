/** MOCK TRANSPORTS ONLY. This suite proves state transitions, not provider/inbox/CRM receipt. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {isolatedDatabase} from './fixtures/p5-pglite.ts';
import {intakeDeliveryWorker,INTAKE_DRIVER_PENDING_SQL,independentDeliveryPasses,type IntakeTransport,type IntakeChannelState} from '../lib/p5/intakeDelivery.ts';
import {intakeDeliveryEnvelope,intakeLeadKey,intakeOperationKey,intakeLocalCrmRecord,type IntakeDeliveryEnvelope} from '../lib/p5/intakeDeliveryPayload.ts';
import {INTAKE_CHANNELS,INTAKE_RUNTIME_PROOF,type IntakeChannel} from '../lib/p5/intakeDeliveryPolicy.ts';
import {intakeStore,deliveryKey,intakeDigest,type IntakeRow} from '../lib/p5/intakeStore.ts';
import {routeIntake,INTAKE_RECIPIENTS,INTAKE_SITES,type IntakeSite} from '../lib/p5/intakePolicy.ts';
import {emptyIntakeDetails,type IntakeSnapshot} from '../lib/p5/intakeContract.ts';
const id='12345678-1234-4234-8234-123456789abc';
const start=Date.parse('2099-01-02T12:00:00Z');
function request(site:IntakeSite='p5',revision=1):Omit<IntakeSnapshot,'savedAt'>{return {schema:1,projectId:`p5:${id}`,originSite:'p5',currentSite:site,draftId:id,revision,contextVersion:0,
 contact:{name:'Fictional Customer',email:'customer@example.invalid',phone:'',preferredContact:'email'},details:{...emptyIntakeDetails(),transcript:[{id:'fictional-message',role:'user',text:'Fictional project details',at:start,label:'Fictional question',caption:'Fictional caption',files:['fictional-plan.txt']}]},
 scope:{text:'A fictional kitchen in Fictional Region. Unknown budget.',answers:{service:'kitchen',exclusions:'Retain the fictional sink'},extraction:null,uploads:[{id:'12345678-1234-4234-8234-123456789abd',name:'fictional-plan.txt',type:'text/plain',size:1,sha256:'a'.repeat(64),status:'stored'}]},routing:routeIntake(site,'kitchen',['cabinetry']),unresolved:['Site visit may be needed.']};}
async function fixture(site:IntakeSite='p5'){
 const db=await isolatedDatabase();await db.exec(`CREATE TABLE p5_estimator_drafts(id uuid PRIMARY KEY,revision integer,brand text,status text);
 CREATE TABLE p5_estimator_work(draft_id uuid REFERENCES p5_estimator_drafts(id),work_key text,payload jsonb,lease_token text,lease_until timestamptz,updated_at timestamptz DEFAULT now(),PRIMARY KEY(draft_id,work_key));`);
 const query=async(s:string,v:unknown[]=[])=> (await db.query<IntakeRow>(s,v)).rows;
 await query("INSERT INTO p5_estimator_drafts VALUES($1,1,$2,'draft')",[id,site]);
 let clock=start;const calls:IntakeDeliveryEnvelope[]=[];
 const transports=Object.fromEntries(INTAKE_CHANNELS.map(channel=>[channel,{retryWindowMs:channel==='crm'?0:23*3600000,identityScope:'mock-account-and-sender',readiness:async()=>null,send:async(e:IntakeDeliveryEnvelope)=>{calls.push(structuredClone(e));return `mock-${channel}`;}}])) as Record<IntakeChannel,IntakeTransport>;
 const store=intakeStore(query,()=>new Date(clock).toISOString());await store.save(request(site));
 const deps={query,site,transports,now:()=>clock};
 const channels=async(revision=1)=>(await query('SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[id,deliveryKey(revision)]))[0].payload.channels as Record<IntakeChannel,IntakeChannelState>;
 return {db,query,store,deps,calls,transports,channels,advance:(ms:number)=>{clock+=ms;},run:()=>intakeDeliveryWorker(deps).run()};
}
test('mock: concurrent workers and duplicate confirmation deliver one immutable operation per channel',async()=>{
 const f=await fixture();try{await Promise.all([f.run(),f.run(),f.store.save(request())]);await f.run();assert.equal(f.calls.length,3);assert.equal(new Set(f.calls.map(c=>c.key)).size,3);
 const channels=await f.channels();for(const c of INTAKE_CHANNELS){assert.equal(channels[c].status,'accepted');assert.equal(channels[c].attempts,1);}assert.equal((await f.store.read(id))?.delivery.team,'accepted');
 assert.ok(!JSON.stringify(await f.store.read(id)).includes('mock-team'));
 }finally{await f.db.close();}
});
test('mock: absent configuration and unverified CRM block only their channels without consuming attempts',async()=>{
 const f=await fixture();try{f.transports.customer.readiness=async()=> 'configuration-missing';f.transports.crm.readiness=async()=> 'crm-contract-pending';await f.run();const c=await f.channels();assert.equal(c.customer.status,'blocked');assert.equal(c.customer.attempts,0);assert.equal(c.team.status,'accepted');assert.equal(c.crm.reason,'crm-contract-pending');assert.equal(f.calls.length,1);
 assert.match((await f.store.read(id))!.deliveryDetails!.customer,/configuration is missing/);await f.run();assert.equal(f.calls.length,1);
 f.advance(3600001);f.transports.customer.readiness=async()=>null;await f.run();assert.equal((await f.channels()).customer.status,'accepted');assert.equal(f.calls.length,2);
 }finally{await f.db.close();}
});
test('mock: idempotent lost response retries frozen bytes and key, never accepted sibling channels',async()=>{
 const f=await fixture();try{let first=true;f.transports.customer.send=async e=>{f.calls.push(structuredClone(e));if(first){first=false;throw Error('mock secret URL and provider error');}return 'mock-confirmed';};await f.run();assert.equal((await f.channels()).customer.status,'retry');assert.equal(f.calls.length,3);await f.run();assert.equal(f.calls.length,3);f.advance(60001);await f.run();assert.equal(f.calls.length,4);assert.deepEqual(f.calls[0],f.calls[3]);assert.equal((await f.channels()).customer.status,'accepted');assert.ok(!JSON.stringify(await f.channels()).includes('mock secret'));
 }finally{await f.db.close();}
});
test('mock: SMTP/CRM uncertainty never automatically resends while independent channels complete',async()=>{
 const f=await fixture();try{f.transports.customer.retryWindowMs=0;f.transports.customer.send=async e=>{f.calls.push(e);throw Error('mock accepted but response lost');};f.transports.crm.send=async e=>{f.calls.push(e);throw Error('mock CRM response lost');};await f.run();f.advance(86400000);await f.run();assert.equal(f.calls.length,3);const c=await f.channels();assert.equal(c.customer.status,'unknown');assert.equal(c.crm.status,'unknown');assert.equal(c.team.status,'accepted');
 }finally{await f.db.close();}
});
test('mock: expired provider idempotency window or changed transport stops retry',async()=>{
 for(const change of ['expired','transport'] as const){const f=await fixture();try{f.transports.customer.send=async e=>{f.calls.push(e);throw Error('mock failure');};await f.run();f.advance(change==='expired'?24*3600000:60001);if(change==='transport')f.transports.customer.retryWindowMs=0;await f.run();assert.equal((await f.channels()).customer.status,'unknown');assert.equal(f.calls.length,3);}finally{await f.db.close();}}
});
test('mock: acknowledgement persistence loss leaves durable sending intent; SMTP recovery holds',async()=>{
 const f=await fixture();try{f.transports.customer.retryWindowMs=0;let lost=true;const query=async(s:string,v:unknown[]=[])=>{if(lost&&s.startsWith('UPDATE p5_estimator_work SET payload=')&&String(v[3]).includes('"status":"accepted"')){lost=false;throw Error('mock database unavailable');}return f.query(s,v);};await assert.rejects(intakeDeliveryWorker({...f.deps,query}).run(),/mock database/);assert.equal((await f.channels()).customer.status,'sending');await f.run();const c=await f.channels();assert.equal(c.customer.status,'unknown');assert.equal(c.team.status,'accepted');assert.equal(c.crm.status,'accepted');assert.equal(f.calls.length,3);
 }finally{await f.db.close();}
});
test('mock: readiness consuming the remaining idempotency window prevents a late resend',async()=>{
 const f=await fixture();try{f.transports.customer.send=async e=>{f.calls.push(e);throw Error('mock failure');};await f.run();f.advance(22*3600000);f.transports.customer.readiness=async()=>{f.advance(2*3600000);return null;};await f.run();assert.equal((await f.channels()).customer.status,'unknown');assert.equal(f.calls.length,3);}finally{await f.db.close();}
});
test('mock: changed provider account or sender holds an uncertain attempt',async()=>{
 const f=await fixture();try{f.transports.customer.send=async e=>{f.calls.push(e);throw Error('mock lost response');};await f.run();f.advance(60001);f.transports.customer.identityScope='mock-other-account';await f.run();assert.equal((await f.channels()).customer.status,'unknown');assert.equal(f.calls.length,3);}finally{await f.db.close();}
});
test('mock: an expired lease cannot acknowledge or dispatch remaining channels',async()=>{
 const f=await fixture();try{f.transports.customer.send=async e=>{f.calls.push(e);await f.query("UPDATE p5_estimator_work SET lease_until=now()-interval '1 second' WHERE draft_id=$1",[id]);return 'mock-accepted';};await assert.rejects(f.run(),/lease-lost/);assert.equal(f.calls.length,1);assert.equal((await f.channels()).customer.status,'sending');
 }finally{await f.db.close();}
});
test('mock: six attempts bound an idempotent failure loop',async()=>{
 const f=await fixture();try{f.transports.customer.send=async e=>{f.calls.push(e);throw Error('mock failure');};for(let i=0;i<8;i++){await f.run();f.advance(3600001);}const c=await f.channels();assert.equal(c.customer.status,'unknown');assert.equal(c.customer.attempts,6);assert.equal(c.customer.reason,'attempt-limit');assert.equal(f.calls.filter(c=>c.channel==='customer').length,6);
 }finally{await f.db.close();}
});
test('mock: edited revisions retain one lead identity and distinct delivery identities',async()=>{
 const f=await fixture();try{await f.run();await f.query('UPDATE p5_estimator_drafts SET revision=2 WHERE id=$1',[id]);const second=request('p5',2);second.scope.text='Changed fictional scope';await f.store.save(second);await f.run();assert.equal(f.calls.length,6);assert.equal(new Set(f.calls.map(c=>c.leadKey)).size,1);assert.equal(new Set(f.calls.map(c=>c.key)).size,6);assert.notEqual(f.calls[0].snapshotDigest,f.calls[3].snapshotDigest);
 }finally{await f.db.close();}
});
test('mock: corrupted recipient or immutable snapshot never dispatches that channel',async()=>{
 const f=await fixture();try{await f.query(`UPDATE p5_estimator_work SET payload=jsonb_set(payload,'{channels,team,recipient}','"wrong@example.invalid"') WHERE work_key=$1`,[deliveryKey(1)]);await f.run();assert.equal((await f.channels()).team.status,'failed');assert.equal(f.calls.length,2);
 }finally{await f.db.close();}
 const g=await fixture();try{await g.query(`UPDATE p5_estimator_work SET payload=jsonb_set(payload,'{snapshot,scope,text}','"changed"') WHERE work_key='intake-snapshot-v1:1'`);await g.run();assert.equal(g.calls.length,0);assert.equal((await g.channels()).team.reason,'snapshot-conflict');}finally{await g.db.close();}
});
test('mock: synthetic suppression, phone-only contact and site boundary perform no unwanted sends',async()=>{
 const f=await fixture();try{await intakeDeliveryWorker({...f.deps,suppressed:()=>true}).run();assert.equal(f.calls.length,0);assert.equal((await f.channels()).team.status,'suppressed');}finally{await f.db.close();}
 const g=await fixture();try{await intakeDeliveryWorker({...g.deps,site:'cabinet'}).run();assert.equal(g.calls.length,0);await g.query('DELETE FROM p5_estimator_work');const s=request();s.contact={name:'Fictional phone contact',email:'',phone:'2085550100',preferredContact:'phone'};await g.store.save(s);await g.run();assert.equal((await g.channels()).customer.status,'not-requested');assert.equal(g.calls.length,2);}finally{await g.db.close();}
});
test('payload: all five exact recipients, origin/primary/supporting scope, safe staff links and complete attachment',()=>{
 for(const site of Object.keys(INTAKE_SITES) as IntakeSite[]){const s={...request(site),savedAt:new Date(start).toISOString()},team=intakeDeliveryEnvelope(s,'team','digest'),customer=intakeDeliveryEnvelope(s,'customer','digest');assert.equal(team.email?.to,INTAKE_RECIPIENTS[site]);assert.equal(customer.email?.to,s.contact.email);
 const copy=JSON.parse(Buffer.from(team.email!.attachments[0].base64,'base64').toString());assert.equal(copy.origin,'P5 Home Co');assert.equal(copy.primaryTeam,'Boise Remodeling Co');assert.deepEqual(copy.supportingServices,['cabinetry']);assert.deepEqual(copy.conversation,s.details.transcript);assert.equal(copy.answers.exclusions,s.scope.answers.exclusions);
 const url=new URL(copy.files[0].authenticatedOriginal);assert.equal(url.hostname,INTAKE_SITES[site].domain);assert.deepEqual([...url.searchParams.keys()],['draftId','revision','fileId']);assert.ok(!url.href.includes('customer'));const customerCopy=Buffer.from(customer.email!.attachments[0].base64,'base64').toString();assert.ok(!customerCopy.includes('authenticatedOriginal'));assert.ok(!customerCopy.includes('/api/admin'));
 assert.equal(team.leadKey,intakeLeadKey(s.projectId));assert.notEqual(team.key,intakeOperationKey(s,'customer'));assert.match(team.email!.text,/delivery access is pending/);
 }
 assert.deepEqual(INTAKE_RUNTIME_PROOF,{email:'fleet-release-2026-10-08',crm:null});
 assert.equal(intakeDigest({a:1,b:{c:2,d:3}}),intakeDigest({b:{d:3,c:2},a:1}));
});
test('mock: oversized request is retained and requires payload review without a transport call',async()=>{
 const f=await fixture();try{await f.query('DELETE FROM p5_estimator_work');const s=request();s.scope.text='Fictional '.repeat(260000);await f.store.save(s);f.transports.crm.readiness=async()=> 'crm-contract-pending';await f.run();assert.equal(f.calls.length,0);assert.equal((await f.channels()).customer.reason,'payload-review');assert.equal((await f.channels()).team.reason,'payload-review');}finally{await f.db.close();}
});
test('mock: deterministic CRM size failure consumes no provider attempt',async()=>{
 const f=await fixture();try{await f.query('DELETE FROM p5_estimator_work');const s=request();s.scope.text='Fictional '.repeat(12000);await f.store.save(s);f.transports.crm.validate=e=>{try{intakeLocalCrmRecord(e.request!);return null;}catch{return 'payload-review';}};await f.run();const c=await f.channels();assert.equal(c.crm.reason,'payload-review');assert.equal(c.crm.status,'failed');assert.equal(c.crm.attempts,0);assert.equal(f.calls.length,2);
 }finally{await f.db.close();}
});
test('mock: a hung provider is bounded and does not stop independent channels',async()=>{
 const f=await fixture();try{f.transports.customer.send=async e=>{f.calls.push(e);return new Promise<string>(()=>undefined);};await intakeDeliveryWorker({...f.deps,timeoutMs:5}).run();const c=await f.channels();assert.equal(c.customer.status,'retry');assert.equal(c.team.status,'accepted');assert.equal(c.crm.status,'accepted');assert.equal(f.calls.length,3);}finally{await f.db.close();}
});
test('mock: exhausted invocation budget leaves undispatched work pending for the next pass',async()=>{
 const f=await fixture();try{f.transports.customer.readiness=async()=>{f.advance(1000);return null;};await intakeDeliveryWorker({...f.deps,budgetMs:10}).run();assert.equal(f.calls.length,0);const c=await f.channels();for(const channel of INTAKE_CHANNELS){assert.equal(c[channel].status,'pending');assert.equal(c[channel].attempts,0);}}finally{await f.db.close();}
});
test('mock: closed-browser future retry and interrupted lease keep the driver awake; configuration holds do not',async()=>{
 const f=await fixture();try{await f.run();const pending=async(site='p5')=>Number((await f.query(`SELECT ${INTAKE_DRIVER_PENDING_SQL} AS count`,[site]))[0].count);assert.equal(await pending(),0);
 await f.query(`UPDATE p5_estimator_work SET payload=jsonb_set(payload,'{channels,customer,status}','"retry"'),lease_until=now()+interval '4 minutes' WHERE work_key=$1`,[deliveryKey(1)]);
 await f.query(`UPDATE p5_estimator_work SET payload=jsonb_set(payload,'{channels,customer,nextAttemptAt}','"2099-01-02T13:00:00Z"') WHERE work_key=$1`,[deliveryKey(1)]);assert.equal(await pending(),1);assert.equal(await pending('cabinet'),0);
 await f.query(`UPDATE p5_estimator_work SET payload=jsonb_set(payload,'{channels,customer,status}','"sending"') WHERE work_key=$1`,[deliveryKey(1)]);assert.equal(await pending(),1);
 await f.query(`UPDATE p5_estimator_work SET payload=jsonb_set(payload,'{channels,customer,status}','"blocked"') WHERE work_key=$1`,[deliveryKey(1)]);assert.equal(await pending(),0);
 }finally{await f.db.close();}
});
test('mock: intake failure does not skip the preserved legacy delivery pass',async()=>{
 let legacy=0;await assert.rejects(independentDeliveryPasses(async()=>{throw Error('mock intake SQL failure');},async()=>{legacy++;}),/mock intake SQL failure/);assert.equal(legacy,1);
});

test('mock: unavailable originals block without attempts and recover without duplicate sibling sends',async()=>{
 const f=await fixture();try{let available=false;f.transports.customer.prepare=async(_s,e)=>{if(!available)throw Error('file-delivery-unavailable');return e;};await f.run();let c=await f.channels();assert.equal(c.customer.status,'blocked');assert.equal(c.customer.reason,'file-delivery-unavailable');assert.equal(c.customer.attempts,0);assert.equal(f.calls.length,2);available=true;f.advance(3600001);await f.run();c=await f.channels();assert.equal(c.customer.status,'accepted');assert.equal(c.customer.attempts,1);assert.equal(f.calls.length,3);await f.run();assert.equal(f.calls.length,3);}finally{await f.db.close();}
});
