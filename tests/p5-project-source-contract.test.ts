import test from 'node:test';
import assert from 'node:assert/strict';
import {projectInput,projectHash,ProjectRecordError} from '../lib/p5/projectRecord.ts';
import {acceptProjectCompletion} from '../lib/p5/projectCompletion.ts';
import {projectCompletionWireFor,PROJECT_COMPLETION_INSTRUCTIONS} from '../lib/p5/projectRecordContracts.ts';
import {openAiPricingRequestEnvelope} from '../lib/p5/scopePricing.ts';

function fixture(){
 const input=projectInput({text:'Replace the owner-supplied door handle.',answers:{location:'Boise'},extraction:null,uploads:[],reviewedAt:'2026-09-30T00:00:00Z',corrections:[]});
 const source=input.sources[0];
 return {input,reply:{sourceChecks:Object.fromEntries(input.sources.map(s=>[s.id,'Reviewed this source against the current requested scope.'])),steps:[{id:'install',subject:'Door handle',description:'Install the supplied handle.',operation:'install',kind:'requested',responsibility:'contractor',evidence:[{sourceId:source.id,quote:source.text}],reason:'Requested by the customer.'}]}};
}
test('every source is a required response key and citation IDs are bound to the actual inventory',()=>{
 const {input}=fixture();
 const body=JSON.parse(JSON.stringify(openAiPricingRequestEnvelope(PROJECT_COMPLETION_INSTRUCTIONS,{sources:input.sources},false).body));
 const schema=body.text.format.schema;
 assert.deepEqual(schema.properties.sourceChecks.required,input.sources.map(s=>s.id));
 assert.equal(schema.properties.sourceChecks.additionalProperties,false);
 const pattern=schema.properties.steps.items.properties.evidence.items.properties.sourceId.pattern;
 assert.ok(new RegExp(pattern).test(input.sources[0].id));assert.equal(new RegExp(pattern).test('src-invented'),false);
});
test('missing, unknown and empty source checks cannot be accepted and checks remain hashed',()=>{
 const {input,reply}=fixture();const schema=projectCompletionWireFor(input.sources);
 const accepted=acceptProjectCompletion(reply,input);
 assert.deepEqual(accepted.reviewedSourceIds,input.sources.map(s=>s.id));assert.deepEqual(accepted.sourceChecks,reply.sourceChecks);
 const {planHash,sourceHash,...plan}=accepted;assert.equal(planHash,projectHash({sourceHash,plan}));
 const missing=structuredClone(reply);delete missing.sourceChecks[input.sources[1].id];assert.equal(schema.safeParse(missing).success,false);assert.throws(()=>acceptProjectCompletion(missing,input));
 const invented=structuredClone(reply);invented.sourceChecks['src-invented']='Claimed review';assert.equal(schema.safeParse(invented).success,false);
 const empty=structuredClone(reply);empty.sourceChecks[input.sources[1].id]='';assert.equal(schema.safeParse(empty).success,false);
});
test('a quotation from another real source yields a precise repair without silent reassignment',()=>{
 const {input,reply}=fixture();reply.steps[0].evidence[0].sourceId=input.sources[1].id;
 assert.throws(()=>acceptProjectCompletion(reply,input),(error:unknown)=>{
  assert.ok(error instanceof ProjectRecordError);
  const problem=error.problems.find(p=>p.code==='completion-evidence');assert.ok(problem);
  assert.ok(problem.message.includes(input.sources[0].id));assert.match(problem.message,/not been reassigned automatically/);return true;
 });
 assert.equal(reply.steps[0].evidence[0].sourceId,input.sources[1].id);
});
