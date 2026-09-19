import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {emptyFactFixture} from './support/plans-empty-fact-fixture.mjs';
import {resumePlansEmptyFact} from '../scripts/resume-plans-empty-fact.mjs';
import {resumePlansRepairEvidence} from '../scripts/resume-plans-repair-evidence.mjs';
import {privateJson} from '../scripts/model-qa-support.mjs';
import {hash,validateEvidence} from '../src/core.mjs';
import {Pipeline,reconcileVerification} from '../src/pipeline.mjs';
import {requestBody} from '../src/provider.mjs';
import {READER_SYSTEM,VERIFIER_SYSTEM,EVIDENCE_SCHEMA} from '../src/contracts.mjs';
import {CITATION_SYSTEM,CITATION_SCHEMA,citationInput,applyCitations} from '../src/evidence-citations.mjs';
import {SOURCE_REPAIR_SYSTEM,SOURCE_REPAIR_EVIDENCE_RULE,SOURCE_REPAIR_SCHEMA,prepareSourceRepair,applySourceRepairs} from '../src/evidence-source-repair.mjs';

async function fixture(){
 const f=await emptyFactFixture();await resumePlansEmptyFact(f.store,f.document,f.root);
 const pages=await f.store.pages(f.document.id,null,true),native5=pages[4].native,input5=[{...native5,image:undefined,spans:undefined}],c5=f.result.evidenceCheckpoint;
 const prepared5=prepareSourceRepair(c5.raw,input5,citationInput(c5.raw,input5),c5.repair);
 const repair5={facts:[],items:prepared5.input.rejectedStatements.map(s=>({key:s.key,statement:{...s.statement,evidence:'Synthetic source',basis:'uncertain'},reason:'Placement needs verification'})),regions:[]};
 const prior5=validateEvidence(applySourceRepairs(prepared5.grounded,input5,prepared5.rejected,repair5),input5).pages[0];
 const verified={pages:[structuredClone(prior5)]};verified.pages[0].items[0].quantity=2;verified.pages[0].items[0].basis='visual';
 for(const i of [3,4,5])verified.pages[0].facts[i].evidence='Wrong quote';
 const citations5=citationInput(verified,[native5]),cite5={citations:citations5.statements.map(s=>({key:s.key,supported:true,lines:[1]}))};
 const committed5=reconcileVerification(prior5,validateEvidence(applyCitations(verified,[native5],citations5,cite5),[native5]).pages[0]);
 const c7=f.result7.evidenceCheckpoint,prepared7=prepareSourceRepair(c7.raw,f.input7,citationInput(c7.raw,f.input7),c7.repair);
 const answer={facts:[{key:'7:facts:0',statement:{field:'otherDetails',value:'Square footage not stated on this sheet (elevation drawing does not provide sqft data)',evidence:'',basis:'uncertain'},reason:'Keep the missing source value explicit.'}],items:[],regions:[]};
 const oldSystem=SOURCE_REPAIR_SYSTEM.replace(SOURCE_REPAIR_EVIDENCE_RULE,''),systems=[oldSystem,VERIFIER_SYSTEM,CITATION_SYSTEM,oldSystem],inputs=[prepared5.input,{pages:[native5],prior:prior5},citations5,prepared7.input],schemas=[SOURCE_REPAIR_SCHEMA,EVIDENCE_SCHEMA,CITATION_SCHEMA,SOURCE_REPAIR_SCHEMA],purposes=['source-repair','verify','citation','source-repair'];
 const values=[repair5,verified,cite5,answer],usages=[[11722,6549],[35945,4777],[8706,96],[7341,181]],costs=[.104,.116,.019,.0130524];
 for(let i=0;i<4;i++){
  const request=requestBody('anthropic','claude-sonnet-5',systems[i],inputs[i],[],schemas[i],purposes[i]==='citation'?2048:10000,purposes[i]).body;
  const usage={input_tokens:usages[i][0],output_tokens:usages[i][1]},responseText=JSON.stringify({model:'claude-sonnet-5',stop_reason:'end_turn',usage,content:[{type:'text',text:JSON.stringify(values[i])}]}),requestSha256=hash(JSON.stringify(request)),responseFile='responses/'+String(25+i).padStart(4,'0')+'.json';
  f.ledger.calls.push({status:'usage-reported',usage,reservedUsd:costs[i],httpStatus:200,requestSha256,responseFile,responseSha256:hash(responseText)});
  await privateJson(join(f.root,responseFile),{request,requestSha256,httpStatus:200,responseText});
 }
 c7.sourceCorrectionStarted=true;c7.sourceCorrection=answer;
 await privateJson(join(f.root,'cost.json'),f.ledger);
 const report=JSON.parse(await readFile(join(f.root,'report.json'),'utf8'));report.error='unsupported-evidence';await privateJson(join(f.root,'report.json'),report);
 await f.pool.query("UPDATE p5ds_documents SET state='failed',error_code='unsupported-evidence' WHERE id=$1",[f.document.id]);
 await f.pool.query('UPDATE p5ds_pages SET evidence=$2 WHERE document_id=$1 AND page=5',[f.document.id,committed5]);
 await f.pool.query("UPDATE p5ds_jobs SET state='complete',attempts=2,error_code=null,result=$1 WHERE id='read-5'",[{pages:[5]}]);
 await f.pool.query("UPDATE p5ds_jobs SET state='failed',attempts=2,error_code='unsupported-evidence',result=$1 WHERE id='read-7'",[f.result7]);
 f.document=await f.store.document('qa','plans',f.document.id);return f;
}

