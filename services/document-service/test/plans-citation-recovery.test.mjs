import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {isolatedPool,privateJson,guardedSonnetFetch} from '../scripts/model-qa-support.mjs';
import {resumePlansCitation} from '../scripts/resume-plans-citation.mjs';
import {Store} from '../src/store.mjs';
import {hash} from '../src/core.mjs';
import {applyCitations,citationInput} from '../src/evidence-citations.mjs';

const digest='4565acfa74cc3590fc2c7b2baf532c99a069c9a572448de8a6f599a7cf135786';
const claim="5' PUID easements on north and south property lines; unverified fill zone along east/rear property line";
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'p5-plans-recovery-'));
 const pool=await isolatedPool(),store=new Store(pool,{maxTenantBytes:1000000,maxQueue:30});await store.init();
 const {document}=await store.putDocument('qa','plans','synthetic.pdf',Buffer.from('%PDF synthetic'));
 await pool.query("UPDATE p5ds_documents SET digest=$2,state='failed',error_code='unsupported-source-statement',page_count=23 WHERE id=$1",[document.id,digest]);
 await pool.query("UPDATE p5ds_jobs SET state='complete',attempts=1 WHERE document_id=$1",[document.id]);
 const raw={pages:[{page:3,status:'read',facts:Array.from({length:8},(_,i)=>({field:'site',value:i===7?claim:'Source label',basis:'stated',evidence:i===7?'Combined spatial description':'5\u0027 PUID EASEMENT'})),items:[],notes:[],regions:[],inclusions:[],exclusions:[],responsibilities:[],sheet:'A1.1',revision:''}]};
 const result={evidenceCheckpoint:{version:1,key:'old-source-prompt-key',raw,repairStarted:true,repair:{citations:[{key:'3:facts:7',supported:false,lines:[]}]}}};
 for(let page=1;page<=23;page++){
  const native={page,kind:'drawing',textQuality:1,text:"5' PUID EASEMENT\nUNVERIFIED FILL ZONE",spans:[{text:'retained',x:1,y:1}]};
  await pool.query('INSERT INTO p5ds_pages(document_id,page,native,image,evidence) VALUES($1,$2,$3,$4,$5)',[document.id,page,native,Buffer.from('saved-image-'+page),page<3?{page,status:'partial',notes:['Unresolved original detail'],facts:[],items:[],regions:[]}:null]);
  await store.enqueue(pool,{id:'read-'+page,tenant:'qa',project:'plans',kind:'read',documentId:document.id,payload:{pages:[page]}});
  if(page<=3)await pool.query('UPDATE p5ds_jobs SET state=$2,attempts=2,error_code=$3,result=$4 WHERE id=$1',['read-'+page,page<3?'complete':'failed',page<3?null:'unsupported-source-statement',page===3?result:{pages:[page]}]);
 }
 await store.enqueue(pool,{id:'review',tenant:'qa',project:'plans',kind:'review',payload:{documents:[{id:document.id,source:'synthetic.pdf'}],text:'Synthetic fixture',answers:{}}});
 await pool.query("UPDATE p5ds_jobs SET state='failed',error_code='source-reading-failed',attempts=3 WHERE id='review'");
 const calls=[];
 for(let i=0;i<7;i++){
  const request={model:'claude-sonnet-5',messages:[{role:'user',content:'Synthetic '+i}]};
  const responseText=JSON.stringify({usage:{input_tokens:1,output_tokens:1},content:[]}),requestSha256=hash(JSON.stringify(request));
  const responseFile='responses/'+String(i+1).padStart(4,'0')+'.json';
  calls.push({status:'usage-reported',usage:{input_tokens:1,output_tokens:1},reservedUsd:i===6?.551956:0,httpStatus:200,requestSha256,responseFile,responseSha256:hash(responseText)});
  await privateJson(join(root,responseFile),{request,requestSha256,httpStatus:200,responseText});
 }
 const ledger={version:1,model:'claude-sonnet-5',paused:false,calls};
 await privateJson(join(root,'cost.json'),ledger);
 await privateJson(join(root,'report.json'),{id:'plans',sourceSha256:digest,expectedPages:23,complete:false,error:'unsupported-source-statement'});
 return {root,pool,store,document:await store.document('qa','plans',document.id),ledger,result,close:async()=>{await pool.end();await rm(root,{recursive:true,force:true});}};
}

