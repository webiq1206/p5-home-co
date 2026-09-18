// Real isolated SQL and pricing orchestration, with synthetic provider responses.
import assert from 'node:assert/strict';
import {mkdtemp,cp,writeFile,rm,mkdir,rename} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

await mkdir('node_modules/.cache',{recursive:true});
const dir=await mkdtemp(path.join(process.cwd(),'node_modules/.cache/p5-pricing-recovery-'));
const previous=process.env.DATABASE_URL;
type SavedPayload={replies:Record<string,{timeouts?:number}>};
type StageInput={taskBatch?:{id:string;description:string;evidence:string}[]};
let db:{database:{close():Promise<void>};query(sql:string,values?:unknown[]):Promise<{payload:SavedPayload}[]>}|undefined;
try{
 delete process.env.DATABASE_URL;
 await cp('lib/p5',dir,{recursive:true});
 await writeFile(path.join(dir,'database.ts'),`import {PGlite} from '@electric-sql/pglite';export const database=new PGlite();export async function query(s:string,v:unknown[]=[]){return (await database.query(s,v)).rows;}`);
 // Keep the real pricing engine. Replace only its external provider boundary.
 await rename(path.join(dir,'scopePricing.ts'),path.join(dir,'scopePricingReal.ts'));
 await writeFile(path.join(dir,'scopePricing.ts'),`export * from './scopePricingReal.ts';let provider:any;export const setProvider=(value:any)=>{provider=value;};export const requestPricing=(...args:any[])=>provider(...args);`);
 const mod=(name:string)=>import(pathToFileURL(path.join(dir,name+'.ts')).href);
 const store=await mod('store'),work=await mod('pricingWork'),provider=await mod('scopePricing');
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

 const split=await newDraft();const sizes:number[]=[];
 const tasks=Array.from({length:6},(_,i)=>({...task,id:'cabinet-'+i,description:'Synthetic component '+i}));
 provider.setProvider(async(_instructions:string,value:unknown)=>{
  const input=value as StageInput;
  if(input.taskBatch){sizes.push(input.taskBatch.length);if(input.taskBatch.length>3)throw new ProcessingDeadlineError();return reply({tasks:input.taskBatch.map(item=>({...item,existingLineIds:lines,additions:[],researchDescription:'',issues:[]})),issues:[]});}
  if('priorPricingIssues' in input)return reply({coveredTaskIds:tasks.map(item=>item.id),issues:[]});
  return reply({tasks,issues:[]});
 });
 await run(split);assert.deepEqual(sizes,[6,3,3]);
 await run(split);assert.deepEqual(sizes,[6,3,3],'timed-out large mapping stays split on replay');
 assert.equal((await db!.query('SELECT * FROM p5_estimator_work WHERE lease_token IS NOT NULL')).length,0);
 assert.equal((await db!.query('SELECT * FROM p5_estimator_outbox')).length,0);
 console.log('PASS: saved SQL pricing timeout recovers, completed work is reused, actual retries stop at three, large mappings stay split, and incomplete pricing creates no delivery. No live provider calls.');
}finally{
 if(db)await db.database.close();
 if(previous===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previous;
 await rm(dir,{recursive:true,force:true});
}
