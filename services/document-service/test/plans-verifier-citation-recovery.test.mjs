import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {repairEvidenceFixture} from './support/plans-repair-evidence-fixture.mjs';
import {resumePlansRepairEvidence} from '../scripts/resume-plans-repair-evidence.mjs';
import {resumePlansVerifierCitation} from '../scripts/resume-plans-verifier-citation.mjs';
import {privateJson} from '../scripts/model-qa-support.mjs';
import {hash,validateEvidence} from '../src/core.mjs';
import {Pipeline,reconcileVerification} from '../src/pipeline.mjs';
import {requestBody} from '../src/provider.mjs';
import {READER_SYSTEM,VERIFIER_SYSTEM,EVIDENCE_SCHEMA} from '../src/contracts.mjs';
import {CITATION_SYSTEM,CITATION_SCHEMA,citationInput,applyCitations,evidenceCheckpointKey} from '../src/evidence-citations.mjs';
import {SOURCE_REPAIR_SYSTEM,SOURCE_REPAIR_SCHEMA,prepareSourceRepair,applySourceRepairs} from '../src/evidence-source-repair.mjs';
import {SPAN_COORDINATES} from '../src/page-geometry.mjs';
async function fixture(){
 const f=await repairEvidenceFixture({page8Text:Array.from({length:85},(_,i)=>i===0?'Synthetic source':`Source line ${i+1}`).join('\n')});
 await resumePlansRepairEvidence(f.store,f.document,f.root);
 const pages=await f.store.pages(f.document.id,null,true),native7={...pages[6].native,spanCoordinates:SPAN_COORDINATES},native8=pages[7].native,verifyNative8={...native8,spanCoordinates:SPAN_COORDINATES},input8=[{...native8,image:undefined,spans:undefined}];
 const cp7=f.result7.evidenceCheckpoint,prepared7=prepareSourceRepair(cp7.raw,f.input7,citationInput(cp7.raw,f.input7),cp7.repair),answer7=structuredClone(cp7.sourceCorrection);answer7.facts[0].statement.evidence='Limitation: the elevation does not establish a floor area.';
 const prior7=validateEvidence(applySourceRepairs(prepared7.grounded,f.input7,prepared7.rejected,answer7),f.input7).pages[0],verify7={pages:[structuredClone(prior7)]};verify7.pages[0].regions=[];
 for(const i of [7,8]){verify7.pages[0].items[i].quantity=15;verify7.pages[0].items[i].basis='visual';}
 const committed7=reconcileVerification(prior7,validateEvidence(structuredClone(verify7),[native7]).pages[0]);
 const page8={page:8,sheet:'',revision:'',status:'partial',notes:[],facts:Array.from({length:3},(_,i)=>({field:'otherDetails',value:'Synthetic fact '+i,evidence:i===1?'Wrong quote':'Synthetic source',basis:'stated'})),items:Array.from({length:4},(_,i)=>({id:i===2?'BS3-Section1':'item-'+i,description:'Synthetic source',building:'Main',floor:'Main/Upper',component:'Section',quantity:null,unit:'',evidence:'Synthetic source',basis:'stated'})),regions:[.1,.3,.5].map(x=>({x,y:.1,width:.1,height:.1,reason:'Drawing detail'})),inclusions:[],exclusions:[],responsibilities:[]};
 const raw8={pages:[page8]},repair8={citations:[{key:'8:facts:1',supported:true,lines:[48,82]}]},readCitations=citationInput(raw8,input8),prior8=validateEvidence(applyCitations(raw8,input8,readCitations,repair8),input8).pages[0];
 const verify8={pages:[structuredClone(prior8)]};verify8.pages[0].facts[1].evidence='Wrong quote';verify8.pages[0].items[2].evidence='Unsupported assignment';verify8.pages[0].items[2].description='Unsupported room dimension assignment';
 const verifyCitations=citationInput(verify8,[verifyNative8]),verifyRepair={citations:[{key:'8:facts:1',supported:true,lines:[48,82]},{key:'8:items:2',supported:false,lines:[]}]};
 const verifyInput={pages:[verifyNative8],prior:prior8};
 const systems=[SOURCE_REPAIR_SYSTEM,VERIFIER_SYSTEM,READER_SYSTEM,CITATION_SYSTEM,VERIFIER_SYSTEM,CITATION_SYSTEM],inputs=[prepared7.input,{pages:[native7],prior:prior7},{pages:input8},readCitations,verifyInput,verifyCitations],schemas=[SOURCE_REPAIR_SCHEMA,EVIDENCE_SCHEMA,EVIDENCE_SCHEMA,CITATION_SCHEMA,EVIDENCE_SCHEMA,CITATION_SCHEMA],purposes=['source-repair','verify','read','citation','verify','citation'];
 const values=[answer7,verify7,raw8,repair8,verify8,verifyRepair],usages=[[7341,309],[15375,7647],[4918,1413],[2414,36],[20621,4316],[2698,59]],costs=[.02,.12,.027,.005,.082,.0062408];
 for(let i=0;i<6;i++){
  const request=requestBody('anthropic','claude-sonnet-5',systems[i],inputs[i],[],schemas[i],purposes[i]==='citation'?2048:10000,purposes[i]).body;
  const usage={input_tokens:usages[i][0],output_tokens:usages[i][1]},responseText=JSON.stringify({model:'claude-sonnet-5',stop_reason:'end_turn',usage,content:[{type:'text',text:JSON.stringify(values[i])}]}),requestSha256=hash(JSON.stringify(request)),responseFile='responses/'+String(29+i).padStart(4,'0')+'.json';
  f.ledger.calls.push({status:'usage-reported',usage,reservedUsd:costs[i],httpStatus:200,requestSha256,responseFile,responseSha256:hash(responseText)});await privateJson(join(f.root,responseFile),{request,requestSha256,httpStatus:200,responseText});
 }
 const result8={evidenceCheckpoint:{version:1,key:evidenceCheckpointKey({input:input8,provider:'anthropic',model:'claude-sonnet-5'},READER_SYSTEM,EVIDENCE_SCHEMA),raw:raw8,repairStarted:true,repair:repair8},verificationCheckpoints:{'verify-8':{version:1,key:evidenceCheckpointKey({input:[verifyNative8],prior:prior8,provider:'anthropic',model:'claude-sonnet-5'},VERIFIER_SYSTEM,EVIDENCE_SCHEMA),raw:verify8,repairStarted:true,repair:verifyRepair}}};
 await privateJson(join(f.root,'cost.json'),f.ledger);const report=JSON.parse(await readFile(join(f.root,'report.json'),'utf8'));report.error='unsupported-source-statement';await privateJson(join(f.root,'report.json'),report);
 await f.pool.query("UPDATE p5ds_documents SET state='failed',error_code='unsupported-source-statement' WHERE id=$1",[f.document.id]);
 await f.pool.query('UPDATE p5ds_pages SET evidence=$2 WHERE document_id=$1 AND page=7',[f.document.id,committed7]);
 await f.pool.query("UPDATE p5ds_jobs SET state='complete',attempts=3,error_code=null,result=$1 WHERE id='read-7'",[{pages:[7]}]);
 await f.pool.query("UPDATE p5ds_jobs SET state='failed',attempts=1,error_code='unsupported-source-statement',result=$1 WHERE id='read-8'",[result8]);
 await f.pool.query("UPDATE p5ds_jobs SET state='failed',attempts=16,error_code='source-reading-failed' WHERE id='review'");
 f.document=await f.store.document('qa','plans',f.document.id);return {...f,result8,verifyNative8,prior8};
}

