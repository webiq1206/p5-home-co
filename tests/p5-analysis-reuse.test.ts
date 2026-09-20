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
