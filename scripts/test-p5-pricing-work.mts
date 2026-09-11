import assert from 'node:assert/strict';
import {mkdtemp,cp,writeFile,rm,mkdir} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
await mkdir('node_modules/.cache',{recursive:true});
const dir=await mkdtemp(path.join(process.cwd(),'node_modules/.cache/p5-pricing-work-'));
try{
 await cp('lib/p5',dir,{recursive:true});
 await writeFile(path.join(dir,'database.ts'),`import {PGlite} from '@electric-sql/pglite';export const database=new PGlite();export async function query(s:string,v:unknown[]=[]){return (await database.query(s,v)).rows;}`);
 await writeFile(path.join(dir,'scopePricing.ts'),`export const calls:string[]=[];export async function requestPricing(stage:string){calls.push(stage);await new Promise(r=>setTimeout(r,40));return {value:{stage},sourceUrls:[]};}export async function priceCompleteScope(scope:any,configuration:any,request:any){for(const stage of ['MAP','RESEARCH','AUDIT'])await request(stage,{scope},stage==='RESEARCH',255000);return {customer:{range:{low:100,high:150}}};}`);
 const load=(name:string)=>import(pathToFileURL(path.join(dir,name+'.ts')).href);
 const {saveDraft}=await load('store');const {priceSavedScope}=await load('pricingWork');const {PricingPending}=await load('pricingProgress');const provider=await load('scopePricing');const db=await load('database');
 const id=randomUUID(),key=randomBytes(32).toString('hex');
 await saveDraft(id,key,'test',{text:'Synthetic',answers:{},extraction:null,reviewed:null,contact:{name:'',email:'',phone:''}},0);
 const scope={text:'Synthetic',answers:{},extraction:null,uploads:[]};
 await assert.rejects(()=>priceSavedScope(id,scope,{}),PricingPending);assert.deepEqual(provider.calls,['MAP']);
 await assert.rejects(()=>priceSavedScope(id,scope,{}),PricingPending);assert.deepEqual(provider.calls,['MAP','RESEARCH']);
 assert.deepEqual((await priceSavedScope(id,scope,{})).customer.range,{low:100,high:150});assert.deepEqual(provider.calls,['MAP','RESEARCH','AUDIT']);
 await priceSavedScope(id,{...scope,reviewedAt:new Date().toISOString()},{});assert.equal(provider.calls.length,3,'A re-save of unchanged scope must reuse work');
 const results=await Promise.allSettled([priceSavedScope(id,{...scope,text:'Changed'},{}),priceSavedScope(id,{...scope,text:'Changed'},{})]);
 assert.ok(results.every(x=>x.status==='rejected'&&x.reason instanceof PricingPending));assert.equal(provider.calls.filter((s:string)=>s==='MAP').length,2,'Concurrent retries must claim only one provider request');
 const rows=await db.query('SELECT payload,lease_token FROM p5_estimator_work');assert.ok(rows.every((r:any)=>r.lease_token===null));
 await db.database.close();console.log('PASS: persisted pricing stages, resumed requests, unchanged-scope reuse, changed-scope invalidation and concurrent lease safety; isolated SQL and simulated AI only.');
}finally{await rm(dir,{recursive:true,force:true});}
