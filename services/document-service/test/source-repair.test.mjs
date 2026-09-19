import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Pipeline} from '../src/pipeline.mjs';
import {READER_SYSTEM} from '../src/contracts.mjs';
import {citationInput,applyCitations} from '../src/evidence-citations.mjs';
import {prepareSourceRepair,applySourceRepairs} from '../src/evidence-source-repair.mjs';
import {ServiceError,validateEvidence} from '../src/core.mjs';

const source={page:1,kind:'text',textQuality:1,text:'Install 120 linear feet of baseboard.\nExclude owner-supplied materials.\nInstall 3 doors.',spans:[]};
const raw=()=>({pages:[{page:1,sheet:'',revision:'',status:'read',notes:[],facts:[],items:[
 {id:'trim',description:'Baseboard',component:'Trim',building:'Main',floor:'First',quantity:999,unit:'lf',basis:'stated',evidence:'Install 999 lf of trim.'},
 {id:'doors',description:'Door installation',component:'Doors',building:'Main',floor:'First',quantity:3,unit:'ea',basis:'stated',evidence:'Install 3 doors.'}
],inclusions:[],exclusions:['Owner-supplied materials'],responsibilities:['Owner supplies materials'],regions:[]}]});
const rejected={citations:[{key:'1:items:0',supported:false,lines:[]}]};
const corrected=()=>({...raw().pages[0].items[0],quantity:120,evidence:'Install 120 linear feet of baseboard.'});
const patch=()=>({facts:[],items:[{key:'1:items:0',statement:corrected(),reason:'The stated length is 120 linear feet, not 999.'}],regions:[]});

test('citation ordering is canonicalized without losing intervening qualifications or changing the saved reply',()=>{
 const value=raw();value.pages[0].items[0].quantity=120;value.pages[0].items[0].evidence='Install 120 lf of trim.';
 const input=citationInput(value,[source]),response={citations:[{key:'1:items:0',supported:true,lines:[3,1]}]},before=structuredClone(response);
 const result=applyCitations(value,[source],input,response);
 assert.equal(result.pages[0].items[0].evidence,source.text);assert.deepEqual(response,before);
 assert.equal(value.pages[0].items[0].evidence,'Install 120 lf of trim.');
});
for(const lines of [[1,1],[0,3],[4,1],[1.5,2],[]])test('citation normalization still refuses invalid references '+JSON.stringify(lines),()=>{
 const value=raw();assert.throws(()=>applyCitations(value,[source],citationInput(value,[source]),{citations:[{key:'1:items:0',supported:true,lines}]}));
});

test('source correction changes only the rejected statement and preserves accepted quantities and responsibilities',()=>{
 const value=raw(),before=structuredClone(value),prepared=prepareSourceRepair(value,[source],citationInput(value,[source]),rejected);
 const result=applySourceRepairs(prepared.grounded,[source],prepared.rejected,patch());
 assert.equal(result.pages[0].items[0].quantity,120);assert.deepEqual(result.pages[0].items[1],value.pages[0].items[1]);
 assert.deepEqual(result.pages[0].exclusions,value.pages[0].exclusions);assert.deepEqual(result.pages[0].responsibilities,value.pages[0].responsibilities);assert.deepEqual(value,before);
 assert.equal(citationInput(result,[source]).statements.length,0);
 assert.equal(citationInput(result,[source],prepared.rejected).statements.length,1,'Even an exact replacement quote must be checked for full support');
});
for(const kind of ['accepted-key','missing','duplicate','identity','uncertain-count','wrong-page','wrong-collection'])test('source correction refuses '+kind,()=>{
 const value=raw(),prepared=prepareSourceRepair(value,[source],citationInput(value,[source]),rejected),answer=patch();
 if(kind==='accepted-key')answer.items[0].key='1:items:1';
 if(kind==='missing')answer.items=[];
 if(kind==='duplicate')answer.items.push(structuredClone(answer.items[0]));
 if(kind==='identity')answer.items[0].statement.id='another-physical-item';
 if(kind==='uncertain-count')answer.items[0].statement.basis='uncertain';
 if(kind==='wrong-page')answer.regions.push({page:2,x:0,y:0,width:.5,height:.5,reason:'Other page'});
 if(kind==='wrong-collection')answer.items[0].key='1:facts:0';
 assert.throws(()=>applySourceRepairs(prepared.grounded,[source],prepared.rejected,answer));assert.equal(value.pages[0].items[0].quantity,999);
});
test('unresolved source correction remains partial with no invented quantity',()=>{
 const value=raw(),prepared=prepareSourceRepair(value,[source],citationInput(value,[source]),rejected),answer=patch();
 answer.items[0].statement={...corrected(),basis:'uncertain',quantity:null};
 const result=validateEvidence(applySourceRepairs(prepared.grounded,[source],prepared.rejected,answer),[source]);
 assert.equal(result.pages[0].status,'partial');assert.equal(result.pages[0].items[0].quantity,null);assert.ok(result.pages[0].notes.some(n=>n.includes('Source correction')));
});

