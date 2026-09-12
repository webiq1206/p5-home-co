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
 await writeFile(path.join(dir,'scopePricing.ts'),`export const calls:string[]=[];let blocked=false;export function block(){blocked=true;}export async function requestPricing(stage:string){calls.push(stage);await new Promise(r=>setTimeout(r,40));return {value:{stage},sourceUrls:[]};}export async function priceCompleteScope(scope:any,configuration:any,request:any){for(const stage of ['MAP','RESEARCH','AUDIT'])await request(stage,{scope},stage==='RESEARCH',255000);return blocked?{customer:{range:null},internal:{missingInformation:["Missing quantity: tileSqft for tile work"],privateCostDetail:"INTERNAL_ONLY"}}:{customer:{range:{low:100,high:150}}};}`);
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
 // Regional allowances are reusable evidence, never edits to the approved book.
 const regional=await load('regionalRates');
 const rule={id:'well-allowance',description:'Synthetic well pump',category:'materials',unit:'EA',unitCost:100,quantity:{fixed:8,factor:1},building:'Alpha',floor:'First',scopeTaskId:'scope-well',estimatingBasis:'sourced-market-average',evidence:{validUntil:'2099-01-01',provenance:{sources:[{url:'https://supplier.example.invalid/well-pump',date:'2026-09-12',dateBasis:'retrieved'}]}}};
 const original=JSON.stringify(rule);
 await regional.saveRegionalRates(id,' Emmett,  Idaho ',[rule,{...rule,id:'owner-rate',estimatingBasis:'owner-average'}]);
 const local=await regional.readRegionalRates('emmett, idaho',new Date('2026-09-12'));
 assert.equal(local.length,1);assert.deepEqual(local[0].quantity,{fixed:1,factor:1});assert.equal(local[0].building,undefined);assert.equal(local[0].floor,undefined);assert.equal(local[0].scopeTaskId,undefined);
 assert.equal(JSON.stringify(rule),original,'Saving regional evidence must not mutate approved input costs or scope');
 assert.equal((await regional.readRegionalRates('Boise, Idaho',new Date('2026-09-12'))).length,0,'Another location cannot inherit this allowance without new evidence');
 assert.equal((await regional.readRegionalRates('Emmett, Idaho',new Date('2100-01-01'))).length,0,'Expired evidence must not be reused');
 const [savedRate]=await db.query("SELECT payload FROM p5_estimator_work WHERE work_key LIKE 'regional-rate-v1-%'");assert.equal(savedRate.payload.status,'estimated');assert.equal(savedRate.payload.rate.evidence.provenance.sources[0].dateBasis,'retrieved');
 // Exercise the real submission route against isolated SQL. No transport may
 // run for an incomplete quote, and the saved draft must remain editable.
 await writeFile(path.join(dir,'outbox.ts'),`export async function enqueueSubmission(){throw new Error('An incomplete quote reached delivery');}export async function deliveryStatus(){return [];}export async function processOutbox(){throw new Error('An incomplete quote reached transport');}`);
 const {postSubmission}=await load('submitEndpoint');const {ESTIMATOR_BRAND}=await load('brand');
 const {getCustomerPdf}=await load('customerPdfEndpoint');
 const beforeContactCalls=provider.calls.length;
 for(const contact of [{name:'',email:'customer@example.invalid',phone:''},{name:'Test Customer',email:'',phone:''},{name:'Test Customer',email:'not-an-email',phone:''},{name:'  ',email:'customer@example.invalid',phone:''}]){
  const contactId=randomUUID(),contactKey=randomBytes(32).toString('hex');
  const contactDraft=await saveDraft(contactId,contactKey,'test',{text:'Synthetic contact gate',answers:{service:ESTIMATOR_BRAND.services[0]},extraction:null,reviewed:{...scope,answers:{service:ESTIMATOR_BRAND.services[0]}},contact},0);
  const headers={'x-p5-draft-id':contactId,'x-p5-draft-key':contactKey,'Content-Type':'application/json'};
  const call=()=>postSubmission(new Request('https://example.test/api/p5-estimator/submit',{method:'POST',headers,body:JSON.stringify({revision:contactDraft.revision,background:true})}));
  const blocked=await call();assert.equal(blocked.status,400);assert.equal((await blocked.json()).result,undefined);
  assert.equal((await getCustomerPdf(new Request('https://example.test/api/p5-estimator/pdf',{headers}))).status,404);
  // Even an old/inconsistent submitted record must not bypass contact capture.
  await db.query("UPDATE p5_estimator_drafts SET status='submitted', customer_estimate=$2 WHERE id=$1",[contactId,JSON.stringify({range:{low:100,high:150}})]);
  assert.equal((await call()).status,400);
  assert.equal((await getCustomerPdf(new Request('https://example.test/api/p5-estimator/pdf',{headers}))).status,400);
 }
 assert.equal(provider.calls.length,beforeContactCalls,'Missing contact must not begin pricing or provider calls');
 assert.equal((await db.query('SELECT * FROM p5_estimator_outbox')).length,0,'Missing contact must not enqueue email or CRM');
 const blockedId=randomUUID(),blockedKey=randomBytes(32).toString('hex');
 const reviewed={...scope,answers:{service:ESTIMATOR_BRAND.services[0]},reviewedAt:new Date().toISOString(),corrections:[]};
 const blockedDraft=await saveDraft(blockedId,blockedKey,'test',{text:reviewed.text,answers:reviewed.answers,extraction:null,reviewed,contact:{name:'Test Customer',email:'customer@example.invalid',phone:''}},0);
 provider.block();
 const submit=()=>postSubmission(new Request('https://example.test/api/p5-estimator/submit',{method:'POST',headers:{'x-p5-draft-id':blockedId,'x-p5-draft-key':blockedKey,'Content-Type':'application/json'},body:JSON.stringify({revision:blockedDraft.revision})}));
 assert.equal((await submit()).status,202);assert.equal((await submit()).status,202);
 const held=await submit();assert.equal(held.status,422);const message=await held.json();assert.equal(message.pricingReviewRequired,true);assert.ok(!JSON.stringify(message).includes('INTERNAL_ONLY'));assert.ok(!message.error.includes('tileSqft'));
 const [retained]=await db.query('SELECT status,internal_estimate,customer_estimate FROM p5_estimator_drafts WHERE id=$1',[blockedId]);assert.equal(retained.status,'draft');assert.equal(retained.customer_estimate,null);assert.equal(retained.internal_estimate.privateCostDetail,'INTERNAL_ONLY');assert.equal((await db.query('SELECT * FROM p5_estimator_outbox')).length,0);
 await db.database.close();console.log('PASS: persisted pricing stages, resumed requests, unchanged-scope reuse, changed-scope invalidation and concurrent lease safety; isolated SQL and simulated AI only.');
}finally{await rm(dir,{recursive:true,force:true});}
