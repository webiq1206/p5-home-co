import test from 'node:test';
import assert from 'node:assert/strict';
import {require as tsxRequire} from 'tsx/cjs/api';
import {pathToFileURL} from 'node:url';
import {clarificationTakeoffUpdates} from '../lib/p5/clarificationTakeoffs.ts';
import {instructionPrompts} from '../lib/p5/clarifications.ts';
import {emptyInstructions} from '../lib/p5/instructions.ts';
import {reconcileClarificationTakeoffs} from '../lib/p5/retainedClarification.ts';
import type {Takeoff} from '../lib/p5/documentLedger.ts';
import type {ScopeExtraction} from '../lib/p5/scope.ts';
const item:Takeoff={id:'sewer-local',description:'Localized sewer repair',building:'house',floor:'',component:'sewer',quantity:32,unit:'feet from entry',basis:'stated',evidence:'Damage at 32 feet from entry',sources:[{source:'RE10.pdf',page:1,sheet:'',revision:''}],supersedes:[],issues:[]};
const corrected:Takeoff={...item,quantity:null,basis:'uncertain'};

test('public clarification repairs an invalid identity with a bounded correction contract without reopening the document',async()=>{
 const keys=['OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_API_KEY','AI_INTEGRATIONS_OPENAI_BASE_URL','ANTHROPIC_API_KEY'] as const;
 const before=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 for(const key of keys)delete process.env[key];
 process.env.OPENAI_API_KEY='synthetic';process.env.ANTHROPIC_API_KEY='synthetic';
 try{
  const {resolveInstructionAnswer}=tsxRequire('../lib/p5/clarificationAnswer.ts',pathToFileURL(import.meta.filename).href) as typeof import('../lib/p5/clarificationAnswer.ts');
  const extraction:ScopeExtraction={summary:'Seller repair',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],instructions:{...emptyInstructions(),questions:['Sewer pipe damage at 32 feet: repair vs. replacement method?']},takeoffs:[structuredClone(item)],documentCoverage:{expectedPages:1,complete:true,pages:[{...item.sources[0],status:'read',notes:[]}]}};
  const answer='Estimate a localized repair. The exact repair length is unknown and must be confirmed by a licensed plumber.';
  let calls=0;
  const request:typeof fetch=async(_url,init)=>{
   calls++;const body=JSON.parse(String(init?.body));
   assert.match(JSON.stringify(body),/priorTakeoffs/);assert.match(JSON.stringify(body),/sewer-local/);
   const schema=body.tools?.[0].input_schema||body.text.format.schema;
   assert.deepEqual(schema.properties.takeoffs.items.properties.id.enum,['sewer-local']);
   assert.deepEqual(schema.properties.takeoffs.items.required,['id','quantity']);
   assert.equal(schema.properties.takeoffs.items.additionalProperties,false);
   assert.match(body.system||body.instructions,/RETAINED TAKEOFF CORRECTIONS/,'repair retains the authorized correction contract');
   assert.ok(!JSON.stringify(body).includes('input_file'));assert.ok(!JSON.stringify(body).includes('base64'));
   const record={summary:'Localized repair of unknown extent',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],clarifications:[],instructions:{...emptyInstructions(),inclusions:['Localized sewer repair with extent to confirm']},pages:[],takeoffs:[{id:calls===1?'sewer-repair-renamed':item.id,quantity:null}]};
   return body.model==='gpt-4.1'
    ?Response.json({status:'completed',model:'gpt-4.1',output:[{content:[{type:'output_text',text:JSON.stringify(record)}]}]})
    :Response.json({model:'claude-haiku-4-5-20251001',stop_reason:'tool_use',content:[{type:'tool_use',name:'record_scope_analysis',id:'synthetic',input:record}]});
  };
  const prompt=instructionPrompts(extraction,{})[0];
  const result=await resolveInstructionAnswer(extraction,{service:'handyman'},{id:prompt.id,answer},[],request);
  assert.equal(calls,2);assert.equal(result.extraction?.takeoffs?.[0].quantity,null);assert.equal(result.extraction?.takeoffs?.[0].basis,'uncertain');
  assert.equal(extraction.takeoffs?.[0].quantity,32,'original evidence is not mutated');
  assert.deepEqual(result.extraction?.documentCoverage,extraction.documentCoverage);
  assert.ok(result.extraction?.takeoffs?.[0].sources.some(source=>source.source==='typed scope'&&source.page===0));
  assert.match(result.extraction!.takeoffs![0].evidence,/Retained prior source evidence/);
  assert.equal(instructionPrompts(result.extraction,result.answers).length,0);
 }finally{for(const key of keys){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}}
});

test('clarification updates cannot invent work, change units or assert numbers absent from the answer',()=>{
 const context={prior:[item],answer:'Actual repair length is unknown.'};
 assert.throws(()=>clarificationTakeoffUpdates([{...corrected,id:'invented'}],context),/identity-invalid/);
 assert.throws(()=>clarificationTakeoffUpdates([{...corrected,unit:'LF'}],context),/unit-changed/);
 assert.throws(()=>clarificationTakeoffUpdates([{...item,quantity:100}],context),/evidence-unverified/);
 assert.throws(()=>clarificationTakeoffUpdates([corrected,corrected],context),/identity-invalid/);
 assert.throws(()=>clarificationTakeoffUpdates([corrected],{...context,prior:[item,{...item,building:'separate garage'}]}),/identity-invalid/);
 const update=clarificationTakeoffUpdates([{...item,quantity:12}],{prior:[item],answer:'12'});
 assert.equal(update[0].quantity,12);assert.equal(update[0].evidence,'12');assert.equal(update[0].sources[0].page,0);
 assert.equal(clarificationTakeoffUpdates([{...item,quantity:12}],{prior:[item],answer:'Twelve feet.'})[0].quantity,12);
 assert.equal(clarificationTakeoffUpdates([{id:item.id,quantity:null}],context)[0].unit,item.unit);
 assert.throws(()=>clarificationTakeoffUpdates([{id:'renamed',quantity:null}],context),/unknown-id at update 0/);
 assert.throws(()=>clarificationTakeoffUpdates([{id:item.id,quantity:null},{id:item.id,quantity:null}],context),/duplicate-update at update 1/);
 assert.throws(()=>clarificationTakeoffUpdates([{id:item.id}],context),/Invalid takeoff evidence/);
 assert.throws(()=>clarificationTakeoffUpdates([{id:item.id,quantity:100}],context),/evidence-unverified/);
});

test('explicit takeoff corrections coexist with unrelated structured quantity corrections',()=>{
 const cabinet:Takeoff={...item,id:'base-cabinets',component:'base cabinets',description:'Base cabinets',unit:'LF',quantity:8};
 const updates=clarificationTakeoffUpdates([corrected],{prior:[item,cabinet],answer:'Repair extent is unknown. Base cabinets are 12 linear feet.'});
 const result=reconcileClarificationTakeoffs([item,cabinet],updates,[{field:'cabinetBaseLf',value:'12',confidence:1,evidence:'Base cabinets are 12 linear feet.'}]);
 assert.equal(result?.find(row=>row.id===item.id)?.quantity,null);
 assert.equal(result?.find(row=>row.id===cabinet.id)?.quantity,12);
});
