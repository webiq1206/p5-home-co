import test from 'node:test';
import assert from 'node:assert/strict';
import {isolatedPool} from '../scripts/model-qa-support.mjs';
import {Store} from '../src/store.mjs';
import {Pipeline} from '../src/pipeline.mjs';
import {Reader} from '../src/provider.mjs';
import {QA_MODEL} from '../src/qa-budget.mjs';
const tenant='p5homeco.com',project='qa-paid-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const native={page:1,kind:'text',textQuality:1,text:'Interior trim scope\nInstall 120 linear feet of painted baseboard.\nExclude all electrical work.'};
const raw={pages:[{page:1,sheet:'',revision:'',status:'read',notes:[],facts:[],items:[{id:'baseboard',description:'Painted baseboard',component:'Trim',building:'',floor:'',quantity:120,unit:'lf',basis:'stated',evidence:'Install 120 lf of painted baseboard.'}],inclusions:[],exclusions:['Electrical work'],responsibilities:[],regions:[]}]};
const repair={citations:[{key:'1:items:0',supported:true,lines:[2]}]};
for(const ambiguous of [false,true])test('real QA pipeline citation hold resumes with an exact permit; unknown='+ambiguous,async()=>{
 const config={provider:'anthropic',model:QA_MODEL,verifyModel:QA_MODEL,key:'fake-only',parserSlots:1,slots:1,rpm:100,tpm:1000000,callMs:20000,parseMs:60000,jobMs:300000,maxPages:4,maxTenantBytes:1000000,maxQueue:30,maxOutput:10000};
 const pool=await isolatedPool(),store=new Store(pool,config);await store.init();await store.qa.provision([{tenant,project}]);
 let calls=0,direct=0;
 store.qa.request=async()=>{calls++;if(calls===2&&ambiguous)throw new TypeError('Synthetic ambiguous provider transport');return Response.json({id:'msg_'+calls,model:QA_MODEL,stop_reason:'tool_use',usage:{input_tokens:100,output_tokens:100},content:[{type:'tool_use',id:'tool_'+calls,name:'submit_document_review',input:calls===1?raw:repair}]});};
 const reader=new Reader(config,store,async()=>{direct++;throw Error('Unexpected direct provider');});
 const parser=async(bytes,{onManifest,onPage})=>{await onManifest(1);await onPage({...native,image:Buffer.from('synthetic-image'),parseMs:0,nativeMs:0,renderMs:0});};
 const pipeline=new Pipeline(store,reader,config,parser),signal=()=>AbortSignal.timeout(20000);
 try{
  const {document}=await store.putDocument(tenant,project,'synthetic.pdf',Buffer.from('%PDF-synthetic'));
  await pipeline.prepare(await store.claim(['parse']),signal());let job=await store.claim(['read']);
  const held=async(pattern)=>{let error;try{await pipeline.read(job,signal());}catch(e){error=e;}assert.match(error?.message||'',pattern);await store.fail(job,error);};
  const resume=async()=>{await store.retry(tenant,project,document.id,'documents');await pool.query("UPDATE p5ds_jobs SET available_at=now() WHERE id=$1 AND state='queued'",[job.id]);job=await store.claim(['read']);assert.ok(job);};
  const permit=async(slot)=>{const intent=(await pool.query('SELECT request_hash FROM p5ds_qa_intents ORDER BY created_at DESC LIMIT 1')).rows[0];await store.qa.permit(intent.request_hash,slot,'Exact synthetic pipeline request inspected; fake provider only.');};
  await held(/review-required/);assert.equal(calls,0);await permit('pipeline-read-0001');await resume();
  await held(/review-required/);assert.equal(calls,1);
  const saved=await store.job(tenant,project,job.id);assert.equal(saved.result.evidenceCheckpoint.repairStarted,true);assert.deepEqual(saved.result.evidenceCheckpoint.raw,raw);
  // Repeated retries before permission retain raw evidence and do not spend.
  await resume();await held(/review-required/);assert.equal(calls,1);
  await permit('pipeline-citation-0002');await resume();
  if(ambiguous){await held(/provider-network-error/);assert.equal(calls,2);await resume();await held(/run-held/);assert.equal(calls,2);const run=(await pool.query('SELECT * FROM p5ds_qa_runs')).rows[0];assert.equal(run.blocked,true);assert.ok(Number(run.liability_microusd)>200000);}
  else{await pipeline.read(job,signal());assert.equal(calls,2);const documentAfter=await store.document(tenant,project,document.id);assert.equal(documentAfter.state,'complete');const page=(await store.pages(document.id))[0].evidence;assert.equal(page.items[0].quantity,120);assert.equal(page.items[0].evidence,native.text.split('\n')[1]);assert.equal((await pool.query("SELECT count(*)::int n FROM p5ds_qa_calls WHERE status='settled'")).rows[0].n,2);}
  assert.equal(direct,0);
 }finally{await pool.end();}
});

test('QA nonstream response can exceed ordinary idle timeout; ordinary behavior stays bounded',async()=>{
 const config={provider:'anthropic',model:QA_MODEL,verifyModel:QA_MODEL,key:'fake-only',slots:1,rpm:100,tpm:1000000,callMs:25,streamMs:5000,maxOutput:100};
 const pool=await isolatedPool(),store=new Store(pool,config);await store.init();await store.qa.provision([{tenant,project}]);
 let calls=0;
 const response={id:'msg_slow',model:QA_MODEL,stop_reason:'tool_use',usage:{input_tokens:100,output_tokens:10},content:[{type:'tool_use',id:'tool_slow',name:'submit_document_review',input:{value:'accepted'}}]};
 const slow=async(url,init)=>{calls++;await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,100);init.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(init.signal.reason);},{once:true});});return Response.json(response);};
 store.qa.request=slow;const reader=new Reader(config,store,slow),schema={type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false},job={id:'slow-qa',tenant,project,kind:'read',attempts:1};
 const call=()=>reader.call(job,'Read',{},[],schema,AbortSignal.timeout(5000));
 try{await assert.rejects(call(),/review-required/);const intent=(await pool.query('SELECT request_hash FROM p5ds_qa_intents')).rows[0];await store.qa.permit(intent.request_hash,'slow-reviewed-0001','Exact slow synthetic request inspected; no real network.');assert.deepEqual(await call(),{value:'accepted'});assert.equal(calls,1);await assert.rejects(reader.call({...job,id:'ordinary',project:'ordinary'},'Read',{},[],schema,AbortSignal.timeout(5000)),/idle-timeout/);assert.equal(calls,2);}finally{await pool.end();}
});
