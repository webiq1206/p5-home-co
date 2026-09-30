import test from 'node:test';
import assert from 'node:assert/strict';
import {processingLookup} from '../lib/p5/backgroundJobs.ts';
import {scopeAnalysisFailureWarning} from '../lib/p5/scopeEndpoint.ts';
import {analysisAcknowledgement} from '../lib/p5/processingStatus.ts';
import {selectReusableAnalysis} from '../lib/p5/analysisReuse.ts';

// Ported from the Cabinet typed-scope recovery suite: the cases that cover shared
// document-reading modules. Cabinet intent cases stay with projectIntent's own tests.
const text='QA TEST ONLY: Install 20 linear feet of owner-supplied assembled base cabinets in Caldwell. Labor only; exclude countertops and upper cabinets.';

test('completed work progress binds each work key as scalar text',()=>{
  const keys=['analysis:v8:abc','analysis:document-service-v1:def'];
  const lookup=processingLookup(keys);
  assert.doesNotMatch(lookup.statement,/ANY|text\[\]/);
  assert.match(lookup.statement,/work_key IN \(\$2,\$3\)/);
  assert.deepEqual(lookup.values,keys);
  assert.deepEqual(processingLookup([keys[0]]).values,[keys[0],keys[0]]);
  const three=processingLookup([...keys,'analysis:document-service-v2:def:remote']);
  assert.ok(three.statement.includes('work_key IN ($2,$3,$4)'));assert.equal(three.values.length,3);
  assert.ok(lookup.statement.includes('ORDER BY (work_key=$2) DESC'));
  assert.throws(()=>processingLookup([]),/work-key-missing/);
});

test('text-only failures never claim that files need review',()=>{
  const textWarning=scopeAnalysisFailureWarning(false);
  assert.doesNotMatch(textWarning,/\bfiles?|documents?\b/i);
  assert.match(textWarning,/project description is saved/i);
  const acknowledgement=analysisAcknowledgement(1,0,true,1);
  assert.doesNotMatch(acknowledgement,/\bfiles?\b/i);
  assert.match(acknowledgement,/text is saved/i);
  assert.match(scopeAnalysisFailureWarning(true),/files are saved/i);
});

const reusableAnalysis={provider:'Anthropic',model:'claude-sonnet-5',analyzedAt:'2026-09-19T18:30:50.054Z',extraction:{summary:'complete',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],clarifications:[]}};
const legacy=(overrides:Record<string,unknown>={})=>({workKey:'background-v1-legacy',payload:{state:'complete',input:{kind:'analysis',draft:{uploads:[]},text,answers:{}},result:{pending:false,version:'legacy',analysis:{...reusableAnalysis,...overrides}}}});
const current={text,answers:{service:'cabinet-install' as const},uploads:[]};

test('reuses an exact completed legacy analysis when only service normalization changed',()=>{
  const candidate=legacy();
  const selected=selectReusableAnalysis([candidate],current);
  assert.ok(selected.reusable);
  assert.equal(selected.reusable?.analysis,(candidate.payload as any).result.analysis);
  assert.equal(selected.reusable?.analysis.provider,'Anthropic');
  assert.equal(selected.reusable?.analysis.model,'claude-sonnet-5');
});

test('rejects changed source, upload, manual answer, conflicting service, incomplete and unread legacy results',()=>{
  assert.equal(selectReusableAnalysis([legacy()],{...current,text:`${text} changed`}).reusable,null);
  assert.equal(selectReusableAnalysis([legacy()],{...current,uploads:[{id:'u',name:'x',type:'text/plain',size:1,sha256:'hash',status:'stored'}]}).reusable,null);
  assert.equal(selectReusableAnalysis([legacy()],{...current,answers:{service:'cabinet-install',location:'Nampa'}}).reusable,null);
  assert.equal(selectReusableAnalysis([legacy()],{...current,answers:{service:'cabinet-product'}}).reusable,null);
  assert.equal(selectReusableAnalysis([legacy({extraction:{...reusableAnalysis.extraction,reviewNotes:['unread']}})],current).reusable,null);
  assert.equal(selectReusableAnalysis([{...legacy(),payload:{...legacy().payload,state:'running'}}],current).reusable,null);
  assert.equal(selectReusableAnalysis([{...legacy(),payload:{...legacy().payload,input:{kind:'analysis',draft:{uploads:[]},text,answers:{service:'cabinet-product'}}}}],current).reusable,null);
});

