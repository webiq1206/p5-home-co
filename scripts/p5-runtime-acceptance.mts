import assert from 'node:assert/strict';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {estimateEmail} from '../lib/p5/estimateEmail.ts';
import {estimateSections} from '../lib/p5/presentation.ts';

/**
 * Read-only acceptance of one already-completed, clearly marked QA submission.
 *
 * Required environment:
 * P5_ACCEPTANCE_BASE_URL          Published or preview origin.
 * P5_ACCEPTANCE_DRAFT_ID          Existing QA draft UUID.
 * P5_ACCEPTANCE_DRAFT_KEY         The original 64-hex browser draft key.
 * P5_ACCEPTANCE_EXPECTED_REVISION Exact submitted revision.
 * P5_ACCEPTANCE_ADMIN_COOKIE      Authenticated administrator Cookie header.
 *
 * This runner performs GET requests only. It never submits a draft, processes
 * delivery, sends email, writes CRM data, or creates a customer record.
 */
const required=(name:string)=>{const value=process.env[name]?.trim();if(!value)throw new Error(`${name} is required.`);return value;};
const base=required('P5_ACCEPTANCE_BASE_URL').replace(/\/+$/,'');
const id=required('P5_ACCEPTANCE_DRAFT_ID');
const key=required('P5_ACCEPTANCE_DRAFT_KEY');
const revision=Number(required('P5_ACCEPTANCE_EXPECTED_REVISION'));
const cookie=required('P5_ACCEPTANCE_ADMIN_COOKIE');
const origin=new URL(base);
if(origin.protocol!=='https:'&&!['localhost','127.0.0.1','::1'].includes(origin.hostname))throw new Error('P5_ACCEPTANCE_BASE_URL must use HTTPS outside the local machine.');
if(!/^[a-f0-9-]{36}$/i.test(id)||!/^[a-f0-9]{64}$/i.test(key))throw new Error('Use the original browser draft ID and key.');
if(!Number.isInteger(revision)||revision<1)throw new Error('P5_ACCEPTANCE_EXPECTED_REVISION must be a positive integer.');

const read=async(path:string,headers:Record<string,string>={})=>{
  const response=await fetch(base+path,{method:'GET',headers,redirect:'error'});
  if(!response.ok)throw new Error(`${path} returned HTTP ${response.status}.`);
  return response;
};
const draftHeaders={'x-p5-draft-id':id,'x-p5-draft-key':key};
const adminHeaders={cookie};
const draft=(await (await read('/api/p5-estimator/draft?events=1',draftHeaders)).json()).draft;
assert.ok(draft,'The authenticated browser draft was not found.');
assert.equal(draft.id,id);
assert.equal(draft.revision,revision,'The saved browser revision changed; inspect before accepting.');
assert.equal(draft.status,'submitted','Runtime acceptance requires an already-submitted QA session.');

const admin=await (await read(`/api/admin/p5-estimators?id=${encodeURIComponent(id)}`,adminHeaders)).json();
assert.equal(admin.estimate.id,id);
assert.equal(Number(admin.estimate.revision),revision,'The admin record and browser revision differ.');
assert.ok(admin.estimate.customer_estimate?.range,'The genuine customer selling range is missing.');
assert.ok(admin.estimate.internal_estimate?.contractPrice,'The genuine internal pricing result is missing.');
assert.ok(Array.isArray(admin.deliveries)&&admin.deliveries.some((row:any)=>row.destination==='crm'),'The CRM delivery record is missing.');
assert.ok(admin.deliveries.some((row:any)=>String(row.destination).startsWith('customer:')),'The customer email delivery record is missing.');
assert.ok(admin.deliveries.some((row:any)=>String(row.destination).startsWith('admin:')),'The administrator delivery record is missing.');

const pdfBytes=async(path:string,headers:Record<string,string>)=>new Uint8Array(await (await read(path,headers)).arrayBuffer());
const pdfText=async(data:Uint8Array)=>{const pdf=await getDocument({data}).promise;const pages=[];for(let n=1;n<=pdf.numPages;n++){const content=await (await pdf.getPage(n)).getTextContent();pages.push(content.items.map((item:any)=>item.str||'').join(' '));}return pages.join('\n');};
const customerPdfText=await pdfText(await pdfBytes('/api/p5-estimator/pdf',draftHeaders));
const adminCustomerPdfText=await pdfText(await pdfBytes(`/api/admin/p5-estimators?id=${encodeURIComponent(id)}&pdf=customer`,adminHeaders));
const adminPdfText=await pdfText(await pdfBytes(`/api/admin/p5-estimators?id=${encodeURIComponent(id)}&pdf=administrative`,adminHeaders));
const record={customer:admin.estimate.customer_estimate,internal:admin.estimate.internal_estimate,contact:admin.estimate.payload?.contact};
const customerEmail=estimateEmail(id,record,false);
const adminEmail=estimateEmail(id,record,true);
const customerPage=JSON.stringify(estimateSections(record.customer));
const customerSurfaces=[JSON.stringify(record.customer),customerPage,customerEmail.text,customerEmail.html,customerPdfText,adminCustomerPdfText];
const privatePatterns=[/\bdirect costs?\b/i,/\bunit costs?\b/i,/\boverhead recovery\b/i,/\boperating profit\b/i,/\bpricing divisor\b/i];
for(const surface of customerSurfaces)for(const pattern of privatePatterns)assert.ok(!pattern.test(surface),`Customer output crossed the private pricing boundary (${pattern}).`);
assert.ok(/Direct project cost/i.test(adminPdfText)&&/Operating profit/i.test(adminPdfText),'The administrative PDF is missing its private financial breakdown.');
assert.ok(/INTERNAL FINANCIAL BREAKDOWN/.test(adminEmail.text),'The administrator email is missing its private financial breakdown.');

console.log(JSON.stringify({
  passed:true,
  mode:'read-only-authenticated-runtime-acceptance',
  revision,
  checks:['browser draft authentication','exact revision','saved final pricing','customer page boundary','customer PDF boundary','customer email boundary','administrator PDF boundary','administrator email boundary','CRM delivery presence'],
  writeRequests:0,
  sends:0,
  customerRecordsCreated:0,
}));