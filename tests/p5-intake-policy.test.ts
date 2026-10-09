import test from 'node:test';
import assert from 'node:assert/strict';
import {INTAKE_SITES,INTAKE_RECIPIENTS,publicProjectMode,routeIntake,intakeSite} from '../lib/p5/intakePolicy.ts';

test('only the five approved websites participate; every new project requires review',()=>{
  assert.deepEqual(Object.keys(INTAKE_SITES),['p5','construction','remodeling','handyman','cabinet']);
  for(const site of Object.keys(INTAKE_SITES))for(const service of ['kitchen','bathroom','addition','new-construction','cabinet-install','handyman','unknown'])assert.equal(publicProjectMode(site,service),'review');
  assert.equal(intakeSite('adu'),null);assert.equal(intakeSite('__proto__'),null);
});
test('whole-project classification wins over supporting trades on every website',()=>{
  for(const site of Object.keys(INTAKE_SITES) as Array<keyof typeof INTAKE_SITES>){
    const route=routeIntake(site,'kitchen',['cabinetry','plumbing','cabinetry']);
    assert.equal(route.primaryTeam,'remodeling');assert.deepEqual(route.supportingServices,['cabinetry','plumbing']);
    assert.equal(route.handoff,site==='p5'||site==='remodeling'?null:'remodeling');
  }
});
test('specialty handoffs use approved project responsibilities',()=>{
  assert.equal(routeIntake('handyman','bathroom').handoff,'remodeling');
  assert.equal(routeIntake('construction','cabinet-install').handoff,'cabinet');
  assert.equal(routeIntake('remodeling','addition').handoff,'construction');
  assert.equal(routeIntake('remodeling','new-construction').handoff,'construction');
  assert.equal(routeIntake('cabinet','handyman').handoff,'handyman');
});
test('P5 completes all projects in place, including unresolved classifications',()=>{
  for(const service of ['kitchen','addition','cabinet-product','handyman','adu','rush','unknown'])assert.equal(routeIntake('p5',service).handoff,null);
  assert.deepEqual(routeIntake('p5','unknown').unresolved,['Confirm the primary project team during review.']);
});
test('unknown classifications and untrusted supporting values cannot invent a recipient',()=>{
  const route=routeIntake('cabinet','https://outside.invalid',['outside@example.invalid','cabinetry']);
  assert.equal(route.primaryTeam,'cabinet');assert.equal(route.handoff,null);assert.deepEqual(route.supportingServices,['cabinetry']);
});

