import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,cp,mkdir,rm} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {PDFDocument} from 'pdf-lib';
import {customerPdf,administrativePdf} from '../lib/p5/pdf.ts';
import {COST_CATEGORIES,calculateP5Estimate,customerEstimate} from '../lib/p5/pricing.ts';
import {mergeScopeFacts,requiredScopeQuestions,validateExtraction,validateAnswer} from '../lib/p5/scope.ts';
import {verifyUpload,prepareAnalysisFiles} from '../lib/p5/documents.ts';
import ExcelJS from 'exceljs';

// All contacts, prices and forecasts in this script are synthetic test fixtures.
// Production modules are copied without changing their logic. Only database and
// external transport boundaries are replaced inside an isolated temporary folder.
const root=process.cwd();
await mkdir('p5-verification',{recursive:true});
const now=new Date();
const today=now.toISOString().slice(0,10);
const future=new Date(now.getTime()+86400000*20).toISOString().slice(0,10);
const finance={annualOverhead:420000,annualRevenue:6000000,forecastSource:'TEST ONLY; never deploy this forecast',reviewedAt:today,approvedBy:['Fixture']};
const pricing:any={service:'kitchen',revision:'synthetic-fixture',scopeSummary:'TEST ONLY: kitchen planning scope, 200 square feet.',uncertainty:'high',locationProvided:false,
 lines:[{id:'trade',category:'subcontractors',description:'Synthetic written complete trade scope',quantity:1,unit:'package',unitCost:60000,quantitySource:'TEST scope',evidence:{basis:'written-quote',reference:'TEST ONLY',verifiedAt:today,validUntil:future}}],
 coverage:COST_CATEGORIES.map(category=>({category,status:category==='subcontractors'?'included':'not-applicable',reason:'Reviewed synthetic fixture only'})),risks:['limited-access'],assumptions:['Fixture layout retained.'],exclusions:['Owner-supplied appliances.'],missingInformation:[],allowances:[]};
const internal=calculateP5Estimate(pricing,finance,[],now);
const customer=customerEstimate(internal,pricing.scopeSummary);
const fixtureId=randomUUID();
for(const [kind,bytes] of [['customer',await customerPdf(fixtureId,customer)],['administrative',await administrativePdf(fixtureId,{...internal,scope:{text:'TEST ONLY. '+('Long scope with room, dimensions, allowances and source evidence. '.repeat(120)),uploads:[{name:'A'.repeat(250)+'.pdf'}]}})]] as const){
 const doc=await PDFDocument.load(bytes);assert.ok(doc.getPageCount()>=1);
 for(const page of doc.getPages()){assert.equal(page.getWidth(),612);assert.equal(page.getHeight(),792);}
 await writeFile(`p5-verification/${kind}.pdf`,bytes);
}
const extraction=validateExtraction({summary:"Synthetic kitchen scope",facts:[{field:'service',value:'kitchen',confidence:.98,source:'typed scope',evidence:'kitchen remodel'},{field:'sqft',value:'200',confidence:.95,source:'plan.pdf',evidence:'200 square feet'}],conflicts:[],missingInformation:[],reviewNotes:[]});
assert.equal(mergeScopeFacts({},extraction).answers.sqft,'200');
assert.ok(mergeScopeFacts({sqft:'300'},extraction).conflicts.length);
assert.equal(mergeScopeFacts({}, {...extraction,facts:extraction.facts.map(f=>({...f,confidence:.4}))}).answers.sqft,undefined);
assert.ok(!requiredScopeQuestions({service:'new-construction',sqft:'2000'}).includes('address'));
assert.ok(validateAnswer('sqft','-1'));assert.ok(validateAnswer('sqft','Infinity'));
assert.throws(()=>verifyUpload('not-a-plan.pdf',Buffer.from('invalid file')));
const workbook=new ExcelJS.Workbook();workbook.addWorksheet('Scope').addRows([['Room','Square feet'],['Kitchen',200]]);
const xlsx=Buffer.from(await workbook.xlsx.writeBuffer());
const office=await prepareAnalysisFiles([verifyUpload('scope.xlsx',xlsx)]);
assert.equal(office.manualReview.length,0);assert.ok(office.readable.some(f=>f.data.toString('utf8').includes('Kitchen')));

