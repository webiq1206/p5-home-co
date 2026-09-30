import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogResolution} from '../lib/p5/scopePricing.ts';
import {priceBookRates,specifiedShowerGlassRate} from '../lib/p5/priceBook.ts';
import {EMPTY_CONFIGURATION} from '../lib/p5/costBook.ts';
import type {ReviewedScope} from '../lib/p5/scope.ts';
const now=new Date('2026-09-30T12:00:00Z');
const config={...EMPTY_CONFIGURATION,planningCatalog:{version:'qa',source:'owner-book',importedAt:now.toISOString(),rates:priceBookRates({service:'bathroom',finish:'mid-range'})}};
const scope=(text:string,bathrooms?:string):ReviewedScope=>({text,answers:{service:'bathroom',finish:'mid-range',bathrooms},extraction:null,uploads:[],reviewedAt:now.toISOString(),corrections:[]});
const task=(id:string,description:string,code:string,floor='ground')=>({id,description,evidence:description,issues:[],existingLineIds:[],researchDescription:'',additions:[{code,quantity:1,quantityEvidence:description,building:'main',floor}]});
const mapping=(tasks:any[])=>({tasks,issues:[],notes:[],replacements:[],removeExclusions:[]});
test('one bathroom demolition assembly prices its included disposal once, retaining both requested tasks',()=>{
 const m=mapping([task('demo','Remove all existing bathroom finishes and fixtures.','PB-02-41-04'),task('disposal','Dispose of demolition debris offsite.','PB-02-41-04')]);
 const out=catalogResolution(m,config,[],now,scope('Remodel one 6 by 10 foot bathroom. Remove finishes and fixtures; include disposal.'));
 assert.equal(out.rules.length,1,JSON.stringify(out.issues));assert.deepEqual(m.tasks[1].existingLineIds,[out.rules[0].id]);assert.equal(out.issues.length,0);
 assert.match(out.assumptions.join(' '),/dump fees.*charged once/);
});
test('assembly coverage never merges two bathrooms or distinct locations',()=>{
 const tasks=[task('demo','Remove existing bathroom finishes.','PB-02-41-04'),task('disposal','Dispose of demolition debris offsite.','PB-02-41-04')];
 assert.equal(catalogResolution(mapping(tasks),config,[],now,scope('Remodel two bathrooms.','2')).rules.length,2);
 const separate=[task('demo','Remove existing bathroom finishes.','PB-02-41-04','first'),task('disposal','Dispose of demolition debris offsite.','PB-02-41-04','second')];
 assert.equal(catalogResolution(mapping(separate),config,[],now,scope('Remodel one bathroom.')).rules.length,2);
});
test('explicit framed shower door uses the framed book amount regardless of general mid-range tier',()=>{
 const m=mapping([task('door','Supply and install one framed shower door.','PB-08-83-01')]);
 const out=catalogResolution(m,config,[],now,scope('Remodel one bathroom.'));
 assert.equal(out.rules[0].unitCost,900);assert.match(out.rules[0].description,/Framed shower glass/);
 const rate=config.planningCatalog.rates.find(r=>r.code==='PB-08-83-01')!;
 assert.equal(specifiedShowerGlassRate(rate,'One semi-frameless enclosure','bathroom').amount,1400);
 assert.equal(specifiedShowerGlassRate(rate,'One frameless enclosure','bathroom').amount,2400);
 assert.equal(specifiedShowerGlassRate(rate,'One custom frameless enclosure','bathroom').amount,4000);
 assert.equal(specifiedShowerGlassRate(rate,'Choose framed or frameless','bathroom'),rate);
 assert.equal(specifiedShowerGlassRate({...rate,source:'Owner custom quote'},'One framed door','bathroom').amount,1400);
});