test('34-call recovery preserves both page8 stages and seven completed pages, then corrects only rejected verifier text',async()=>{
 const f=await fixture();
 try{
  const files=['cost.json',...Array.from({length:34},(_,i)=>'responses/'+String(i+1).padStart(4,'0')+'.json'),'plans-page7-repair-evidence-v1.json'];
  const before=await Promise.all(files.map(p=>readFile(join(f.root,p),'utf8'))),pages=await f.store.pages(f.document.id,null,true);
  await resumePlansVerifierCitation(f.store,f.document,f.root);
  assert.deepEqual(await Promise.all(files.map(p=>readFile(join(f.root,p),'utf8'))),before);assert.deepEqual(await f.store.pages(f.document.id,null,true),pages);
  const job=await f.store.claim(['read']);assert.equal(job.id,'read-8');assert.deepEqual(job.result,f.result8);
  const purposes=[],pipeline=new Pipeline(f.store,{call:async(j,system,input,images,schema,signal,verify,purpose)=>{
   purposes.push(purpose);assert.equal(verify,true);
   if(purpose==='source-repair')return {facts:[],items:[{key:'8:items:2',statement:{...input.rejectedStatements[0].statement,description:'Synthetic source',evidence:'Synthetic source'},reason:'Remove unsupported placement claims'}],regions:[]};
   assert.equal(purpose,'citation');return {citations:input.statements.map(s=>({key:s.key,supported:true,lines:[1]}))};
  }},{provider:'anthropic',model:'claude-sonnet-5',verifyModel:'claude-sonnet-5',parserSlots:1});
  await pipeline.evidence(job,VERIFIER_SYSTEM,[f.verifyNative8],[],new AbortController().signal,true,'verify-8',f.prior8);assert.deepEqual(purposes,['source-repair','citation']);
  const archive=JSON.parse(await readFile(join(f.root,'plans-page8-verifier-citation-v1.json'),'utf8'));assert.equal(archive.previousLedger.calls.length,34);assert.deepEqual(archive.previousJobs.find(j=>j.id==='read-8').result,f.result8);
  await assert.rejects(resumePlansVerifierCitation(f.store,await f.store.document('qa','plans',f.document.id),f.root),/already attempted/);
 }finally{await f.close();}
});
for(const kind of ['unknown-charge','changed-page7','changed-read','changed-verifier','already-correcting','active-job','tampered-cache','changed-attempt'])test('34-call recovery refuses '+kind+' without changing saved work',async()=>{
 const f=await fixture();
 try{
  if(kind==='unknown-charge'){f.ledger.calls[33].status='charge-unknown';await privateJson(join(f.root,'cost.json'),f.ledger);}
  if(kind==='changed-page7')await f.pool.query("UPDATE p5ds_pages SET evidence=jsonb_set(evidence,'{status}','\"read\"') WHERE document_id=$1 AND page=7",[f.document.id]);
  if(kind==='changed-read'){f.result8.evidenceCheckpoint.raw.pages[0].items[0].description='Changed';await f.pool.query("UPDATE p5ds_jobs SET result=$1 WHERE id='read-8'",[f.result8]);}
  if(kind==='changed-verifier'){f.result8.verificationCheckpoints['verify-8'].repair.citations[1].supported=true;await f.pool.query("UPDATE p5ds_jobs SET result=$1 WHERE id='read-8'",[f.result8]);}
  if(kind==='already-correcting'){f.result8.verificationCheckpoints['verify-8'].sourceCorrectionStarted=true;await f.pool.query("UPDATE p5ds_jobs SET result=$1 WHERE id='read-8'",[f.result8]);}
  if(kind==='active-job')await f.pool.query("UPDATE p5ds_jobs SET state='running' WHERE id='review'");
  if(kind==='changed-attempt')await f.pool.query("UPDATE p5ds_jobs SET attempts=2 WHERE id='read-8'");
  if(kind==='tampered-cache'){const file=join(f.root,'responses/0034.json'),cache=JSON.parse(await readFile(file,'utf8'));cache.responseText='changed';await privateJson(file,cache);}
  const before=(await f.pool.query('SELECT * FROM p5ds_jobs ORDER BY id')).rows,cost=await readFile(join(f.root,'cost.json'),'utf8');
  await assert.rejects(resumePlansVerifierCitation(f.store,f.document,f.root));assert.deepEqual((await f.pool.query('SELECT * FROM p5ds_jobs ORDER BY id')).rows,before);assert.equal(await readFile(join(f.root,'cost.json'),'utf8'),cost);
  await assert.rejects(readFile(join(f.root,'plans-page8-verifier-citation-v1.json')),{code:'ENOENT'});
 }finally{await f.close();}
});
