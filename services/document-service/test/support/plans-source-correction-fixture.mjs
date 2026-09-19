import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {sourceRecoveryFixture} from './plans-source-fixture.mjs';
import {resumePlansSourceRepair} from '../../scripts/resume-plans-source-repair.mjs';
import {privateJson} from '../../scripts/model-qa-support.mjs';
import {hash} from '../../src/core.mjs';
import {requestBody} from '../../src/provider.mjs';
import {READER_SYSTEM,VERIFIER_SYSTEM,EVIDENCE_SCHEMA} from '../../src/contracts.mjs';
import {CITATION_SYSTEM,CITATION_SCHEMA,citationInput,evidenceCheckpointKey} from '../../src/evidence-citations.mjs';

export async function sourceCorrectionFixture(options={}){
 const f=await sourceRecoveryFixture({...options,page5Text:Array.from({length:460},(_,i)=>i===0?'Synthetic source':`Source line ${i+1}`).join('\n')});
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

