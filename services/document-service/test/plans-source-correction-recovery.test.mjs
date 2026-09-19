import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {sourceRecoveryFixture} from './support/plans-source-fixture.mjs';
import {resumePlansSourceRepair} from '../scripts/resume-plans-source-repair.mjs';
import {resumePlansSourceCorrection} from '../scripts/resume-plans-source-correction.mjs';
import {privateJson} from '../scripts/model-qa-support.mjs';
import {hash} from '../src/core.mjs';
import {Pipeline} from '../src/pipeline.mjs';
import {requestBody} from '../src/provider.mjs';
import {READER_SYSTEM,VERIFIER_SYSTEM,EVIDENCE_SCHEMA} from '../src/contracts.mjs';
import {CITATION_SYSTEM,CITATION_SCHEMA,citationInput,evidenceCheckpointKey} from '../src/evidence-citations.mjs';

async function fixture(){
 const f=await sourceRecoveryFixture({page5Text:Array.from({length:460},(_,i)=>i===0?'Synthetic source':`Source line ${i+1}`).join('\n')});
 await resumePlansSourceRepair(f.store,f.document,f.root);
 const pages=await f.store.pages(f.document.id,null,true),native4=pages[3].native,native5=pages[4].native,input5=[{...native5,image:undefined,spans:undefined}];
 const page4={page:4,sheet:'',revision:'',status:'read',notes:[],facts:[{field:'site',value:'Synthetic source',evidence:'Synthetic source',basis:'stated'}],items:[],regions:[],inclusions:[],exclusions:[],responsibilities:[]};
 const page5={...structuredClone(page4),page:5,status:'partial',facts:Array.from({length:7},(_,i)=>({field:'otherDetails',value:'Synthetic statement '+i,evidence:[1,3,4,5].includes(i)?'Wrong quote':'Synthetic source',basis:'stated'})),items:Array.from({length:18},(_,i)=>({id:i===9?'WIN-2640C':i===10?'WIN-2646C':'item-'+i,description:'Synthetic source',component:'Window',building:'Main',floor:'Upper',quantity:null,unit:'count',evidence:[9,10].includes(i)?'Wrong quote':'Synthetic source',basis:'stated'}))};
 const raw={pages:[page5]},citations=citationInput(raw,[native5]),repair={citations:citations.statements.map(s=>({key:s.key,supported:!s.key.includes(':items:'),lines:s.key==='5:facts:5'?[427,441,425,443,445]:s.key.includes(':items:')?[]:[1]}))};
 const requests=[
  requestBody('anthropic','claude-sonnet-5',READER_SYSTEM,{pages:[native4]},[],EVIDENCE_SCHEMA,10000,'read-efficient').body,
  requestBody('anthropic','claude-sonnet-5',VERIFIER_SYSTEM,{pages:[native4],prior:page4},[],EVIDENCE_SCHEMA,10000,'verify').body,
  requestBody('anthropic','claude-sonnet-5',READER_SYSTEM,{pages:input5},[],EVIDENCE_SCHEMA,10000,'read').body,
  requestBody('anthropic','claude-sonnet-5',CITATION_SYSTEM,citations,[],CITATION_SCHEMA,2048,'citation').body
 ];
 const values=[{pages:[page4]},{pages:[page4]},raw,repair],usages=[{input_tokens:9999,output_tokens:4636},{input_tokens:59614,output_tokens:5774},{input_tokens:7665,output_tokens:3929},{input_tokens:9049,output_tokens:169}],costs=[.0731505,.1811155,.0614125,.019788];
 for(let i=0;i<4;i++){
  const request=requests[i],responseText=JSON.stringify({stop_reason:'end_turn',usage:usages[i],content:[{type:'text',text:JSON.stringify(values[i])}]}),requestSha256=hash(JSON.stringify(request)),responseFile='responses/'+String(15+i).padStart(4,'0')+'.json';
  f.ledger.calls.push({status:'usage-reported',usage:usages[i],reservedUsd:costs[i],httpStatus:200,requestSha256,responseFile,responseSha256:hash(responseText)});
  await privateJson(join(f.root,responseFile),{request,requestSha256,httpStatus:200,responseText});
 }
 const result={evidenceCheckpoint:{version:1,key:evidenceCheckpointKey({input:input5,provider:'anthropic',model:'claude-sonnet-5'},READER_SYSTEM,EVIDENCE_SCHEMA),raw,repairStarted:true,repair}};
 await privateJson(join(f.root,'cost.json'),f.ledger);
 const report=JSON.parse(await readFile(join(f.root,'report.json'),'utf8'));report.error='invalid-citation-line';await privateJson(join(f.root,'report.json'),report);
 await f.pool.query("UPDATE p5ds_documents SET state='failed',error_code='invalid-citation-line' WHERE id=$1",[f.document.id]);
 await f.pool.query('UPDATE p5ds_pages SET evidence=$2 WHERE document_id=$1 AND page=4',[f.document.id,page4]);
 await f.pool.query("UPDATE p5ds_jobs SET state='complete',attempts=4,error_code=null,result=$1 WHERE id='read-4'",[{pages:[4]}]);
 await f.pool.query("UPDATE p5ds_jobs SET state='failed',attempts=1,error_code='invalid-citation-line',result=$1 WHERE id='read-5'",[result]);
 await f.pool.query("UPDATE p5ds_jobs SET state='failed',attempts=11,error_code='source-reading-failed' WHERE id='review'");
 f.document=await f.store.document('qa','plans',f.document.id);return {...f,result,input5};
}

