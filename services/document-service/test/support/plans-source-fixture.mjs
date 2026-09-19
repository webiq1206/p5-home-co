import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {citationOutputFixture} from './plans-citation-output-fixture.mjs';
import {resumePlansCitationOutput} from '../../scripts/resume-plans-citation-output.mjs';
import {privateJson} from '../../scripts/model-qa-support.mjs';
import {hash} from '../../src/core.mjs';
import {requestBody} from '../../src/provider.mjs';
import {CITATION_SYSTEM,CITATION_SCHEMA,citationInput} from '../../src/evidence-citations.mjs';

const rejected=new Set(['4:facts:1','4:items:0','4:items:1','4:items:7','4:items:10','4:items:12','4:items:23','4:items:42']);
export async function sourceRecoveryFixture(options){
 const f=await citationOutputFixture(options),raw=f.result.evidenceCheckpoint.raw,page=raw.pages[0],native=(await f.store.pages(f.document.id))[3].native;
 page.status='partial';page.facts=[{field:'site',value:'Synthetic source',basis:'stated',evidence:'Wrong quote'},{field:'projectMonths',value:'',basis:'stated',evidence:'Drawing issue date'},{field:'otherDetails',value:'Synthetic detail',basis:'stated',evidence:'Wrong quote'}];
 page.items=Array.from({length:45},(_,i)=>({id:'item-'+i,description:'Synthetic work',building:'Main',floor:'Main level',component:'Trim',quantity:null,unit:'',basis:'stated',evidence:'Wrong quote'}));
 const caches=await Promise.all([12,13].map(n=>readFile(join(f.root,'responses/'+String(n).padStart(4,'0')+'.json'),'utf8').then(JSON.parse)));
 const complete=JSON.parse(caches[0].responseText);complete.content[0].text=JSON.stringify(raw);caches[0].responseText=JSON.stringify(complete);
 caches[1].request.messages[0].content[0].text=JSON.stringify(citationInput(raw,[native]));
 for(let i=0;i<2;i++){
  const cache=caches[i],call=f.ledger.calls[11+i];cache.requestSha256=hash(JSON.stringify(cache.request));call.requestSha256=cache.requestSha256;call.responseSha256=hash(cache.responseText);
  await privateJson(join(f.root,call.responseFile),cache);
 }
 await privateJson(join(f.root,'cost.json'),f.ledger);await f.pool.query("UPDATE p5ds_jobs SET result=$1 WHERE id='read-4'",[f.result]);
 await resumePlansCitationOutput(f.store,f.document,f.root);
 const repair={citations:citationInput(raw,[native]).statements.map(s=>({key:s.key,supported:!rejected.has(s.key),lines:rejected.has(s.key)?[]:[1]}))};
 const request=requestBody('anthropic','claude-sonnet-5',CITATION_SYSTEM,citationInput(raw,[native]),[],CITATION_SCHEMA,2048,'citation').body;
 const response={stop_reason:'end_turn',usage:{input_tokens:20308,output_tokens:1142},content:[{type:'text',text:JSON.stringify(repair)}]},responseText=JSON.stringify(response),requestSha256=hash(JSON.stringify(request));
 const call={status:'usage-reported',usage:response.usage,reservedUsd:.052036,httpStatus:200,requestSha256,responseFile:'responses/0014.json',responseSha256:hash(responseText)};
 f.ledger.calls.push(call);await privateJson(join(f.root,call.responseFile),{request,requestSha256,httpStatus:200,responseText});await privateJson(join(f.root,'cost.json'),f.ledger);
 f.result.evidenceCheckpoint.repair=repair;
 await f.pool.query("UPDATE p5ds_jobs SET state='failed',attempts=3,error_code='unsupported-source-statement',result=$1 WHERE id='read-4'",[f.result]);
 await f.pool.query("UPDATE p5ds_documents SET state='failed',error_code='unsupported-source-statement' WHERE id=$1",[f.document.id]);
 const report=JSON.parse(await readFile(join(f.root,'report.json'),'utf8'));report.error='unsupported-source-statement';await privateJson(join(f.root,'report.json'),report);
 f.document=await f.store.document('qa','plans',f.document.id);return f;
}

