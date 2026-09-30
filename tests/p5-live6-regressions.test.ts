import test from 'node:test';
import assert from 'node:assert/strict';
import {wrongCabinetFasteners,exactDuplicateCharge,catalogResolution,normalizeConsumableMapping,normalizeRepairServices} from '../lib/p5/scopePricing.ts';
import {reconcileDocumentHierarchy,groundDocumentConditions} from '../lib/p5/scopeInterpretation.ts';
import {applyExplicitTypedCorrections} from '../lib/p5/typedCorrections.ts';
import {scopeQuestions} from '../lib/p5/adaptive.ts';
import {emptyInstructions} from '../lib/p5/instructions.ts';
import {priceBookRates} from '../lib/p5/priceBook.ts';
import {EMPTY_CONFIGURATION} from '../lib/p5/costBook.ts';
import {PLANNING_MODEL_VERSION} from '../lib/p5/planningBooks.ts';
import type {ScopeExtraction,ReviewedScope,ExtractedFact} from '../lib/p5/scope.ts';
const now=new Date('2026-09-30T08:00:00Z');
const fact=(field:ExtractedFact['field'],value:string,evidence=value):ExtractedFact=>({field,value,evidence,source:'public-plan.pdf',basis:'stated',confidence:1});
const extraction=(facts:ExtractedFact[]=[]):ScopeExtraction=>({summary:'Controlled regression fixture',facts,conflicts:[],missingInformation:[],reviewNotes:[],instructions:emptyInstructions()});
const config={...EMPTY_CONFIGURATION,planningCatalog:{version:PLANNING_MODEL_VERSION,source:'Owner book',authorizedBy:'Existing approved schedule',importedAt:now.toISOString(),rates:priceBookRates({service:'whole-home',finish:'mid-range'})}};
const scope=(text:string,answers:ReviewedScope['answers']={}):ReviewedScope=>({text,answers,extraction:null,uploads:[],reviewedAt:now.toISOString(),corrections:[]});
const mapping=(tasks:any[])=>({tasks,issues:[],notes:[],replacements:[],removeExclusions:[]});

test('cabinet-fastener rejection respects negation without admitting wrong fasteners',()=>{
 for(const qualifier of ['not drywall screws','no drywall screws','never drywall screws','instead of drywall screws'])
  assert.equal(wrongCabinetFasteners('Supply cabinet mounting screws',`Manufacturer-rated cabinet screws, ${qualifier}`),false,qualifier);
 for(const description of ['Drywall screws','Drywall screws, not cabinet screws','Not only drywall screws but also cabinet screws','Cabinet screws plus drywall screws'])
  assert.equal(wrongCabinetFasteners('Install cabinets',description),true,description);
 assert.equal(wrongCabinetFasteners('Repair drywall','Drywall screws'),false);
});

test('two 30-inch vanities remain two assemblies, including one-per-bathroom evidence',()=>{
 const task={id:'vanities',description:'Supply and install two 30-inch vanities with integrated top and sink (one per bathroom).',evidence:'Two bathrooms, each receives one 30-inch vanity.',existingLineIds:[],researchDescription:'',issues:[],additions:[{code:'PB-12-41-01',quantity:2,quantityEvidence:'Two vanities, one per bathroom'}]};
 const correct=catalogResolution(mapping([task]),config,[],now,scope(task.description,{service:'whole-home'}));
 assert.equal(correct.rules.length,1,JSON.stringify(correct.issues));assert.equal(correct.rules[0].quantity.fixed,2);
 const wrong=structuredClone(task);wrong.additions[0].quantity=30;wrong.additions[0].quantityEvidence='30 vanities';
 assert.equal(catalogResolution(mapping([wrong]),config,[],now,scope(task.description)).rules.length,0);
});

test('duplicate allegations cannot merge different physical handles or different sources',()=>{
 const line={scopeTaskId:'handle-1',description:'Install first handle',quantity:1,unit:'EA',unitCost:90,category:'field-labor',evidence:{reference:'PB-08-71-01'}};
 assert.equal(exactDuplicateCharge(line,{...line}),true);
 assert.equal(exactDuplicateCharge(line,{...line,scopeTaskId:'handle-2',description:'Install second handle'}),false);
 assert.equal(exactDuplicateCharge(line,{...line,evidence:{reference:'OTHER'}}),false);
});

test('a job cleanup cannot borrow a one-square-foot cleaning price without a measured area',()=>{
 const task={id:'cleanup',description:'Final cleanup after the repairs',evidence:'Include job cleanup',existingLineIds:[],researchDescription:'',issues:[],additions:[{code:'PB-01-74-05',quantity:1,quantityEvidence:'One job'}]};
 normalizeConsumableMapping(mapping([task]),config,[],scope('Replace two GFCIs and one P-trap. Include final cleanup.',{service:'re10'}));
 assert.deepEqual(task.additions,[]);assert.match(task.researchDescription,/hourly cleanup/);
});

