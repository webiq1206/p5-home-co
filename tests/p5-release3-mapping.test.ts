import test from 'node:test';import assert from 'node:assert/strict';
import {catalogResolution,normalizeConsumableMapping,normalizeRepairServices,normalizeExplicitFinishOperations} from '../lib/p5/scopePricing.ts';
import {priceBookRates} from '../lib/p5/priceBook.ts';import {EMPTY_CONFIGURATION} from '../lib/p5/costBook.ts';
const now=new Date('2026-09-30');
const configuration={...EMPTY_CONFIGURATION,planningCatalog:{version:'qa',source:'Owner book',authorizedBy:'QA',importedAt:now.toISOString(),rates:priceBookRates({service:'re10',finish:'mid-range'})}} as any;
const mapping=(description:string,additions:any[],evidence=description)=>({tasks:[{id:'task',description,evidence,additions,existingLineIds:[],issues:[],researchDescription:''}],issues:[],notes:[],replacements:[],removeExclusions:[]}) as any;
const add=(code:string,quantity:number,quantityEvidence:string)=>({code,quantity,quantityEvidence});
test('nominal vanity width is not an each-count in two independently located bathroom tasks',()=>{
 const m=mapping('Supply and install 30" vanity w/ integrated top and sink, one faucet, and one toilet in bathroom 1 at existing locations.',[add('PB-12-41-01',1,'1 EA: Each bathroom includes one 30-inch vanity')],'Two bathrooms: each supply/install one 30-inch vanity with integrated top/sink, one faucet and one toilet.');
 const result=catalogResolution(m,configuration,[],now);assert.ok(!result.issues.some(i=>/explicit quantity/.test(i)),result.issues.join('; '));assert.equal(result.rules[0].quantity.fixed,1);
 m.tasks[0].additions[0].quantity=2;assert.ok(catalogResolution(m,configuration,[],now).issues.some(i=>/explicit quantity/.test(i)),'a real count mismatch still fails');
});
test('a twelve-inch drywall hole cannot use the under-six-inch repair service',()=>{
 const m=mapping('Repair one 12 by 12 inch (1 SF) hole in 5/8-inch Type X drywall, including backing, tape, compound and spot prime.',[add('PB-09-01-07',1,'One drywall hole')]);
 normalizeRepairServices(m,configuration);assert.equal(m.tasks[0].additions[0].code,'PB-09-01-08');assert.equal(m.tasks[0].additions[0].quantity,1);
});
test('GFCI purchase specification survives a generic receptacle catalog suggestion',()=>{
 const m=mapping('Replace two GFCI receptacles.',[add('PB-26-01-05',2,'Two GFCIs'),add('PB-26-28-02',2,'Two devices')]);
 normalizeConsumableMapping(m,configuration,[],{text:'Replace two GFCI receptacles.',answers:{service:'re10'},extraction:null} as any);
 assert.deepEqual(m.tasks[0].additions.map((a:any)=>a.code),['PB-26-01-05']);assert.match(m.tasks[0].researchDescription,/standard GFCI receptacles/);
});
test('a revised 18-inch patch cannot retain a 1-to-2-SF service as if its size still matched',()=>{
 const m=mapping('Repair one 18 by 18 inch (2.25 SF) hole in 5/8-inch Type X drywall, including backing, tape, compound and spot prime.',[add('PB-09-01-08',1,'One 2.25 SF drywall hole')]);
 normalizeConsumableMapping(m,configuration,[],{text:m.tasks[0].description,answers:{service:'re10'},extraction:null} as any);
 assert.ok(!m.tasks[0].additions.some((a:any)=>a.code==='PB-09-01-08'));
 assert.match(m.tasks[0].researchDescription,/2.25 SF each/);
 assert.match(m.notes.join(' '),/outside its explicit size band/);
 const valid=mapping('Repair one 12 by 12 inch (1 SF) drywall hole.',[add('PB-09-01-08',1,'One 1 SF patch')]);
 normalizeRepairServices(valid,configuration);assert.equal(valid.tasks[0].additions[0].code,'PB-09-01-08');
});

