import test from 'node:test';
import assert from 'node:assert/strict';
import {validateExtraction} from '../lib/p5/scope.ts';
import {reconcileScope} from '../lib/p5/adaptive.ts';
import {dynamicScopeFields} from '../lib/p5/dynamicQuestions.ts';

const read=(facts:unknown[])=>validateExtraction({summary:'Synthetic P5 qualification',facts,conflicts:[],missingInformation:[],reviewNotes:[]});
const fact=(field:string,value:string,evidence:string)=>({field,value,evidence,basis:'calculated',confidence:1,source:'typed scope'});

test('live bathroom invented countertop depth never becomes a verified quantity',()=>{
 const extraction=read([
  fact('countertopSqft','2.08','one 30-inch vanity; 30 in / 12 in = 2.5 ft. Assume 1 ft deep: 2.5 ft x 1 ft = 2.5 SF (rounded)'),
  fact('cabinetBaseLf','2.5','one 30-inch vanity; 30 in / 12 in = 2.5 LF'),
 ]);
 assert.equal(extraction.facts[0].basis,'inferred');
 assert.ok(extraction.facts[0].confidence<.85);
 const answers=reconcileScope({},extraction).answers;
 assert.equal(answers.countertopSqft,undefined);
 assert.equal(answers.cabinetBaseLf,'2.5');
 assert.equal(validateExtraction(extraction).facts[0].basis,'inferred');
});

test('calculated fact cannot disagree with its stated final arithmetic result',()=>{
 const extraction=read([fact('sqft','250','20 ft x 15 ft = 300 SF')]);
 assert.equal(reconcileScope({},extraction).answers.sqft,undefined);
});

test('valid explicit quantities and conversions remain usable',()=>{
 const extraction=read([
  fact('sqft','2000','50 ft x 40 ft = 2,000 SF'),
  fact('tileSqft','144','60 SF floor + 84 SF shower walls = 144 SF'),
  fact('countertopSqft','5','30 in / 12 = 2.5 ft; 2.5 ft x 2 ft = 5 SF'),
 ]);
 const answers=reconcileScope({},extraction).answers;
 assert.equal(answers.sqft,'2000');assert.equal(answers.tileSqft,'144');assert.equal(answers.countertopSqft,'5');
});

test('unlike fixture components are not reduced to a guessed global total',()=>{
 const extraction=read([fact('fixtureCount','7','Kitchen: one sink, one faucet. Bath: two faucets, two toilets, vanities have integrated sinks.')]);
 assert.equal(reconcileScope({},extraction).answers.fixtureCount,undefined);
 assert.match(reconcileScope({},extraction).answers.fixtures||'',/two toilets/);
 assert.equal(validateExtraction(extraction).facts[0].field,'fixtures');
});

test('single-kind calculated count is retained',()=>{
 const extraction=read([fact('fixtureCount','3','Two passage handles + one passage handle = 3 handles')]);
 assert.equal(reconcileScope({},extraction).answers.fixtureCount,'3');
});

test('shower valve and trim never asks for linear feet of baseboard',()=>{
 for(const wording of ['shower trim','shower valve trim','shower valve and trim','shower valve/trim']) {
  const fields=dynamicScopeFields({service:'bathroom',sqft:'60',finish:'mid-range'},null,['trimLf'],`Supply and install one ${wording}. Paint bathroom walls.`);
  assert.equal(fields.includes('trimLf'),false,wording);
 }
 assert.ok(dynamicScopeFields({service:'bathroom',sqft:'60',finish:'mid-range'},null,['trimLf'],'Replace wood trim and baseboards.').includes('trimLf'));
});

test('RE10 keeps GFCI and P-trap quantities separate across document reads',()=>{
 const extraction=read([
  {...fact('fixtureCount','2','Replace exactly two GFCI receptacles'),basis:'stated'},
  {...fact('fixtureCount','1','Replace exactly one leaking 1-1/2 inch PVC sink P-trap'),basis:'stated'},
 ]);
 assert.ok(extraction.facts.every(f=>f.field!=='fixtureCount'));
 assert.ok(!extraction.conflicts.some(c=>c.field==='fixtureCount'));
 assert.match(extraction.facts.map(f=>f.value).join(' '),/two GFCI/);
 assert.match(extraction.facts.map(f=>f.value).join(' '),/one leaking/);
});
test('a measured drywall patch does not ask for the house area',()=>{
 const extraction=read([]);
 extraction.takeoffs=[{id:'patch',component:'Drywall patch',description:'Repair 1 SF drywall hole, including spot prime',quantity:1,unit:'SF',basis:'calculated',evidence:'12 inches by 12 inches / 144 = 1 SF',sources:[{source:'re10.pdf',page:1,sheet:'',revision:''}],supersedes:[],issues:[]}];
 assert.ok(!dynamicScopeFields({service:'re10'},extraction,[],'Repair the drywall patch.').includes('sqft'));
 extraction.takeoffs[0].quantity=null;
 extraction.takeoffs[0].basis='uncertain';
 // An unreadable patch measurement still does not make the house floor area
 // useful. The source clarification must request this patch's dimensions.
 extraction.clarifications=[{field:'otherDetails',question:'What are the width and height of the drywall hole?',reason:'The patch measurement is unreadable.'}];
 const missing=dynamicScopeFields({service:'re10'},extraction,[],'Repair the drywall patch.');
 assert.ok(!missing.includes('sqft'));assert.ok(missing.includes('otherDetails'));
});

test('saved image confirmation cannot revive an unsupported countertop dimension',()=>{
 const input={summary:'Bathroom',facts:[{...fact('countertopSqft','2.08','30/12=2.5 LF x standard 12 inch depth = 2.5*1=2.5 SF'),source:'bathroom.png'}],conflicts:[{field:'countertopSqft',values:['2.08'],explanation:'Please confirm countertop area in square feet read from the image: 2.08. Check the drawing label and enter a correction if needed; image readings can be mistaken.'}],missingInformation:[],reviewNotes:[]};
 const extraction=validateExtraction(input);
 assert.equal(reconcileScope({},extraction).answers.countertopSqft,undefined);
 assert.ok(!extraction.conflicts.some(c=>c.field==='countertopSqft'));
});

test('bounded bathroom finish replacement does not repeat the supplied room area',()=>{
 const answers={service:'bathroom',sqft:'60',finish:'mid-range',demolition:'Remove existing finishes and fixtures'};
 assert.ok(!dynamicScopeFields(answers,null,[],'Remove existing finishes and fixtures. Replace 60 SF floor tile.').includes('demolitionSqft'));
 assert.ok(dynamicScopeFields({...answers,demolition:'Remove walls and slabs'},null,['demolitionSqft'],'Remove walls and slabs.').includes('demolitionSqft'));
});
