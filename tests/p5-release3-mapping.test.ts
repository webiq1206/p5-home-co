import test from 'node:test';import assert from 'node:assert/strict';
import {catalogResolution,normalizeConsumableMapping,normalizeRepairServices} from '../lib/p5/scopePricing.ts';
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
