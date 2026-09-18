import {stable} from './core.mjs';
export function percentiles(values){
 const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);
 const at=p=>sorted.length?sorted[Math.max(0,Math.ceil(p*sorted.length)-1)]:null;
 return {samples:sorted.length,p50:at(.5),p95:at(.95),p99:at(.99)};
}
export function compareRecords(expected,actual,identity=stable){
 const wanted=new Set(expected.map(identity)),returned=new Set(actual.map(identity));
 const truePositives=[...wanted].filter(k=>returned.has(k)).length;
 return {truePositives,falsePositives:returned.size-truePositives,falseNegatives:wanted.size-truePositives,
  expected:wanted.size,returned:returned.size,precision:returned.size?truePositives/returned.size:null,recall:wanted.size?truePositives/wanted.size:null,
  missing:[...wanted].filter(k=>!returned.has(k)),unexpected:[...returned].filter(k=>!wanted.has(k))};
}
/** Omitted categories are unmeasured. Confidence never contributes to a score. */
export function measureQuality(truth,result,source='benchmark.pdf'){
 if(!truth?.review?.independent||!truth.review.reviewer||!truth.review.reviewedAt||!Array.isArray(truth.completeCategories))throw Error('Truth requires independent review metadata and explicit completeCategories.');
 const fields={
  facts:[result.facts||[],f=>stable([f.field,String(f.value),f.source||source])],
  quantities:[result.takeoffs||[],t=>stable([t.id,t.building||'',t.floor||'',t.component,t.quantity,t.unit])],
  inclusions:[result.instructions?.inclusions||[],stable],exclusions:[result.instructions?.exclusions||[],stable],
  revisions:[result.pages||[],p=>stable([p.source||source,p.page,p.sheet||'',p.revision||''])],
  pages:[result.pages||[],p=>stable([p.source||source,p.page,p.status])]
 };
 return Object.fromEntries(Object.entries(fields).map(([kind,[actual,identity]])=>{
  if(!truth.completeCategories.includes(kind))return [kind,{measured:false}];
  if(!Array.isArray(truth[kind]))throw Error('Missing exhaustive truth category: '+kind);
  return [kind,{measured:true,...compareRecords(truth[kind],actual,identity)}];
 }));
}
export function summarizeStages(events){
 const sum=fn=>events.reduce((n,e)=>n+(Number(fn(e))||0),0);
 return {queueWorkMs:sum(e=>e.stage==='queue'?e.duration_ms:0),
  nativeParseWorkMs:sum(e=>e.stage==='page-parse'?e.detail.nativeMs:0),renderWorkMs:sum(e=>e.stage==='page-parse'?e.detail.renderMs:0),
  parsePipelineWorkMs:sum(e=>e.stage==='native-parse'?e.duration_ms:0),providerAdmissionWaitWorkMs:sum(e=>e.detail.queueMs),
  aiReadWorkMs:sum(e=>e.stage==='read-provider'?e.duration_ms:0),aiCitationWorkMs:sum(e=>e.stage==='citation-provider'?e.duration_ms:0),aiVerificationWorkMs:sum(e=>e.stage==='verify-provider'?e.duration_ms:0),
  reconciliationWorkMs:sum(e=>e.stage==='reconciliation-provider'?e.duration_ms:0),failedProviderWorkMs:sum(e=>e.stage==='provider-failure'?e.duration_ms:0),
  note:'Summed work across concurrent jobs. These durations do not add up to customer wall time.'};
}
