import assert from 'node:assert/strict';
import {mkdtemp,cp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {digest} from './pricingQualification.ts';

export function isolatedCaptureFetch(assetFetch:typeof fetch):typeof fetch {
  return async(input,init)=>{
    const endpoint=typeof input==='string'?input:input instanceof URL?input.href:input.url;
    let url:URL;try{url=new URL(endpoint);}catch{throw new Error('capture:asset-url-invalid');}
    if(url.protocol!=='file:' && url.protocol!=='data:')throw new Error('capture:network-fetch-denied');
    return assetFetch(input,init);
  };
}

/** Exercise the unchanged outbox against a private in-memory DB and capture-only
 * delivery adapter. No application DB, SMTP, email API or CRM module is loaded. */
export async function capturePricingDelivery(result:any,scope:any,artifacts:string,assetFetch:typeof fetch=globalThis.fetch) {
  const cache=path.resolve('node_modules/.cache');await mkdir(cache,{recursive:true});
  const runtime=await mkdtemp(path.join(cache,'pricing-delivery-'));
  let db:any;const enclosingFetch=globalThis.fetch;
  globalThis.fetch=isolatedCaptureFetch(assetFetch);
  try {
    await cp('lib/p5',runtime,{recursive:true});
    await writeFile(path.join(runtime,'database.ts'),`import {PGlite} from '@electric-sql/pglite';export const database=new PGlite();export async function query(s:string,v:unknown[]=[]){return (await database.query(s,v)).rows as any[];}`);
    await writeFile(path.join(runtime,'deliveryAdapter.ts'),`export const EMAIL_SUPPORTS_IDEMPOTENCY=true;export const emails:any[]=[];export const crm:any[]=[];export async function adminRecipients(){return ['qualification-admin@example.invalid'];}export async function sendEmail(v:any){emails.push(v);return 'captured-'+v.key;}export async function syncCrm(record:any,key:string){crm.push({record,key});return 'captured-'+key;}`);
    const load=(name:string)=>import(pathToFileURL(path.join(runtime,`${name}.ts`)).href);
    db=await load('database');
    const store=await load('store'),outbox=await load('outbox'),capture=await load('deliveryAdapter');
    const id=randomUUID(),key=randomBytes(32).toString('hex');
    const contact={name:'Synthetic Qualification',email:'qualification-customer@example.invalid',phone:''};
    const record={draftId:id,contact,scope,internal:result.internal,customer:result.customer};
    await store.saveDraft(id,key,'qualification',{text:scope.text,answers:scope.answers,extraction:null,reviewed:null,contact},0);
    assert.equal(await outbox.enqueueSubmission(id,1,record),true);
    await outbox.processOutbox({draftId:id});
    await outbox.processOutbox({draftId:id});
    assert.equal(capture.emails.length,2);assert.equal(capture.crm.length,outbox.CRM_DELIVERY_ENABLED?1:0);
    if(outbox.CRM_DELIVERY_ENABLED){assert.deepEqual(capture.crm[0].record.customer,result.customer);assert.deepEqual(capture.crm[0].record.internal,result.internal);}
    else assert.equal((await db.query("SELECT 1 FROM p5_estimator_outbox WHERE destination='crm'")).length,0,'CRM off must enqueue nothing');
    assert.ok((await outbox.deliveryStatus(id)).every((d:any)=>d.status==='sent'));
    await mkdir(artifacts,{recursive:true});
    const mail=capture.emails.find((m:any)=>m.to===contact.email);
    assert.ok(mail && mail.attachments.length===1);
    const pdfPath=path.join(artifacts,'customer.pdf');
    await writeFile(pdfPath,mail.attachments[0].content);
    const pdfText=execFileSync('pdftotext',['-layout',pdfPath,'-'],{encoding:'utf8'});
    const money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n);
    assert.ok(result.customer.range,'Qualification requires an actual publishable customer price');
    for(const n of [result.customer.range.low,result.customer.range.high]){
      assert.ok(mail.text.includes(money(n)),'Customer email range must equal pricing result');
      assert.ok(pdfText.includes(money(n)),'Customer PDF range must equal pricing result');
    }
    assert.ok(!/operatingProfit|targetOperatingProfit/.test(mail.text+pdfText));
    const administrative=capture.emails.find((m:any)=>m.to!==contact.email);
    await writeFile(path.join(artifacts,'administrative.pdf'),administrative.attachments[0].content);
    const manifest={capturedOnly:true,businessWrites:0,externalSends:0,emails:capture.emails.map((m:any)=>({
      to:m.to,text:m.text,html:m.html,key:m.key,attachments:m.attachments.map((a:any)=>({
        filename:a.filename,sha256:digest(a.content)}))})),crm:capture.crm,
      customerPdfSha256:digest(await readFile(pdfPath)),priceConsistency:true};
    await writeFile(path.join(artifacts,'delivery.json'),JSON.stringify(manifest,null,2));
    return manifest;
  } finally {
    try {if(db)await db.database.close();await rm(runtime,{recursive:true,force:true});}
    finally {globalThis.fetch=enclosingFetch;}
  }
}