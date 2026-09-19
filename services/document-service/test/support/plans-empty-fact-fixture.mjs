import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {sourceCorrectionFixture} from './plans-source-correction-fixture.mjs';
import {resumePlansSourceCorrection} from '../../scripts/resume-plans-source-correction.mjs';
import {privateJson} from '../../scripts/model-qa-support.mjs';
import {hash} from '../../src/core.mjs';
import {requestBody} from '../../src/provider.mjs';
import {READER_SYSTEM,VERIFIER_SYSTEM,EVIDENCE_SCHEMA} from '../../src/contracts.mjs';
import {CITATION_SYSTEM,CITATION_SCHEMA,citationInput,evidenceCheckpointKey} from '../../src/evidence-citations.mjs';
import {SOURCE_REPAIR_SYSTEM,SOURCE_REPAIR_SCHEMA} from '../../src/evidence-source-repair.mjs';

export async function emptyFactFixture(){
 const f=await sourceCorrectionFixture({page7Text:Array.from({length:70},(_,i)=>i===0?'Synthetic source':`Source line ${i+1}`).join('\n')});
 await resumePlansSourceCorrection(f.store,f.document,f.root);
 const pages=await f.store.pages(f.document.id,null,true),native6=pages[5].native,native7=pages[6].native,input7=[{...native7,image:undefined,spans:undefined}];
 const page6={page:6,sheet:'',revision:'',status:'read',notes:[],facts:[{field:'otherDetails',value:'Synthetic source',evidence:'Synthetic source',basis:'stated'}],items:[],regions:[],inclusions:[],exclusions:[],responsibilities:[]};
 const page7={...structuredClone(page6),page:7,status:'partial',facts:Array.from({length:7},(_,i)=>i===0?{field:'sqft',value:'',evidence:'',basis:'uncertain'}:{field:'otherDetails',value:'Synthetic fact '+i,evidence:i>=5?'Wrong quote':'Synthetic source',basis:'stated'}),items:Array.from({length:17},(_,i)=>({id:'item-'+i,description:'Synthetic source',component:'Trim',building:'Main',floor:'First',quantity:null,unit:'count',evidence:'Synthetic source',basis:'stated'})),regions:[{x:0,y:0,width:.2,height:.2,reason:'Detail one'},{x:.3,y:.3,width:.2,height:.2,reason:'Detail two'}]};
 const raw={pages:[page7]},repair={citations:[{key:'7:facts:5',supported:true,lines:[31,65]},{key:'7:facts:6',supported:true,lines:[51,53]}]};
 const inputs=[{pages:[native6]}, {source:[],statements:[]}, {pages:[native6],draft:{pages:[page6]},rejectedStatements:[]}, {pages:[native6],prior:page6},{pages:input7},citationInput(raw,input7)];
 const systems=[READER_SYSTEM,CITATION_SYSTEM,SOURCE_REPAIR_SYSTEM,VERIFIER_SYSTEM,READER_SYSTEM,CITATION_SYSTEM],purposes=['read','citation','source-repair','verify','read','citation'];
 const values=[{pages:[page6]},{citations:[]},{facts:[],items:[],regions:[]},{pages:[page6]},raw,repair],usages=[[4852,4642],[2642,125],[7931,2701],[22539,5823],[4698,2875],[2032,63]],costs=[.05,.006,.045,.13,.032,.0042789];
 for(let i=0;i<6;i++){
  const schema=purposes[i]==='citation'?CITATION_SCHEMA:purposes[i]==='source-repair'?SOURCE_REPAIR_SCHEMA:EVIDENCE_SCHEMA;
  const request=requestBody('anthropic','claude-sonnet-5',systems[i],inputs[i],[],schema,purposes[i]==='citation'?2048:10000,purposes[i]).body;
  const usage={input_tokens:usages[i][0],output_tokens:usages[i][1]},responseText=JSON.stringify({model:'claude-sonnet-5',stop_reason:'end_turn',usage,content:[{type:'text',text:JSON.stringify(values[i])}]}),requestSha256=hash(JSON.stringify(request)),responseFile='responses/'+String(19+i).padStart(4,'0')+'.json';
  f.ledger.calls.push({status:'usage-reported',usage,reservedUsd:costs[i],httpStatus:200,requestSha256,responseFile,responseSha256:hash(responseText)});
  await privateJson(join(f.root,responseFile),{request,requestSha256,httpStatus:200,responseText});
 }
 const result7={evidenceCheckpoint:{version:1,key:evidenceCheckpointKey({input:input7,provider:'anthropic',model:'claude-sonnet-5'},READER_SYSTEM,EVIDENCE_SCHEMA),raw,repairStarted:true,repair}};
 await privateJson(join(f.root,'cost.json'),f.ledger);
 const report=JSON.parse(await readFile(join(f.root,'report.json'),'utf8'));report.error='empty-source-fact';await privateJson(join(f.root,'report.json'),report);
 await f.pool.query("UPDATE p5ds_documents SET state='failed',error_code='empty-source-fact' WHERE id=$1",[f.document.id]);
 await f.pool.query('UPDATE p5ds_pages SET evidence=$2 WHERE document_id=$1 AND page=6',[f.document.id,page6]);
 await f.pool.query("UPDATE p5ds_jobs SET state='complete',attempts=1,error_code=null,result=$1 WHERE id='read-6'",[{pages:[6]}]);
 // The inspected old runtime tied page 5 with untouched pages; recreate it.
 await f.pool.query("UPDATE p5ds_jobs SET priority=5 WHERE id='read-5'");
 await f.pool.query("UPDATE p5ds_jobs SET state='failed',attempts=1,error_code='empty-source-fact',result=$1 WHERE id='read-7'",[result7]);
 await f.pool.query("UPDATE p5ds_jobs SET state='failed',attempts=14,priority=2,error_code='source-reading-failed' WHERE id='review'");
 f.document=await f.store.document('qa','plans',f.document.id);return {...f,result7,input7};
}

