import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {outputFixture} from './plans-output-fixture.mjs';
import {resumePlansOutput} from '../../scripts/resume-plans-output.mjs';
import {privateJson} from '../../scripts/model-qa-support.mjs';
import {hash} from '../../src/core.mjs';
import {requestBody} from '../../src/provider.mjs';
import {READER_SYSTEM,EVIDENCE_SCHEMA} from '../../src/contracts.mjs';
import {CITATION_SYSTEM,CITATION_SCHEMA,citationInput,evidenceCheckpointKey} from '../../src/evidence-citations.mjs';

export async function citationOutputFixture(){
 const f=await outputFixture();await resumePlansOutput(f.store,f.document,f.root);
 const native=(await f.store.pages(f.document.id))[3].native,input=[{...native,image:undefined,spans:undefined}];
 const raw={pages:[{page:4,sheet:'',revision:'',status:'read',notes:[],facts:[{field:'site',value:'Synthetic source',evidence:'Incorrect citation',basis:'stated'}],items:[],regions:[],inclusions:[],exclusions:[],responsibilities:[]}]};
 const result={readProfile:'low-effort-v1',readProfileReason:'provider-output-limit',lowReadStarted:true,evidenceCheckpoint:{version:1,key:evidenceCheckpointKey({input,provider:'anthropic',model:'claude-sonnet-5',readProfile:'low-effort-v1'},READER_SYSTEM,EVIDENCE_SCHEMA),raw,repairStarted:true}};
 const requests=[requestBody('anthropic','claude-sonnet-5',READER_SYSTEM,{pages:input},[],EVIDENCE_SCHEMA,10000,'read-efficient').body,requestBody('anthropic','claude-sonnet-5',CITATION_SYSTEM,citationInput(raw,[native]),[],CITATION_SCHEMA,2048,'citation').body];
 delete requests[1].thinking; // Exact historical request before the correction.
 const responses=[{stop_reason:'end_turn',usage:{input_tokens:9999,output_tokens:5740},content:[{type:'text',text:JSON.stringify(raw)}]},{stop_reason:'max_tokens',usage:{input_tokens:20308,output_tokens:2048,output_tokens_details:{thinking_tokens:2048}},content:[{type:'thinking',thinking:''}]}];
 const ledger=JSON.parse(await readFile(join(f.root,'cost.json'),'utf8'));
 for(let n=0;n<2;n++){
  const request=requests[n],responseText=JSON.stringify(responses[n]),requestSha256=hash(JSON.stringify(request)),responseFile='responses/'+String(12+n).padStart(4,'0')+'.json';
  ledger.calls.push({status:'usage-reported',usage:responses[n].usage,reservedUsd:n===0?.0835955:.061096,httpStatus:200,requestSha256,responseFile,responseSha256:hash(responseText)});
  await privateJson(join(f.root,responseFile),{request,requestSha256,httpStatus:200,responseText});
 }
 await privateJson(join(f.root,'cost.json'),ledger);
 await f.pool.query("UPDATE p5ds_documents SET state='failed',error_code='provider-output-limit' WHERE id=$1",[f.document.id]);
 await f.pool.query("UPDATE p5ds_jobs SET state='failed',attempts=2,error_code='provider-output-limit',result=$1 WHERE id='read-4'",[result]);
 f.document=await f.store.document('qa','plans',f.document.id);return {...f,ledger,result};
}