test('page-5 recovery retains its saved read and citations, all completed evidence and all eighteen charges',async()=>{
 const f=await fixture();
 try{
  const files=['cost.json',...Array.from({length:18},(_,i)=>'responses/'+String(i+1).padStart(4,'0')+'.json'),'plans-page4-source-recovery-v1.json'];
  const before=await Promise.all(files.map(p=>readFile(join(f.root,p),'utf8'))),pages=await f.store.pages(f.document.id,null,true);
  await resumePlansSourceCorrection(f.store,f.document,f.root);
  assert.deepEqual(await Promise.all(files.map(p=>readFile(join(f.root,p),'utf8'))),before);assert.deepEqual(await f.store.pages(f.document.id,null,true),pages);
  const recovered=await f.store.job('qa','plans','read-5');assert.deepEqual(recovered.result,f.result);assert.equal(recovered.attempts,1);
  const archive=JSON.parse(await readFile(join(f.root,'plans-page5-source-correction-v1.json'),'utf8'));assert.deepEqual(archive.previousLedger,f.ledger);assert.equal(archive.pageEvidence[3].evidence.status,'read');
  await assert.rejects(resumePlansSourceCorrection(f.store,await f.store.document('qa','plans',f.document.id),f.root),/already attempted/);
  await f.pool.query("UPDATE p5ds_jobs SET available_at=now()+interval '1 day' WHERE state='queued' AND id!='read-5'");
  const purposes=[],reader={call:async(job,system,input,images,schema,signal,verify,purpose)=>{
   purposes.push(purpose);
   if(purpose==='source-repair')return {facts:[],items:input.rejectedStatements.map(s=>({key:s.key,statement:{...s.statement,evidence:'Synthetic source'},reason:'Use the original literal source.'})),regions:[]};
   assert.equal(purpose,'citation','The saved initial read and citations must be reused');
   return {citations:input.statements.map(s=>({key:s.key,supported:true,lines:[1]}))};
  }};
  const pipeline=new Pipeline(f.store,reader,{provider:'anthropic',model:'claude-sonnet-5',parserSlots:1});
  await pipeline.evidence(await f.store.claim(['read']),READER_SYSTEM,f.input5,[],new AbortController().signal);
  assert.deepEqual(purposes,['source-repair','citation']);
 }finally{await f.close();}
});

for(const kind of ['unknown-charge','changed-page4','changed-page5','changed-citation','already-correcting','active-job','tampered-cache'])test('page-5 recovery refuses '+kind+' without changing saved work',async()=>{
 const f=await fixture();
 try{
  if(kind==='unknown-charge'){f.ledger.calls[17].status='charge-unknown';await privateJson(join(f.root,'cost.json'),f.ledger);}
  if(kind==='changed-page4')await f.pool.query("UPDATE p5ds_pages SET evidence=jsonb_set(evidence,'{status}','\"partial\"') WHERE document_id=$1 AND page=4",[f.document.id]);
  if(kind==='changed-page5'){f.result.evidenceCheckpoint.raw.pages[0].items[9].description='Changed';await f.pool.query("UPDATE p5ds_jobs SET result=$1 WHERE id='read-5'",[f.result]);}
  if(kind==='changed-citation'){f.result.evidenceCheckpoint.repair.citations[0].lines=[99];await f.pool.query("UPDATE p5ds_jobs SET result=$1 WHERE id='read-5'",[f.result]);}
  if(kind==='already-correcting'){f.result.evidenceCheckpoint.sourceCorrectionStarted=true;await f.pool.query("UPDATE p5ds_jobs SET result=$1 WHERE id='read-5'",[f.result]);}
  if(kind==='active-job')await f.pool.query("UPDATE p5ds_jobs SET state='running' WHERE id='review'");
  if(kind==='tampered-cache'){const file=join(f.root,'responses/0018.json'),cache=JSON.parse(await readFile(file,'utf8'));cache.responseText='changed';await privateJson(file,cache);}
  const before=(await f.pool.query('SELECT * FROM p5ds_jobs ORDER BY id')).rows,cost=await readFile(join(f.root,'cost.json'),'utf8');
  await assert.rejects(resumePlansSourceCorrection(f.store,f.document,f.root));
  assert.deepEqual((await f.pool.query('SELECT * FROM p5ds_jobs ORDER BY id')).rows,before);assert.equal(await readFile(join(f.root,'cost.json'),'utf8'),cost);
  await assert.rejects(readFile(join(f.root,'plans-page5-source-correction-v1.json')),{code:'ENOENT'});
 }finally{await f.close();}
});