const cache=path.join(root,'node_modules','.cache');await mkdir(cache,{recursive:true});
const runtime=await mkdtemp(path.join(cache,'p5-test-'));
try{
 await cp(path.join(root,'lib/p5'),runtime,{recursive:true});
 await writeFile(path.join(runtime,'database.ts'),`import {PGlite} from '@electric-sql/pglite'; export const database=new PGlite(); export async function query(statement:string,values:unknown[]=[]){return (await database.query(statement,values)).rows as any[];}`);
 await writeFile(path.join(runtime,'deliveryAdapter.ts'),`export const EMAIL_SUPPORTS_IDEMPOTENCY=true; export const attempts:any[]=[]; export const delivered=new Map(); export const failures=new Set<string>(); export async function adminRecipients(){return ['admin@example.invalid'];} export async function sendEmail(input:any){attempts.push(input);if(failures.has(input.to))throw new Error('Synthetic transport failure');if(!delivered.has(input.key))delivered.set(input.key,input);return 'test-'+input.key;} export async function syncCrm(record:any,key:string){attempts.push({crm:key,record});if(failures.has('crm'))throw new Error('Synthetic CRM outage');if(!delivered.has(key))delivered.set(key,record);return 'test-lead-'+key;}`);
 const module=(name:string)=>import(pathToFileURL(path.join(runtime,name+'.ts')).href);
 const store=await module('store');const outbox=await module('outbox');const db=await module('database');const transport=await module('deliveryAdapter');
 const id=randomUUID(),key=randomBytes(32).toString('hex');
 const payload={text:'TEST project',answers:{service:'kitchen'},extraction:null,reviewed:null,contact:{name:'Test Customer',email:'customer@example.invalid',phone:''}};
 let draft=await store.saveDraft(id,key,'test',payload,0);assert.equal(draft.revision,1);
 await assert.rejects(store.readDraft(id,randomBytes(32).toString('hex')));
 const raced=await Promise.allSettled([store.saveDraft(id,key,'test',payload,1),store.saveDraft(id,key,'test',payload,1)]);
 assert.equal(raced.filter(r=>r.status==='fulfilled').length,1);draft=await store.readDraft(id,key);assert.equal(draft.revision,2);
 const upload={name:'scope.txt',type:'text/plain',data:Buffer.from('Synthetic scope')};
 const u1=await store.saveUpload(id,key,upload),u2=await store.saveUpload(id,key,upload);assert.equal(u1.id,u2.id);
 assert.equal((await store.readUploads(id,key)).length,1);
 const record={draftId:id,contact:payload.contact,scope:{text:payload.text,answers:payload.answers},internal,customer};
 const submitted=await Promise.all([outbox.enqueueSubmission(id,2,record),outbox.enqueueSubmission(id,2,record)]);
 assert.equal(submitted.filter(Boolean).length,1);
 assert.equal((await db.query('SELECT * FROM p5_estimator_outbox')).length,3);
 transport.failures.add('customer@example.invalid');transport.failures.add('crm');
 await outbox.processOutbox({draftId:id});
 const failed=await db.query('SELECT destination,status FROM p5_estimator_outbox');
 assert.equal(failed.find((r:any)=>r.destination==='crm').status,'needs-review');
 assert.equal(failed.find((r:any)=>r.destination==='customer:customer@example.invalid').status,'retry');
 assert.equal((await store.readDraft(id,key)).status,'submitted');
 assert.ok(failed.some((r:any)=>r.destination==='alert:admin@example.invalid'));
 transport.failures.clear();await db.query("UPDATE p5_estimator_outbox SET next_attempt_at=now() WHERE status='retry'");
 await outbox.processOutbox({draftId:id});
 const attemptsBefore=transport.attempts.length;await outbox.processOutbox({draftId:id});assert.equal(transport.attempts.length,attemptsBefore);
 const customerMail=[...transport.delivered.values()].find((v:any)=>v.to==='customer@example.invalid') as any;
 assert.ok(customerMail);assert.match(customerMail.attachments[0].filename,/-customer.pdf$/);
 assert.ok(!customerMail.text.includes('operatingProfit'));
 const alertMail=[...transport.delivered.values()].find((v:any)=>v.subject?.includes('needs attention')) as any;
 assert.ok(alertMail);assert.equal(alertMail.attachments.length,0);
 const publicRecord=await store.readDraft(id,key);assert.equal(publicRecord.internal_estimate,undefined);
 await assert.rejects(store.saveDraft(id,key,'test',payload,2));
 await db.database.close();
 await writeFile('p5-verification/workflow-results.json',JSON.stringify({passed:true,scope:'Isolated database, synthetic pricing fixtures, simulated delivery and CRM. No live email or CRM request was made.',checks:['PDF generation','high-confidence extraction','conflict preservation','low-confidence review','optional address','invalid upload','XLSX extraction','draft authorization','optimistic concurrency','upload deduplication','atomic submission','outbox deduplication','customer delivery retry','CRM ambiguity review','administrator alert','confidential result separation']},null,2));
 console.log('P5 workflow checks passed (isolated database; simulated external services).');
}finally{await rm(runtime,{recursive:true,force:true});}
