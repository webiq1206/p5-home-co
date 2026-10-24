import {intakeDeliveryEnvelope,intakeOperationKey,intakeLocalCrmRecord} from '../lib/p5/intakeDeliveryPayload.ts';
import {intakeProjectReview} from '../lib/p5/intakeProjectReview.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {renderIntakePdf} from '../lib/p5/intakePdf.ts';
import {pdfTextLayers} from '../lib/p5/pdfText.ts';
import {renderIntakeEmail} from '../lib/p5/intakeEmail.ts';
import {emptyIntakeDetails,intakeReceipt,type IntakeSnapshot} from '../lib/p5/intakeContract.ts';
import {routeIntake} from '../lib/p5/intakePolicy.ts';

function fixture():IntakeSnapshot{return {schema:1,projectId:'p5:12345678-1234-4234-8234-123456789abc',draftId:'12345678-1234-4234-8234-123456789abc',originSite:'p5',currentSite:'p5',revision:78,contextVersion:1,savedAt:'2026-10-15T01:02:03.000Z',contact:{name:'PDF TEST ONLY - Zoë García',email:'fixture@example.invalid',phone:'',preferredContact:'email'},details:emptyIntakeDetails(),scope:{text:'Café entry\nKeep the existing door.\nDo not change the baño.',answers:{service:'handyman'},uploads:[],extraction:{privateNote:'DO_NOT_DISCLOSE_INTERNAL_DATA'} as never},routing:routeIntake('p5','handyman'),unresolved:[]};}

test('received request is a real readable PDF with reference and no invented price or internal data',async()=>{
 const s=fixture(),bytes=await renderIntakePdf(s);
 assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
 const text=(await pdfTextLayers(bytes)).join('\n');
 for(const expected of ['P5 Home Co','P5-1234567812','Zoë García','Café','baño','Keep the existing door.','No files were submitted.','not a priced estimate'])assert.ok(text.includes(expected),expected);
 assert.doesNotMatch(text,/DO_NOT_DISCLOSE|Revision 78|\$0/);
 const doc=await PDFDocument.load(bytes);assert.equal(doc.getCreationDate()?.toISOString(),s.savedAt);
});

test('long multiline input and unbroken strings paginate without losing the end of the request',async()=>{
 const s=fixture();s.scope.text=Array.from({length:220},(_,i)=>`Task ${i+1}: Preserve the room's existing finishes. Café résumé München.`).join('\n')+'\n'+ 'LongUnbrokenScope'.repeat(40)+'\nFINAL_REQUEST_SENTINEL';
 const before=JSON.stringify(s),bytes=await renderIntakePdf(s),pages=await pdfTextLayers(bytes);
 assert.ok(pages.length>4);assert.ok(pages.join('\n').includes('FINAL_REQUEST_SENTINEL'));
 assert.ok(pages.every(p=>p.includes('P5-1234567812')));assert.equal(JSON.stringify(s),before);
});

test('customer acknowledgment leads with received status, next steps and a mobile call action without revision language',()=>{
 const message=renderIntakeEmail(fixture(),false,[]);
 assert.match(message.subject,/Your project request P5-/);assert.doesNotMatch(message.subject,/revision/i);
 assert.match(message.html,/Your project request has been received/);
 assert.ok(message.html.indexOf('What happens next')<message.html.indexOf('Project at a glance'));
 assert.match(message.html,/href="tel:\+12084771169"/);assert.match(message.text,/Call \(208\) 477-1169/);
 assert.doesNotMatch(message.html,/Revision 78/);assert.doesNotMatch(message.text,/Revision 78/);
});

test('unsupported Unicode fails closed instead of issuing an incomplete PDF',async()=>{
 const s=fixture();s.contact.name='李';const before=JSON.stringify(s);
 await assert.rejects(renderIntakePdf(s),/payload-review/);
 assert.equal(JSON.stringify(s),before);
});

test('one assigned reference is consistent across receipt, both emails, PDF and CRM without changing operation identity',async()=>{
 const s=fixture(),priorKey=intakeOperationKey(s,'crm');
 assert.equal(Object.hasOwn(JSON.parse(intakeLocalCrmRecord(s).customer.summary),'reference'),false);
 s.reference='P5-P-ABCD2345';
 assert.equal(JSON.parse(intakeLocalCrmRecord(s).customer.summary).reference,s.reference);
 assert.equal(intakeReceipt(s,{customer:'pending',team:'pending',crm:'pending'}).reference,s.reference);
 for(const team of [false,true]){const email=renderIntakeEmail(s,team,[]);assert.ok(email.subject.includes(s.reference));assert.ok(email.text.includes(s.reference));}
 assert.ok((await pdfTextLayers(await renderIntakePdf(s))).join('\n').includes(s.reference));
 const envelope=intakeDeliveryEnvelope(s,'crm','a'.repeat(64));
 assert.equal(intakeProjectReview(envelope,'',true).request.reference,s.reference);
 assert.equal(envelope.key,priorKey);
});