function fixture(handler,checkpointHook=()=>{}){
 const job={id:'synthetic-job',kind:'read',document_id:'synthetic-document',payload:{pages:[1]}},purposes=[];let committed;
 const store={
  checkpoint:async(job,result)=>{await checkpointHook(result);job.result=structuredClone(result);},
  pages:async()=>[{page:1,native:source,image:Buffer.from('synthetic-image'),evidence:null}],
  complete:async(job,result,write)=>write({query:async(sql,args)=>{if(sql.includes('UPDATE p5ds_pages'))committed=JSON.parse(args[2]);return {rows:[],rowCount:1};}}),
  checkStorage:async()=>{},finalize:async()=>{}
 };
 const reader={call:async(job,system,input,images,schema,signal,verify,purpose)=>{
  purposes.push(purpose);const custom=await handler?.({job,system,input,images,schema,signal,verify,purpose,purposes});if(custom!==undefined)return custom;
  if(purpose==='read')return raw();
  if(purpose==='source-repair')return patch();
  if(purpose==='citation')return purposes.length===2?rejected:{citations:[{key:'1:items:0',supported:true,lines:[1]}]};
  if(purpose==='verify')return {pages:[structuredClone(input.prior)]};
  throw Error('Unexpected stage');
 }};
 const pipeline=new Pipeline(store,reader,{provider:'anthropic',model:'claude-sonnet-5',verifyModel:'claude-sonnet-5',parserSlots:1});
 const run=(signal=new AbortController().signal)=>pipeline.evidence(job,READER_SYSTEM,[source],[],signal);
 return {job,purposes,pipeline,run,committed:()=>committed};
}

test('a corrected exact quote receives support validation and all successful stages replay without another call',async()=>{
 const f=fixture(({purpose,input,purposes})=>{if(purpose==='citation'&&purposes.length===4){assert.equal(input.statements[0].statement.quantity,120);assert.equal(input.statements[0].statement.evidence,source.text.split('\n')[0]);}});
 const result=await f.run();assert.equal(result.pages[0].items[0].quantity,120);assert.equal(f.job.result.evidenceCheckpoint.raw.pages[0].items[0].quantity,999);
 assert.deepEqual(await f.run(),result);assert.deepEqual(f.purposes,['read','citation','source-repair','citation']);
});
test('a replacement still rejected by the support check fails and cannot create a correction loop',async()=>{
 const f=fixture(({purpose})=>purpose==='citation'?rejected:undefined);
 await assert.rejects(f.run(),/unsupported-source-statement/);await assert.rejects(f.run(),/unsupported-source-statement/);
 assert.deepEqual(f.purposes,['read','citation','source-repair','citation']);
});
for(const provider of ['openai','gemini'])test('bounded correction does not silently change the '+provider+' processing policy',async()=>{
 const f=fixture();f.pipeline.config.provider=provider;
 await assert.rejects(f.run(),/unsupported-source-statement/);assert.deepEqual(f.purposes,['read','citation']);
});
for(const stage of ['source-repair','replacement-citation'])test('interrupted '+stage+' keeps its durable start marker and cannot repeat',async()=>{
 const f=fixture(({purpose,purposes})=>{if(purpose===stage||stage==='replacement-citation'&&purpose==='citation'&&purposes.length===4)throw new ServiceError('qa-paused-unknown-provider-charge',422);});
 await assert.rejects(f.run(),/unknown-provider-charge/);const count=f.purposes.length;
 await assert.rejects(f.run(),stage==='source-repair'?/source-correction-needs-inspection/:/source-citation-needs-inspection/);assert.equal(f.purposes.length,count);
});
test('a visual replacement still reaches independent visual verification before evidence can be committed',async()=>{
 const f=fixture(({purpose})=>{if(purpose==='source-repair'){const answer=patch();answer.items[0].statement.basis='visual';return answer;}});
 await f.pipeline.read(f.job,new AbortController().signal);
 assert.deepEqual(f.purposes,['read','citation','source-repair','verify']);assert.equal(f.committed().items[0].quantity,120);assert.equal(f.committed().items[1].quantity,3);
});
for(const kind of ['cancelled','lease-lost'])test('source correction cannot spend after '+kind,async()=>{
 const controller=new AbortController(),f=fixture(({purpose})=>{if(kind==='cancelled'&&purpose==='citation')controller.abort();},result=>{if(kind==='lease-lost'&&result.evidenceCheckpoint?.sourceCorrectionStarted)throw new ServiceError('lease-lost',409);});
 await assert.rejects(f.run(controller.signal));assert.deepEqual(f.purposes,['read','citation']);
});

