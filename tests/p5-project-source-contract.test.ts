import test from 'node:test';
import assert from 'node:assert/strict';
import {projectInput,projectHash,acceptProjectRecord,ProjectRecordError} from '../lib/p5/projectRecord.ts';
import {acceptProjectCompletion} from '../lib/p5/projectCompletion.ts';
import {projectCompletionWireFor,projectProposalWireFor,PROJECT_COMPLETION_INSTRUCTIONS,PROJECT_RECORD_INSTRUCTIONS} from '../lib/p5/projectRecordContracts.ts';
import {projectSourceContext,sourcePassages,sourcePassageIndex} from '../lib/p5/projectCitations.ts';
import {openAiPricingRequestEnvelope} from '../lib/p5/scopePricing.ts';

const scope={text:'Replace the owner-supplied door handle.',answers:{location:'Boise'},extraction:null,uploads:[],reviewedAt:'2026-09-30T00:00:00Z',corrections:[]};
function fixture(){
 const input=projectInput(scope),source=input.sources[0];
 return {input,reply:{sourceChecks:Object.fromEntries(input.sources.map(s=>[s.id,'Reviewed this source against the current requested scope.'])),steps:[{id:'install',subject:'Door handle',description:'Install the supplied handle.',operation:'install',kind:'requested',responsibility:'contractor',evidence:[{passageId:sourcePassages(source)[0].id}],reason:'Requested by the customer.'}]}};
}
test('every source is a required response key and passage IDs are bound to the actual input inventory',()=>{
 const {input}=fixture(),sources=projectSourceContext(input.sources);
 const body=JSON.parse(JSON.stringify(openAiPricingRequestEnvelope(PROJECT_COMPLETION_INSTRUCTIONS,{sources},false).body));
 const schema=body.text.format.schema;
 assert.deepEqual(schema.properties.sourceChecks.required,input.sources.map(s=>s.id));
 assert.equal(schema.properties.sourceChecks.additionalProperties,false);
 const pattern=schema.properties.steps.items.properties.evidence.items.properties.passageId.pattern;
 assert.ok(new RegExp(pattern).test(sources[0].passages[0].id));assert.equal(new RegExp(pattern).test('passage-invented'),false);
 assert.deepEqual(schema.properties.steps.items.properties.evidence.items.required,['passageId']);
});
test('missing, unknown and empty source checks cannot be accepted and checks remain hashed',()=>{
 const {input,reply}=fixture();const schema=projectCompletionWireFor(input.sources);
 const accepted=acceptProjectCompletion(reply,input);
 assert.deepEqual(accepted.reviewedSourceIds,input.sources.map(s=>s.id));assert.deepEqual(accepted.sourceChecks,reply.sourceChecks);
 assert.deepEqual(accepted.steps[0].evidence,[{sourceId:input.sources[0].id,quote:input.sources[0].text}]);
 const {planHash,sourceHash,...plan}=accepted;assert.equal(planHash,projectHash({sourceHash,plan}));
 assert.equal(acceptProjectCompletion({...reply,sourceChecks:Object.fromEntries(Object.entries(reply.sourceChecks).reverse())},input).planHash,planHash,'Database key reordering must not change the work method identity.');
 const missing=structuredClone(reply);delete missing.sourceChecks[input.sources[1].id];assert.equal(schema.safeParse(missing).success,false);assert.throws(()=>acceptProjectCompletion(missing,input));
 const invented=structuredClone(reply);invented.sourceChecks['src-invented']='Claimed review';assert.equal(schema.safeParse(invented).success,false);
 const empty=structuredClone(reply);empty.sourceChecks[input.sources[1].id]='';assert.equal(schema.safeParse(empty).success,false);
});
test('passage transport reconstructs every original character and retains distinct source identities',()=>{
 const text=('72" VANITY\n48"X72" SHWR\n42" PONY WALL\n'+('Other original drawing labels. '.repeat(40))+'60" FREE-STANDING TUB\n').repeat(20)+'x'.repeat(639)+'😀';
 const sources=[{id:'original',text},{id:'observation',text}],context=projectSourceContext(sources),index=sourcePassageIndex(sources);
 for(const [i,source]of context.entries()){
  assert.equal(source.passages.map(p=>p.text).join(''),text);assert.ok(!('text'in source));
  for(const p of source.passages){assert.equal(p.text,text.slice(p.start,p.end));assert.equal(index.get(p.id)?.sourceId,sources[i].id);assert.equal(index.get(p.id)?.quote,p.text);}
 }
 assert.notEqual(context[0].passages[0].id,context[1].passages[0].id);
 assert.deepEqual([...sourcePassageIndex(context)], [...index]);
});
test('invented or stale passage references and model-written joined quotations are rejected',()=>{
 const {input,reply}=fixture(),schema=projectCompletionWireFor(input.sources);
 const joined={...reply,steps:[{...reply.steps[0],evidence:[{...reply.steps[0].evidence[0],sourceId:input.sources[0].id,quote:'72" VANITY\n60" FREE-STANDING TUB'}]}]};
 assert.equal(schema.safeParse(joined).success,false);
 const invented=structuredClone(reply);invented.steps[0].evidence[0].passageId='passage-invented';assert.throws(()=>acceptProjectCompletion(invented,input));
 const changed=projectInput({...scope,text:'The owner now excludes the door handle.'});
 const stale={...reply,sourceChecks:Object.fromEntries(changed.sources.map(s=>[s.id,'Checked current source.']))};assert.throws(()=>acceptProjectCompletion(stale,changed));
});
test('scope proposals require every source assessment and restore only server-selected source text',()=>{
 const {input}=fixture(),source=input.sources[0];
 const wire={summary:scope.text,service:'handyman',location:'Boise',evidence:[{id:'e1',passageId:sourcePassages(source)[0].id}],subjects:[{id:'handle',parentId:null,name:'Owner-supplied door handle',kind:'fixture',existingCondition:'',evidenceIds:['e1']}],quantities:[],requirements:[{id:'replace-handle',subjectId:'handle',description:scope.text,trade:'Trim & Finish Carpentry',operation:'replace',component:'labor',status:'included',responsibility:'contractor',origin:'requested',requiredBy:[],reason:'',evidenceIds:['e1'],quantityId:null,specifications:[]}],questions:[],sourceAssessments:Object.fromEntries(input.sources.map(s=>[s.id,{status:'reviewed',reason:''}])),assumptions:[]};
 const schema=projectProposalWireFor(input.sources);assert.equal(schema.safeParse(wire).success,true);
 const record=acceptProjectRecord(wire,input);
 assert.equal(acceptProjectRecord({...wire,sourceAssessments:Object.fromEntries(Object.entries(wire.sourceAssessments).reverse())},input).recordHash,record.recordHash,'Database key reordering must not change the accepted scope identity.');
 assert.deepEqual(record.evidence,[{id:'e1',sourceId:source.id,quote:source.text}]);assert.deepEqual(record.sourceReviews.map(s=>s.sourceId),input.sources.map(s=>s.id));
 const missing=structuredClone(wire);delete missing.sourceAssessments[input.sources[1].id];assert.throws(()=>acceptProjectRecord(missing,input));
 const provider=JSON.parse(JSON.stringify(openAiPricingRequestEnvelope(PROJECT_RECORD_INSTRUCTIONS,{sources:projectSourceContext(input.sources)},false).body)).text.format.schema;
 assert.deepEqual(provider.properties.sourceAssessments.required,input.sources.map(s=>s.id));assert.equal(provider.properties.sourceReviews,undefined);
});
test('legacy internal quotations still require the actual identified source and are never silently reassigned',()=>{
 const {input,reply}=fixture();const legacy={reviewedSourceIds:Object.keys(reply.sourceChecks),steps:[{...reply.steps[0],evidence:[{sourceId:input.sources[1].id,quote:input.sources[0].text}]}]};
 assert.throws(()=>acceptProjectCompletion(legacy,input),(error:unknown)=>{
  assert.ok(error instanceof ProjectRecordError);const problem=error.problems.find(p=>p.code==='completion-evidence');assert.ok(problem);
  assert.ok(problem.message.includes(input.sources[0].id));assert.match(problem.message,/not been reassigned automatically/);return true;
 });
});
