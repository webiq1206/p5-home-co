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

test('construction fill and splash-block notes cannot answer site or utility conditions',()=>{
 const x=extraction([
  fact('site','Assumes flat site and standard soil.'),
  fact('site','Land purchase excluded. 4 inches of compacted granular fill under slab.'),
  fact('site','No site, soil or slope data in this segment. Splash block at landscape areas.'),
  fact('utilities','Utility scope not detailed; site and service information must be provided.')
 ]);
 const out=groundDocumentConditions(x,'Build a complete 376 SF ADU.');
 const a=reconcileScope({service:'adu',sqft:'376',finish:'mid-range'},out).answers;
 assert.equal(a.site,undefined);
 x.clarifications=[{field:'site',question:'What are the actual site conditions?',reason:'Site-specific cost'},{field:'utilities',question:'Which utility connections and lengths?',reason:'Connections'}];
 const updated=groundDocumentConditions(x,'Build a complete ADU.');
 const q=scopeQuestions(reconcileScope({service:'adu',sqft:'376',finish:'mid-range'},updated).answers,updated);
 assert.equal(q.filter(q=>q.field==='site').length,1);assert.equal(q.filter(q=>q.field==='utilities').length,1);
 const actual=groundDocumentConditions(extraction([fact('site','Existing site is level; customer confirms granular fill is already placed.')]),'Build an ADU.');
 assert.equal(actual.facts[0].field,'site');
});

test('repeated covered access area questions merge without merging named structures or components',async()=>{
 const {sameDecision}=await import('../lib/p5/clarifications.ts');
 const a='What is the square footage of any covered exterior landings or stairs to be included?';
 const b='Dimensions of covered exterior stairs/landings?';
 const c='What is the area in square feet of covered landings or exterior stairs to be included?';
 assert.equal(sameDecision(a,b),true);assert.equal(sameDecision(a,c),true);
 assert.equal(sameDecision(a,'What is the covered porch area in square feet?'),false);
 assert.equal(sameDecision(a,'What is the area of the main home covered stairs and landings?'),false);
 const x=extraction();x.instructions!.questions=[a,b,c];
 assert.equal(scopeQuestions({service:'adu',sqft:'376',finish:'mid-range'},x).filter(q=>/covered.*(?:stairs|landings)/i.test(q.reason)).length,1);
});

test('partial flooring and bathroom tile cannot borrow their project footprint as measured installation',async()=>{
 const {separateFootprintFromInstallation}=await import('../lib/p5/scopeInterpretation.ts');
 for(const [size,field,text] of [['1800','flooringSqft','Remodel selected interior finishes of an 1800 SF Boise home: flooring, paint and doors.'],['60','tileSqft','Replace floor tile in one 60 SF bathroom.']] as const){
  const x=extraction([fact('sqft',size,text),{...fact(field,size,text),source:'typed scope'}]);
  const out=separateFootprintFromInstallation(x,text);
  assert.equal(out.facts.some(f=>f.field===field),false);assert.match(out.facts[1].value,/unmeasured/);
  assert.equal(scopeQuestions(reconcileScope({service:field==='tileSqft'?'bathroom':'whole-home'},out).answers,out,[],[],[],text).some(q=>q.field==='flooringSqft'),true);
 }
 const explicit='Remodel an 1800 SF home. Replace 1800 SF of LVP flooring.';
 const x=extraction([fact('sqft','1800','1800 SF home'),{...fact('flooringSqft','1800','1800 SF of LVP flooring'),source:'typed scope'}]);
 assert.equal(separateFootprintFromInstallation(x,explicit).facts[1].field,'flooringSqft');
 const mixed=extraction([fact('sqft','1800','1800 SF home'),{...fact('flooringSqft','1800','1800 SF home: flooring'),source:'typed scope'}]);
 mixed.takeoffs=[{id:'floor',description:'LVP flooring in house',component:'flooring',quantity:1800,unit:'SF',basis:'stated',evidence:'Measured house installation area: 1800 SF of LVP flooring.',building:'',floor:'',sources:[],supersedes:[],issues:[]}];
 assert.equal(separateFootprintFromInstallation(mixed,'Remodel selected finishes in an 1800 SF home.').takeoffs![0].quantity,1800);
});

test('a revised garage rectangle resolves only with matching stated area and arithmetic',async()=>{
 const {applyExplicitTypedCorrections}=await import('../lib/p5/typedCorrections.ts');
 const text='Change the garage to 24 by 24 feet, 576 SF, superseding the PDF garage size. Keep the 2000 SF house unchanged.';
 const x=extraction([{...fact('garageSqft','576',text),source:'typed scope'},fact('sqft','2000','2000 SF home')]);
 x.conflicts=[{field:'garageSqft',values:['440','576'],explanation:'Revised garage size differs from PDF.'}];
 const out=applyExplicitTypedCorrections(x,text);assert.equal(out.conflicts.length,0);assert.equal(out.facts.find(f=>f.field==='sqft')!.value,'2000');
 assert.equal(applyExplicitTypedCorrections(x,text.replace('24 by 24','24 by 22')).conflicts.length,1);
});

test('incidental debris cleanup does not classify an entire hardware replacement as cleanup',async()=>{
 const {suggestedTrade}=await import('../lib/p5/trades.ts');
 assert.equal(suggestedTrade('Remove existing and install two owner-supplied interior passage lever handles on doors, including adjustment, functional testing, and minor debris cleanup.'),'Windows & Doors');
 assert.equal(suggestedTrade('Perform final cleanup after the window replacement.'),'Cleanup & Disposal');
 assert.equal(suggestedTrade('Repair and resecure 6 linear feet of existing interior window trim. No new casing or stool package and no rot repair.'),'Trim & Finish Carpentry');
 assert.equal(suggestedTrade('Replace one window and repair its existing trim.'),'Windows & Doors');
});