import {intakeQuestions} from '../lib/p5/intakeQuestions.ts';
import {intakeUnresolved,intakeContact,intakeDetails,emptyIntakeDetails,intakeReviewFingerprint,intakeScopeReviewed} from '../lib/p5/intakeContract.ts';
import {SCOPE_FIELDS,type ScopeExtraction} from '../lib/p5/scope.ts';
import {emptyInstructions} from '../lib/p5/instructions.ts';
const extraction=():ScopeExtraction=>({summary:'Fictional project',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],instructions:emptyInstructions()});
test('intake asks optional location and timing, then respects unknown answers',()=>{
 const draft={text:'Tighten the handle on one interior door.',answers:{service:'handyman',taskList:'Tighten one handle'},extraction:null,wizard:{skipped:[],resolutions:{}}};
 assert.ok(intakeQuestions(draft).some(q=>q.field==='location'));assert.ok(intakeQuestions(draft).some(q=>q.field==='schedule'));
 const unknown={...draft,wizard:{skipped:['location','schedule'] as ('location'|'schedule')[],resolutions:{}}};
 assert.ok(!intakeQuestions(unknown).some(q=>q.field==='location'||q.field==='schedule'));
 assert.ok(intakeUnresolved(unknown,SCOPE_FIELDS).some(q=>q.includes('not known yet')));
});
test('ordinary whole-scope clarifications survive the instruction fallback field',()=>{
 for(const question of ['Should the detached shed be included or excluded from this project?','Will you remain in the home during the work?','Should we retain the original hardware or replace it?']){
  const read=extraction();read.instructions!.questions=[question];
  const draft={text:'Remodel the existing kitchen.',answers:{service:'kitchen',sqft:'1'},extraction:read};
  assert.ok(intakeQuestions(draft).some(q=>q.instructionId),question);
  assert.ok(intakeUnresolved(draft,SCOPE_FIELDS).length>0,question);
 }
});
test('a current measured value alone does not resolve contradictory evidence',()=>{
 const read=extraction();read.conflicts=[{field:'sqft',values:['1','2'],explanation:'Plans disagree.'}];
 const draft={answers:{service:'kitchen',sqft:'1'},extraction:read,wizard:{skipped:[],resolutions:{}}};
 assert.ok(intakeUnresolved(draft,SCOPE_FIELDS).includes('Plans disagree.'));
 assert.ok(!intakeUnresolved({...draft,wizard:{skipped:[],resolutions:{sqft:'1'}}},SCOPE_FIELDS).includes('Plans disagree.'));
});
test('unfinished contact and previously accepted long messages remain saveable',()=>{
 assert.equal(intakeContact({name:'李',email:'inquiry@',phone:'+1'},false).email,'inquiry@');
 assert.throws(()=>intakeContact({name:'李',email:'inquiry@',phone:'+1'}),/valid email/);
 const message='A'.repeat(20001),filename='x'.repeat(180)+'.pdf';
 const details=intakeDetails({...emptyIntakeDetails(),transcript:[{id:'fictional-1',role:'user',text:message,at:1,files:[filename]}]});
 assert.equal(details.transcript[0].text,message);assert.equal(details.transcript[0].files![0],filename);
});
test('changed whole scope invalidates old classification approval without deleting intentional answers',()=>{
 const draft={text:'Install cabinets only.',answers:{service:'cabinet-install',exclusions:'No plumbing'},uploads:[],intake:{...emptyIntakeDetails(),reviewedScopeFingerprint:''}};
 draft.intake.reviewedScopeFingerprint=intakeReviewFingerprint(draft);assert.equal(intakeScopeReviewed(draft),true);
 const edited={...draft,text:'Full kitchen remodel, including new cabinets, flooring and plumbing.'};assert.equal(intakeScopeReviewed(edited),false);
 assert.equal(edited.answers.service,'cabinet-install');assert.equal(edited.answers.exclusions,'No plumbing');
 const corrected={...edited,answers:{service:'kitchen',exclusions:''},intake:{...edited.intake,supportingServices:['cabinetry','plumbing'] as ('cabinetry'|'plumbing')[]}};
 corrected.intake.reviewedScopeFingerprint=intakeReviewFingerprint(corrected);assert.equal(intakeScopeReviewed(corrected),true);
 assert.equal(routeIntake('p5',corrected.answers.service,corrected.intake.supportingServices).primaryTeam,'remodeling');
});
test('supporting selections with exclusions remain explicit questions for the team',()=>{
 const unresolved=intakeUnresolved({answers:{service:'kitchen',exclusions:'No plumbing work'},extraction:null,intake:{supportingServices:['plumbing']}},SCOPE_FIELDS);
 assert.ok(unresolved.some(text=>text.includes('plumbing')&&text.includes('exclusions')));
});
test('reading warnings track exact file bytes even with older extraction and duplicate names',()=>{
 const uploads=[{id:'one',name:'plans.pdf',type:'application/pdf',size:1,sha256:'a'.repeat(64),status:'stored' as const},{id:'two',name:'new-plans.pdf',type:'application/pdf',size:2,sha256:'b'.repeat(64),status:'stored' as const}];
 const scope={answers:{},extraction:extraction(),uploads,analyzedUploads:[{sha256:'a'.repeat(64),size:1}]};
 const warnings=intakeUnresolved(scope,SCOPE_FIELDS);assert.equal(warnings.length,1);assert.match(warnings[0],/^new-plans.pdf:/);
 const replaced={...scope,uploads:[{...uploads[0],sha256:'c'.repeat(64)}]};assert.match(intakeUnresolved(replaced,SCOPE_FIELDS)[0],/^plans.pdf:/);
});
test('each finishing website retains its approved inbox separately from its primary business',()=>{
 assert.deepEqual(INTAKE_RECIPIENTS,{p5:'hello@p5homeco.com',construction:'hello@boiseconstruction.co',remodeling:'hello@boiseremodeling.co',handyman:'hello@boisehandyman.co',cabinet:'hello@boisecabinet.co'});
 assert.equal(routeIntake('p5','kitchen').primaryTeam,'remodeling');assert.equal(INTAKE_RECIPIENTS.p5,'hello@p5homeco.com');
});
