import assert from 'node:assert/strict';
import {mkdtemp,cp,writeFile,rm,mkdir} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

await mkdir('node_modules/.cache',{recursive:true});
const dir=await mkdtemp(path.join(process.cwd(),'node_modules/.cache/p5-pricing-identity-'));
let database:any;
try{
 await cp('lib/p5',dir,{recursive:true});
 await writeFile(path.join(dir,'database.ts'),`import {PGlite} from '@electric-sql/pglite';export const database=new PGlite();export async function query(s:string,v:unknown[]=[]){return (await database.query(s,v)).rows;}`);
 await writeFile(path.join(dir,'scopePricing.ts'),`
 export const PRICING_STAGE_MAX_MS=150000;
 export let calls=0;let variant=0;let reverse=false;
 export function scenario(v:number,r=false){variant=v;reverse=r;}
 export async function requestPricing(instructions:string,input:any){calls++;return {value:{instructions,input},sourceUrls:[]};}
 export async function priceCompleteScope(scope:any,configuration:any,request:any,now:Date){
   const inputs=[{taskBatch:[{id:'doors',quantity:variant?1:4}],responsibility:variant?'owner supplies three':'contractor supplies four',date:now.toISOString()},
     {taskBatch:[{id:'trim',quantity:120}],date:now.toISOString()}];
   if(reverse)inputs.reverse();
   const results=[];
   for(const input of inputs)results.push(await request('You are a construction estimator',input,false,150000));
   return {customer:{range:{low:100,high:150}},results,inputs};
 }
 `);
 const load=(name:string)=>import(pathToFileURL(path.join(dir,name+'.ts')).href);
 database=await load('database');
 const work=await load('pricingWork'),provider=await load('scopePricing'),store=await load('store');
 const {ESTIMATOR_BRAND}=await load('brand');
 const id=randomUUID();
 await store.saveDraft(id,randomBytes(32).toString('hex'),ESTIMATOR_BRAND.id,{text:'Test scope',answers:{},extraction:null,reviewed:null,contact:{name:'',email:'',phone:''}},0);
 const scope={text:'Test scope',answers:{},extraction:null,uploads:[]};
 const date=new Date('2026-09-19T01:00:00Z');
 const run=(time=date)=>work.priceSavedScope(id,scope,{},time);
 const check=(result:any)=>assert.deepEqual(result.results.map((r:any)=>r.value.input),result.inputs,'each reply belongs to its exact requested scope');
 check(await run());assert.equal(provider.calls,2);
 provider.scenario(0,true);check(await run(new Date('2026-09-19T02:00:00Z')));
 assert.equal(provider.calls,2,'reordering and a later resume reuse completed requests');
 provider.scenario(1);check(await run());
 assert.equal(provider.calls,3,'changed quantity and responsibility invalidate only the affected batch');
 provider.scenario(0);check(await run());assert.equal(provider.calls,3,'earlier exact evidence is still available');
 const key=work.pricingWorkKey(scope,{},date);
 const [row]=await database.query('SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[id,key]);
 assert.equal(row.payload.pricingAt,date.toISOString());
 // Historical position-only replies have no evidence tying them to current
 // quantities. Preserve the records, but never treat them as a validated hit.
 row.payload.replies={'mapping#1':{value:{input:'wrong historical scope'},sourceUrls:[]}};
 await database.query('UPDATE p5_estimator_work SET payload=$1::jsonb WHERE draft_id=$2 AND work_key=$3',[JSON.stringify(row.payload),id,key]);
 check(await run());assert.equal(provider.calls,5);
 const [retained]=await database.query('SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[id,key]);
 assert.ok(retained.payload.replies['mapping#1'],'historical checkpoints remain available for inspection');
 console.log('PASS: exact input replay, reordered batches, frozen pricing date, selective invalidation and retained historical checkpoints. Isolated SQL and synthetic responses only.');
}finally{
 if(database)await database.database.close();
 await rm(dir,{recursive:true,force:true});
}
