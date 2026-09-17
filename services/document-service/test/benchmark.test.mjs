import {test} from 'node:test';
import assert from 'node:assert/strict';
import {measureQuality,percentiles,summarizeStages} from '../src/benchmark-metrics.mjs';
import {validateSchema} from '../src/schema.mjs';
import {EVIDENCE_SCHEMA} from '../src/contracts.mjs';
test('precision and recall count errors and never model confidence',()=>{
 const truth={review:{independent:true,reviewer:'QA',reviewedAt:'2026-09-17'},completeCategories:['facts'],facts:[{field:'sqft',value:'100'},{field:'rooms',value:'2'}]};
 const q=measureQuality(truth,{facts:[{field:'sqft',value:'100',confidence:0},{field:'rooms',value:'3',confidence:1}]});
 assert.equal(q.facts.precision,.5);assert.equal(q.facts.recall,.5);assert.equal(q.quantities.measured,false);
});
test('unreviewed truth cannot masquerade as measured accuracy',()=>assert.throws(()=>measureQuality({facts:[]},{}),/independent/));
test('quantity, exclusion, revision and page errors have separate scores',()=>{
 const truth={review:{independent:true,reviewer:'QA',reviewedAt:'2026-09-17'},completeCategories:['quantities','exclusions','revisions','pages'],quantities:[{id:'D1',component:'door',quantity:2,unit:'EA'}],exclusions:['appliances'],revisions:[{page:1,sheet:'A1',revision:'2'}],pages:[{page:1,status:'read'}]};
 const result={takeoffs:[{id:'D1',component:'door',quantity:3,unit:'EA'}],instructions:{exclusions:[]},pages:[{page:1,sheet:'A1',revision:'1',status:'partial'}]};
 const q=measureQuality(truth,result);for(const k of truth.completeCategories)assert.equal(q[k].recall,0);
});
test('p95 uses tail latency and preserves the sample count',()=>{assert.deepEqual(percentiles(Array.from({length:20},(_,i)=>(i+1)*1000)),{samples:20,p50:10000,p95:19000,p99:20000});assert.equal(percentiles([]).p95,null);});
test('work timings separate rendering, admission, verification and reconciliation',()=>{
 const r=summarizeStages([{stage:'page-parse',duration_ms:100,detail:{nativeMs:20,renderMs:80}},{stage:'verify-provider',duration_ms:1000,detail:{queueMs:500}},{stage:'reconciliation-provider',duration_ms:800,detail:{}}]);
 assert.equal(r.renderWorkMs,80);assert.equal(r.providerAdmissionWaitWorkMs,500);assert.equal(r.aiVerificationWorkMs,1000);assert.equal(r.reconciliationWorkMs,800);
});
test('local schema rejects omitted arrays, wrong types and extra fields',()=>{
 assert.throws(()=>validateSchema({pages:[{page:1,status:'read'}]},EVIDENCE_SCHEMA),/schema/);
 assert.throws(()=>validateSchema({pages:[],unchecked:true},EVIDENCE_SCHEMA),/schema/);
 assert.throws(()=>validateSchema({pages:'complete'},EVIDENCE_SCHEMA),/schema/);
 assert.deepEqual(validateSchema({pages:[]},EVIDENCE_SCHEMA),{pages:[]});
});
