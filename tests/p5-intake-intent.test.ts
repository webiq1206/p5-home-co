import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretIntakeIntent,applyIntakeIntent} from '../lib/p5/intakeIntent.ts';
import {routeIntake,INTAKE_SITES,intakeRoutingContext,type IntakeSite} from '../lib/p5/intakePolicy.ts';
import {serviceEvidenceSupports} from '../lib/p5/serviceSignals.ts';
import {refreshAnalyzedScope} from '../lib/p5/scopeReplacement.ts';
import {intakeQuestions} from '../lib/p5/intakeQuestions.ts';
const examples:Array<[string,string|undefined]>=[
 ['I want to build a modern farmhouse 3200 ft.² and I currently owned a lot','new-construction'],
 ['wanna bild a 3200 sqft modern farm house on my land','new-construction'],
 ['We own land and want to build a house','new-construction'],
 ['looking at buying a lot for a custom home','new-construction'],
 ["new home but haven’t found land",'new-construction'],
 ['Gut our existing house and make it feel like a new build','whole-home'],
 ['Tear down old house and build a different house on same lot','new-construction'],
 ['Add a 600-square-foot bedroom wing','addition'],
 ['Open kitchen into dining, not adding square footage','kitchen'],
 ['cabinets and counters and move sink','kitchen'],
 ["don’t want to build a new house; renovate the one I have",'remodel'],
 ["aren’t renovating, separate new house on empty lot",'new-construction'],
 ['Build out my basement','remodel'],
 ['Supply cabinets only, my contractor installs','cabinet-product'],
 ['I bought cabinets already, install them','cabinet-install'],
 ['Keep boxes replace doors and fronts','cabinet-install'],
 ['Sagging doors, two broken hinges, no new cabinets','handyman'],
 ['Built-ins, unsure whether to buy or custom',undefined],
 ['Two drywall holes and a doorknob','handyman'],
 ['Full kitchen gut and new layout','kitchen'],
 ['Touch-up paint and a door handle, no renovation','handyman'],
 ['Detached garage, bathroom remodel, and a sticking door','bathroom'],
 ['Build a new house including custom cabinets','new-construction'],
 ['Cabinets now, maybe a remodel next year',undefined],
 ['Help with house',undefined],
 ['Modern farmhouse 3200 sqft',undefined],
 ['Budget 5000',undefined],
 ['My friend built a house. I need a faucet fixed','handyman'],
 ['Not sure. I want to build a modern farmhouse 3200 ft.² and I currently owned a lot','new-construction'],
 ['I want to build a 3200 sqft house on my owned lot. Actually 2800 and still buying a lot','new-construction'],
 ['Kitchen remodel. Actually cabinets only, no counters or layout changes. Supply and install them','cabinet-install'],
 ['My new home needs two drywall holes patched','handyman'],
 ['Repair a faucet in our new house','handyman'],
 ['I bought a new house and need cabinet hinges fixed','handyman'],
 ['Build a driveway at my house',undefined],
 ['Install baseboards in my new home',undefined],
 ['Build a house or renovate our existing house',undefined],
];
for(const [text,expected] of examples)test(`contextual intent: ${text}`,()=>assert.equal(interpretIntakeIntent(text).service,expected));
test('new-home evidence accepts ordinary language and typos without the magic phrase new build',()=>{
 for(const [text,expected] of examples)if(expected==='new-construction')assert.equal(serviceEvidenceSupports('new-construction',text),true,text);
 for(const text of ['Build a driveway at my house','Modern farmhouse 3200 sqft','Gut our existing house and make it feel like a new build','Install baseboards in my new home'])assert.equal(serviceEvidenceSupports('new-construction',text),false,text);
});
test('only stated area and land context are retained, with original evidence and no invented ownership',()=>{
 const exact=examples[0][0],known=applyIntakeIntent(exact,{},null);
 assert.equal(known.answers.service,'new-construction');assert.equal(known.answers.sqft,'3200');assert.match(known.answers.workContext!,/owned a lot/);
 assert.equal(known.extraction!.facts.find(f=>f.field==='sqft')?.evidence,exact);
 const prospective=applyIntakeIntent(examples[3][0],{},null);assert.match(prospective.answers.workContext!,/buying/);assert.doesNotMatch(prospective.answers.workContext!,/own/);
 const unclear=applyIntakeIntent('Modern farmhouse 3200 sqft',{},null);assert.equal(unclear.answers.service,undefined);assert.equal(unclear.answers.sqft,undefined);
 const combined=applyIntakeIntent('Build a house with 3200 sqft under roof including garage',{},null);assert.equal(combined.answers.sqft,undefined);
});
test('later source corrections replace derived facts, while independent user choices need clarification',()=>{
 const first=applyIntakeIntent('I want to build a 3200 sqft house and own a lot',{},null);
 const revisedText='I want to build a 3200 sqft house and own a lot. Actually 2800 and still buying a lot';
 const refreshed=refreshAnalyzedScope({text:examples[0][0],...first},revisedText);
 const revised=applyIntakeIntent(revisedText,refreshed.answers,refreshed.extraction);
 assert.equal(revised.answers.sqft,'2800');assert.match(revised.answers.workContext!,/still buying/);
 const selected=applyIntakeIntent(examples[0][0],{service:'remodel'},null,{service:'remodel'});
 assert.equal(selected.answers.service,'remodel');assert.equal(selected.clearServiceResolution,true);assert.equal(selected.extraction?.conflicts[0]?.field,'service');
 const draft={text:examples[0][0],...selected,wizard:{skipped:[],resolutions:{}}};
 assert.equal(routeIntake('remodeling','remodel',[],intakeRoutingContext(draft)).handoff,null);
 const questions=intakeQuestions(draft);assert.equal(questions[0]?.field,'service');assert.equal(questions.filter(q=>q.field==='service').length,1);
 const confirmed=applyIntakeIntent(draft.text,selected.answers,selected.extraction,{service:'remodel'});assert.equal(confirmed.clearServiceResolution,undefined);
});
test('uncertainty stays on every current site; P5 retains every discipline and cabinet repair overlap stays local',()=>{
 for(const site of Object.keys(INTAKE_SITES) as IntakeSite[]){
  for(const service of ['', 'unknown']){const route=routeIntake(site,service);assert.equal(route.handoff,null);assert.equal(route.primaryTeam,site);}
  const newHome=routeIntake(site,'new-construction');assert.equal(newHome.handoff,site==='p5'||site==='construction'?null:'construction');
 }
 for(const service of ['new-construction','addition','kitchen','bathroom','cabinet-install','cabinet-product','handyman','adu'])assert.equal(routeIntake('p5',service).handoff,null);
 assert.equal(routeIntake('construction','adu').handoff,null);
 assert.equal(routeIntake('cabinet','handyman',[],{text:examples[16][0]}).handoff,null);
 assert.equal(routeIntake('handyman','kitchen').handoff,'remodeling');
});

test('inspection, urgent and change-order choices can contain the same trades without a false conflict',()=>{
 for(const service of ['re10','rush','change-order']){const result=applyIntakeIntent('Change order: supply and install ten feet of base cabinetry. No other work.',{service},null);assert.equal(result.answers.service,service);assert.equal(result.extraction,null);assert.equal(result.clearServiceResolution,undefined);}
});
