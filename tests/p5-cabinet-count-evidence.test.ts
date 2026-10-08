import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCabinetCountEvidence} from '../lib/p5/cabinetCountEvidence.ts';
import type {ReviewedScope} from '../lib/p5/scope.ts';

const scope=(text='Supply and install 3 LF of tall pantry cabinets.'):ReviewedScope=>({text,answers:{service:'remodel',cabinetTallLf:'3'},extraction:null,uploads:[],reviewedAt:'2026-10-06T20:15:00.000Z',corrections:[]});
const task={description:'Supply and install 3 LF of tall pantry cabinets.'};
const rate={code:'PB-12-32-04',description:'Tall pantry / oven cabinet',unit:'EA'};
const addition={quantity:3,quantityEvidence:'Modeled as 3 cabinet units at 1 LF each = 3 EA',quantityRange:{low:3,high:3}};
const check=(overrides:Partial<Parameters<typeof validateCabinetCountEvidence>[0]>={})=>validateCabinetCountEvidence({scope:scope(),task,rate,addition,...overrides});
const allowance=(quantity=2,quantityEvidence='ALLOWANCE: 3 LF of tall pantry run divided by an assumed 18-inch-wide cabinet = 2 EA. Confirm cabinet widths and count before ordering.',low=1,high=3)=>({quantity,quantityEvidence,quantityRange:{low,high}});
const invalid=(result:ReturnType<typeof check>)=>{assert.equal(result.applicable,true);assert.ok(result.applicable&&!result.valid);return result;};

test('saved pantry proposal cannot turn 3 LF into three confirmed EA',()=>{
 const input={scope:scope(),task,rate,addition},before=structuredClone(input);
 const result=invalid(validateCabinetCountEvidence(input));
 assert.match(result.issue,/LF cannot be copied into confirmed EA/);
 assert.equal(result.facts.sourceLengthFt,3);assert.equal(result.facts.sourceCount,undefined);
 assert.equal(result.facts.proposedCount,3);assert.equal(result.facts.quantityUnit,'EA');
 assert.ok(result.facts.sourceFacts.some(fact=>fact.unit==='LF'&&fact.text.includes('3 LF')));
 assert.deepEqual(input,before,'a validator cannot rewrite saved inputs or quantities');
});

for(const text of ['Install three tall pantry cabinets.','Install 3 pantry cabinets.','Install one 36-inch-wide tall pantry cabinet.','Tall pantry cabinet count: 1 EA.'])test('original stated count survives: '+text,()=>{
 const quantity=/three|\b3\b/.test(text)?3:1;
 const result=check({scope:scope(text),addition:{quantity,quantityEvidence:'Use the original cabinet count.',quantityRange:null}});
 assert.ok(result.applicable&&result.valid);assert.equal(result.basis,'stated-count');assert.equal(result.facts.sourceCount,quantity);
 assert.equal(result.facts.sourceLengthFt,3,'the independent LF fact remains a length');
});

for(const size of ['36 x 84','36 × 84','36×84','24 x 36 x 84','36 in x 84','36 x 84 inches','36" × 84"','36-in x 84-in','36 W x 84 H x 24 D'])test('cabinet dimensions never authenticate a count: '+size,()=>{
 const result=invalid(check({scope:scope('Install a '+size+' pantry cabinet.'),addition:{quantity:84,quantityEvidence:'Original cabinet count.',quantityRange:null}}));
 assert.equal(result.facts.sourceCount,undefined);
});

test('a real EA count before cabinet dimensions remains the original count',()=>{
 const result=check({scope:scope('Install 2 EA 36 x 84 pantry cabinets.'),addition:{quantity:2,quantityEvidence:'Two explicitly requested units.',quantityRange:null}});
 assert.ok(result.applicable&&result.valid);assert.equal(result.facts.sourceCount,2);
});

