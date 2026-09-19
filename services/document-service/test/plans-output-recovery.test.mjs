import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {isolatedPool,privateJson,guardedSonnetFetch} from '../scripts/model-qa-support.mjs';
import {resumePlansOutput} from '../scripts/resume-plans-output.mjs';
import {Store} from '../src/store.mjs';
import {hash} from '../src/core.mjs';

const digest='4565acfa74cc3590fc2c7b2baf532c99a069c9a572448de8a6f599a7cf135786';
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'p5-plans-output-')),pool=await isolatedPool(),store=new Store(pool,{maxTenantBytes:1000000,maxQueue:30});await store.init();
 const {document}=await store.putDocument('qa','plans','synthetic.pdf',Buffer.from('%PDF synthetic'));
 await pool.query("UPDATE p5ds_documents SET digest=$2,state='failed',error_code='provider-output-limit',page_count=23 WHERE id=$1",[document.id,digest]);
 await pool.query("UPDATE p5ds_jobs SET state='complete',attempts=1 WHERE document_id=$1",[document.id]);
 for(let page=1;page<=23;page++){
  const native={page,kind:'drawing',textQuality:1,text:'Synthetic source',spans:[]};
  const evidence={page,sheet:'',revision:'',status:'partial',notes:['Unresolved actual detail'],facts:[],items:[],regions:[],inclusions:[],exclusions:['Excluded synthetic scope'],responsibilities:[]};
  await pool.query('INSERT INTO p5ds_pages(document_id,page,native,image,evidence) VALUES($1,$2,$3,$4,$5)',[document.id,page,native,Buffer.from('image-'+page),page<=3?evidence:null]);
  await store.enqueue(pool,{id:'read-'+page,tenant:'qa',project:'plans',kind:'read',documentId:document.id,payload:{pages:[page]}});
  if(page<=4)await pool.query('UPDATE p5ds_jobs SET state=$2,attempts=$3,error_code=$4,result=$5 WHERE id=$1',['read-'+page,page<4?'complete':'failed',page===4?1:page===3?3:2,page===4?'provider-output-limit':null,page===4?null:{pages:[page]}]);
 }
 await store.enqueue(pool,{id:'review',tenant:'qa',project:'plans',kind:'review',payload:{documents:[{id:document.id,source:'synthetic.pdf'}],text:'Synthetic fixture',answers:{}}});
 await pool.query("UPDATE p5ds_jobs SET state='failed',error_code='source-reading-failed',attempts=3 WHERE id='review'");
 const calls=[];
 for(let i=0;i<11;i++){
  const usage=i===10?{input_tokens:9999,output_tokens:10000}:{input_tokens:1,output_tokens:1};
  const request={model:'claude-sonnet-5',max_tokens:10000,output_config:{effort:'medium'},messages:[{role:'user',content:[{type:'text',text:JSON.stringify({pages:[{page:i===10?4:i+1}]})}]}]};
  const responseText=JSON.stringify({usage,stop_reason:i===10?'max_tokens':'end_turn',content:[]}),requestSha256=hash(JSON.stringify(request)),responseFile='responses/'+String(i+1).padStart(4,'0')+'.json';
  calls.push({status:'usage-reported',usage,reservedUsd:i===6?.551956:i===10?.2417693:0,httpStatus:200,requestSha256,responseFile,responseSha256:hash(responseText)});
  await privateJson(join(root,responseFile),{request,requestSha256,httpStatus:200,responseText});
 }
 const ledger={version:1,model:'claude-sonnet-5',paused:false,calls},pages=await store.pages(document.id,null,true);
 await privateJson(join(root,'cost.json'),ledger);
 await privateJson(join(root,'report.json'),{id:'plans',sourceSha256:digest,expectedPages:23,complete:false,error:'provider-output-limit'});
 await privateJson(join(root,'plans-citation-recovery-v1.json'),{version:1,action:'Synthetic historical marker'});
 await privateJson(join(root,'plans-spatial-page3-recovery-v1.json'),{version:1,legacyMarkerSha256:hash(await readFile(join(root,'plans-citation-recovery-v1.json'))),previousLedger:{...ledger,calls:calls.slice(0,7)},previousReport:{sourceSha256:digest},pageEvidence:pages.slice(0,2).map(p=>({page:p.page,evidence:p.evidence})),pageFingerprints:pages.map(p=>({page:p.page,nativeSha256:hash(JSON.stringify(p.native)),imageSha256:hash(p.image)}))});
 return {root,pool,store,document:await store.document('qa','plans',document.id),ledger,close:async()=>{await pool.end();await rm(root,{recursive:true,force:true});}};
}

