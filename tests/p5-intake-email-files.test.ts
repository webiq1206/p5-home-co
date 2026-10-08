/** Synthetic originals and memory-only reads. No email, storage or provider requests. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {emptyIntakeDetails,type IntakeSnapshot} from '../lib/p5/intakeContract.ts';
import {INTAKE_SITES,INTAKE_RECIPIENTS,routeIntake,type IntakeSite} from '../lib/p5/intakePolicy.ts';
import {intakeFileLink,intakeFileHandler,INTAKE_FILE_LINK_DAYS} from '../lib/p5/intakeFileAccess.ts';
import {intakeDeliveryEnvelope} from '../lib/p5/intakeDeliveryPayload.ts';
import {prepareIntakeEmail,INTAKE_ATTACHMENT_BYTES} from '../lib/p5/intakeEmailDelivery.ts';
import {renderIntakeEmail} from '../lib/p5/intakeEmail.ts';

const now=Date.parse('2099-01-02T12:00:00Z'),secret='synthetic-test-secret-only';
function fixture(site:IntakeSite='p5',bytes=Buffer.from('Synthetic project original')){
 const draftId='12345678-1234-4234-8234-123456789abc',fileId='12345678-1234-4234-8234-123456789abd';
 const file={id:fileId,name:'plan <one>.txt',type:'text/plain',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),status:'stored' as const};
 const s:IntakeSnapshot={schema:1,projectId:`p5:${draftId}`,originSite:'p5',currentSite:site,draftId,revision:2,contextVersion:1,contact:{name:'Test <script>alert(1)</script>',email:'customer@example.invalid',phone:'2085550100',preferredContact:'email'},details:{...emptyIntakeDetails(),desiredOutcome:'More room',transcript:[{id:'test',role:'user',text:'Keep the sink & door',at:now}]},scope:{text:'Kitchen <img src=x onerror=alert(1)>',answers:{service:'kitchen',exclusions:'Do not move the wall'},uploads:[file],extraction:{internalSecret:'NEVER EXPOSE EXTRACTION'} as unknown as IntakeSnapshot['scope']['extraction']},routing:routeIntake(site,'kitchen',['cabinetry']),unresolved:['Schedule not known yet.'],savedAt:new Date(now).toISOString()};
 const row={id:fileId,name:file.name,mime_type:file.type,size_bytes:file.size,sha256:file.sha256,data_base64:bytes.toString('base64')};
 let reads=0;
 const query=async(sql:string)=>{reads++;return sql.includes("AS snapshot")?[{snapshot:s}]:[row];};
 const deps={query,readBytes:async()=>bytes,secret:()=>secret,now:()=>now};
 return {s,file,row,bytes,deps,reads:()=>reads};
}
test('both branded messages preserve all customer fields and exclude extraction/private data',()=>{
 for(const site of Object.keys(INTAKE_SITES) as IntakeSite[]){const f=fixture(site);for(const team of [true,false]){
  const message=renderIntakeEmail(f.s,team,[]);
  assert.ok(message.subject.startsWith(INTAKE_SITES[site].name));assert.ok(message.html.includes(INTAKE_RECIPIENTS[site]));
  assert.ok(message.text.includes('Do not move the wall'));assert.ok(message.text.includes('Keep the sink & door'));
  assert.ok(message.html.includes('&lt;script&gt;'));assert.ok(!message.html.includes('<script>'));assert.ok(!message.html.includes('<img src=x'));
  assert.ok(!message.html.includes('NEVER EXPOSE'));assert.ok(!message.text.includes('NEVER EXPOSE'));
 }}
 const f=fixture();f.s.contact.email='';assert.match(renderIntakeEmail(f.s,true,[]).text,/No customer confirmation email was requested/);
});
test('every original is byte verified and included as attachment plus recipient-accessible link',async()=>{
 const f=fixture();for(const channel of ['customer','team'] as const){
  const result=await prepareIntakeEmail(f.s,intakeDeliveryEnvelope(f.s,channel,'digest'),f.deps);
  assert.equal(result.email!.attachments.length,2);assert.deepEqual(Buffer.from(result.email!.attachments[1].base64,'base64'),f.bytes);
  const record=JSON.parse(Buffer.from(result.email!.attachments[0].base64,'base64').toString());assert.equal(record.files.length,1);assert.equal(record.files[0].attachedOriginal,true);
  const response=await intakeFileHandler({...f.deps,site:'p5'})(new Request(record.files[0].privateDownload));assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),f.bytes);
  assert.match(response.headers.get('cache-control')!,/no-store/);assert.match(response.headers.get('content-disposition')!,/^attachment/);
  assert.ok(result.email!.html!.includes('Original attached'));assert.ok(!result.email!.text.includes('access is pending'));
 }
});
test('oversize original stays privately downloadable and is never described as attached',async()=>{
 const f=fixture('p5',Buffer.alloc(INTAKE_ATTACHMENT_BYTES+1,65));
 const result=await prepareIntakeEmail(f.s,intakeDeliveryEnvelope(f.s,'customer','digest'),f.deps);
 assert.equal(result.email!.attachments.length,1);const record=JSON.parse(Buffer.from(result.email!.attachments[0].base64,'base64').toString());
 assert.equal(record.files[0].attachedOriginal,false);assert.ok(record.files[0].privateDownload);assert.ok(!result.email!.html!.includes('Original attached'));
 const response=await intakeFileHandler({...f.deps,site:'p5'})(new Request(record.files[0].privateDownload));assert.equal(response.status,200);assert.equal((await response.arrayBuffer()).byteLength,f.bytes.length);
});
test('missing or corrupt original blocks preparation before a send can occur',async()=>{
 const f=fixture(),envelope=intakeDeliveryEnvelope(f.s,'customer','digest');
 await assert.rejects(prepareIntakeEmail(f.s,envelope,{...f.deps,readBytes:async()=>Buffer.from('tampered')}),/file-delivery-unavailable/);
 f.row.name='other.txt';await assert.rejects(prepareIntakeEmail(f.s,envelope,f.deps),/file-delivery-unavailable/);
});
test('private links reject tampering, wrong site, expiry and other file or revision before data reads',async()=>{
 const f=fixture(),link=intakeFileLink(f.s,f.file,'customer',secret,now),handler=intakeFileHandler({...f.deps,site:'p5'});
 for(const [key,value] of [['fileId','22345678-1234-4234-8234-123456789abd'],['draftId','22345678-1234-4234-8234-123456789abc'],['revision','3'],['recipient','b'.repeat(64)],['signature','c'.repeat(43)]]){
  const url=new URL(link);url.searchParams.set(key,value);assert.equal((await handler(new Request(url))).status,404);
 }
 assert.equal((await intakeFileHandler({...f.deps,site:'cabinet'})(new Request(link))).status,404);
 assert.equal((await intakeFileHandler({...f.deps,site:'p5',now:()=>now+(INTAKE_FILE_LINK_DAYS*86400+1)*1000})(new Request(link))).status,404);
 assert.equal(f.reads(),0);
});
test('valid signature cannot select a different saved site, recipient or original bytes',async()=>{
 const f=fixture(),url=intakeFileLink(f.s,f.file,'customer',secret,now),handler=intakeFileHandler({...f.deps,site:'p5'});
 f.s.contact.email='different@example.invalid';assert.equal((await handler(new Request(url))).status,404);
 f.s.contact.email='customer@example.invalid';f.s.currentSite='cabinet';assert.equal((await handler(new Request(url))).status,404);
 f.s.currentSite='p5';f.row.sha256='b'.repeat(64);assert.equal((await handler(new Request(url))).status,404);
});