test('a combined plan total is reconciled only when independently stated parts sum exactly',()=>{
 const x=extraction([fact('service','adu'),fact('service','new-construction'),fact('sqft','376','376 SF conditioned living area'),fact('garageSqft','528','528 SF garage'),fact('sqft','904','904 SF combined building area')]);
 x.conflicts=[{field:'service',values:['adu','new-construction'],explanation:'Types differ'},{field:'sqft',values:['376','904'],explanation:'Areas differ'}];
 const out=reconcileDocumentHierarchy(x,'Build the ADU over the garage shown on these plans.');
 assert.deepEqual(out.conflicts,[]);assert.deepEqual(out.facts.filter(f=>f.field==='sqft').map(f=>f.value),['376']);
 const wrong=structuredClone(x);wrong.facts.find(f=>f.field==='garageSqft')!.value='500';
 assert.ok(reconcileDocumentHierarchy(wrong,'Build this ADU.').conflicts.some(c=>c.field==='sqft'));
 assert.equal(reconcileDocumentHierarchy(x,'Build a main house and a separate ADU.').conflicts.length,2);
});

test('unknown utilities and conditional gas notes never become unconditional scope decisions',()=>{
 const x=extraction([fact('mechanical','Gas appliance connection required','If gas appliances are installed, provide the required connection.')]);
 x.instructions!.exclusions=['Utility connections: lengths not shown'];
 const out=groundDocumentConditions(x,'Build the complete ADU including MEP.');
 assert.deepEqual(out.instructions!.exclusions,[]);assert.ok(out.instructions!.questions.some(q=>/utility connections/.test(q)));
 assert.equal(out.facts[0].basis,'inferred');assert.match(out.facts[0].value,/^If /);
 assert.deepEqual(groundDocumentConditions(x,'Exclude all utility connections.').instructions!.exclusions,x.instructions!.exclusions);
});

test('typed revisions need the actual instruction and matching fact, not a verbatim model quote',()=>{
 const x=extraction([fact('fixtureCount','3'),{...fact('fixtureCount','2','Customer revised the handle count.'),source:'typed scope'}]);
 x.conflicts=[{field:'fixtureCount',values:['3','2'],explanation:'Three in PDF, two in revised scope'}];
 assert.equal(applyExplicitTypedCorrections(x,'Change the passage handles to two, superseding the PDF.').conflicts.length,0);
 assert.equal(applyExplicitTypedCorrections(x,'Use the PDF.').conflicts.length,1);
});

test('incomplete bathroom retains the requested component questions, including placeholder fixtures',()=>{
 const x=extraction();x.clarifications=[{field:'tileSqft',question:'How much floor tile and shower wall tile are included?',reason:'Areas missing'},{field:'fixtures',question:'Which fixtures are being replaced?',reason:'Fixtures unspecified'}];
 const questions=scopeQuestions({service:'bathroom',sqft:'60',finish:'mid-range',fixtures:'Replace fixtures'},x,[],[],[],'Remodel bathroom with new floor and shower wall tile.');
 assert.ok(questions.some(q=>q.field==='flooringSqft'));assert.ok(questions.some(q=>q.field==='tileSqft'));assert.ok(questions.some(q=>q.field==='fixtures'));
});

test('an existing-condition photograph asks what work is wanted before area or finish',()=>{
 const x=extraction([{...fact('service','kitchen','Visible kitchen'),basis:'visual'}]);
 x.clarifications=[{field:'taskList',question:'What work do you want included for this kitchen?',reason:'Photo shows existing conditions only'},{field:'sqft',question:'How large is the kitchen?',reason:'No scale'}];
 assert.deepEqual(scopeQuestions({service:'kitchen'},x,[],[],[],'Estimate from this photo.').map(q=>q.field),['taskList']);
 assert.ok(scopeQuestions({service:'kitchen',taskList:'Replace kitchen cabinets'},x).some(q=>q.field!=='taskList'));
});

test('repair normalization does not add explicitly excluded primer',()=>{
 for(const qualifier of ['no primer','primer excluded','primer by owner','do not prime']){
  const task={id:'patch',description:`Patch one 12x12 inch drywall hole; ${qualifier}.`,evidence:`One drywall patch; ${qualifier}.`,existingLineIds:[],researchDescription:'',issues:[],additions:[{code:'PB-09-01-08',quantity:1,quantityEvidence:'One patch'}]};
  normalizeRepairServices(mapping([task]),config);
  assert.equal(task.additions.length,1,qualifier);
 }
});
