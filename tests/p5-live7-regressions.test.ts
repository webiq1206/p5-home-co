import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeQuestions,reconcileScope} from '../lib/p5/adaptive.ts';
import {normalizeCountSubjects,normalizeTileSubjects,reconcileDocumentHierarchy} from '../lib/p5/scopeInterpretation.ts';
import {applyExplicitTypedCorrections} from '../lib/p5/typedCorrections.ts';
import {researchTaskBatches} from '../lib/p5/scopePricing.ts';
import {emptyInstructions} from '../lib/p5/instructions.ts';
import type {ScopeExtraction,ExtractedFact} from '../lib/p5/scope.ts';
const fact=(field:ExtractedFact['field'],value:string,evidence:string,source='fixture.pdf'):ExtractedFact=>({field,value,evidence,source,basis:'stated',confidence:1});
const extraction=(facts:ExtractedFact[]=[]):ScopeExtraction=>({summary:'Regression fixture',facts,conflicts:[],missingInformation:[],reviewNotes:[]});

test('window-only correction does not inherit whole-kitchen dimensions or finish questions',()=>{
 const text='Replace only the two existing windows with contractor-supplied white vinyl double-pane windows, each 3 feet wide by 4 feet high. Keep existing openings. Include removal, disposal, weatherproofing, and interior trim repair. Keep the wood floor, brick walls, and all other items unchanged. No cabinet work, appliances, electrical, or structural changes.';
 const x=extraction();x.clarifications=[{field:'sqft',question:'How large is the kitchen?',reason:'No photo scale'}];
 const q=scopeQuestions({service:'kitchen',taskList:text},x);
 assert.equal(q.some(q=>['sqft','finish','flooringSqft','cabinetBaseLf','cabinetUpperLf'].includes(q.field)),false,JSON.stringify(q));
 assert.ok(scopeQuestions({service:'kitchen',taskList:'Completely remodel the kitchen, including new floor, cabinets, counters and electrical.'},null).some(q=>q.field==='sqft'));
});

test('actual Osprey title and area labels reconcile without treating gross area as living area',()=>{
 const x=extraction([fact('sqft','376','376 SQ. FOOT DWELLING ABOVE'),fact('sqft','376','STUDIO: 376 SQ. FT'),fact('garageSqft','528','GARAGE: 528 SQ. FT'),fact('sqft','904','904 SQ. FT STUDIO ADU ABOVE GARAGE')]);
 x.conflicts=[{field:'sqft',values:['376','904'],explanation:'Different pages'}];
 const result=reconcileDocumentHierarchy(x,'Build this ADU above its garage.');
 assert.deepEqual(result.conflicts,[]);assert.equal(reconcileScope({},result).answers.sqft,'376');
 const wrong=structuredClone(x);wrong.facts.find(f=>f.field==='garageSqft')!.value='500';
 assert.equal(reconcileDocumentHierarchy(wrong,'Build this ADU.').conflicts.length,1);
});

test('two bathrooms establish bathroom count, never a whole-home room count',()=>{
 const out=normalizeCountSubjects(extraction([fact('rooms','2','Two bathrooms, each receives one 30-inch vanity.')]));
 assert.equal(out.facts[0].field,'bathrooms');
 const room=normalizeCountSubjects(extraction([fact('rooms','8','Eight total rooms, including two bathrooms.')]));
 assert.equal(room.facts[0].field,'rooms');
});