const finishConfig={...EMPTY_CONFIGURATION,planningCatalog:{version:'qa',source:'Owner book',authorizedBy:'QA',importedAt:now.toISOString(),rates:priceBookRates({service:'remodel',finish:'mid-range'})}} as any;
const finishScope=(text:string,answers:any={})=>({text,answers:{service:'remodel',...answers},extraction:null}) as any;
test('requested door and baseboard painting survive installed primed-product mappings once',()=>{
 const doors=mapping('Replace eight primed prehung interior doors.',[add('PB-08-14-01',8,'Eight replacement doors')]);
 const base=mapping('Replace 420 LF primed MDF baseboard.',[add('PB-06-20-01',420,'420 LF baseboard')]);base.tasks[0].id='base';doors.tasks.push(base.tasks[0]);
 const scope=finishScope('Selected interior finishes.',{fixtures:'Replace 8 interior doors with solid-core primed prehung doors. Include fitting, hardware, and painting the replacement doors. No exterior doors.',otherDetails:'Replace exactly 420 LF of baseboard with 3.5-inch primed MDF. Include removal, disposal, installation, caulk, nail-hole filling and two-coat paint. Retain all other trim.'});
 normalizeExplicitFinishOperations(doors,finishConfig,[],scope);normalizeExplicitFinishOperations(doors,finishConfig,[],scope);
 assert.deepEqual(doors.tasks.flatMap((t:any)=>t.additions).map((a:any)=>[a.code,a.quantity]),[['PB-08-14-01',8],['PB-09-91-05',8],['PB-06-20-01',420],['PB-09-91-04',420]]);
});
test('primed or paint-grade products and adjacent wall painting do not authorize painting them',()=>{
 for(const text of ['Install 8 primed prehung interior doors. Paint 4000 SF walls.','Install 420 LF paint-grade baseboard.','Install 420 LF baseboard; paint walls and ceilings.','Replace 8 interior doors. No painting.','Replace 8 interior doors including painting by owner.']){
  const m=mapping(text,[add('PB-08-14-01',8,'Eight doors'),add('PB-06-20-01',420,'420 LF')]);normalizeExplicitFinishOperations(m,finishConfig,[],finishScope(text));assert.equal(m.tasks[0].additions.length,2,text);
 }
});
test('existing finish allocation, excluded painting and supply-only scope do not get another finish charge',()=>{
 const text='Replace 8 interior doors including painting.';
 const m=mapping(text,[add('PB-08-14-01',8,'Eight doors'),add('PB-09-91-05',8,'Eight doors')]);normalizeExplicitFinishOperations(m,finishConfig,[],finishScope(text));assert.equal(m.tasks[0].additions.length,2);
 const excluded=mapping(text,[add('PB-08-14-01',8,'Eight doors')]);normalizeExplicitFinishOperations(excluded,finishConfig,[],finishScope(text,{exclusions:'Painting'}));assert.equal(excluded.tasks[0].additions.length,1);
 const supplied=mapping(text,[add('PB-08-14-01',8,'Eight doors')]);normalizeExplicitFinishOperations(supplied,finishConfig,[],{...finishScope(text),extraction:{instructions:{materialsOnly:true}}});assert.equal(supplied.tasks[0].additions.length,1);
});

test('floor and door demolition do not silently cover requested existing baseboard removal',()=>{
 const m=mapping('Replace 420 LF baseboard.',[add('PB-06-20-01',420,'420 LF')]);
 const demo=mapping('Remove flooring, doors and baseboard.',[add('PB-02-41-29',8,'8 doors')]);demo.tasks[0].id='demo';m.tasks.push(demo.tasks[0]);
 const scope=finishScope('Replace exactly 420 LF baseboard. Include removal, disposal and installation.');
 normalizeExplicitFinishOperations(m,finishConfig,[],scope);normalizeExplicitFinishOperations(m,finishConfig,[],scope);
 const removal=m.tasks.filter((t:any)=>t.id==='required-existing-baseboard-removal');assert.equal(removal.length,1);assert.match(removal[0].description,/420 LF/);assert.equal(removal[0].additions.length,0);assert.match(removal[0].researchDescription,/disclosed range/);
});
test('owner-demolished baseboard does not receive a removal task',()=>{
 const m=mapping('Install 420 LF new baseboard.',[add('PB-06-20-01',420,'420 LF')]);normalizeExplicitFinishOperations(m,finishConfig,[],finishScope('Install 420 LF new baseboard. Owner removed old baseboard; demolition is excluded.',{exclusions:'Demolition'}));assert.equal(m.tasks.length,1);
});
