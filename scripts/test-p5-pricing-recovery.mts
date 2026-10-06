// Real isolated SQL and pricing orchestration, with synthetic provider responses.
import assert from 'node:assert/strict';
import {mkdtemp,cp,writeFile,rm,mkdir,rename} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

// This standalone script also runs on hosts with real provider credentials.
// Isolate every provider boundary and fail if any unexpected fetch is attempted.
const network=globalThis.fetch;let unexpectedNetwork=0;
globalThis.fetch=async()=>{unexpectedNetwork++;throw new Error('Unexpected network request in isolated pricing recovery');};
const credentialNames=['OPENAI_API_KEY','OPENAI_BASE_URL','AI_INTEGRATIONS_OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_BASE_URL','ANTHROPIC_API_KEY','P5_BOOK_SHORTLIST_TEST'];
const environment=Object.fromEntries(credentialNames.map(name=>[name,process.env[name]]));
for(const name of credentialNames)delete process.env[name];
process.env.P5_BOOK_SHORTLIST_TEST='1';
await mkdir('node_modules/.cache',{recursive:true});
const dir=await mkdtemp(path.join(process.cwd(),'node_modules/.cache/p5-pricing-recovery-'));
const previous=process.env.DATABASE_URL;
type SavedPayload={replies:Record<string,{timeouts?:number;outputLimited?:boolean}>};
type QaRepairPayload=SavedPayload&{repairClock:{startedAt:number;busyWaitMs:number};qaReviewWaitStartedAt?:number;requests:Record<string,{repair?:string;attempt:number;failures:unknown[]}>;shortlists?:Record<string,Record<string,string[]>>};
type StageInput={taskBatch?:{id:string;description:string;evidence:string}[]};
let db:{database:{close():Promise<void>};query(sql:string,values?:unknown[]):Promise<{payload:SavedPayload}[]>}|undefined;
try{
 delete process.env.DATABASE_URL;
 await cp('lib/p5',dir,{recursive:true});
 await writeFile(path.join(dir,'bookShortlist.ts'),`export let calls=0;export async function shortlistBook(tasks:any[],rates:any[]){calls++;return new Map(tasks.map(task=>[task.id,calls%2?[rates[0].code]:[]]));}`);
 await writeFile(path.join(dir,'database.ts'),`import {PGlite} from '@electric-sql/pglite';export const database=new PGlite();export async function query(s:string,v:unknown[]=[]){return (await database.query(s,v)).rows;}`);
 // Keep the real pricing engine. Replace only its external provider boundary.
 await rename(path.join(dir,'scopePricing.ts'),path.join(dir,'scopePricingReal.ts'));
 await writeFile(path.join(dir,'scopePricing.ts'),`export * from './scopePricingReal.ts';let provider:any;export const setProvider=(value:any)=>{provider=value;};export const requestPricing=(...args:any[])=>provider(...args);`);
 const mod=(name:string)=>import(pathToFileURL(path.join(dir,name+'.ts')).href);
 const store=await mod('store'),work=await mod('pricingWork'),provider=await mod('scopePricing'),shortlist=await mod('bookShortlist');
 const {ProcessingDeadlineError}=await mod('processingBudget');
 const {createPlanningConfiguration,PLANNING_MODEL_VERSION}=await mod('planningBooks');
 const {priceReviewedScope}=await mod('costBook');
 const {ESTIMATOR_BRAND}=await mod('brand');
 db=await mod('database');
 const date=new Date(),stamp=date.toISOString();
 const config=createPlanningConfiguration({version:PLANNING_MODEL_VERSION,source:'Synthetic test only',authorizedBy:'Test only',importedAt:stamp,rates:['03-17-01-M','03-17-01-L','03-19-02-M','03-15-02-M','03-15-02-L','03-16-01-M','03-16-01-L','03-14-01-M','03-14-01-L','03-04-01','03-04-02','03-04-03','03-05-02-M','03-05-02-L','REF-GENERAL-HOUR','REF-PLUMBING-HOUR','REF-ELECTRICAL-HOUR'].map(code=>({code,description:'Synthetic work',type:code.endsWith('-M')?'Material':'Labor',unit:code.includes('HOUR')?'HR':'LF',amount:100,source:'Synthetic test',basis:'owner-average-cost'}))});
 const scope={text:'Supply ten feet of cabinetry.',answers:{service:'cabinet-product',cabinetBaseLf:'10',cabinetUpperLf:'0',cabinetTallLf:'0',location:'Boise'},extraction:null,uploads:[],reviewedAt:stamp,corrections:[]};
 const lines=priceReviewedScope(scope,config,date).internal.lines.map((line:{id:string})=>line.id);
 assert.ok(lines.length);
 const task={id:'cabinets',description:'Cabinet supply',evidence:'Ten feet requested'};
 const reply=(value:unknown)=>({value,sourceUrls:[]});
 const newDraft=async()=>{
  const id=randomUUID();
  await store.saveDraft(id,randomBytes(32).toString('hex'),ESTIMATOR_BRAND.id,{text:scope.text,answers:scope.answers,extraction:null,reviewed:null,contact:{name:'',email:'',phone:''}},0);
  return id;
 };
 const run=(id:string)=>work.priceSavedScope(id,scope,config,date,Date.now()+30000);
 const payload=async(id:string)=>(await db!.query('SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[id,work.pricingWorkKey(scope,config,date)]))[0].payload;

 const recovered=await newDraft();let inventoryCalls=0,mappingCalls=0,auditCalls=0;
 provider.setProvider(async(_instructions:string,value:unknown)=>{
  const input=value as StageInput;
  if(input.taskBatch){mappingCalls++;if(mappingCalls===1)throw new ProcessingDeadlineError();return reply({tasks:input.taskBatch.map(item=>({...item,existingLineIds:lines,additions:[],researchDescription:'',issues:[]})),issues:[]});}
  if('priorPricingIssues' in input){auditCalls++;return reply({coveredTaskIds:['cabinets'],issues:[]});}
  inventoryCalls++;return reply({tasks:[task],issues:[]});
 });
 await assert.rejects(run(recovered),(error:unknown)=>error instanceof Error&&error.name==='PricingPending');
 assert.ok(Object.values((await payload(recovered)).replies).some(value=>value.timeouts===1));
 const result=await run(recovered);
 assert.ok(result.customer.range,'a recoverable mapping timeout must make a real bounded retry');
 assert.equal(inventoryCalls,1,'completed inventory is reused');assert.equal(mappingCalls,2);assert.equal(auditCalls,1);
 await run(recovered);
 assert.equal(mappingCalls,2,'a completed mapping is not called again');assert.equal(auditCalls,1);
 assert.equal(shortlist.calls,1,'the original shortlist is saved and reused across pricing resumes');

 // A durable malformed mapping must receive one differently keyed repair,
 // not replay itself when mapBatch asks again. Other stages remain reusable.
 const formatted=await newDraft();let formattedInventory=0,formattedMapping=0,formattedAudit=0;
 provider.setProvider(async(_instructions:string,value:unknown)=>{
  const input=value as StageInput&{formatRepair?:{attempt:number;errors:unknown[]}};
  if(input.taskBatch){
   formattedMapping++;
   const mapped={...task,existingLineIds:lines,additions:[],researchDescription:'',issues:[],notes:['Confirm the selected color.']};
   if(!input.formatRepair)return reply({tasks:[{...mapped,id:{value:task.id}}],issues:[]});
   assert.equal(input.formatRepair.attempt,1);assert.ok(input.formatRepair.errors.length);
   return reply({tasks:[mapped],issues:[]});
  }
  if('priorPricingIssues' in input){formattedAudit++;return reply({coveredTaskIds:[task.id],issues:[]});}
  formattedInventory++;return reply({tasks:[task],issues:[]});
 });
 const corrected=await run(formatted);
 assert.ok(corrected.customer.range,'a saved malformed mapping has a real repair path');
 assert.deepEqual([formattedInventory,formattedMapping,formattedAudit],[1,2,1]);
 await run(formatted);
 assert.deepEqual([formattedInventory,formattedMapping,formattedAudit],[1,2,1],'resume reuses the successful repair without another paid call');

 // A schema-valid response can still lose scope. Exercise the real saved SQL
 // path for omitted, duplicate and invented IDs, including durable repair reuse.
 for(const defect of ['missing','duplicate','unexpected','string-tasks'] as const){
  const id=await newDraft();let maps=0,audits=0;
  const batch=[task,{...task,id:'cabinet-second',description:'Second distinct cabinet component'}];
  provider.setProvider(async(_instructions:string,value:unknown)=>{
   const input=value as StageInput&{formatRepair?:{errors:{message:string}[];priorResponse:unknown}};
   if(input.taskBatch){
    maps++;
    const mapped=input.taskBatch.map(item=>({...item,existingLineIds:lines,additions:[],researchDescription:'',issues:[]}));
    if(!input.formatRepair)return reply({tasks:defect==='string-tasks'?'[not valid JSON':defect==='missing'?mapped.slice(0,1):defect==='duplicate'?[mapped[0],mapped[0]]:[mapped[0],{...mapped[1],id:'invented-task'}],issues:[]});
    assert.ok(input.formatRepair.errors.some(issue=>defect==='string-tasks'?issue.message.includes('array'):issue.message.includes('Incomplete mapping batch')));
    assert.ok(input.formatRepair.priorResponse,'the exact failed response accompanies the correction');
    return reply({tasks:mapped,issues:[]});
   }
   if('priorPricingIssues' in input){audits++;return reply({coveredTaskIds:batch.map(item=>item.id),issues:[]});}
   return reply({tasks:batch,issues:[]});
  });
  assert.ok((await run(id)).customer.range,`${defect} IDs receive one real corrective mapping`);
  assert.deepEqual([maps,audits],[2,1]);
  await run(id);assert.deepEqual([maps,audits],[2,1],'replayed bad answer reuses its saved successful repair');
  const saved=await payload(id) as SavedPayload&{requests:Record<string,{stage:string;taskIds?:string[];repair?:string;mappingResult?:{tasksType:string;returnedTaskIds:string[]}}>};
  const traces=Object.values(saved.requests).filter(trace=>trace.stage==='mapping');
  assert.equal(traces.length,2);assert.ok(traces.every(trace=>JSON.stringify(trace.taskIds)===JSON.stringify(batch.map(item=>item.id).sort())));
  assert.equal(traces.filter(trace=>trace.repair==='format').length,1);
  assert.deepEqual(traces.find(trace=>trace.repair==='format')?.mappingResult,{tasksType:'array',returnedTaskIds:batch.map(item=>item.id)});
  if(defect==='string-tasks')assert.equal(traces.find(trace=>!trace.repair)?.mappingResult?.tasksType,'string');
 }

 const incomplete=await newDraft();let incompleteMaps=0;
 provider.setProvider(async(_instructions:string,value:unknown)=>{
  const input=value as StageInput;
  if(input.taskBatch){incompleteMaps++;return reply({tasks:[{...task,id:'wrong-task',existingLineIds:lines,additions:[],researchDescription:'',issues:[]}],issues:[]});}
  if('priorPricingIssues' in input)throw Error('Invalid task coverage must not reach audit');
  return reply({tasks:[task],issues:[]});
 });
 const held=await run(incomplete);
 assert.equal(held.customer.range,null,'a second incomplete response cannot release a partial price');
 assert.ok(held.internal.scopePricing.issues.some((issue:string)=>issue.includes('Incomplete mapping batch')&&issue.includes('wrong-task')),'the exact mismatched IDs survive in the saved result');
 await run(incomplete);assert.equal(incompleteMaps,2,'repeated failures are bounded across resumes');

 const exhausted=await newDraft();let attempts=0,legacyKey='';
 provider.setProvider(async(_instructions:string,value:unknown)=>{
  const input=value as StageInput;
  if(input.taskBatch){legacyKey=work.pricingReplyKey(_instructions,input,false);attempts++;throw new ProcessingDeadlineError();}
  if('priorPricingIssues' in input)throw Error('An incomplete mapping must never reach the audit');
  return reply({tasks:[task],issues:[]});
 });
 await assert.rejects(run(exhausted),(error:unknown)=>error instanceof Error&&error.name==='PricingPending');
 // Older releases used a content hash. Its actual attempts still count after
 // migration to the current mapping key, so an upgrade cannot reset the limit.
 const older=await payload(exhausted);
 const marker=Object.entries(older.replies).find(([,value])=>value.timeouts===1)!;
 delete older.replies[marker[0]];older.replies[legacyKey]=marker[1];
 await db!.query('UPDATE p5_estimator_work SET payload=$1::jsonb WHERE draft_id=$2 AND work_key=$3',[JSON.stringify(older),exhausted,work.pricingWorkKey(scope,config,date)]);
 await assert.rejects(run(exhausted),(error:unknown)=>error instanceof Error&&error.name==='PricingPending');
 const failed=await run(exhausted);
 assert.equal(failed.customer.range,null,'exhaustion must not release a partial price');
 assert.ok(failed.internal.scopePricing.issues.some((issue:string)=>issue.includes('pricing-stage-exhausted')));
 assert.equal(attempts,3,'exactly three actual attempts, not three polls');
 await run(exhausted);assert.equal(attempts,3,'exhausted work never starts another paid call');
 assert.ok(Object.values((await payload(exhausted)).replies).some(value=>value.timeouts===3));

 const split=await newDraft();const sizes:number[]=[];const completed:string[]=[];
 const tasks=Array.from({length:6},(_,i)=>({...task,id:'cabinet-'+i,description:'Synthetic component '+i}));
 provider.setProvider(async(_instructions:string,value:unknown)=>{
  const input=value as StageInput;
  if(input.taskBatch){sizes.push(input.taskBatch.length);if(input.taskBatch.length>3)throw new ProcessingDeadlineError();completed.push(...input.taskBatch.map(item=>item.id));return reply({tasks:input.taskBatch.map(item=>({...item,existingLineIds:lines,additions:[],researchDescription:'',issues:[]})),issues:[]});}
  if('priorPricingIssues' in input)return reply({coveredTaskIds:tasks.map(item=>item.id),issues:[]});
  return reply({tasks,issues:[]});
 });
 await run(split);assert.deepEqual(sizes,[4,2,2,2]);assert.deepEqual([...completed].sort(),tasks.map(item=>item.id).sort(),'every task is completed exactly once');
 await run(split);assert.deepEqual(sizes,[4,2,2,2],'timed-out large mapping stays split on replay');

 const auditSplit=await newDraft();const auditSizes:number[]=[];let childRetry=0;
 provider.setProvider(async(_instructions:string,value:unknown)=>{
  const input=value as StageInput&{tasks?:typeof tasks};
  if(input.taskBatch)return reply({tasks:input.taskBatch.map(item=>({...item,existingLineIds:lines,additions:[],researchDescription:'',issues:[]})),issues:[]});
  if('priorPricingIssues' in input){
   auditSizes.push(input.tasks!.length);
   if(input.tasks!.length>3)throw new Error('pricing-check-incomplete:max_tokens');
   if(input.tasks![0].id==='cabinet-3'&&++childRetry===1)throw new ProcessingDeadlineError();
   return reply({coveredTaskIds:input.tasks!.map(item=>item.id),issues:[]});
  }
  return reply({tasks,issues:[]});
 });
 await assert.rejects(run(auditSplit),(error:unknown)=>error instanceof Error&&error.name==='PricingPending');
 assert.ok(Object.values((await payload(auditSplit)).replies).some(value=>value.outputLimited),'the oversized audit is durably marked');
 assert.ok((await run(auditSplit)).customer.range,'resumed child audit completes full coverage');
 assert.deepEqual(auditSizes,[6,3,3,3],'resume reuses the successful subset and never repeats the oversized audit');
 await run(auditSplit);assert.deepEqual(auditSizes,[6,3,3,3],'all completed audit subsets are reused');

 const auditExhausted=await newDraft();let singleAuditCalls=0;
 provider.setProvider(async(_instructions:string,value:unknown)=>{
  const input=value as StageInput;
  if(input.taskBatch)return reply({tasks:input.taskBatch.map(item=>({...item,existingLineIds:lines,additions:[],researchDescription:'',issues:[]})),issues:[]});
  if('priorPricingIssues' in input){singleAuditCalls++;throw new Error('pricing-check-incomplete:max_tokens');}
  return reply({tasks:[task],issues:[]});
 });
 assert.equal((await run(auditExhausted)).customer.range,null,'an incomplete single-task audit cannot release pricing');
 assert.equal((await run(auditExhausted)).customer.range,null);
 assert.equal(singleAuditCalls,1,'an unsplittable output failure does not repeat paid work');

 // Only these two QA holds prove that the boundary stopped before dispatch.
 // Exercise the real broker wire guard, not a made-up successful research reply.
 const qa=await mod('qaPaid');
 const {qaWire,QA_MODEL}=await import('../services/document-service/src/qa-budget.mjs');
 const serverToolHold=()=>{
  try{qaWire({model:QA_MODEL,max_tokens:1000,messages:[{role:'user',content:'Synthetic repair research'}],tools:[{type:'web_search_20250305',name:'web_search'}]});}
  catch(error){assert.equal((error as {code:string}).code,'qa-server-tools-not-budgeted');return new qa.QaPaidHold((error as {code:string}).code);}
  throw new Error('The existing server-tool guard must remain closed');
 };
 const excludedPauseHolds=['qa-provider-http-503','qa-usage-unverified','qa-usage-over-reservation','qa-receipt-not-saved','qa-saved-receipt-unverified','qa-response-not-json','qa-response-too-large','qa-run-held','qa-run-blocked','qa-settlement-state-changed','qa-budget-exhausted','qa-provider-held'];
 for(const code of excludedPauseHolds)assert.equal(qa.isQaReviewWait(new qa.QaPaidHold(code)),false,code+' must not grant more repair time');
 assert.equal(qa.isQaReviewWait(new Error('qa-server-tools-not-budgeted')),false,'ordinary errors cannot create QA pause evidence');
 const pauseReceipts=[];
 for(const scenario of [
  {code:'qa-exact-request-review-required',pause:true,worked:30000},
  {code:'qa-server-tools-not-budgeted',pause:true,worked:30000},
  {code:'qa-server-tools-not-budgeted',pause:true,worked:provider.REPAIR_BUDGET_MS+1},
  {code:'qa-usage-unverified',pause:false,worked:30000},
  {code:'qa-run-held',pause:false,worked:30000},
 ]){
  const qaId=randomUUID();
  await store.saveDraft(qaId,randomBytes(32).toString('hex'),ESTIMATOR_BRAND.id,{text:scope.text,answers:scope.answers,extraction:null,reviewed:null,contact:{name:'[QA] Repair wait',email:'',phone:''}},0,'bounded-paid');
  let permit=false,repairAttempts=0,repairCompletions=0,qaAudits=0,qaInventories=0,qaMappings=0;
  const realNow=Date.now;let fakeNow=realNow();Date.now=()=>fakeNow;
  const idle=240000;
  try{
   provider.setProvider(async(_instructions:string,value:unknown)=>{
    const input=value as StageInput&{repairInstruction?:string};
    if(input.taskBatch){
     if(input.repairInstruction){
      repairAttempts++;
      if(!permit){fakeNow+=scenario.worked;throw scenario.code==='qa-server-tools-not-budgeted'?serverToolHold():new qa.QaPaidHold(scenario.code);}
      repairCompletions++;fakeNow+=20000;
     }else qaMappings++;
     return reply({tasks:input.taskBatch.map(item=>({...item,existingLineIds:lines,additions:[],researchDescription:'',issues:[]})),issues:[]});
    }
    if('priorPricingIssues' in input){qaAudits++;return reply({coveredTaskIds:[task.id],issues:qaAudits===1?['cabinets: wrong unit does not match the explicit requested quantity.']:[]});}
    qaInventories++;return reply({tasks:[task],issues:[]});
   });
   await assert.rejects(run(qaId),(error:unknown)=>error instanceof qa.QaPaidHold&&(error as Error).message===scenario.code);
   const before=await payload(qaId) as QaRepairPayload;assert.ok(before.repairClock);
   assert.equal(before.qaReviewWaitStartedAt,scenario.pause?fakeNow:undefined,scenario.code+' pause evidence must match the proven boundary');
   assert.equal(fakeNow-before.repairClock.startedAt,scenario.worked,'work before the hold remains on the clock');
   assert.deepEqual([qaInventories,qaMappings,qaAudits,repairAttempts,repairCompletions],[1,1,1,1,0],'the hold returns without an automatic retry');
   const heldTrace=Object.values(before.requests).find(trace=>trace.repair==='scope');assert.ok(heldTrace);
   assert.equal(heldTrace.attempt,0);assert.deepEqual(heldTrace.failures,[],'QA holds retain their existing attempt accounting');
   // SQL JSONB reload is the continuation boundary. Explicitly serialize the
   // saved payload again so an in-memory pause cannot make this fixture pass.
   await db!.query('UPDATE p5_estimator_work SET payload=$1::jsonb WHERE draft_id=$2 AND work_key=$3',[JSON.stringify(before),qaId,work.pricingWorkKey(scope,config,date)]);
   fakeNow+=idle;permit=true;
   const repaired=await run(qaId),after=await payload(qaId) as QaRepairPayload;
   assert.equal(after.qaReviewWaitStartedAt,undefined);
   assert.equal(after.repairClock.startedAt,before.repairClock.startedAt+(scenario.pause?idle:0),'credit only the proven idle interval');
   assert.equal(after.repairClock.busyWaitMs,before.repairClock.busyWaitMs);
   for(const [key,value] of Object.entries(before.replies))assert.deepEqual(after.replies[key],value,'retained paid stages must remain unchanged');
   assert.deepEqual(after.shortlists,before.shortlists);
   const eligible=scenario.pause&&scenario.worked<=provider.REPAIR_BUDGET_MS;
   assert.equal(Boolean(repaired.customer.range),eligible);
   assert.equal(repairCompletions,eligible?1:0);
   assert.equal(repairAttempts,eligible?2:1,'spent work and unverified holds cannot reopen repair');
   assert.deepEqual([qaInventories,qaMappings,qaAudits],[1,1,eligible?2:1],'completed stages are reused after the pause');
   assert.equal(fakeNow-after.repairClock.startedAt,scenario.worked+(scenario.pause?0:idle)+(eligible?20000:0),'actual work and non-pause time still count');
   if(eligible){await run(qaId);assert.deepEqual([qaInventories,qaMappings,qaAudits,repairAttempts],[1,1,2,2],'reopening reuses the completed repair and audit');}
   else assert.ok(repaired.internal.scopePricing.issues.some((issue:string)=>issue.startsWith('Repair round skipped:')));
   pauseReceipts.push({code:scenario.code,workedMs:scenario.worked,creditedIdleMs:scenario.pause?idle:0,repairCompleted:eligible});
  }finally{Date.now=realNow;}
 }

 assert.equal((await db!.query('SELECT * FROM p5_estimator_work WHERE lease_token IS NOT NULL')).length,0);
 assert.equal((await db!.query('SELECT * FROM p5_estimator_outbox')).length,0);
 assert.equal(unexpectedNetwork,0,'every provider boundary is isolated');
 console.log(JSON.stringify({qaPauseReceipts:pauseReceipts,realProviderCalls:unexpectedNetwork,outboxRows:0}));
 console.log('PASS: saved SQL pricing timeout recovers, completed work is reused, actual retries stop at three, large mappings and output-limited audits stay split, unsplittable output remains held, and incomplete pricing creates no delivery. No live provider calls.');
}finally{
 globalThis.fetch=network;
 for(const name of credentialNames){if(environment[name]===undefined)delete process.env[name];else process.env[name]=environment[name];}
 if(db)await db.database.close();
 if(previous===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previous;
 await rm(dir,{recursive:true,force:true});
}
