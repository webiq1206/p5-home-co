import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileQuestionMemory,recordQuestion,currentQuestionEntries,mergeQuestionMemory,questionHistoryNotes,readQuestionMemory} from '../lib/p5/intakeQuestionMemory.ts';
import {intakeQuestions} from '../lib/p5/intakeQuestions.ts';
import {emptyIntakeDetails,intakeDetails,intakeUnresolved} from '../lib/p5/intakeContract.ts';
import {intakeDraftContext} from '../lib/p5/intakeDraft.ts';
import {SCOPE_FIELDS,type ExtractedFact} from '../lib/p5/scope.ts';
import type {BrowserDraft} from '../lib/p5/browserDraft.ts';
import type {Draft} from '../lib/p5/store.ts';

const draft=():BrowserDraft=>({id:'11111111-1111-4111-8111-111111111111',key:'a'.repeat(64),revision:1,text:'Fictional kitchen project.',answers:{service:'kitchen',location:'Fictional city',schedule:'March 2027',sqft:'2'},extraction:null,contact:{name:'Fictional',email:'test@example.invalid',phone:''},step:1,updatedAt:1,transcript:[],wizard:{skipped:[],resolutions:{}}});
function remember(d:BrowserDraft):BrowserDraft{return {...d,intake:{...emptyIntakeDetails(),projectId:`p5:${d.id}`,originSite:'p5',currentSite:'p5',version:d.revision,contact:{...d.contact,preferredContact:'either'},...d.intake,questionMemory:reconcileQuestionMemory(d)}};}
function extracted():BrowserDraft{
 const d=draft();d.uploads=[{id:'file-a',name:'plan.pdf',type:'application/pdf',size:2,sha256:'a'.repeat(64),status:'stored'}];d.analyzedUploads=d.uploads.map(({sha256,size})=>({sha256,size}));
 d.extraction={summary:'Cedar material is shown.',facts:[{field:'materials',value:'Cedar',basis:'stated',confidence:1,source:'plan.pdf page 1',evidence:'Cedar material is visible.'}],conflicts:[],missingInformation:[],reviewNotes:[]};return d;
}
const uncertainCases:Array<[string,(d:BrowserDraft,f:ExtractedFact)=>void]>=[
 ['inferred',(d,f)=>{f.basis='inferred';}],['visual',(d,f)=>{f.basis='visual';}],['low confidence',(d,f)=>{f.confidence=.5;}],
 ['unmatched source',(d,f)=>{f.source='different.pdf page 1';}],['unmatched analyzed hash',d=>{d.analyzedUploads=[{sha256:'b'.repeat(64),size:2}];}],
 ['missing analyzed binding',d=>{d.analyzedUploads=[];}],['incomplete coverage',d=>{d.extraction!.documentCoverage={complete:false,expectedPages:2,pages:[{source:'plan.pdf',page:1,sheet:'',revision:'',status:'partial',coverageState:'illegible',notes:[]}]};}],
];
for(const [label,mutate] of uncertainCases)test(`${label} fact, evidence and summary retain review status for customer and staff`,()=>{
 const d=extracted();mutate(d,d.extraction!.facts[0]);const raw=JSON.stringify(d.extraction),m=reconcileQuestionMemory(d),entries=m.entries.filter(e=>e.topic==='materials');
 assert.ok(entries.length>=3);assert.ok(entries.every(e=>e.state==='review'));
 assert.equal(currentQuestionEntries(m).get('materials')!.state,'review');
 assert.ok(questionHistoryNotes(m).some(n=>n.includes('Materials')&&n.includes('team review')));
 assert.ok(intakeUnresolved({...d,intake:{...emptyIntakeDetails(),questionMemory:m}},SCOPE_FIELDS).some(n=>n.includes('Materials')&&n.includes('team review')));
 assert.equal(JSON.stringify(d.extraction),raw);assert.ok(!intakeQuestions(d).some(q=>q.field==='materials'));
});
test('summary without supporting trusted facts remains a review observation',()=>{
 const d=extracted();d.extraction!.facts=[];assert.equal(currentQuestionEntries(reconcileQuestionMemory(d)).get('materials')!.state,'review');
});
test('stated fact with matching analyzed bytes retains answered state, including its evidence and supported summary',()=>{
 const d=extracted(),m=reconcileQuestionMemory(d);assert.ok(m.entries.filter(e=>e.topic==='materials').every(e=>e.state==='answered'));
 assert.ok(!questionHistoryNotes(m).some(n=>n.includes('Materials')));
});
test('explicit answer resolves the current topic without deleting uncertain file provenance or making it certain',()=>{
 let d=extracted();d.extraction!.facts[0].basis='inferred';d=remember(d);d={...d,revision:2,answers:{...d.answers,materials:'Maple'}};d=remember(d);
 let m=d.intake!.questionMemory!;assert.equal(currentQuestionEntries(m).get('materials')!.value,'Maple');assert.ok(m.entries.some(e=>e.topic==='materials'&&e.state==='review'));
 d.revision=3;d.extraction!.facts[0].evidence='Cedar materials are still visible.';m=reconcileQuestionMemory(d);
 assert.equal(currentQuestionEntries(m).get('materials')!.value,'Maple');assert.ok(!questionHistoryNotes(m).some(n=>n.includes('Materials')));
 assert.equal(d.extraction!.facts[0].basis,'inferred');
});
for(const middle of ['Not sure yet','Prefer not to share','April 2027'])for(const sameRevision of [false,true])test(`restored answer after ${middle} stays current through save/reload/stale merge (${sameRevision?'one revision':'three revisions'})`,()=>{
 let d=remember(draft());const first=d.intake!.questionMemory!;
 d=remember({...d,revision:sameRevision?1:2,answers:{...d.answers,schedule:middle}});const stale=d.intake!.questionMemory!;
 d=remember({...d,revision:sameRevision?1:3,answers:{...d.answers,schedule:'March 2027'}});
 const current=d.intake!.questionMemory!,history=current.entries.filter(e=>e.topic==='schedule');
 assert.deepEqual(history.map(e=>e.value),['March 2027',middle,'March 2027']);assert.equal(new Set(history.map(e=>e.id)).size,3);
 assert.equal(history[0].source,history[2].source);assert.notEqual(history[0].id,history[2].id);
 for(const memory of [mergeQuestionMemory(current,stale,first),mergeQuestionMemory(first,stale,current)]){
  const saved=intakeDraftContext(d.id,'p5',d as unknown as Draft,{...emptyIntakeDetails(),questionMemory:memory},d.contact);
  const reload=JSON.parse(JSON.stringify({...d,intake:saved})) as BrowserDraft;
  assert.deepEqual(intakeDetails(reload.intake).questionMemory,current);
  assert.equal(currentQuestionEntries(reconcileQuestionMemory(reload)).get('schedule')!.value,'March 2027');
  assert.ok(!intakeUnresolved(reload,SCOPE_FIELDS).some(n=>n.includes('Requested schedule')));
  assert.ok(!intakeQuestions(reload).some(q=>q.field==='schedule'));
 }
});
test('old schema1 entries without event order remain readable and a restored answer gets a new occurrence',()=>{
 let d=remember(draft());d=remember({...d,revision:2,answers:{...d.answers,schedule:'Not sure yet'}});
 d.intake!.questionMemory!.entries=d.intake!.questionMemory!.entries.map(({order,observation,...e})=>e);
 const m=reconcileQuestionMemory({...d,revision:3,answers:{...d.answers,schedule:'March 2027'}});
 assert.equal(currentQuestionEntries(readQuestionMemory(JSON.parse(JSON.stringify(m)))).get('schedule')!.value,'March 2027');
 assert.equal(m.entries.filter(e=>e.topic==='schedule').length,3);
});
test('old conversation observations and unchanged source are not replayed on autosave',()=>{
 let d=draft();delete d.answers.schedule;d.transcript=[{id:'q',role:'assistant',kind:'question',label:SCOPE_FIELDS.schedule.label,text:'When should work start?',at:1},{id:'a',role:'user',text:'Not sure yet',at:2}];
 d=remember(d);d=remember({...d,revision:2,answers:{...d.answers,schedule:'March 2027'}});
 const memory=d.intake!.questionMemory!;assert.deepEqual(reconcileQuestionMemory({...d,revision:20}),memory);assert.equal(currentQuestionEntries(memory).get('schedule')!.value,'March 2027');
});
test('same-revision direct question A/unknown/A preserves all decisions and retires the card',()=>{
 const q={field:'schedule' as const,label:SCOPE_FIELDS.schedule.label,reason:'When should work start?',semanticId:'schedule'};
 let m=readQuestionMemory(undefined);for(const [state,value] of [['answered','March 2027'],['unknown','Not sure yet'],['answered','March 2027']] as const)m=recordQuestion(m,q,state,value,1);
 assert.equal(m.entries.length,3);assert.equal(currentQuestionEntries(m).get('schedule')!.value,'March 2027');assert.deepEqual(questionHistoryNotes(m),[]);
});
test('a stale lower revision cannot replace a newer decision even when merged last',()=>{
 let d=remember(draft());d=remember({...d,revision:5,answers:{...d.answers,schedule:'Not sure yet'}});
 const older=remember({...draft(),revision:2,answers:{...draft().answers,schedule:'April 2027'}});
 assert.equal(currentQuestionEntries(mergeQuestionMemory(d.intake!.questionMemory,older.intake!.questionMemory)).get('schedule')!.state,'unknown');
});
test('pending conflict is retired after explicit resolution and staff no longer sees the old question',()=>{
 let d=remember(draft());d.conflicts=[{field:'sqft',values:['1','2'],explanation:'Two fictional plans disagree.'}];const q=intakeQuestions(d).find(q=>q.conflict)!;
 d.intake!.questionMemory=recordQuestion(d.intake!.questionMemory!,q,'asked','',1);d.pendingReply={id:q.semanticId!,answer:''};
 d={...d,revision:2,conflicts:[],wizard:{skipped:[],resolutions:{sqft:'2'}}};d=remember(d);
 assert.ok(!intakeQuestions(d).some(q=>q.conflict));assert.ok(!intakeUnresolved(d,SCOPE_FIELDS).some(n=>n.includes('asked once')));
});
test('a changed conflict cannot resume the earlier conflicting-values card',()=>{
 const d=remember(draft());d.conflicts=[{field:'sqft',values:['1','2'],explanation:'First fictional conflict.'}];const old=intakeQuestions(d).find(q=>q.conflict)!;
 d.intake!.questionMemory=recordQuestion(d.intake!.questionMemory!,old,'asked','',1);d.pendingReply={id:old.semanticId!,answer:''};
 d.conflicts=[{field:'sqft',values:['2','3'],explanation:'New fictional evidence.'}];const next=intakeQuestions(d).find(q=>q.conflict)!;
 assert.ok(next);assert.notEqual(next.semanticId,old.semanticId);assert.match(next.reason,/2 \/ 3/);
});
test('invalid event metadata fails closed',()=>{
 const m=reconcileQuestionMemory(draft());assert.throws(()=>readQuestionMemory({...m,entries:[{...m.entries[0],order:-1}]}),/invalid/);
});