for(const basis of ['uncertain','stated'])test('empty '+basis+' facts outside the citation manifest get one bounded correction and replay',async()=>{
 const value=raw();value.pages[0].items[0]=corrected();
 value.pages[0].facts=[{field:'sqft',value:'',evidence:basis==='stated'?'Install 3 doors.':'',basis}];
 const answer={facts:[{key:'1:facts:0',statement:{field:'otherDetails',value:'Floor area is not specified on this page.',evidence:'The page lists trim and doors without a floor area.',basis:'uncertain'},reason:'Retain the missing area explicitly without inventing a quantity.'}],items:[],regions:[]};
 const f=fixture(({purpose})=>purpose==='read'?value:purpose==='source-repair'?answer:undefined);
 const result=await f.run();assert.equal(result.pages[0].status,'partial');assert.equal(result.pages[0].facts[0].basis,'uncertain');
 assert.deepEqual(f.job.result.evidenceCheckpoint.raw,value);assert.deepEqual(result.pages[0].items,value.pages[0].items);
 assert.deepEqual(await f.run(),result);assert.deepEqual(f.purposes,['read','source-repair']);
});
test('empty facts and unsupported items share one correction without duplication',()=>{
 const value=raw();value.pages[0].facts=[{field:'',value:'   ',evidence:'Wrong quote',basis:'stated'}];
 const input=citationInput(value,[source]),response={citations:input.statements.map(s=>({key:s.key,supported:false,lines:[]}))};
 const prepared=prepareSourceRepair(value,[source],input,response);
 assert.deepEqual(prepared.rejected.sort(),['1:facts:0','1:items:0']);assert.equal(prepared.input.rejectedStatements.length,2);
});
test('a supported citation cannot validate an empty fact or conceal an invalid line reference',()=>{
 const value=raw();value.pages[0].items[0]=corrected();value.pages[0].facts=[{field:'sqft',value:'',basis:'stated',evidence:'Wrong quote'}];
 const input=citationInput(value,[source]);
 const prepared=prepareSourceRepair(value,[source],input,{citations:[{key:'1:facts:0',supported:true,lines:[1]}]});
 assert.deepEqual(prepared.rejected,['1:facts:0']);
 assert.throws(()=>prepareSourceRepair(value,[source],input,{citations:[{key:'1:facts:0',supported:true,lines:[900]}]}),/invalid-citation-line/);
});
test('a correction that returns another empty fact fails once and stays cached',async()=>{
 const value=raw();value.pages[0].items[0]=corrected();value.pages[0].facts=[{field:'sqft',value:'',evidence:'',basis:'uncertain'}];
 const f=fixture(({purpose})=>purpose==='read'?value:purpose==='source-repair'?{facts:[{key:'1:facts:0',statement:{...value.pages[0].facts[0],evidence:'Not provided'},reason:'Still empty'}],items:[],regions:[]}:undefined);
 await assert.rejects(f.run(),/empty-source-fact/);await assert.rejects(f.run(),/empty-source-fact/);assert.deepEqual(f.purposes,['read','source-repair']);
});
test('an empty fact in independent verification remains a failure rather than opening another correction cycle',async()=>{
 const f=fixture(({purpose})=>{
  if(purpose==='source-repair'){const answer=patch();answer.items[0].statement.basis='visual';return answer;}
  if(purpose==='verify'){const value=raw();value.pages[0].items[0]=corrected();value.pages[0].facts=[{field:'sqft',value:'',evidence:'',basis:'uncertain'}];return value;}
 });
 await assert.rejects(f.pipeline.read(f.job,new AbortController().signal),/empty-source-fact/);assert.equal(f.committed(),undefined);
 assert.deepEqual(f.purposes,['read','citation','source-repair','verify']);
});