test('inspected plans recovery preserves pages, charges, caches and strict validation; only failed work is reset once',async()=>{
 const f=await fixture();
 try{
  const pages=await f.store.pages(f.document.id,null,true),cost=await readFile(join(f.root,'cost.json'),'utf8'),response=await readFile(join(f.root,'responses','0007.json'),'utf8');
  const complete=(await f.pool.query("SELECT * FROM p5ds_jobs WHERE state='complete' ORDER BY id")).rows;
  assert.equal(await resumePlansCitation(f.store,f.document,f.root),true);
  assert.deepEqual(await f.store.pages(f.document.id,null,true),pages);
  assert.equal(await readFile(join(f.root,'cost.json'),'utf8'),cost);
  assert.equal(await readFile(join(f.root,'responses','0007.json'),'utf8'),response);
  assert.deepEqual((await f.pool.query("SELECT * FROM p5ds_jobs WHERE state='complete' ORDER BY id")).rows,complete);
  const job=await f.store.job('qa','plans','read-3');assert.equal(job.state,'queued');assert.equal(job.result,null);assert.equal(job.attempts,2);
  const archive=JSON.parse(await readFile(join(f.root,'plans-citation-recovery-v1.json'),'utf8'));
  assert.deepEqual(archive.previousLedger,f.ledger);assert.deepEqual(archive.previousJobs.find(j=>j.id==='read-3').result,f.result);
  assert.equal(archive.pageEvidence.length,2);assert.ok(archive.pageEvidence.every(p=>p.evidence.status==='partial'));
  assert.equal((await f.store.document('qa','plans',f.document.id)).state,'prepared');
  const native=pages[2].native,raw=f.result.evidenceCheckpoint.raw;
  assert.throws(()=>applyCitations(raw,[native],citationInput(raw,[native]),f.result.evidenceCheckpoint.repair),/unsupported-source-statement/);
  const guard=await guardedSonnetFetch({file:join(f.root,'cost.json'),limitUsd:3,maxCalls:64,request:()=>{throw Error('No provider call permitted');}});
  assert.equal(guard.summary().estimatedUsd,.551956);assert.equal(guard.summary().requests,7);
  await assert.rejects(resumePlansCitation(f.store,await f.store.document('qa','plans',f.document.id),f.root),/already attempted/);
 }finally{await f.close();}
});

for(const kind of ['unknown-charge','tampered-cache','changed-statement','active-job','changed-page-status'])test('plans recovery refuses '+kind+' without changing database or ledger',async()=>{
 const f=await fixture();
 try{
  if(kind==='unknown-charge'){f.ledger.calls[6].status='charge-unknown';await privateJson(join(f.root,'cost.json'),f.ledger);}
  if(kind==='tampered-cache')await writeFile(join(f.root,'responses','0007.json'),'{"request":{},"responseText":"tampered"}');
  if(kind==='changed-statement'){f.result.evidenceCheckpoint.raw.pages[0].facts[7].value='Different failure';await f.pool.query("UPDATE p5ds_jobs SET result=$1 WHERE id='read-3'",[f.result]);}
  if(kind==='active-job')await f.pool.query("UPDATE p5ds_jobs SET state='running' WHERE id='read-4'");
  if(kind==='changed-page-status')await f.pool.query("UPDATE p5ds_pages SET evidence=jsonb_set(evidence,'{status}','\"read\"') WHERE document_id=$1 AND page=1",[f.document.id]);
  const before=(await f.pool.query('SELECT * FROM p5ds_jobs ORDER BY id')).rows,cost=await readFile(join(f.root,'cost.json'),'utf8');
  await assert.rejects(resumePlansCitation(f.store,f.document,f.root));
  assert.deepEqual((await f.pool.query('SELECT * FROM p5ds_jobs ORDER BY id')).rows,before);
  assert.equal(await readFile(join(f.root,'cost.json'),'utf8'),cost);
  await assert.rejects(readFile(join(f.root,'plans-citation-recovery-v1.json')),{code:'ENOENT'});
 }finally{await f.close();}
});