test('refuses ambiguous exact legacy matches instead of selecting either result',()=>{
  const first=legacy();
  const second={...legacy(),workKey:'background-v1-second',payload:{...legacy().payload,result:{pending:false,version:'other',analysis:{...reusableAnalysis,provider:'OpenAI'}}}};
  const selected=selectReusableAnalysis([first,second],current);
  assert.equal(selected.reusable,null);
  assert.equal(selected.reason,'multiple-compatible-analyses');
});

test('progress lookup uses the persisted jsonb input hashed by the pricing worker',async()=>{
 const {PGlite}=await import('@electric-sql/pglite');
 const {jobProgressWorkKeys}=await import('../lib/p5/backgroundJobs.ts');
 const {pricingWorkKey}=await import('../lib/p5/pricingWork.ts');
 const {EMPTY_CONFIGURATION}=await import('../lib/p5/costBook.ts');
 const db=new PGlite();
 try{
  const job={createdAt:'2026-09-24T12:00:00Z',input:{kind:'pricing',draft:{id:'qa',reviewed:{text:'Trim',answers:{service:'handyman',location:'Boise'},extraction:null,uploads:[],reviewedAt:'2026-09-24',corrections:[]}},configuration:EMPTY_CONFIGURATION}};
  const {rows}=await db.query<{payload:typeof job}>('SELECT $1::jsonb AS payload',[JSON.stringify(job)]);const saved=rows[0].payload;
  const workerKey=pricingWorkKey(saved.input.draft.reviewed,saved.input.configuration,new Date(saved.createdAt));
  assert.notEqual(pricingWorkKey(job.input.draft.reviewed,job.input.configuration,new Date(job.createdAt)),workerKey,'jsonb reproduces the original key-order mismatch');
  assert.deepEqual(await jobProgressWorkKeys(saved as Parameters<typeof jobProgressWorkKeys>[0]),[workerKey]);
 }finally{await db.close();}
});

test('P5 reuses a verified complete source read when a supplied answer became an identical extracted fact',async()=>{
 const {selectSourceEquivalentAnalysis}=await import('../lib/p5/analysisReuse.ts');
 const {MODEL_POLICY_VERSION,ESTIMATOR_MODEL_SNAPSHOT}=await import('../lib/p5/modelPolicy.ts');
 const uploads=[{id:'public-source',name:'public-plan.pdf',type:'application/pdf',size:100,sha256:'verified-source-hash',status:'stored' as const}];
 const extraction={summary:'Complete public fixture',facts:[{field:'location' as const,value:'Boise, Idaho',evidence:'Boise, Idaho',source:'typed scope',basis:'stated' as const,confidence:1}],conflicts:[],reviewNotes:[],missingInformation:[],documentCoverage:{complete:true,expectedPages:1,pages:[{source:'public-plan.pdf',page:1,sheet:'A1',revision:'',status:'read' as const,notes:[]}]}};
 const analysis={provider:'OpenAI',model:ESTIMATOR_MODEL_SNAPSHOT,modelPolicy:MODEL_POLICY_VERSION,analyzedAt:'2026-09-30',extraction};
 const candidate={workKey:'saved',payload:{state:'complete',input:{kind:'analysis',text:'Build this ADU.',answers:{location:'Boise, Idaho'},draft:{uploads}},result:{analysis}}};
 const input={text:'Build this ADU.',answers:{},uploads,extraction};
 assert.equal(selectSourceEquivalentAnalysis([candidate],input)?.analysis,analysis);
 assert.equal(selectSourceEquivalentAnalysis([candidate],{...input,text:'Build only the garage.'}),null);
 assert.equal(selectSourceEquivalentAnalysis([candidate],{...input,answers:{location:'Nampa'}}),null);
 assert.equal(selectSourceEquivalentAnalysis([candidate],{...input,answers:{location:'Nampa'},resolutions:{location:'Nampa'}}),null);
 assert.equal(selectSourceEquivalentAnalysis([candidate],{...input,uploads:[{...uploads[0],sha256:'replaced-source'}]}),null);
 assert.equal(selectSourceEquivalentAnalysis([candidate,candidate],input),null);
 const wrong=structuredClone(candidate);wrong.payload.result.analysis.modelPolicy='unverified-legacy';
 assert.equal(selectSourceEquivalentAnalysis([wrong],input),null);
 const partial=structuredClone(candidate);partial.payload.result.analysis.extraction.documentCoverage.complete=false;
 assert.equal(selectSourceEquivalentAnalysis([partial],input),null);
 const conflict=structuredClone(extraction);conflict.facts[0].value='Meridian';
 assert.equal(selectSourceEquivalentAnalysis([candidate],{...input,extraction:conflict}),null);
});