for(const text of ['Install 1 - 3 pantry cabinets.','Install 1–3 pantry cabinets.',`Install 1${String.fromCharCode(0x2014)}3 pantry cabinets.`,'Install two to three pantry cabinets.','Install 1 EA to 3 EA tall pantry cabinets.','Tall pantry cabinets: 1 - 3 EA.','Tall pantry cabinet count: 1 to 3 each.','Install between two and three pantry cabinets.','Install up to three pantry cabinets.','Install at least three pantry cabinets.','Install at most three pantry cabinets.','Install about three pantry cabinets.','Install around three pantry cabinets.','Install roughly three pantry cabinets.','Install more than three pantry cabinets.','Install less than three pantry cabinets.','Install approximately three pantry cabinets.','Install three pantry cabinets maximum.'])test('a source range or bound cannot authenticate its endpoint: '+text,()=>{
 const result=invalid(check({scope:scope(text),addition:{quantity:3,quantityEvidence:'Original stated count.',quantityRange:null}}));
 assert.equal(result.facts.sourceCount,undefined);
});

for(const other of ['24-36 LF of base cabinets','about 24 SF of countertop','approximately 24 SF of countertop'])test('unrelated uncertainty does not invalidate a separate exact count: '+other,()=>{
 const result=check({scope:scope('Allow '+other+' and install three pantry cabinets.'),addition:{quantity:3,quantityEvidence:'Three original pantry units.',quantityRange:null}});
 assert.ok(result.applicable&&result.valid);assert.equal(result.facts.sourceCount,3);
});

for(const size of ['24-36-inch-wide','24–36 inches wide','24 inches to 36 inches wide'])test('a separate real count survives a dimensional width range: '+size,()=>{
 const result=check({scope:scope('Install 2 EA '+size+' tall pantry cabinets.'),addition:{quantity:2,quantityEvidence:'Two requested cabinet units; width selection remains unresolved.',quantityRange:null}});
 assert.ok(result.applicable&&result.valid);assert.equal(result.basis,'stated-count');assert.equal(result.facts.sourceCount,2);
});

for(const action of ['Remove','Removal of','Demolish','Demolition of','Dispose of','Disposal of','Discard','Haul off','Haul-off','Retain','Keep','Reuse'])test('a '+action.toLowerCase()+' count cannot price the new cabinet supply',()=>{
 const original=scope(action+' three pantry cabinets. Supply and install 6 LF of new tall pantry cabinets.');original.answers.cabinetTallLf='6';
 const result=invalid(check({scope:original,task:{description:'Supply and install 6 LF of new tall pantry cabinets.'},addition:{quantity:3,quantityEvidence:'Original count stated.',quantityRange:null}}));
 assert.equal(result.facts.sourceCount,undefined);
});

test('separate removal and replacement counts preserve only the new installation count',()=>{
 const result=check({scope:scope('Remove three pantry cabinets and install two pantry cabinets.'),addition:{quantity:2,quantityEvidence:'Two cabinets explicitly requested for installation.',quantityRange:null}});
 assert.ok(result.applicable&&result.valid);assert.equal(result.facts.sourceCount,2);
});

test('an explicit remove-and-replace instruction supplies a replacement count',()=>{
 const result=check({scope:scope('Remove and replace three pantry cabinets.'),addition:{quantity:3,quantityEvidence:'Three replacement cabinets explicitly requested.',quantityRange:null}});
 assert.ok(result.applicable&&result.valid);assert.equal(result.facts.sourceCount,3);
});

for(const qualifier of ['remain','stay','are retained','will be disposed of','are existing'])test('a passive '+qualifier+' count cannot authenticate new cabinet supply',()=>{
 const original=scope('Three pantry cabinets '+qualifier+'. Supply and install 6 LF of new tall pantry cabinets.');original.answers.cabinetTallLf='6';
 const result=invalid(check({scope:original,task:{description:'Supply and install 6 LF of new tall pantry cabinets.'},addition:{quantity:3,quantityEvidence:'Original count stated.',quantityRange:null}}));
 assert.equal(result.facts.sourceCount,undefined);
});

