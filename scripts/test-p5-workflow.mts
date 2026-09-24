import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,cp,mkdir,rm} from 'node:fs/promises';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {PDFDocument} from 'pdf-lib';
import {customerPdf,administrativePdf} from '../lib/p5/pdf.ts';
import {pdfTextLayers} from '../lib/p5/pdfText.ts';
import {estimateEmail} from '../lib/p5/estimateEmail.ts';
import {estimateSections,customerPresentation} from '../lib/p5/presentation.ts';
import {COST_CATEGORIES,calculateP5Estimate,customerEstimate} from '../lib/p5/pricing.ts';
import {mergeScopeFacts,requiredScopeQuestions,validateExtraction,validateAnswer} from '../lib/p5/scope.ts';
import {verifyUpload,prepareAnalysisFiles} from '../lib/p5/documents.ts';
import ExcelJS from 'exceljs';
import {ESTIMATOR_BRAND as brand} from '../lib/p5/brand.ts';

// All contacts, prices and forecasts in this script are synthetic test fixtures.
// Production modules are copied without changing their logic. Only database and
// external transport boundaries are replaced inside an isolated temporary folder.
// Pricing/workflow verification is offline; never let ambient provider secrets
// change which code path this fixture exercises.
for (const key of ['AI_INTEGRATIONS_OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_BASE_URL','OPENAI_API_KEY','ANTHROPIC_API_KEY']) delete process.env[key];
// This suite explicitly enables the capture-only CRM adapter to test its failure handling.
process.env.P5_CRM_DELIVERY='on';
process.env.P5_LINK_SECRET='isolated-workflow-test-secret';
const root=process.cwd();
await mkdir('p5-verification',{recursive:true});
const now=new Date();
const today=now.toISOString().slice(0,10);
const future=new Date(now.getTime()+86400000*20).toISOString().slice(0,10);
const finance={annualOverhead:420000,annualRevenue:6000000,forecastSource:'TEST ONLY; never deploy this forecast',reviewedAt:today,approvedBy:['Fixture']};
const leakingAssumption='$2.00/LF ($200.00 direct cost)';
const pricing:any={service:'kitchen',revision:'synthetic-fixture',scopeSummary:'TEST ONLY: kitchen planning scope, 200 square feet.',uncertainty:'high',locationProvided:false,
 lines:[{id:'trade',category:'subcontractors',description:'Synthetic written complete trade scope',quantity:1,unit:'package',unitCost:60000,quantitySource:'TEST scope',evidence:{basis:'written-quote',reference:'TEST ONLY',verifiedAt:today,validUntil:future}}],
 coverage:COST_CATEGORIES.map(category=>({category,status:category==='subcontractors'?'included':'not-applicable',reason:'Reviewed synthetic fixture only'})),risks:['limited-access'],assumptions:['Fixture layout retained.',`Preliminary trim allowance based on ${leakingAssumption}; confirm field quantity.`],exclusions:['Owner-supplied appliances.'],missingInformation:[],allowances:[]};
