import assert from 'node:assert/strict';
import {mkdtemp,cp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {digest} from './pricingQualification.ts';
import {exactPricingReplay} from './exactPricingReplay.mjs';
import {canonical,sha} from './recoveryEpoch.mjs';

export async function capturedPdfText(bytes:Uint8Array):Promise<string>{
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task=getDocument({data:new Uint8Array(bytes),useSystemFonts:true,isEvalSupported:false});
  const document=await task.promise;
  try{const pages:string[]=[];for(let n=1;n<=document.numPages;n++){
    const page=await document.getPage(n),content=await page.getTextContent();
    pages.push(content.items.map((item:any)=>item.str||'').join(' '));page.cleanup();
  }return pages.join('\n');}finally{await task.destroy();}
}
export interface CaptureOptions {
  uploads?:{name:string;type:string;data:Buffer}[];
  expectedPages?:{source:string;page:number}[];
  modelEvidence?:unknown;
  pricingReplay?:{configuration:unknown;configurationSha256:string;transcript:any;transcriptSha256:string;resultSha256:string;now:string};
}

export function isolatedCaptureFetch(assetFetch:typeof fetch):typeof fetch {
  return async(input,init)=>{
    const endpoint=typeof input==='string'?input:input instanceof URL?input.href:input.url;
    let url:URL;try{url=new URL(endpoint);}catch{throw new Error('capture:asset-url-invalid');}
    if(url.protocol!=='file:' && url.protocol!=='data:')throw new Error('capture:network-fetch-denied');
    return assetFetch(input,init);
  };
}

/** Exercise the unchanged outbox against a private local DB and capture-only
 * delivery adapter. No application DB, SMTP, email API or CRM module is loaded. */
export async function capturePricingDelivery(result:any,scope:any,artifacts:string,assetFetch:typeof fetch=globalThis.fetch,options:CaptureOptions={}) {
  assert.notEqual(process.env.P5_CRM_DELIVERY,'on','capture:CRM must remain off');
  assert.notEqual(process.env.P5_OBJECT_STORAGE_ENABLED,'true','capture:remote object storage must remain off');
  const cache=path.resolve('node_modules/.cache');await mkdir(cache,{recursive:true});
  const runtime=await mkdtemp(path.join(cache,'pricing-delivery-'));
  let db:any;const enclosingFetch=globalThis.fetch;
  globalThis.fetch=isolatedCaptureFetch(assetFetch);
  try {
    await cp('lib/p5',runtime,{recursive:true});
    await writeFile(path.join(runtime,'database.ts'),`import {PGlite} from '@electric-sql/pglite';const directory=${JSON.stringify(path.join(runtime,'private-db'))};export let database=new PGlite(directory);export async function query(s:string,v:unknown[]=[]){return (await database.query(s,v)).rows as any[];}export async function reopen(){await database.close();database=new PGlite(directory);}`);
    await writeFile(path.join(runtime,'deliveryAdapter.ts'),`export const EMAIL_SUPPORTS_IDEMPOTENCY=true;export const emails:any[]=[];export const crm:any[]=[];export async function adminRecipients(){return ['qualification-admin@example.invalid'];}export async function sendEmail(v:any){emails.push(v);return 'captured-'+v.key;}export async function syncCrm(record:any,key:string){crm.push({record,key});return 'captured-'+key;}`);
    const load=(name:string)=>import(pathToFileURL(path.join(runtime,`${name}.ts`)).href);
    db=await load('database');
    const store=await load('store'),outbox=await load('outbox'),capture=await load('deliveryAdapter');
    const id=randomUUID(),key=randomBytes(32).toString('hex');
    const contact={name:'Synthetic Qualification',email:'qualification-customer@example.invalid',phone:''};
    const payload={text:scope.text,answers:scope.answers,extraction:scope.extraction||null,reviewed:scope.extraction?scope:null,contact};
    const first=await store.saveDraft(id,key,'qualification',payload,0);
    const uploads=[];
    for(const file of options.uploads||[])uploads.push(await store.saveUpload(id,key,file));
    let semanticCoverageVerified=false;
    if(uploads.length){
      assert.ok(options.expectedPages?.length,'capture:independent source page inventory required');
      const client=await load('documentServiceClient'),validator=await load('scope');
      const {PDFDocument}=await import('pdf-lib');
      const inventoried=[];
      for(const upload of client.uniqueSourceUploads(uploads)){
        const file=options.uploads!.find(file=>digest(file.data)===upload.sha256)!;
        assert.equal(file.type,'application/pdf','capture:original-plan acceptance requires PDF bytes');
        const count=(await PDFDocument.load(file.data)).getPageCount();
        for(let page=1;page<=count;page++)inventoried.push({source:client.sourceIdentity(upload,uploads),page});
      }
      assert.deepEqual(options.expectedPages,inventoried,'capture:page inventory must match original PDF bytes');
      assert.deepEqual((scope.uploads||[]).map((f:any)=>[f.name,f.sha256,f.size]).sort(),uploads.map((f:any)=>[f.name,f.sha256,f.size]).sort(),'capture:reviewed source identity must match uploaded bytes');
      const extraction=validator.validateExtraction(scope.extraction);
      client.verifyDocumentModelEvidence(options.modelEvidence);
      client.assertProjectSourceCoverage(uploads,extraction);
      client.assertCompleteSourceCoverage(extraction,options.expectedPages!.map(p=>p.source),options.expectedPages,true);
      assert.deepEqual(scope.extraction,extraction,'capture:scope must contain the production-normalized extraction');
      payload.reviewed={...scope,uploads};semanticCoverageVerified=true;
    }else assert.equal(scope.uploads?.length||0,0,'capture:source bytes required for uploaded scope');
    let replayedStages:number|null=null;
    if(options.pricingReplay){
      assert.equal(process.env.NODE_TEST_CONTEXT,undefined,'capture:production shortlist path must not be skipped by the test runner');
      assert.equal(result,null,'capture:replay computes its own result');
      assert.ok(semanticCoverageVerified,'capture:original plan coverage required before pricing replay');
      const spec=options.pricingReplay;
      assert.equal(sha(canonical(spec.configuration)),spec.configurationSha256,'capture:approved pricing snapshot changed');
      assert.ok(Number.isFinite(Date.parse(spec.now)),'capture:original pricing timestamp required');
      const {ESTIMATOR_MODEL}=await load('modelPolicy');
      const replay=exactPricingReplay({transcript:spec.transcript,expectedSha256:spec.transcriptSha256,expectedModel:ESTIMATOR_MODEL});
      const pricing=await load('scopePricing');
      result=await pricing.priceCompleteScope(scope,structuredClone(spec.configuration),replay.request,new Date(spec.now),undefined,undefined,0,undefined,replay.selectBook);
      replayedStages=replay.assertComplete().replayedStages;
      assert.equal(sha(canonical(result)),spec.resultSha256,'capture:recomputed result must equal the original saved pricing result');
      assert.equal(sha(canonical(spec.configuration)),spec.configurationSha256);
      assert.ok(result.customer.range,'capture:original plan must produce a publishable price');
      assert.ok(result.internal.lines?.length,'capture:original plan must produce priced line items');
      assert.ok(result.internal.lines.every((line:any)=>Number.isFinite(line.cost)&&line.cost>=0),'capture:nonfinite or negative line cost');
    }
    const saved=await store.saveDraft(id,key,'qualification',payload,first.revision);
    await assert.rejects(store.saveDraft(id,key,'qualification',payload,first.revision),/updated elsewhere/);
    await db.reopen();
    const restored=await store.readDraft(id,key);
    assert.equal(restored.revision,saved.revision);assert.deepEqual(restored.extraction,JSON.parse(JSON.stringify(payload.extraction)));
    assert.deepEqual(restored.reviewed,JSON.parse(JSON.stringify(payload.reviewed)));assert.deepEqual(restored.answers,scope.answers);assert.equal(restored.text,scope.text);
    const restoredUploads=await store.readUploads(id,key);
    assert.deepEqual(restoredUploads.map((f:any)=>digest(f.data)).sort(),(options.uploads||[]).map(f=>digest(f.data)).sort());
    const pricingResultSha256=sha(canonical(result));
    const {issueRecord}=await load('estimateDocument'),{ESTIMATOR_BRAND}=await load('brand');
    const issue=issueRecord({brandId:ESTIMATOR_BRAND.id,id,revision:saved.revision,now:new Date(),contact,scope:payload.reviewed||scope});
    result={...result,customer:{...result.customer,issue}};
    const record={draftId:id,contact,scope:payload.reviewed||scope,internal:result.internal,customer:result.customer};
    assert.equal(await outbox.enqueueSubmission(id,saved.revision,record),true);
    assert.equal(await outbox.enqueueSubmission(id,saved.revision,record),false);
    await db.reopen();
    const [submitted]=await db.query('SELECT * FROM p5_estimator_drafts WHERE id=$1',[id]);
    assert.equal(submitted.status,'submitted');assert.deepEqual(submitted.internal_estimate,JSON.parse(JSON.stringify(result.internal)));assert.deepEqual(submitted.customer_estimate,JSON.parse(JSON.stringify(result.customer)));
    await outbox.processOutbox({draftId:id});
    await outbox.processOutbox({draftId:id});
    assert.equal(capture.emails.length,2);assert.equal(capture.crm.length,outbox.CRM_DELIVERY_ENABLED?1:0);
    if(outbox.CRM_DELIVERY_ENABLED){assert.deepEqual(capture.crm[0].record.customer,result.customer);assert.deepEqual(capture.crm[0].record.internal,result.internal);}
    else assert.equal((await db.query("SELECT 1 FROM p5_estimator_outbox WHERE destination='crm'")).length,0,'CRM off must enqueue nothing');
    assert.ok((await outbox.deliveryStatus(id)).every((d:any)=>d.status==='sent'));
    await mkdir(artifacts,{recursive:true});
    await writeFile(path.join(artifacts,'saved-estimate.json'),JSON.stringify({scope:payload.reviewed||scope,internal:submitted.internal_estimate,customer:submitted.customer_estimate},null,2));
    const mail=capture.emails.find((m:any)=>m.to===contact.email);
    assert.ok(mail && mail.attachments.length===1);
    const pdfPath=path.join(artifacts,'customer.pdf');
    await writeFile(pdfPath,mail.attachments[0].content);
    const pdfText=await capturedPdfText(mail.attachments[0].content);
    const money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n);
    assert.ok(result.customer.range,'Qualification requires an actual publishable customer price');
    for(const n of [result.customer.range.low,result.customer.range.high]){
      assert.ok(mail.text.includes(money(n)),'Customer email range must equal pricing result');
      assert.ok(pdfText.includes(money(n)),'Customer PDF range must equal pricing result');
    }
    assert.ok(!/operatingProfit|targetOperatingProfit/.test(mail.text+pdfText));
    const administrative=capture.emails.find((m:any)=>m.to!==contact.email);
    await writeFile(path.join(artifacts,'administrative.pdf'),administrative.attachments[0].content);
    const pdf=await load('pdf');
    const regenerated=await pdf.customerPdf(id,submitted.customer_estimate,submitted.submitted_at);
    assert.equal(await capturedPdfText(regenerated),pdfText,'Saved estimate download must match email PDF');
    const administrativeText=await capturedPdfText(administrative.attachments[0].content);
    assert.ok(administrativeText.includes('Direct project cost'),'Administrative PDF must retain internal cost detail');
    if(Number.isFinite(result.internal.directCost))assert.ok(administrativeText.includes(money(result.internal.directCost)),'Administrative direct cost must match saved estimate');
    assert.ok(!/Operating profit|Overhead recovery/i.test(pdfText),'Customer PDF must exclude internal profit build-up');
    const manifest={capturedOnly:true,businessWrites:0,externalSends:0,emails:capture.emails.map((m:any)=>({
      to:m.to,text:m.text,html:m.html,key:m.key,attachments:m.attachments.map((a:any)=>({
        filename:a.filename,sha256:digest(a.content)}))})),crm:capture.crm,
      customerPdfSha256:digest(await readFile(pdfPath)),administrativePdfSha256:digest(administrative.attachments[0].content),
      priceConsistency:true,persistedAfterReopen:true,staleWriteRejected:true,duplicateSubmissionRejected:true,replayedStages,pricingResultSha256,
      sourceHashes:restoredUploads.map((f:any)=>digest(f.data)),semanticCoverageVerified,crmEnabled:false,
      extractionSha256:payload.extraction?digest(JSON.stringify(payload.extraction)):null,
      reviewedScopeSha256:payload.reviewed?digest(JSON.stringify(payload.reviewed)):null};
    await writeFile(path.join(artifacts,'delivery.json'),JSON.stringify(manifest,null,2));
    return manifest;
  } finally {
    try {if(db)await db.database.close();await rm(runtime,{recursive:true,force:true});}
    finally {globalThis.fetch=enclosingFetch;}
  }
}
