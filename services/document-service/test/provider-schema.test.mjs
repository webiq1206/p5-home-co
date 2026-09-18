import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requestBody,Reader} from '../src/provider.mjs';
import {REVIEW_SCHEMA,EVIDENCE_SCHEMA} from '../src/contracts.mjs';
const review=()=>({summary:'Synthetic QA',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],clarifications:[],instructions:{inclusions:[],exclusions:[],responsibilities:[],buildings:[],floors:[],separateBuildings:false,laborOnly:false,materialsOnly:false,questions:[]},pages:[],takeoffs:[]});
test('Anthropic review removes repeated large enums without changing the local contract',()=>{
 const before=JSON.stringify(REVIEW_SCHEMA);
 const wire=requestBody('anthropic','test','vocabulary',{},[],REVIEW_SCHEMA,1024).body.output_config.format.schema;
 for(const name of ['facts','conflicts','clarifications']){
  assert.equal(wire.properties[name].items.properties.field.enum,undefined);
  assert.equal(wire.properties[name].items.properties.field.type,'string');
 }
 assert.deepEqual(wire.properties.takeoffs,REVIEW_SCHEMA.properties.takeoffs);
 assert.deepEqual(wire.required,REVIEW_SCHEMA.required);
 assert.equal(wire.additionalProperties,false);
 assert.equal(JSON.stringify(REVIEW_SCHEMA),before);
 assert.deepEqual(requestBody('anthropic','test','',{},[],EVIDENCE_SCHEMA,1024).body.output_config.format.schema,EVIDENCE_SCHEMA);
 assert.deepEqual(requestBody('openai','test','',{},[],REVIEW_SCHEMA,1024).body.text.format.schema,REVIEW_SCHEMA);
 assert.deepEqual(requestBody('gemini','test','',{},[],REVIEW_SCHEMA,1024).body.generationConfig.responseJsonSchema,REVIEW_SCHEMA);
});
for(const location of ['facts','conflicts','clarifications','valid'])test('Reader validates original vocabulary: '+location,async()=>{
 const result=review();
 if(location==='facts')result.facts=[{field:'unknownField',value:'4',confidence:1,source:'QA.pdf',evidence:'four doors',basis:'stated'}];
 if(location==='conflicts')result.conflicts=[{field:'unknownField',values:['1','2'],explanation:'test'}];
 if(location==='clarifications')result.clarifications=[{field:'unknownField',question:'test?',reason:'test'}];
 let released=0,calls=0;
 const config={provider:'anthropic',model:'test',verifyModel:'test',key:'synthetic',tpm:100000,maxOutput:2048,callMs:1000};
 const store={reserve:async()=> 'slot',release:async()=>released++,metric:async()=>{}};
 const reader=new Reader(config,store,async(url,options)=>{
  calls++;
  const schema=JSON.parse(options.body).output_config.format.schema;
  assert.equal(schema.properties.facts.items.properties.field.enum,undefined);
  return new Response(JSON.stringify({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(result)}]}));
 });
 const call=reader.call({kind:'review'},'vocabulary',{},[],REVIEW_SCHEMA,new AbortController().signal);
 if(location==='valid')assert.deepEqual(await call,result);
 else await assert.rejects(call,/invalid-provider-schema/);
 assert.equal(calls,1);assert.equal(released,1);
});