for(const text of ['Three pantry cabinets.','Cabinet schedule: 3 EA pantry cabinets.','3 pantry cabinets with roll-out shelves.'])test('unqualified cabinet BOM count remains usable: '+text,()=>{
 const result=check({scope:scope(text),addition:{quantity:3,quantityEvidence:'Original BOM count.',quantityRange:null}});
 assert.ok(result.applicable&&result.valid);assert.equal(result.facts.sourceCount,3);
});

for(const text of ['Install 3 EA tall pantry cabinets.','Install 3 each tall pantry cabinets.','Install 3EA tall pantry cabinets.','Install three 36 x 84 pantry cabinets.','Install 3 EA 36 inches × 84 inches tall pantry cabinets.','Install three 36" x 84" x 24" pantry cabinets.'])test('explicit cabinet count survives unit and dimension qualifiers: '+text,()=>{
 const result=check({scope:scope(text),addition:{quantity:3,quantityEvidence:'Original stated count.',quantityRange:null}});
 assert.ok(result.applicable&&result.valid);assert.equal(result.basis,'stated-count');assert.equal(result.facts.sourceCount,3);
});

test('original count overrides contradictory mapper assertions and allowances',()=>{
 for(const proposed of [addition,allowance(2)]){
  const result=invalid(check({scope:scope('Install one pantry cabinet.'),addition:proposed}));
  assert.match(result.issue,/original stated cabinet count/);
 }
});

test('mapping descriptions, quantity evidence, extraction summaries and inferred facts cannot supply original counts',()=>{
 const original=scope();original.extraction={summary:'Install three pantry cabinets.',facts:[{field:'cabinetTallLf',value:'3',basis:'inferred',confidence:1,source:'model',evidence:'Three pantry cabinets.'}],conflicts:[],missingInformation:[],reviewNotes:[]};
 const result=invalid(check({scope:original,task:{description:'Install three pantry cabinets.'},addition:{...addition,quantityEvidence:'Confirmed three pantry cabinets from original scope.'}}));
 assert.equal(result.facts.sourceCount,undefined);
});

test('original document text and reviewed task answers can establish a count',()=>{
 for(const source of ['document','answer']){
  const original=scope();
  if(source==='document')original.extraction={summary:'',sourceText:'Install two pantry cabinets.',facts:[],conflicts:[],missingInformation:[],reviewNotes:[]};
  else original.answers.taskList='Install two pantry cabinets.';
  const result=check({scope:original,addition:{quantity:2,quantityEvidence:'Two cabinets explicitly requested.',quantityRange:null}});
  assert.ok(result.applicable&&result.valid);assert.equal(result.basis,'stated-count');
 }
});

test('conflicting, alternative or assumed original counts cannot authenticate one selected count',()=>{
 for(const text of ['Install one pantry cabinet; install two pantry cabinets.','Install one or three pantry cabinets.','Assume three pantry cabinets.','Do not install three pantry cabinets.']){
  invalid(check({scope:scope(text)}));
 }
});

test('a disclosed inch-width allowance preserves extent and verifies EA arithmetic',()=>{
 const result=check({addition:allowance()});
 assert.ok(result.applicable&&result.valid);assert.equal(result.basis,'width-allowance');
 assert.equal(result.facts.sourceLengthFt,3);assert.equal(result.facts.proposedWidthIn,18);assert.equal(result.facts.proposedCount,2);
 assert.equal(result.facts.sourceCount,undefined,'a valid modeled count never becomes a customer fact');
});

test('an explicitly proposed foot width is converted, never supplied by a default',()=>{
 const result=check({addition:allowance(3,'ALLOWANCE: 3 LF run / assumed cabinet width 1 foot = 3 EA; confirm width and count.',2,4)});
 assert.ok(result.applicable&&result.valid);assert.equal(result.facts.proposedWidthIn,12);
 invalid(check({addition:allowance(3,'ALLOWANCE: 3 LF of tall pantry cabinets = 3 EA; confirm count.',2,4)}));
});

