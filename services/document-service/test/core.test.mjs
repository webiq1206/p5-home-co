import {test} from 'node:test';
import assert from 'node:assert/strict';
import {documentId,jobId,hash,stable,signature,signedHeaders,verifyHeaders,identifier,groupPages,mapLimit,readConfig,validateEvidence,noteHasUnresolvedIssue,ServiceError,retainInvalidDurationsAsUncertain} from '../src/core.mjs';
import {requestBody,parseReply,Reader} from '../src/provider.mjs';
import {EVIDENCE_SCHEMA,REVIEW_SCHEMA,validateReview} from '../src/contracts.mjs';
import {reconcileVerification} from '../src/pipeline.mjs';
const secret='a'.repeat(48),tenant='boiseconstruction.co',time=1789680000000;
const raw=Buffer.from('original PDF content');const headers=()=>signedHeaders(secret,'POST','/v1/projects/qa/documents',tenant,raw,time);
const evidence=(extra={})=>({page:1,sheet:'A1',revision:'',status:'read',notes:[],facts:[],items:[],inclusions:[],exclusions:[],responsibilities:[],regions:[],...extra});
const source={page:1,text:'House 2400 SF. Garage 600 SF. Appliance purchases excluded.',textQuality:1};
test('signed request verifies its tenant, path, method and body digest',()=>assert.equal(verifyHeaders({[tenant]:secret},'POST','/v1/projects/qa/documents',headers(),time).digest,hash(raw)));
for(const [name,method,path] of [['method','GET','/v1/projects/qa/documents'],['path','POST','/v1/projects/other/documents']])test('signature rejects changed '+name,()=>assert.throws(()=>verifyHeaders({[tenant]:secret},method,path,headers(),time)));
test('stale signature rejected',()=>assert.throws(()=>verifyHeaders({[tenant]:secret},'POST','/v1/projects/qa/documents',headers(),time+90001)));
test('unknown tenant rejected',()=>assert.throws(()=>verifyHeaders({'other-site':secret},'POST','/v1/projects/qa/documents',headers(),time)));
test('document cache is independent of conversation answers',()=>assert.equal(documentId(tenant,'qa',hash(raw)),documentId(tenant,'qa',hash(raw))));
test('same bytes isolated by project',()=>assert.notEqual(documentId(tenant,'first',hash(raw)),documentId(tenant,'second',hash(raw))));
test('same bytes isolated by website',()=>assert.notEqual(documentId(tenant,'qa',hash(raw)),documentId('boisecabinet.co','qa',hash(raw))));
test('content changes invalidate only that document',()=>assert.notEqual(documentId(tenant,'qa',hash(raw)),documentId(tenant,'qa',hash('changed'))));
test('review identity changes with scope, without changing document identity',()=>assert.notEqual(jobId(tenant,'qa','review',{scope:'trim only'}),jobId(tenant,'qa','review',{scope:'full project'})));
test('review keys do not depend on answer property order',()=>assert.equal(jobId(tenant,'qa','review',{a:1,b:2}),jobId(tenant,'qa','review',{b:2,a:1})));
for(const invalid of ['../secret','a/b','',null,' '.repeat(4)])test('unsafe identifier rejected '+JSON.stringify(invalid),()=>assert.throws(()=>identifier(invalid)));
test('four ordinary pages become one read, with every page preserved',()=>assert.deepEqual(groupPages([1,2,3,4].map(page=>({page,kind:'text',text:'written scope'}))).map(g=>g.map(p=>p.page)),[[1,2,3,4]]));
test('100 distinct pages all retained through grouping',()=>{const pages=Array.from({length:100},(_,i)=>({page:i+1,kind:i%7?'text':'drawing',text:'scope '+i}));assert.deepEqual(groupPages(pages).flat().map(p=>p.page),pages.map(p=>p.page));});
test('drawings isolated without dividing every sheet into dozens of tiles',()=>assert.deepEqual(groupPages([{page:1,kind:'text',text:'x'},{page:2,kind:'drawing',text:'x'},{page:3,kind:'text',text:'x'}]).map(g=>g.length),[1,1,1]));
test('text budget splits a dense group without clipping any source',()=>{const p=[1,2].map(page=>({page,kind:'text',text:'a'.repeat(18000)}));assert.equal(groupPages(p).length,2);assert.equal(groupPages(p).flat().reduce((n,p)=>n+p.text.length,0),36000);});
test('bounded parallel executor preserves order and capacity',async()=>{let active=0,peak=0;const r=await mapLimit([1,2,3,4,5],2,async n=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,3));active--;return n*2;});assert.equal(peak,2);assert.deepEqual(r,[2,4,6,8,10]);});
test('missing page records cannot produce complete coverage',()=>assert.throws(()=>validateEvidence({pages:[]},[source]),/manifest/));
test('duplicate source pages rejected',()=>assert.throws(()=>validateEvidence({pages:[evidence(),evidence()]},[source,{...source,page:2}]),/reference/));
test('invented native-text quote rejected',()=>assert.throws(()=>validateEvidence({pages:[evidence({facts:[{field:'sqft',value:'9999',evidence:'House 9999 SF',basis:'stated'}]})]},[source]),/quote-not/));
test('valid exact source evidence accepted',()=>assert.equal(validateEvidence({pages:[evidence({facts:[{field:'sqft',value:'2400',evidence:'House 2400 SF',basis:'stated'}]})]},[source]).pages[0].status,'read'));
for(const date of ['Issued Date: 13 July 2026','Issued Date: September 19, 2025','DATE: 11/13/25','DATE: 11.13.25'])test('drawing issue date cannot become project duration: '+date,()=>assert.throws(()=>validateEvidence({pages:[evidence({facts:[{field:'projectMonths',value:'12',evidence:date,basis:'stated'}]})]},[source]),/invalid-project-duration-source/));
test('absent project duration is omitted rather than represented as a source fact',()=>assert.throws(()=>validateEvidence({pages:[evidence({facts:[{field:'projectMonths',value:'unknown',evidence:'Project duration not stated on this sheet',basis:'uncertain'}]})]},[source]),/absent-source-fact/));
test('assembly depth is not accepted as a room or ceiling height',()=>{
 const page=validateEvidence({pages:[evidence({items:[{id:'A4.2-1',description:'Section includes catwalk built into floor truss; dimensions include ceiling/wall heights and 1\'-6 3/4" assembly depth',building:'Main',floor:'Upper',component:'Building Section',quantity:1,unit:'each',evidence:'CATWALK BUILT INTO TRUSS',basis:'visual'}]})]},[{...source,kind:'drawing'}]).pages[0];
 assert.equal(page.status,'partial');assert.equal(page.items[0].basis,'uncertain');assert.equal(page.items[0].quantity,1);
});
test('ordinary assembly and wall dimensions are not falsely conflated',()=>{
 const page=validateEvidence({pages:[evidence({items:[{id:'detail-1',description:'Wall assembly detail; 8 ft wall',building:'Main',floor:'Upper',component:'Wall assembly',quantity:1,unit:'each',evidence:'Wall assembly detail',basis:'visual'}]})]},[{...source,kind:'drawing'}]).pages[0];
 assert.equal(page.status,'read');assert.equal(page.items[0].basis,'visual');assert.equal(page.items[0].quantity,1);
});
test('uncertain and conflicting notes cannot remain a read page',()=>{
 const page=validateEvidence({pages:[evidence({notes:['Verify conflicting ceiling dimension with builder']})]},[source]).pages[0];
 assert.equal(page.status,'partial');
});
for(const note of ['No unresolved conflicts remain after verification.','Conflicts were resolved and verified.','No ambiguities remain.'])test('resolved evidence note remains read: '+note,()=>{
 const page=validateEvidence({pages:[evidence({notes:[note]})]},[source]).pages[0];
 assert.equal(noteHasUnresolvedIssue(note),false);assert.equal(page.status,'read');
});
for(const note of ['Unresolved conflict remains in the ceiling dimensions.','Verify conflicting ceiling dimension with builder.','Some detail regions still require confirmation.'])test('active uncertainty note remains partial: '+note,()=>{
 assert.equal(noteHasUnresolvedIssue(note),true);
 assert.equal(validateEvidence({pages:[evidence({notes:[note]})]},[source]).pages[0].status,'partial');
});
test('a resolved note does not hide a mixed active uncertainty',()=>{
 const notes=['No unresolved conflicts remain after verification.','Verify the stair opening dimension.'];
 const page=validateEvidence({pages:[evidence({notes})]},[source]).pages[0];
 assert.equal(page.status,'partial');
});
for(const note of ['No unresolved conflicts remain, but the ceiling dimension is uncertain.','No conflicts remain; verify the stair opening dimension.','Verification is complete, but one region is still ambiguous.'])test('same-sentence resolution does not hide active uncertainty: '+note,()=>{
 assert.equal(noteHasUnresolvedIssue(note),true);
 assert.equal(validateEvidence({pages:[evidence({notes:[note]})]},[source]).pages[0].status,'partial');
});
test('reconciliation-generated source conflicts remain partial',()=>{
  const original=evidence({facts:[{field:'ceilingHeight',value:'9',evidence:'9 ft ceiling',basis:'stated'}]});
  const checked=evidence();
 const page=reconcileVerification(original,checked);
 assert.equal(page.status,'partial');
  assert.deepEqual(page.facts,original.facts);
  assert.match(page.notes.join(' '),/omitted ceilingHeight/);
 assert.equal(noteHasUnresolvedIssue(page.notes.at(-1)),true);
});
test('independent verification cannot silently relabel or duplicate an existing physical item',()=>{
  const item={id:'holdown-1',description:'Mark 1 HDU2 holdown',building:'Main',floor:'Foundation',component:'Holdown schedule',quantity:1,unit:'each',evidence:'Schedule row Mark 1',basis:'visual'};
  const original=evidence({items:[item]});
  const checked=evidence({items:[{...item,description:'Mark 1 portal-frame holdown',evidence:'Flattened schedule text',basis:'stated'}]});
  const page=reconcileVerification(original,checked);
  assert.equal(page.status,'partial');assert.deepEqual(page.items,[item]);
  assert.match(page.notes.join(' '),/changed item holdown-1/);
});
test('independent verification cannot replace a supported quantity',()=>{
  const item={id:'footing-f2',description:'F2 footing',building:'Main',floor:'Foundation',component:'Footing',quantity:3,unit:'each',evidence:'F2 3 #4 EACH WAY',basis:'stated'};
  const page=reconcileVerification(evidence({items:[item]}),evidence({items:[{...item,quantity:4}]}));
  assert.equal(page.status,'partial');assert.deepEqual(page.items,[item]);assert.equal(page.items.length,1);
});
test('uncertain verifier output cannot overwrite a supported stated claim',()=>{
  const fact={field:'sqft',value:'2400',evidence:'House 2400 SF',basis:'stated'};
  const page=reconcileVerification(evidence({facts:[fact]}),evidence({facts:[{field:'sqft',value:'unknown',evidence:'Could not confirm area',basis:'uncertain'}]}));
  assert.equal(page.status,'partial');assert.deepEqual(page.facts,[fact]);assert.match(page.notes.join(' '),/disagreed with sqft/);
});
test('new verifier visual and calculated claims remain explicit unresolved findings, not accepted evidence',()=>{
  const checked=evidence({facts:[{field:'sqft',value:'3841',evidence:'87 ft 3 in by 44 ft',basis:'calculated'}],
   items:[{id:'new-visual',description:'Portal frame holdown',building:'Main',floor:'Foundation',component:'Holdown',quantity:1,unit:'each',evidence:'Schedule alignment',basis:'visual'}]});
  const page=reconcileVerification(evidence(),checked);
  assert.equal(page.status,'partial');assert.deepEqual(page.facts,[]);assert.deepEqual(page.items,[]);
  assert.match(page.notes.join(' '),/new calculated fact/);assert.match(page.notes.join(' '),/new-visual/);
});
test('new verifier regions remain unresolved and cannot promote a page',()=>{
  const region={x:.1,y:.1,width:.2,height:.2,reason:'Verify schedule row alignment'};
  const page=reconcileVerification(evidence(),evidence({regions:[region]}));
  assert.equal(page.status,'partial');assert.deepEqual(page.regions,[region]);assert.match(page.notes.join(' '),/detail regions/);
});
test('known unspecified values do not create a reread region',()=>{
 const page=validateEvidence({pages:[evidence({regions:[{x:.1,y:.2,width:.3,height:.3,reason:'Dimension not specified; closer inspection cannot recover a value.'}]})]},[{...source,kind:'text',textQuality:1}]).pages[0];
 assert.equal(page.regions.length,0);assert.equal(page.status,'read');assert.match(page.notes.join(' '),/Dimension not specified/);assert.match(page.notes.join(' '),/remain missing/i);
});
test('pending visual crop keeps page partial',()=>assert.equal(validateEvidence({pages:[evidence({regions:[{x:.1,y:.2,width:.5,height:.5,reason:'dimension'}]})]},[source]).pages[0].status,'partial'));
test('out-of-page crop rejected',()=>assert.throws(()=>validateEvidence({pages:[evidence({regions:[{x:.9,y:0,width:.5,height:1}]})]},[source]),/region/));
test('a redacted number is not invented to fill an empty value',()=>assert.throws(()=>validateEvidence({pages:[evidence({facts:[{field:'sqft',value:'2400',evidence:'2400 SF',basis:'stated'}]})]},[{...source,text:'House , SF'}]),/quote-not/));
test('truncated Anthropic response fails rather than dropping trailing data',()=>assert.throws(()=>parseReply('anthropic',{stop_reason:'max_tokens',content:[]}),/provider-output-limit/));
test('blocked Gemini response fails visibly',()=>assert.throws(()=>parseReply('gemini',{candidates:[{finishReason:'SAFETY'}]}),/incomplete/));
test('incomplete OpenAI response fails visibly',()=>assert.throws(()=>parseReply('openai',{status:'incomplete'}),/incomplete/));
test('valid provider JSON parsed',()=>assert.deepEqual(parseReply('anthropic',{stop_reason:'end_turn',content:[{type:'text',text:'{"pages":[]}'}]}),{pages:[]}));
test('malformed provider JSON rejected without a second whole-document read',()=>assert.throws(()=>parseReply('anthropic',{stop_reason:'end_turn',content:[{type:'text',text:'not JSON'}]}),/invalid-provider-json/));
test('provider bodies carry actual image bytes and strict schema',()=>{for(const p of ['anthropic','gemini','openai']){const r=requestBody(p,'configured-model','source instruction',{page:1},[{label:'page 1',bytes:Buffer.from('image')}],EVIDENCE_SCHEMA,2048);assert.ok(r.url.startsWith('https://'));assert.ok(JSON.stringify(r.body).includes(Buffer.from('image').toString('base64')));}});
test('no model is silently selected without configuration',()=>assert.throws(()=>readConfig({P5_DOCUMENT_TENANTS_JSON:JSON.stringify({[tenant]:secret}),DOCUMENT_DATABASE_URL:'postgres://test'}),/missing-provider/));
test('weak tenant authentication cannot start the service',()=>assert.throws(()=>readConfig({P5_DOCUMENT_TENANTS_JSON:JSON.stringify({[tenant]:'weak'})}),/weak/));
test('protected activation requires exactly the five authorized tenants',()=>{
 const ids=['p5homeco.com','boiseconstruction.co','boiseremodeling.co','boisehandyman.co','boisecabinet.co'];
 const keys=Object.fromEntries(ids.map((id,i)=>[id,`synthetic-tenant-key-${i}-for-tests-123456789`]));
 assert.equal(readConfig({P5_DOCUMENT_REQUIRE_ALL_TENANTS:'true',P5_DOCUMENT_TENANTS_JSON:JSON.stringify(keys),DOCUMENT_DATABASE_URL:'postgres://test',DOCUMENT_MODEL:'test-model',ANTHROPIC_API_KEY:'synthetic'}).tenants['p5homeco.com'],keys['p5homeco.com']);
 assert.throws(()=>readConfig({P5_DOCUMENT_REQUIRE_ALL_TENANTS:'true',P5_DOCUMENT_TENANTS_JSON:JSON.stringify({...keys,'other.example':'synthetic-tenant-key-999999999999999999999'}),DOCUMENT_DATABASE_URL:'postgres://test',DOCUMENT_MODEL:'test-model',ANTHROPIC_API_KEY:'synthetic'}),/incomplete|unauthorized/);
});
test('reader releases global capacity when provider authentication fails',async()=>{let released=0;const c={provider:'anthropic',model:'model',verifyModel:'model',key:'test',tpm:100000,maxOutput:2048,callMs:1000};const store={reserve:async()=> 'slot',release:async()=>released++,metric:async()=>{},cooldown:async()=>{}};const reader=new Reader(c,store,async()=>new Response('{}',{status:401}));await assert.rejects(reader.call({id:'job'},'instruction',{},[],EVIDENCE_SCHEMA,new AbortController().signal),/provider-http-401/);assert.equal(released,1);});
test('synthesis cannot promote a partially read page',()=>{const r={summary:'project',facts:[],takeoffs:[],clarifications:[],conflicts:[],reviewNotes:[]};assert.equal(validateReview(r,[{source:'A.pdf',page:1,status:'partial',notes:['unread dimension']}]).pages[0].status,'partial');assert.equal(r.reviewNotes.length,1);});
test('review cannot convert an issued date into project duration',()=>assert.throws(()=>validateReview({summary:'scope',facts:[{field:'projectMonths',value:'13',confidence:1,source:'A.pdf',evidence:'Issued Date: 13 July 2026',basis:'stated'}],takeoffs:[],clarifications:[],conflicts:[],reviewNotes:[]},[{source:'A.pdf',page:1,status:'read',notes:[]}]),/invalid-project-duration-source/));
test('page evidence retains an issue-date duration mistake only as an explicit uncertainty',()=>{
 const result=retainInvalidDurationsAsUncertain({pages:[evidence({facts:[{field:'projectMonths',value:'Issued Date 13 July 2026',evidence:'Issued Date: 13 July 2026',basis:'stated'}]})]});
 assert.equal(result.pages[0].status,'partial');assert.equal(result.pages[0].facts[0].field,'otherDetails');assert.equal(result.pages[0].facts[0].basis,'uncertain');
 assert.match(result.pages[0].facts[0].value,/does not establish project duration/);assert.doesNotThrow(()=>validateEvidence(result,[source]));
});
test('review omits absent project duration instead of inventing a fact',()=>assert.throws(()=>validateReview({summary:'scope',facts:[{field:'projectMonths',value:'0',confidence:1,source:'A.pdf',evidence:'Project duration not stated',basis:'uncertain'}],takeoffs:[],clarifications:[],conflicts:[],reviewNotes:[]},[{source:'A.pdf',page:1,status:'read',notes:[]}]),/absent-source-fact/));
test('review cannot price an ambiguous room height against assembly depth',()=>assert.throws(()=>validateReview({summary:'scope',facts:[],takeoffs:[{id:'height-1',description:'Ceiling height at floor truss assembly',building:'Main',floor:'Upper',component:'Building Section',quantity:1,unit:'ft',basis:'visual',evidence:'floor truss assembly',sources:[{source:'A.pdf',page:1}],supersedes:[],issues:[]}],clarifications:[],conflicts:[],reviewNotes:[]},[{source:'A.pdf',page:1,status:'partial',notes:['uncertain dimension']}]),/ambiguous-room-height-measurement/));
test('synthesis cannot reference another document',()=>assert.throws(()=>validateReview({summary:'scope',facts:[],takeoffs:[{id:'x',quantity:1,sources:[{source:'other.pdf',page:1}]}],clarifications:[],conflicts:[],reviewNotes:[]},[{source:'A.pdf',page:1,status:'read',notes:[]}]),/provenance/));
test('no fixed accuracy claim is present in the protocol',()=>assert.ok(!JSON.stringify(REVIEW_SCHEMA).includes('99.9')));