test('inspected page-4 recovery preserves all prior charges, responses, evidence and both old archives',async()=>{
 const f=await fixture();
 try{
  const files=['cost.json','responses/0011.json','plans-citation-recovery-v1.json','plans-spatial-page3-recovery-v1.json'];
  const before=await Promise.all(files.map(name=>readFile(join(f.root,name),'utf8'))),pages=await f.store.pages(f.document.id,null,true);
  const completed=(await f.pool.query("SELECT * FROM p5ds_jobs WHERE state='complete' ORDER BY id")).rows;
  await resumePlansOutput(f.store,f.document,f.root);
  assert.deepEqual(await Promise.all(files.map(name=>readFile(join(f.root,name),'utf8'))),before);
  assert.deepEqual(await f.store.pages(f.document.id,null,true),pages);
  assert.deepEqual((await f.pool.query("SELECT * FROM p5ds_jobs WHERE state='complete' ORDER BY id")).rows,completed);
  const page4=await f.store.job('qa','plans','read-4');assert.equal(page4.state,'queued');assert.equal(page4.attempts,1);assert.equal(page4.result.readProfile,'low-effort-v1');assert.equal(page4.result.lowReadStarted,undefined);
  const archive=JSON.parse(await readFile(join(f.root,'plans-page4-output-recovery-v1.json'),'utf8'));assert.deepEqual(archive.previousLedger,f.ledger);assert.equal(archive.pageEvidence.length,3);assert.ok(archive.pageEvidence.every(p=>p.evidence.status==='partial'));
  const guard=await guardedSonnetFetch({file:join(f.root,'cost.json'),limitUsd:3,maxCalls:64,request:()=>assert.fail('No network call')});assert.equal(guard.summary().requests,11);assert.ok(Math.abs(guard.summary().estimatedUsd-.7937253)<1e-10);
  await assert.rejects(resumePlansOutput(f.store,await f.store.document('qa','plans',f.document.id),f.root),/already attempted/);
 }finally{await f.close();}
});

for(const kind of ['unknown-charge','tampered-response','changed-source','changed-prior-evidence','unexpected-checkpoint','active-job','changed-old-archive'])test('output recovery refuses '+kind+' before any mutation',async()=>{
 const f=await fixture();
 try{
  if(kind==='unknown-charge'){f.ledger.calls[10].status='charge-unknown';await privateJson(join(f.root,'cost.json'),f.ledger);}
  if(kind==='tampered-response')await writeFile(join(f.root,'responses/0011.json'),'{"request":{},"responseText":"changed"}');
  if(kind==='changed-source')await f.pool.query("UPDATE p5ds_pages SET native=jsonb_set(native,'{text}','\"Different source\"') WHERE page=4");
  if(kind==='changed-prior-evidence')await f.pool.query("UPDATE p5ds_pages SET evidence=jsonb_set(evidence,'{notes}','[\"Different note\"]') WHERE page=1");
  if(kind==='unexpected-checkpoint')await f.pool.query("UPDATE p5ds_jobs SET result='{}' WHERE id='read-4'");
  if(kind==='active-job')await f.pool.query("UPDATE p5ds_jobs SET state='running' WHERE id='read-5'");
  if(kind==='changed-old-archive')await privateJson(join(f.root,'plans-citation-recovery-v1.json'),{version:2});
  const before=(await f.pool.query('SELECT * FROM p5ds_jobs ORDER BY id')).rows,cost=await readFile(join(f.root,'cost.json'),'utf8');
  await assert.rejects(resumePlansOutput(f.store,f.document,f.root));
  assert.deepEqual((await f.pool.query('SELECT * FROM p5ds_jobs ORDER BY id')).rows,before);assert.equal(await readFile(join(f.root,'cost.json'),'utf8'),cost);
  await assert.rejects(readFile(join(f.root,'plans-page4-output-recovery-v1.json')),{code:'ENOENT'});
 }finally{await f.close();}
});
