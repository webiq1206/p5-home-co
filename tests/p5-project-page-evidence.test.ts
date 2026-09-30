import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {loadProjectPageEvidence,type ProjectPageCache} from '../lib/p5/projectPageEvidence.ts';
import {projectInput,acceptProjectRecord,type ProjectScope} from '../lib/p5/projectRecord.ts';
import {remoteDocumentId} from '../lib/p5/documentServiceClient.ts';
import {ESTIMATOR_BRAND} from '../lib/p5/brand.ts';
import type {Draft} from '../lib/p5/store.ts';
import type {ProjectChange} from '../lib/p5/projectConversation.ts';

const env={P5_DOCUMENT_SERVICE_MODE:'remote',P5_DOCUMENT_SERVICE_URL:'https://reader.example.test',P5_DOCUMENT_SERVICE_TENANT:'p5homeco.com',P5_DOCUMENT_SERVICE_KEY:'synthetic-test-signing-key-01234567890'};
function fixture(count=5){
 const draft={id:'controlled-project',brand:ESTIMATOR_BRAND.id,uploads:[{id:'upload1',name:'plan.pdf',type:'application/pdf',sha256:'a'.repeat(64),status:'stored',size:1000}]} as Pick<Draft,'id'|'brand'|'uploads'>;
 const id=remoteDocumentId('p5homeco.com',draft.id,draft.uploads[0].sha256);
 const identity={version:'p5-page-evidence-v2',id,project:draft.id,sha256:draft.uploads[0].sha256,name:'plan.pdf',state:'complete',revision:'2026-09-30T15:00:00.000Z',pageCount:count};
 const manifest={...identity,complete:true,pages:Array.from({length:count},(_,i)=>({page:i+1,status:'read',notes:[] as string[]}))};
 const text=('Original label: 18 inches by 24 inches.\n').repeat(1300);
 const page=(number:number)=>({...identity,page:{number,native:{text:number===1?text:`Original page ${number}`,kind:'drawing',textQuality:1,width:1728,height:2592,spanCoordinates:'page points',spans:[{text:'18 inches',x:10,y:20}]},readerObservation:{page:number,status:'read',notes:[],items:[{description:'Existing opening',quantity:null}]}}});
 const saved=new Map<string,unknown>(),cache:ProjectPageCache={read:async key=>saved.get(key),write:async(key,value)=>{saved.set(key,value);}};
 const calls:string[]=[];let active=0,maxActive=0;
 const request=(async(input:any,init:any)=>{
  const url=new URL(String(input)),path=url.pathname+url.search,headers=init.headers;
  assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(init.body,undefined);
  assert.equal(headers['x-p5-signature'],createHmac('sha256',env.P5_DOCUMENT_SERVICE_KEY).update(['GET',path,'p5homeco.com',headers['x-p5-time'],headers['x-p5-nonce'],headers['x-p5-body-sha256']].join('\n')).digest('hex'));
  calls.push(path);active++;maxActive=Math.max(maxActive,active);
  await new Promise(resolve=>setTimeout(resolve,2));active--;
  const number=Number(url.searchParams.get('page'));
  return Response.json(number?page(number):manifest);
 }) as typeof fetch;
 return {draft,manifest,page,text,saved,cache,calls,request,get maxActive(){return maxActive;}};
}
test('signed page loading preserves complete native content, caps concurrency and deduplicates identical uploads',async()=>{
 const f=fixture();f.draft.uploads.push({...f.draft.uploads[0],id:'copy',name:'duplicate-plan.pdf'});
 const result=await loadProjectPageEvidence(f.draft,{env,request:f.request,cache:f.cache});
 assert.equal(result.documents.length,1);assert.equal(result.documents[0].pages.length,5);assert.equal(result.documents[0].pages[0].native.text,f.text);
 assert.ok(f.maxActive<=4);assert.equal(f.calls.length,6);assert.equal(f.saved.size,5);
 const scope:ProjectScope={text:'Use the original plans for the requested work.',answers:{},extraction:null,uploads:f.draft.uploads,reviewedAt:'2026-09-30',corrections:[],pageEvidence:result};
 const input=projectInput(scope);assert.deepEqual(input.documentIssues,[]);
 assert.equal(input.sources.filter(s=>s.kind==='native-page-text'&&s.page===1).map(s=>s.text).join(''),f.text);
 assert.equal(new Set(input.sources.map(s=>s.id)).size,input.sources.length);
 assert.equal(input.sources.filter(s=>s.kind==='reader-observation').length,5);
 assert.match(input.sources.find(s=>s.kind==='page-layout')!.name,/not physical construction dimensions/);
 assert.ok(input.sources.every(s=>s.fileId==='upload1'||s.kind==='customer-text'));
});
test('an interrupted later page resumes from independent checkpoints without refetching earlier pages',async()=>{
 const f=fixture();let failed=false;
 const request=(async(input:any,init:any)=>{if(String(input).endsWith('?page=5')&&!failed){failed=true;throw new Error('simulated transport interruption');}return f.request(input,init);}) as typeof fetch;
 await assert.rejects(loadProjectPageEvidence(f.draft,{env,request,cache:f.cache}),/simulated transport interruption/);
 assert.equal(f.saved.size,4);const before=f.calls.length;
 const result=await loadProjectPageEvidence(f.draft,{env,request,cache:f.cache});
 assert.equal(result.documents[0].pages.length,5);assert.equal(f.calls.length-before,2);
 assert.ok(f.calls.at(-1)!.endsWith('?page=5'));
});
test('wrong digests, wrong pages, changing generations and incomplete inventories cannot enter the project record',async()=>{
 for(const mutate of [(value:any)=>{value.sha256='b'.repeat(64);},(value:any)=>{if(value.page)value.page.number=2;},(value:any)=>{if(value.page)value.revision='changed';},(value:any)=>{if(value.pages)value.pages=[];}]){
  const f=fixture(1),request=(async(input:any,init:any)=>{const response=await f.request(input,init),value=await response.json();mutate(value);return Response.json(value);}) as typeof fetch;
  await assert.rejects(loadProjectPageEvidence(f.draft,{env,request,cache:f.cache}));
 }
 const f=fixture(1);await loadProjectPageEvidence(f.draft,{env,request:f.request,cache:f.cache});
 const key=[...f.saved.keys()][0];(f.saved.get(key) as any).sha256='b'.repeat(64);
 await assert.rejects(loadProjectPageEvidence(f.draft,{env,request:f.request,cache:f.cache}),/identity checks/);
});
test('partial-page evidence reaches clarification without being falsely marked fully read',async()=>{
 const f=fixture(1);f.manifest.complete=false;f.manifest.pages[0].status='partial';f.manifest.pages[0].notes=['Right-side dimension is illegible.'];
 const result=await loadProjectPageEvidence(f.draft,{env,request:f.request,cache:f.cache});
 const input=projectInput({text:'Replace the noted opening.',answers:{},extraction:null,uploads:f.draft.uploads,reviewedAt:'2026-09-30',corrections:[],pageEvidence:result});
 assert.deepEqual(input.documentIssues,[]);assert.ok(input.sources.some(s=>s.status==='partial'));
 const proposal={summary:'Opening replacement needs a legible dimension.',service:'handyman',location:'',evidence:[],subjects:[],quantities:[],requirements:[],questions:[{id:'dimension',requirementIds:[],quantityIds:[],kind:'unreadable-source',prompt:'What dimension is shown at the right side of the opening on plan.pdf page 1?',reason:'That dimension is illegible and determines the replacement size.',options:[],priority:'blocking'}],sourceReviews:input.sources.map(s=>({sourceId:s.id,status:s.status==='read'?'reviewed':'unreadable',reason:s.status==='read'?'':'The right-side dimension is illegible.'})),assumptions:[]};
 assert.equal(acceptProjectRecord(proposal,input).questions.length,1);
 proposal.sourceReviews=proposal.sourceReviews.map(r=>({...r,status:'reviewed'}));
 assert.throws(()=>acceptProjectRecord(proposal,input));
});
test('a customer clarification resolves a damaged source without changing its original read status',async()=>{
 const f=fixture(1);f.manifest.complete=false;f.manifest.pages[0].status='partial';
 const pageEvidence=await loadProjectPageEvidence(f.draft,{env,request:f.request,cache:f.cache});
 const scope:ProjectScope={text:'No construction work is requested on the opening.',answers:{},extraction:null,uploads:f.draft.uploads,reviewedAt:'2026-09-30',corrections:[],pageEvidence};
 const change={kind:'answer',sequence:1,draftRevision:2,prompt:'Does the illegible dimension affect the requested work?',response:'No. Retain this opening; it is excluded from this project.',requirementIds:[],quantityIds:[]} as unknown as ProjectChange;
 const input=projectInput(scope,[change]),answer=input.sources.find(s=>s.kind==='customer-clarification')!;
 const proposal={summary:'The customer excluded this opening.',service:'handyman',location:'',evidence:[{id:'resolution',sourceId:answer.id,quote:answer.text}],subjects:[],quantities:[],requirements:[],questions:[],sourceReviews:input.sources.map(s=>s.status==='read'?{sourceId:s.id,status:'reviewed',reason:''}:{sourceId:s.id,status:'resolved-by-customer',reason:'The customer explicitly excludes all work on this opening; its illegible dimension does not define charged work.',resolutionEvidenceIds:['resolution']}),assumptions:[]};
 const accepted=acceptProjectRecord(proposal,input);
 assert.equal(accepted.questions.length,0);assert.ok(accepted.sources.some(s=>s.status==='partial'));
 assert.ok(accepted.sourceReviews.some(s=>s.status==='resolved-by-customer'));
 const reader=input.sources.find(s=>s.kind==='reader-observation')!;
 proposal.evidence[0]={id:'resolution',sourceId:reader.id,quote:reader.text};
 assert.throws(()=>acceptProjectRecord(proposal,input),/Project record needs correction/);
});