test('28-call recovery archives the invalid correction and preserves six pages, original page7 read/citations and all charges',async()=>{
 const f=await fixture();
 try{
  const files=['cost.json',...Array.from({length:28},(_,i)=>'responses/'+String(i+1).padStart(4,'0')+'.json'),'plans-page7-empty-fact-v1.json'];
  const before=await Promise.all(files.map(p=>readFile(join(f.root,p),'utf8'))),pages=await f.store.pages(f.document.id,null,true),original=structuredClone(f.result7);
  await resumePlansRepairEvidence(f.store,f.document,f.root);
  assert.deepEqual(await Promise.all(files.map(p=>readFile(join(f.root,p),'utf8'))),before);assert.deepEqual(await f.store.pages(f.document.id,null,true),pages);
  const job=await f.store.claim(['read']);assert.equal(job.id,'read-7');assert.deepEqual(job.result.evidenceCheckpoint.raw,original.evidenceCheckpoint.raw);assert.deepEqual(job.result.evidenceCheckpoint.repair,original.evidenceCheckpoint.repair);assert.equal(job.result.evidenceCheckpoint.sourceCorrection,undefined);
  const purposes=[],pipeline=new Pipeline(f.store,{call:async(j,system,input,images,schema,signal,verify,purpose)=>{
   purposes.push(purpose);assert.equal(purpose,'source-repair');assert.ok(system.includes(SOURCE_REPAIR_EVIDENCE_RULE));
   const response=structuredClone(original.evidenceCheckpoint.sourceCorrection);response.facts[0].statement.evidence='Limitation: the original elevation sheet does not establish a floor-area value.';return response;
  }},{provider:'anthropic',model:'claude-sonnet-5',parserSlots:1});
  const result=await pipeline.evidence(job,READER_SYSTEM,f.input7,[],new AbortController().signal);assert.equal(result.pages[0].status,'partial');assert.deepEqual(purposes,['source-repair']);
  const archive=JSON.parse(await readFile(join(f.root,'plans-page7-repair-evidence-v1.json'),'utf8'));assert.equal(archive.previousLedger.calls.length,28);assert.deepEqual(archive.previousJobs.find(j=>j.id==='read-7').result,original);
  await assert.rejects(resumePlansRepairEvidence(f.store,await f.store.document('qa','plans',f.document.id),f.root),/already attempted/);
 }finally{await f.close();}
});
for(const kind of ['unknown-charge','changed-page5','changed-page7','changed-correction','active-job','tampered-cache','changed-attempt','changed-archive'])test('28-call recovery refuses '+kind+' without changing saved work',async()=>{
 const f=await fixture();
 try{
  if(kind==='unknown-charge'){f.ledger.calls[27].status='charge-unknown';await privateJson(join(f.root,'cost.json'),f.ledger);}
  if(kind==='changed-page5')await f.pool.query("UPDATE p5ds_pages SET evidence=jsonb_set(evidence,'{status}','\"read\"') WHERE document_id=$1 AND page=5",[f.document.id]);
  if(kind==='changed-page7'){f.result7.evidenceCheckpoint.raw.pages[0].facts[0].value='999';await f.pool.query("UPDATE p5ds_jobs SET result=$1 WHERE id='read-7'",[f.result7]);}
  if(kind==='changed-correction'){f.result7.evidenceCheckpoint.sourceCorrection.facts[0].statement.evidence='Changed';await f.pool.query("UPDATE p5ds_jobs SET result=$1 WHERE id='read-7'",[f.result7]);}
  if(kind==='active-job')await f.pool.query("UPDATE p5ds_jobs SET state='running' WHERE id='review'");
  if(kind==='changed-attempt')await f.pool.query("UPDATE p5ds_jobs SET attempts=3 WHERE id='read-7'");
  if(kind==='changed-archive')await privateJson(join(f.root,'plans-citation-recovery-v1.json'),{changed:true});
  if(kind==='tampered-cache'){const file=join(f.root,'responses/0028.json'),cache=JSON.parse(await readFile(file,'utf8'));cache.responseText='changed';await privateJson(file,cache);}
  const before=(await f.pool.query('SELECT * FROM p5ds_jobs ORDER BY id')).rows,cost=await readFile(join(f.root,'cost.json'),'utf8');
  await assert.rejects(resumePlansRepairEvidence(f.store,f.document,f.root));assert.deepEqual((await f.pool.query('SELECT * FROM p5ds_jobs ORDER BY id')).rows,before);assert.equal(await readFile(join(f.root,'cost.json'),'utf8'),cost);
  await assert.rejects(readFile(join(f.root,'plans-page7-repair-evidence-v1.json')),{code:'ENOENT'});
 }finally{await f.close();}
});