const internal=calculateP5Estimate(pricing,finance,[],now);
const customer=customerEstimate(internal,pricing.scopeSummary);
const fixtureId=randomUUID();
// The customer boundary holds on every customer output even if an internal
// pricing note reaches the saved customer result; the administrative record
// keeps the inspected note.
const leakingCustomer={...customer,assumptions:[...(customer.assumptions||[]),`Preliminary trim allowance based on ${leakingAssumption}; confirm field quantity.`]};
const customerEmail=estimateEmail(fixtureId,{customer:leakingCustomer,internal,contact:{name:'Test Customer'}},false);
assert.ok(!JSON.stringify(customerPresentation(leakingCustomer)).includes(leakingAssumption),'customer API result must not carry internal pricing arithmetic');
assert.ok(!JSON.stringify(estimateSections(leakingCustomer)).includes(leakingAssumption),'customer page sections must not carry internal pricing arithmetic');
assert.ok(!customerEmail.text.includes(leakingAssumption)&&!customerEmail.html.includes(leakingAssumption),'customer email must not carry internal pricing arithmetic');
assert.ok(JSON.stringify(estimateSections(leakingCustomer)).includes('confirm field quantity'),'the public part of a mixed note is kept');
assert.ok(internal.assumptions.some((note:string)=>note.includes(leakingAssumption)),'the administrative result retains the inspected audit note');
assert.ok(!(await pdfTextLayers(await customerPdf(fixtureId,leakingCustomer))).join('\n').includes(leakingAssumption),'customer PDF must not carry internal pricing arithmetic');
for(const [kind,bytes] of [['customer',await customerPdf(fixtureId,customer)],['administrative',await administrativePdf(fixtureId,{...internal,scope:{text:'TEST ONLY. '+('Long scope with room, dimensions, allowances and source evidence. '.repeat(120)),uploads:[{name:'A'.repeat(250)+'.pdf'}]}})]] as const){
 const doc=await PDFDocument.load(bytes);assert.ok(doc.getPageCount()>=1);if(kind==="customer")assert.ok(doc.getPageCount()<=3,"A short approved estimate and its full details must remain compact.");
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
 await writeFile(path.join(runtime,'deliveryAdapter.ts'),`import {crmPayload} from './deliveryPayloads.ts'; export const EMAIL_SUPPORTS_IDEMPOTENCY=true; export const attempts:any[]=[]; export const delivered=new Map(); export const failures=new Set<string>(); export async function adminRecipients(){return ['admin@example.invalid'];} export async function sendEmail(input:any){attempts.push(input);if(failures.has(input.to))throw new Error('Synthetic transport failure');if(!delivered.has(input.key))delivered.set(input.key,input);return 'test-'+input.key;} export const ambiguous=new Set<string>(); export async function syncCrm(record:any,key:string){const payload=crmPayload(record,key);attempts.push({crm:key,record,payload});if(failures.has('crm'))throw new Error('Synthetic CRM outage');if(!delivered.has(key))delivered.set(key,record);if(ambiguous.has('crm'))throw new Error('Synthetic acknowledgement lost after CRM accepted');return 'test-lead-'+key;}`);
 await writeFile(path.join(runtime,'adminAuth.ts'),`import {DraftError} from './store';export let enabled=true;export function disable(){enabled=false;}export function enable(){enabled=true;}export async function requireEstimatorAdmin(){if(!enabled)throw new DraftError('Administrator sign-in is required.',403);return {id:'fixture-admin',email:'admin@example.invalid'};}`);
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
 const record={draftId:id,revision:2,contact:payload.contact,scope:{text:payload.text,answers:payload.answers},internal,customer};
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
 assert.ok(customerMail);assert.match(customerMail.attachments[0].filename,/-preliminary-estimate-P5-[A-F0-9]+\.pdf$/);
 assert.ok(!customerMail.text.includes('operatingProfit'));
 const alertMail=[...transport.delivered.values()].find((v:any)=>v.subject?.includes('needs attention')) as any;
 assert.ok(alertMail);assert.equal(alertMail.attachments.length,0);
 const publicRecord=await store.readDraft(id,key);assert.equal(publicRecord.internal_estimate,undefined);
 await assert.rejects(store.saveDraft(id,key,'test',payload,2));
 // Recover a worker that died after sending: no duplicate CRM call, and an
 // administrator alert must survive atomically with the review state.
 const interruptedId=randomUUID(),interruptedKey=randomBytes(32).toString('hex');
 await store.saveDraft(interruptedId,interruptedKey,'test',payload,0);
 await outbox.enqueueSubmission(interruptedId,1,{...record,draftId:interruptedId,revision:1});
 await db.query("UPDATE p5_estimator_outbox SET status='sent' WHERE draft_id=$1",[interruptedId]);
 await db.query("UPDATE p5_estimator_outbox SET status='sending',attempts=6,locked_until=now()-interval '1 minute' WHERE draft_id=$1 AND destination IN ('crm','customer:customer@example.invalid')",[interruptedId]);
 const beforeRecovery=transport.attempts.length;
 await outbox.processOutbox({draftId:interruptedId});
 assert.equal(transport.attempts.length,beforeRecovery);
 const recovered=await db.query('SELECT destination,status FROM p5_estimator_outbox WHERE draft_id=$1',[interruptedId]);
 assert.equal(recovered.find((r:any)=>r.destination==='crm').status,'needs-review');
 assert.equal(recovered.find((r:any)=>r.destination==='customer:customer@example.invalid').status,'needs-review');
 assert.equal(recovered.filter((r:any)=>r.destination==='alert:admin@example.invalid').length,1);
 await outbox.processOutbox({draftId:interruptedId});
 assert.equal(transport.attempts.length,beforeRecovery+1);
 await outbox.processOutbox({draftId:interruptedId});
 assert.equal(transport.attempts.length,beforeRecovery+1);
 // The CRM copy is the bounded payload for the exact saved revision, and its
 // customer copy has passed through the customer boundary.
 const crmAttempt=transport.attempts.find((attempt:any)=>attempt.crm&&attempt.payload);
 assert.ok(crmAttempt,'The CRM attempt must carry a built payload.');
 assert.equal(crmAttempt.payload.estimate.id,crmAttempt.record.draftId);assert.equal(crmAttempt.payload.estimate.revision,crmAttempt.record.revision);
 assert.ok(!JSON.stringify(crmAttempt.payload.estimate.customer).includes(leakingAssumption));
 // A CRM may accept a lead and lose its acknowledgement. The saved external
 // key is retained for reconciliation, and the outbox must not call it again.
 const ambiguousId=randomUUID(),ambiguousKey=randomBytes(32).toString('hex');
 await store.saveDraft(ambiguousId,ambiguousKey,'test',payload,0);
 await outbox.enqueueSubmission(ambiguousId,1,{...record,draftId:ambiguousId,revision:1});
 await db.query("UPDATE p5_estimator_outbox SET status='sent' WHERE draft_id=$1 AND destination<>'crm'",[ambiguousId]);
 transport.ambiguous.add('crm');const crmAttempts=()=>transport.attempts.filter((attempt:any)=>attempt.crm).length,beforeAmbiguous=crmAttempts();
 await outbox.processOutbox({draftId:ambiguousId});await outbox.processOutbox({draftId:ambiguousId});
 assert.equal(crmAttempts(),beforeAmbiguous+1,'Ambiguous CRM acceptance must not be silently delivered twice');
 const [ambiguousCrm]=await db.query("SELECT status,last_error FROM p5_estimator_outbox WHERE draft_id=$1 AND destination='crm'",[ambiguousId]);
 assert.equal(ambiguousCrm.status,'needs-review');assert.match(ambiguousCrm.last_error,/acknowledgement lost/);
 transport.ambiguous.clear();
 // A revision-scoped run never drives another revision of the same draft.
 const scopedId=randomUUID(),scopedKey=randomBytes(32).toString('hex');
 await store.saveDraft(scopedId,scopedKey,'test',payload,0);
 await outbox.enqueueSubmission(scopedId,1,{...record,draftId:scopedId,revision:1});
 const beforeScoped=transport.attempts.length;
 assert.deepEqual(await outbox.processOutbox({draftId:scopedId,revision:7}),[]);
 assert.equal(transport.attempts.length,beforeScoped,'Another revision must not be delivered.');
 assert.equal((await outbox.processOutbox({draftId:scopedId,revision:1})).filter((r:any)=>r.status==='sent').length,3);
 assert.equal(transport.attempts.length,beforeScoped+3);
 const manual=await module('manualReview');
 const costBook=await module('costBook');
 const unresolvedScope={text:'TEST scope',answers:{service:'kitchen'},extraction:{summary:'TEST scope',facts:[],conflicts:[],missingInformation:[],reviewNotes:['plans.doc: saved for manual review. Export as PDF, XLSX, DOCX, JPEG or PNG for automatic extraction.']},uploads:[],reviewedAt:today,corrections:[]};
 const unreviewed=costBook.priceReviewedScope(unresolvedScope,{finance,costBooks:[{service:'kitchen',rules:pricing.lines.map((l:any)=>({...l,quantity:{fixed:l.quantity,factor:1}})),coverage:pricing.coverage,assumptions:[],exclusions:[],verifiedScope:'TEST ONLY',reviewedAt:today}]});
 assert.equal(unreviewed.customer.range,null);assert.ok(unreviewed.internal.warnings.some((w:any)=>w.code==='scope-review-required'));
 const conditionalBook={service:'kitchen',rules:[...pricing.lines.map((l:any)=>({...l,quantity:{fixed:l.quantity,factor:1}})),{...pricing.lines[0],id:'conditional-trade',when:{field:'structural',equals:'yes'},quantity:{fixed:1,factor:1}}],coverage:pricing.coverage,assumptions:[],exclusions:[],verifiedScope:'TEST ONLY',reviewedAt:today};
 const conditionalScope={...unresolvedScope,extraction:{...unresolvedScope.extraction,reviewNotes:[]}};
 const unknownCondition=costBook.priceReviewedScope(conditionalScope,{finance,costBooks:[conditionalBook]});
 assert.equal(unknownCondition.customer.range,null);
 assert.ok(unknownCondition.internal.missingInformation.some((v:string)=>v.startsWith('Missing cost condition:')));
 const knownCondition=costBook.priceReviewedScope({...conditionalScope,answers:{service:'kitchen',structural:'no'}},{finance,costBooks:[conditionalBook]});
 assert.ok(knownCondition.customer.range);
 const urgentId=randomUUID(),urgentKey=randomBytes(32).toString('hex');
 await store.saveDraft(urgentId,urgentKey,'test',{...payload,answers:{service:brand.services[0],urgency:'emergency'}},0);
 await db.query("INSERT INTO p5_estimator_policy(id,payload,updated_by) VALUES('current',$1::jsonb,'fixture')",[JSON.stringify({finance,costBooks:[]})]);
 const urgencyReview=await manual.saveManualReview({id:urgentId,expectedRevision:1,input:{...pricing,service:brand.services[0],urgency:'standard'},notes:'TEST ONLY: complete urgent project cost and scope review.'},{id:'fixture-admin',email:'admin@example.invalid'});
 assert.equal(urgencyReview.estimate.service,'rush');assert.ok(urgencyReview.estimate.targetOperatingProfit>=.25);
 const complexId=randomUUID(),complexKey=randomBytes(32).toString('hex');
 await store.saveDraft(complexId,complexKey,'test',{...payload,answers:{service:brand.services[0],complexity:'complex'}},0);
 const complexReview=await manual.saveManualReview({id:complexId,expectedRevision:1,input:{...pricing,service:brand.services[0],complexity:'standard'},notes:'TEST ONLY: explicitly complex scope must retain the higher default target.'},{id:'fixture-admin',email:'admin@example.invalid'});
 assert.equal(complexReview.estimate.targetOperatingProfit,.15);
 const complexFromScope=costBook.priceReviewedScope({...unresolvedScope,answers:{service:'kitchen',complexity:'complex'}},{finance,costBooks:[{...conditionalBook,rules:conditionalBook.rules.slice(0,1)}]});
 assert.equal(complexFromScope.internal.targetOperatingProfit,.15);
 const manualInput={...pricing,service:brand.services[0],revision:'server-assigned',targetMargin:.01};
 const notes='TEST ONLY: verified uploaded scope, cost evidence, exclusions, allowances and all risk dispositions.';
 const actor={id:'fixture-admin',email:'admin@example.invalid'};
 let review=await manual.saveManualReview({id,expectedRevision:2,input:manualInput,notes},actor);
 const referenceApi=await module('referenceEndpoint'),auth=await module('adminAuth');
 const request=(method:string,body:any)=>new Request('https://example.invalid/api/admin/p5-estimators/references',{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 auth.disable();assert.equal((await referenceApi.getReferences()).status,403);auth.enable();
 const initialReferences=await (await referenceApi.getReferences()).json();assert.equal(initialReferences.version,0);assert.equal(initialReferences.overheadRate,.20);
 const reference={id:'synthetic-reference',source:'SYNTHETIC ONLY',sourceDate:today,page:1,trade:'Other Project Work',description:'Identical synthetic complete trade scope',quantity:1,unit:'LS',unitPrice:100000,extendedPrice:100000,priceBasis:'customer-price',commercialStatus:'base',location:'Synthetic',conditions:'Identical test scope',warnings:[]};
 const referencePayload={version:0,references:[reference],notes:'TEST ONLY: verified selling-price basis, identical scope, location, date and units.'};
 assert.equal((await referenceApi.putReferences(request('PUT',referencePayload))).status,200);
 assert.equal((await referenceApi.putReferences(request('PUT',referencePayload))).status,409);
 const comparison={referenceVersion:1,reviewId:review.reviewId,selection:{referenceId:reference.id,costLineId:'trade',quantity:1,unit:'LS',adjustedCustomerUnitPrice:100000,scopeConfirmed:true,locationConfirmed:true,dateConfirmed:true,rationale:'TEST ONLY: verified equivalent complete scope, date, location and package units.'}};
 assert.equal((await referenceApi.postReferenceCheck(request('POST',{...comparison,selection:{...comparison.selection,quantity:2}}))).status,400);
 const comparisonResponse=await referenceApi.postReferenceCheck(request('POST',comparison));assert.equal(comparisonResponse.status,200);
 const compared=await comparisonResponse.json();assert.ok(Math.abs(compared.directCostBudget.maximumDirectUnitCost-100000*review.estimate.divisor/(1+review.estimate.contingencyRate))<1e-7);
 const adminApi=await module('adminEndpoint');
 assert.doesNotThrow(()=>adminApi.validateConfiguration({finance:{annualOverhead:420000,annualRevenue:null,forecastSource:'',reviewedAt:null,approvedBy:[]},costBooks:[]}));
 assert.throws(()=>adminApi.validateConfiguration({finance:{...finance,overheadRate:.08},costBooks:[]}));
 assert.throws(()=>adminApi.validateConfiguration({finance:{...finance,overheadRate:.175},costBooks:[]}));
 const sorted=(v:any):any=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,sorted(v[k])])):v;
 const oldId=createHash('sha256').update(JSON.stringify(sorted({id,revision:2,input:{...manualInput,revision:undefined},finance,notes}))).digest('hex');
 await db.query('INSERT INTO p5_estimator_reviews(id,draft_id,source_revision,input,finance,notes,actor_id) VALUES($1,$2,2,$3::jsonb,$4::jsonb,$5,$6)',[oldId,id,JSON.stringify({...manualInput,revision:oldId}),JSON.stringify(finance),notes,actor.id]);
 await assert.rejects(manual.currentReview(oldId),/pricing policy changed/);
 assert.equal((await referenceApi.postReferenceCheck(request('POST',{...comparison,reviewId:oldId}))).status,409);
 assert.equal((await db.query('SELECT * FROM p5_estimator_reference_checks')).length,1);
 assert.equal((await db.query('SELECT * FROM p5_estimator_reference_sets')).length,1);
 assert.equal(review.estimate.publishable,false);
 await assert.rejects(manual.publishManualReview({reviewId:review.reviewId,confirmed:true},actor));
 process.env.P5_OWNER_NICK_EMAIL='nick@example.invalid';process.env.P5_OWNER_JARED_EMAIL='jared@example.invalid';
 const exception={reviewId:review.reviewId,exception:'repeatable-scope',reason:'TEST ONLY: documented repeatable scope and verified supplier advantage for the exact revision.'};
 await assert.rejects(manual.approveManualReview(exception,actor));
 await manual.approveManualReview(exception,{id:'nick-fixture',email:'nick@example.invalid'});
 review=await manual.approveManualReview(exception,{id:'jared-fixture',email:'jared@example.invalid'});
 assert.equal(review.estimate.publishable,true);
 await db.query("UPDATE p5_estimator_policy SET payload=$1::jsonb WHERE id='current'",[JSON.stringify({finance:{...finance,annualRevenue:5500000},costBooks:[]})]);
 await assert.rejects(manual.publishManualReview({reviewId:review.reviewId,confirmed:true},actor));
 assert.equal((await referenceApi.postReferenceCheck(request('POST',comparison))).status,409);
 await db.query("UPDATE p5_estimator_policy SET payload=$1::jsonb WHERE id='current'",[JSON.stringify({finance,costBooks:[]})]);
 const changed=await manual.saveManualReview({id,expectedRevision:2,input:{...manualInput,scopeSummary:'Changed TEST scope'},notes},actor);
 assert.equal(changed.estimate.publishable,false);
 const published=await Promise.allSettled([manual.publishManualReview({reviewId:review.reviewId,confirmed:true},actor),manual.publishManualReview({reviewId:review.reviewId,confirmed:true},actor)]);
 assert.equal(published.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await store.readDraft(id,key)).revision,3);
 assert.equal((await db.query('SELECT * FROM p5_estimator_history')).length,1);
 const revisedJobs=await db.query('SELECT * FROM p5_estimator_outbox WHERE revision=3');
 assert.equal(revisedJobs.length,3);assert.equal(revisedJobs.find((r:any)=>r.destination==='crm').status,'needs-review');
 const crmJob=revisedJobs.find((r:any)=>r.destination==='crm');
 await manual.reconcileDelivery({deliveryId:crmJob.id,decision:'confirmed-sent',providerId:'fixture-existing-lead',evidence:'TEST ONLY: checked the CRM record and attached the updated scope, upload links and financial revision.'},actor);
 assert.equal((await db.query('SELECT * FROM p5_estimator_delivery_reviews')).length,1);
 await assert.rejects(manual.reconcileDelivery({deliveryId:crmJob.id,decision:'confirmed-not-sent',evidence:'TEST ONLY: repeated action must fail the atomic status check.'},actor));
 await assert.rejects(manual.publishManualReview({reviewId:review.reviewId,confirmed:true},actor));
 await outbox.processOutbox({draftId:id});
 assert.ok((await outbox.deliveryStatus(id)).every((d:any)=>d.status==='sent'));
 await db.database.close();
 await writeFile('p5-verification/workflow-results.json',JSON.stringify({passed:true,scope:'Isolated database, synthetic pricing fixtures, simulated delivery and CRM. No live email or CRM request was made.',checks:['PDF generation','customer page/PDF/email/CRM pricing privacy boundary','ambiguous CRM acknowledgement is never redelivered','revision-scoped delivery','high-confidence extraction','conflict preservation','low-confidence review','optional address','invalid upload','XLSX extraction','draft authorization','optimistic concurrency','upload deduplication','atomic submission','outbox deduplication','customer delivery retry','CRM ambiguity review','administrator alert','confidential result separation','manual cost review','authenticated distinct owner approvals','stale forecast approval rejection','changed scope approval rejection','atomic reviewed publication','revision history','CRM update duplicate guard','delivery reconciliation audit','unresolved document review blocks pricing','submitted urgency cannot silently lower margin','missing conditional cost answers block pricing','interrupted delivery alert and retry ceiling','private reference authorization','versioned reference import','stale reference import rejected','comparison tied to reviewed quantity and units','saved reference comparison audit','approved initial overhead without forecast','legacy policy approval invalidation','stale pricing comparison rejection','reference direct-cost ceilings','complex scope retains higher target in automatic and manual review']},null,2));
 console.log('P5 workflow checks passed (isolated database; simulated external services).');
}finally{await rm(runtime,{recursive:true,force:true,maxRetries:10,retryDelay:300});}
