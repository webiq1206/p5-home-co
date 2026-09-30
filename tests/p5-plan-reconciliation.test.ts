import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeQuestions,reconcileScope} from '../lib/p5/adaptive.ts';
import {reconcileDocumentHierarchy,groundDocumentConditions,normalizeCountSubjects} from '../lib/p5/scopeInterpretation.ts';
import {emptyInstructions} from '../lib/p5/instructions.ts';
import type {ScopeExtraction,ExtractedFact} from '../lib/p5/scope.ts';
const fact=(field:ExtractedFact['field'],value:string,evidence=value):ExtractedFact=>({field,value,evidence,source:'public-fixture.pdf',confidence:1,basis:'stated'});
const extraction=(facts:ExtractedFact[]=[]):ScopeExtraction=>({summary:'Public-plan regression fixture',facts,conflicts:[],reviewNotes:[],missingInformation:[],instructions:emptyInstructions()});
test('vertically stacked ADU and garage are not separate buildings; a main home remains separate',()=>{
 const x=extraction([fact('sqft','376','STUDIO: 376 SQ. FT'),fact('garageSqft','528','GARAGE: 528 SQ. FT'),fact('sqft','904','904 SQ. FT STUDIO ADU ABOVE GARAGE')]);
 x.instructions!.separateBuildings=true;x.conflicts=[{field:'sqft',values:['376','904'],explanation:'Areas differ'}];
 const out=reconcileDocumentHierarchy(x,'Construct the detached ADU above its garage.');
 assert.equal(out.instructions!.separateBuildings,false);assert.deepEqual(out.conflicts,[]);assert.equal(reconcileScope({},out).answers.sqft,'376');
 assert.equal(reconcileDocumentHierarchy(x,'Construct the main house and detached ADU above its garage.').conflicts.length,1);
 x.instructions!.buildings=['ADU above garage','Pool house'];
 assert.equal(reconcileDocumentHierarchy(x,'Construct the detached ADU above its garage, plus the pool house shown in the set.').conflicts.length,1);
});
test('design assumptions and drainage requirements do not answer actual site conditions',()=>{
 const x=extraction([fact('site','Flat site with normal soils','DESIGNED SLAB-ON-GRADE FOUNDATION, AND ASSUMES A FLAT SITE WITH STANDARD SOIL'),fact('site','Site grading to discharge water away','SITE GRADING AND DOWNSPOUT DESIGN TO DISCHARGE WATER AWAY FROM STRUCTURE')]);
 const out=groundDocumentConditions(x,'Construct this ADU.');const a=reconcileScope({service:'adu',sqft:'376',finish:'mid-range'},out).answers;
 assert.equal(a.site,undefined);assert.equal(out.facts.length,2);assert.ok(out.facts.every(f=>f.value.includes('not verified site conditions')));
 assert.equal(scopeQuestions(a,out,[],[],[],'Construct this ADU.').filter(q=>q.field==='site').length,1);
 const supplied={...a,site:'Customer confirms actual lot is level, soil report supports shallow footings and the driveway provides clear equipment access.'};
 assert.equal(scopeQuestions(supplied,out,[],[],[],'Construct this ADU.').some(q=>q.field==='site'),false);
});
test('bedroom-only counts remain evidence without becoming a total room count',()=>{
 const out=normalizeCountSubjects(extraction([fact('rooms','3','Three bedrooms and two bathrooms')]));
 assert.equal(out.facts[0].field,'otherDetails');assert.match(out.facts[0].value,/Three bedrooms/);
 assert.equal(normalizeCountSubjects(extraction([fact('rooms','8','Eight rooms including three bedrooms')])).facts[0].field,'rooms');
});
test('selected interior work asks its flooring quantity independently of house area',()=>{
 const q=scopeQuestions({service:'whole-home',sqft:'1800'},null,[],[],[],'Remodel selected interior finishes of an 1800 SF home: flooring, wall and ceiling paint, interior doors and baseboard. Retain kitchen cabinets, bathrooms, roof and windows. No structural or MEP changes.');
 assert.ok(q.some(q=>q.field==='flooringSqft'));assert.ok(q.some(q=>q.field==='trimLf'));
 assert.equal(q.some(q=>q.field==='cabinetBaseLf'),false);
});
test('utility-run fragments and duplicate broad source questions are asked once',()=>{
 const x=extraction();x.instructions!.questions=['Utility run info (water, sewer, power, gas)','What appliances and built-in fixtures are included in the construction scope (allowance/owner-supplied)?'];
 x.clarifications=[{field:'utilities',question:'What utility connections are required?',reason:'Connection scope'},{field:'appliances',question:x.instructions!.questions[1],reason:'Supply responsibilities'}];
 const q=scopeQuestions({service:'adu',sqft:'600',finish:'mid-range'},x,[],[],[],'Build a complete ADU.');
 assert.equal(q.filter(q=>q.field==='utilities').length,1);assert.match(q.find(q=>q.field==='utilities')!.reason,/Which utility connections/);
 assert.equal(q.filter(q=>q.reason.includes('built-in fixtures')).length,1);
});

test('an explicit two-handle revision overrides three in a source even when the reader only returned a conflict',async()=>{
 const {applyExplicitTypedCorrections}=await import('../lib/p5/typedCorrections.ts');
 const x=extraction();x.conflicts=[{field:'fixtureCount',values:['3','2'],explanation:'PDF three, revision two'}];
 const text='Estimate the attached scope with this explicit revision: Change passage handle replacements to exactly two, superseding the PDF three.';
 const out=applyExplicitTypedCorrections(x,text);
 assert.deepEqual(out.conflicts,[]);assert.equal(reconcileScope({},out).answers.fixtureCount,'2');
 assert.equal(applyExplicitTypedCorrections(x,'Do not change passage handles to two.').conflicts.length,1);
 assert.equal(applyExplicitTypedCorrections(x,'Change passage handles to two or three.').conflicts.length,1);
});
test('window-only work still asks about explicitly requested trim repair, without opening unrelated trades',()=>{
 const text='Replace only two windows. Include interior trim repair. Keep all cabinets and flooring unchanged.';
 const q=scopeQuestions({service:'kitchen',taskList:text},null);
 assert.ok(q.some(q=>q.field==='trimLf'));assert.equal(q.some(q=>['cabinetBaseLf','sqft','flooringSqft'].includes(q.field)),false);
});
test('window flashing stays under windows, while roof flashing stays under roofing',async()=>{
 const {suggestedTrade}=await import('../lib/p5/trades.ts');
 assert.equal(suggestedTrade('Window / door flashing, per opening.'),'Windows & Doors');
 assert.equal(suggestedTrade('Roof flashing at dormer window.'),'Roofing');
});
