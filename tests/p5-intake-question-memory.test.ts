import test from 'node:test';
import assert from 'node:assert/strict';
import {intakeQuestions} from '../lib/p5/intakeQuestions.ts';
import {reconcileQuestionMemory,recordQuestion,questionTopic,mergeQuestionMemory,answerState,readQuestionMemory} from '../lib/p5/intakeQuestionMemory.ts';
import {emptyIntakeDetails,intakeDetails} from '../lib/p5/intakeContract.ts';
import {intakeDraftContext} from '../lib/p5/intakeDraft.ts';
import {emptyInstructions} from '../lib/p5/instructions.ts';
import type {BrowserDraft} from '../lib/p5/browserDraft.ts';
import type {Draft} from '../lib/p5/store.ts';
const draft=():BrowserDraft=>({id:'11111111-1111-4111-8111-111111111111',key:'a'.repeat(64),revision:1,text:'Tighten one interior door handle.',answers:{service:'handyman',taskList:'Tighten one handle'},extraction:null,contact:{name:'Test',email:'test@example.invalid',phone:''},step:1,updatedAt:1,transcript:[],wizard:{skipped:[],resolutions:{}}});
function remember(d:BrowserDraft){return {...d,intake:{...emptyIntakeDetails(),projectId:`p5:${d.id}`,originSite:'p5' as const,currentSite:'p5' as const,version:1,contact:{...d.contact,preferredContact:'either' as const},questionMemory:reconcileQuestionMemory(d)}};}
test('description supplies location, timing, dimensions and material without structured answers',()=>{
 const d=draft();d.text='Build a cedar deck in Boise. It is 1 by 2 feet. Start in March 2027.';
 const known=reconcileQuestionMemory(d).entries.map(e=>e.topic);
 for(const topic of ['location','schedule','length','width','sqft','materials'])assert.ok(known.includes(topic),topic);
 assert.ok(!intakeQuestions(d).some(q=>['location','schedule','length','width','sqft','materials'].includes(q.field)));
});
test('saved occupancy answer suppresses a lexically different generated question',()=>{
 const d=draft();d.extraction={summary:'Kitchen project',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],instructions:{...emptyInstructions(),questions:['Will the property be vacant while construction is underway?']}};
 d.transcript=[{id:'q',kind:'question',role:'assistant',label:'One scope detail',text:'Will you remain in the home during the work?',at:1},{id:'a',role:'user',text:'No, we will move out before work starts.',at:2}];
 assert.ok(!intakeQuestions(d).some(q=>questionTopic(q)==='occupancy'));
});
test('Question/My answer history is understood alongside old Question/Answer format',()=>{
 for(const label of ['Answer','My answer']){const d=draft();d.text+=`\nQuestion: Will you stay in the home?\n${label}: No, we will move out.`;assert.ok(reconcileQuestionMemory(d).entries.some(e=>e.topic==='occupancy'&&e.state==='answered'));}
});
test('declined budget and unknown timing survive replay, revision, lost-response serialization and handoff site changes',()=>{
 let d=draft();d.answers.budget='I prefer not to share my budget';d.answers.schedule="I don't know yet";d=remember(d);
 const before=d.intake!.questionMemory!;assert.ok(before.entries.some(e=>e.topic==='budget'&&e.state==='declined'));
 assert.ok(before.entries.some(e=>e.topic==='schedule'&&e.state==='unknown'));
 d=JSON.parse(JSON.stringify(d));d.revision=7;d.intake!.currentSite='remodeling';d.answers={service:'handyman',taskList:'One handle'};
 assert.ok(!intakeQuestions(d).some(q=>['schedule','budget'].includes(q.field)));
 assert.deepEqual(mergeQuestionMemory(before,before),before);
 assert.deepEqual(intakeDetails(d.intake).questionMemory,before);
});
test('server cannot erase historical answers when a stale client omits its memory',()=>{
 const d=remember({...draft(),answers:{...draft().answers,schedule:'Not sure yet'}});
 const next=intakeDraftContext(d.id,'p5',d as unknown as Draft,emptyIntakeDetails(),d.contact);
 assert.deepEqual(next.questionMemory,d.intake!.questionMemory);
});
test('explicit correction remains in history and current structured answer wins',()=>{
 let d=remember({...draft(),answers:{...draft().answers,location:'Boise'}});d={...d,revision:2,answers:{...d.answers,location:'Meridian'}};
 const memory=reconcileQuestionMemory(d);assert.equal(memory.entries.filter(e=>e.topic==='location').at(-1)!.value,'Meridian');
 assert.ok(memory.entries.some(e=>e.topic==='location'&&e.value==='Boise'));assert.ok(!intakeQuestions(d).some(q=>q.field==='location'));
});
test('multiple extracted original files supply dimensions/material/location with byte provenance',()=>{
 const d=draft();d.uploads=['a','b'].map((x,i)=>({id:x,name:`${x}.pdf`,type:'application/pdf',size:i+1,sha256:x.repeat(64),status:'stored'}));d.analyzedUploads=d.uploads.map(({sha256,size})=>({sha256,size}));
 d.extraction={summary:'Fictional plan',facts:[{field:'length',value:'1',confidence:1,source:'a.pdf page 1',evidence:'Length 1 foot',basis:'stated'},{field:'materials',value:'Cedar',confidence:1,source:'b.pdf page 1',evidence:'Cedar',basis:'stated'},{field:'location',value:'Boise',confidence:1,source:'b.pdf page 1',evidence:'Boise',basis:'stated'}],conflicts:[],missingInformation:[],reviewNotes:[]};
 const memory=reconcileQuestionMemory(d);for(const topic of ['length','materials','location'])assert.ok(memory.entries.some(e=>e.topic===topic&&e.source.startsWith('extraction:')));
 assert.ok(!intakeQuestions(d).some(q=>['length','materials','location'].includes(q.field)));
});
test('unread original files are left for team review, never treated as extracted facts or a re-transcription request',()=>{
 const d=draft();d.uploads=[{id:'unread',name:'plan.pdf',type:'application/pdf',size:1,sha256:'a'.repeat(64),status:'stored'}];
 assert.equal(intakeQuestions(d).length,0);assert.ok(!reconcileQuestionMemory(d).entries.some(e=>e.source.startsWith('extraction:')));
});
test('a question is marked asked on display, reload resumes that card and unknown completion retires it',()=>{
 let d=remember(draft());const q=intakeQuestions(d).find(q=>q.field==='location')!;assert.ok(q.semanticId);
 d.intake!.questionMemory=recordQuestion(d.intake!.questionMemory!,q,'asked','',d.revision);d.pendingReply={id:q.semanticId!,answer:'Bo'};
 d=JSON.parse(JSON.stringify(d));assert.equal(intakeQuestions(d)[0].reason,q.reason);
 d.intake!.questionMemory=recordQuestion(d.intake!.questionMemory!,q,'unknown','Not sure yet',d.revision);
 assert.ok(!intakeQuestions(d).some(candidate=>candidate.field==='location'));
});
test('an unmatched model question is retained for staff rather than asked with an unsafe guessed identity',()=>{
 const d=draft();d.extraction={summary:'Project',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],instructions:{...emptyInstructions(),questions:['Could you elaborate on how the transformation should feel?']}};
 assert.ok(!intakeQuestions(d).some(q=>/transformation/.test(q.reason)));assert.equal(d.extraction.instructions!.questions.length,1);
});
test('new conflict names its competing values; a paraphrase cannot restart the same conflict',()=>{
 const d=remember({...draft(),answers:{...draft().answers,service:'kitchen',sqft:'1'}});d.conflicts=[{field:'sqft',values:['1','2'],explanation:'Two supplied plans disagree.'}];
 const q=intakeQuestions(d).find(q=>q.conflict)!;assert.ok(q);assert.match(q.reason,/1 \/ 2/);assert.match(q.detail!,/Two supplied plans/);
 d.intake!.questionMemory=recordQuestion(d.intake!.questionMemory!,q,'unknown','Not sure yet',d.revision);
 d.conflicts=[{field:'sqft',values:['2','1'],explanation:'A different way of describing the same mismatch.'}];assert.ok(!intakeQuestions(d).some(q=>q.conflict));
});
test('unknown/declined choices and address text are not cleared by repeated reconciliation',()=>{
 for(const text of ['Not sure yet','No address yet','TBD',"I don't know"] )assert.equal(answerState(text),'unknown');
 for(const text of ['Prefer not to say','Skip this',"I don't want to share"])assert.equal(answerState(text),'declined');
 const d=remember({...draft(),answers:{...draft().answers,address:'1 Fictional Lane, Apt 2'}});assert.ok(!intakeQuestions(JSON.parse(JSON.stringify(d))).some(q=>q.field==='location'||q.field==='address'));
});
test('malformed question history fails closed instead of replacing saved history',()=>{
 assert.throws(()=>readQuestionMemory({schema:1,entries:[{topic:'location'}]}),/invalid/);
});


test('unchanged facts retain original provenance revision across autosave acknowledgments',()=>{
 const d=remember({...draft(),answers:{...draft().answers,location:'Boise'}});
 assert.deepEqual(reconcileQuestionMemory({...d,revision:20}),d.intake!.questionMemory);
});
test('explicit manual review remains closed to automated questions after reload and scope edits',()=>{
 let d=remember(draft());d.intake!.questionMemory=recordQuestion(d.intake!.questionMemory!,{field:'otherDetails',label:'Project review',reason:'Review with the details I have',semanticId:'intake-review'},'answered','Continue with saved materials',1);
 d=JSON.parse(JSON.stringify(d));d.text+=' Added fictional work.';assert.deepEqual(intakeQuestions(d),[]);
});