test('legacy combined tile total cannot answer a wall-only question or override its revision',()=>{
 const x=extraction([fact('service','bathroom','Bathroom remodel'),{...fact('tileSqft','144','60 SF floor tile + 84 SF shower wall tile = 144'),basis:'calculated'}]);
 x.takeoffs=[{id:'floor',component:'tile-floor',description:'Bathroom floor tile',quantity:60,unit:'SF',basis:'stated',evidence:'60 SF floor tile',sources:[{source:'fixture.pdf',page:1}],issues:[]},{id:'wall',component:'tile-shower-walls',description:'Shower wall tile',quantity:84,unit:'SF',basis:'stated',evidence:'84 SF shower wall tile',sources:[{source:'fixture.pdf',page:1}],issues:[]}];
 const normalized=normalizeTileSubjects(x);
 const a=reconcileScope({},normalized).answers;
 assert.equal(a.flooringSqft,'60');assert.equal(a.wallTileSqft,'84');
 normalized.facts.push(fact('tileSqft','96','96 SF shower wall tile','typed scope'));
 const revised=applyExplicitTypedCorrections(normalizeTileSubjects(normalized),'Change shower wall tile to 96 SF, superseding the PDF.');
 assert.equal(reconcileScope({},revised).answers.wallTileSqft,'96');assert.equal(reconcileScope({},revised).answers.flooringSqft,'60');
 const incomplete=extraction();incomplete.clarifications=[{field:'tileSqft',question:'How much floor and shower wall tile are included?',reason:'Missing surfaces'}];
 const questions=scopeQuestions({service:'bathroom',sqft:'60',finish:'mid-range',tileSqft:'144'},incomplete,[],[],[],'Replace floor tile and shower wall tile.');
 assert.ok(questions.some(q=>q.field==='wallTileSqft'));assert.ok(questions.some(q=>q.field==='flooringSqft'));
});

test('adhesive research does not receive cabinet screw selection instructions',()=>{
 const text='Install one vanity and include installation supplies, adhesives and screws.';
 const scope={text,answers:{service:'bathroom'},extraction:null,uploads:[],reviewedAt:'2026-09-30',corrections:[]};
 const task={id:'supplies',description:'Supply adhesives and screws',researchDescription:'Supply adhesives and screws',evidence:text,issues:[],additions:[],existingLineIds:[]};
 const batches=researchTaskBatches([task],scope);
 const adhesive=batches.flat().find(t=>t.description.endsWith('adhesives'))!;
 assert.ok(adhesive);assert.doesNotMatch(adhesive.researchDescription,/manufacturer-specified cabinet mounting/);
 assert.match(adhesive.researchDescription,/bonding or sealing operation/);assert.match(adhesive.researchDescription,/tube or gallon/);
});

test('incomplete base and wall cabinet packages retain both run questions',()=>{
 for(const service of ['kitchen','cabinet-product']){
  const q=scopeQuestions({service},null,[],[],[],'Supply kitchen base and wall cabinets only. Owner installs. No tall cabinets, countertops or flooring.');
  assert.ok(q.some(q=>q.field==='cabinetBaseLf'),JSON.stringify(q));assert.ok(q.some(q=>q.field==='cabinetUpperLf'));
 }
});

test('an undecided garage is asked before its size and repeated source questions bind once',()=>{
 const q=scopeQuestions({service:'new-construction',sqft:'2000'},null,[],[],[],'Build a new home. Garage requirements are undecided.');
 assert.ok(q.some(q=>q.field==='garageIncluded'));assert.equal(q.some(q=>q.field==='garageSqft'),false);
 const x=extraction();x.instructions=emptyInstructions();
 x.instructions.questions=['Is the ADU a single-story structure, or should pricing include multiple levels?'];
 x.clarifications=[{field:'stories',question:x.instructions.questions[0],reason:'Stories missing'}];
 const adu=scopeQuestions({service:'adu',sqft:'600',finish:'mid-range',garageIncluded:'no'},x,[],[],[],'Build a complete 600 SF ADU.');
 assert.equal(adu.filter(q=>/story|stories|levels/i.test(q.reason)).length,1,JSON.stringify(adu));
 x.instructions.questions=['How many GFCI receptacles are to be replaced?'];
 x.clarifications=[{field:'fixtureCount',question:'How many GFCI receptacles are to be replaced? The price depends on the total count.',reason:'Count missing'}];
 const re10=scopeQuestions({service:'re10'},x,[],[],[],'Replace GFCI receptacles.');
 assert.equal(re10.filter(q=>/GFCI/.test(q.reason)).length,1,JSON.stringify(re10));
});