test('supplier bag labels retain measured weight, price and quantity through conversion',async()=>{
 const {marketResolution}=await import('../lib/p5/scopePricing.ts');
 const urls=['https://supplier-one.test/thinset','https://supplier-two.test/thinset'];
 const requested=task('thinset','Supply thinset for the stated tile installation.','unused');requested.additions=[];requested.researchDescription=requested.description;
 const rate={taskId:'thinset',description:'Tile thinset mortar',unit:'bag (50 lb)',quantity:2,quantityEvidence:'ALLOWANCE: two 50 lb bags for stated tile work; verify coverage.',quantityRange:{low:2,high:4},basis:'material-purchase',includes:'Thinset mortar only',excludes:'Tile and labor',landedCost:null,sources:urls.map((url,i)=>({url,unit:'bag (50 lb)',low:i?18:15,high:i?18:15,costBasis:'material-purchase',sourceType:'supplier-price',dateBasis:'retrieved',publishedAt:'',region:'Boise, Idaho',excerpt:`Synthetic thinset mortar 50 lb bag $${i?18:15}.00.`}))};
 const result=marketResolution({rates:[rate],issues:[],notes:[]},urls,[requested],now,0,'Boise');
 assert.equal(result.rules[0].unit,'LB');assert.equal(result.rules[0].quantity.fixed,100);assert.equal(result.rules[0].unitCost,.33);
 assert.deepEqual(result.rules[0].quantityRange,{low:100,high:200});
 const wrong=structuredClone(rate);wrong.sources[1].excerpt='Synthetic thinset mortar 25 lb bag $18.00.';
 assert.throws(()=>marketResolution({rates:[wrong],issues:[]},urls,[requested],now,0,'Boise'),/Package size does not match/);
});
test('each tube means one container, never its ounce volume or an unknown material unit',async()=>{
 const {marketResolution}=await import('../lib/p5/scopePricing.ts');
 const urls=['https://supplier-one.test/caulk','https://supplier-two.test/caulk'];
 const requested=task('caulk','Supply silicone caulk.','unused');requested.additions=[];requested.researchDescription=requested.description;
 const rate={taskId:'caulk',description:'Clear silicone caulk in a 10.1 oz tube',unit:'each (tube)',quantity:2,quantityEvidence:'ALLOWANCE: two tubes for perimeter sealing; verify actual usage.',quantityRange:{low:1,high:2},basis:'material-purchase',includes:'Caulk only',excludes:'Labor',landedCost:null,sources:urls.map((url,i)=>({url,unit:'each (tube)',low:i?10:9,high:i?10:9,costBasis:'material-purchase',sourceType:'supplier-price',dateBasis:'retrieved',publishedAt:'',region:'Boise, Idaho',excerpt:`Synthetic silicone caulk 10.1 oz tube $${i?10:9}.00 each.`}))};
 const result=marketResolution({rates:[rate],issues:[]},urls,[requested],now,0,'Boise');
 assert.equal(result.rules[0].quantity.fixed,2);assert.equal(result.rules[0].unitCost,9.5);assert.equal(result.rules[0].unit,'tube');
 assert.match(marketResolution({rates:[{...rate,unit:'each (mystery quantity)'}],issues:[]},urls,[requested],now,0,'Boise').issues.join(' '),/unsupported pricing unit/);
});

test('retained window trim repair cannot purchase a full replacement trim package',async()=>{
 const {incompatibleRepairAssembly}=await import('../lib/p5/scopePricing.ts');
 const description='Repair existing interior trim at two replacement windows.';
 assert.equal(incompatibleRepairAssembly(description,'Window trim package (casing + stool), per window'),true);
 assert.equal(incompatibleRepairAssembly('Replace trim at two windows.','Window trim package (casing + stool), per window'),false);
 assert.equal(incompatibleRepairAssembly(description,'Finish carpenter labor'),false);
 assert.equal(incompatibleRepairAssembly('Replace two windows and repair interior trim.','Window trim package (casing + stool), per window'),true);
 const out=catalogResolution(mapping([task('trim',description,'PB-06-20-22')]),config,[],now,scope('Replace only two windows; repair retained interior trim.'));
 assert.equal(out.rules.length,0);assert.match(out.issues.join(' '),/retained trim repair cannot/);
});

test('direct-cost audit prose cannot falsely say the customer price excludes overhead',async()=>{
 const {customerSafeNotes}=await import('../lib/p5/pricing.ts');
 assert.deepEqual(customerSafeNotes(['No additional labor, material, tax, or overhead included.','Owner supplies both passage handles.']),['Owner supplies both passage handles.']);
 assert.deepEqual(customerSafeNotes(['Repair the overhead garage door; normal hardware included.']),['Repair the overhead garage door; normal hardware included.']);
});