for(const evidence of [
 '3 LF / assumed 18-inch-wide cabinet = 2 EA.',
 'ALLOWANCE: 3 LF / assumed 36-inch-wide cabinet = 2 EA.',
 'ALLOWANCE: 3 SF / assumed 18-inch-wide cabinet = 2 EA.',
 'ALLOWANCE: 3 LF / assumed 18 inches deep = 2 EA.',
 'ALLOWANCE: 3 LF / assumed 18 inches tall = 2 EA.',
 'ALLOWANCE: 3 LF / assumed 18-inch-wide countertop = 2 EA.',
 'ALLOWANCE: 3 LF / assumed 18-inch-wide base cabinet = 2 EA.',
 'ALLOWANCE: 3 LF / assumed cabinet width 450 mm = 2 EA.',
 'ALLOWANCE: 3 LF / assumed cabinet width 18 inches or width 36 inches = 2 EA.',
 'ALLOWANCE: 3 LF / assumed 18-inch-wide cabinet; count to confirm.',
])test('incomplete or dimensionally unsupported allowance remains held: '+evidence,()=>{
 invalid(check({addition:allowance(2,evidence)}));
});

for(const range of [undefined,null,{low:2,high:2},{low:0,high:3},{low:3,high:4},{low:1,high:1.5},{low:1,high:Infinity},{low:NaN,high:3}])test('a modeled count requires a real positive uncertainty range: '+JSON.stringify(range),()=>{
 invalid(check({addition:{...allowance(),quantityRange:range}}));
});

test('missing, uncertain and conflicting LF source quantities never become guessed widths',()=>{
 invalid(check({scope:undefined,addition:allowance()}));
 const original=scope('Supply tall pantry cabinets.');original.answers.cabinetTallLf=undefined;
 invalid(check({scope:original,addition:allowance()}));
 original.answers.cabinetTallLf='3';original.uncertainFields=['cabinetTallLf'];
 invalid(check({scope:original,addition:allowance()}));
 invalid(check({scope:scope('Supply 6 LF of tall pantry cabinets.'),addition:allowance()}));
});

test('base/upper LF lines and cabinet accessories are outside this narrow rule',()=>{
 for(const otherRate of [
  {code:'PB-12-32-01',description:'Base cabinets',unit:'LF'},
  {code:'PB-12-32-02',description:'Wall / upper cabinets',unit:'LF'},
  {...rate,unit:'LF'},
  {description:'Tall pantry cabinet hinges',unit:'EA'},
  {description:'Pantry cabinet shelves',unit:'EA'},
  {description:'Panel-ready appliance panel',unit:'EA'},
 ])assert.deepEqual(check({rate:otherRate}),{applicable:false});
 assert.deepEqual(check({task:{description:'Supply base cabinets.'}}),{applicable:false});
 assert.deepEqual(check({task:{description:'Supply tall pantry cabinet hinges.'}}),{applicable:false});
});

test('counts of pantry cabinet hardware are not counts of whole pantry cabinets',()=>{
 const result=invalid(check({scope:scope('Install three pantry cabinet handles; supply 3 LF of tall pantry cabinets.')}));
 assert.equal(result.facts.sourceCount,undefined);
});

test('oven cabinet and canonical component rates use their matching original count',()=>{
 const result=check({scope:scope('Install two oven cabinets.'),task:{description:'Install oven cabinets.'},rate:{...rate,code:'PB-12-32-04-L'},addition:{quantity:2,quantityEvidence:'Two oven cabinets requested.',quantityRange:null}});
 assert.ok(result.applicable&&result.valid);assert.equal(result.basis,'stated-count');
 invalid(check({scope:scope('Install two oven cabinets.'),addition:{quantity:2,quantityEvidence:'Two units.',quantityRange:null}}));
});

test('unit counts must remain positive whole cabinets',()=>{
 for(const quantity of [0,-1,1.5,Infinity,NaN])invalid(check({addition:{...allowance(),quantity}}));
});
