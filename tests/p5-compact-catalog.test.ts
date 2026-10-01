import test from 'node:test';
import assert from 'node:assert/strict';
import {compactCatalogInput} from '../lib/p5/compactCatalog.ts';

test('large catalog transport preserves every rate and source in initial and corrective input',()=>{
 const catalog=Array.from({length:1484},(_,i)=>({code:`QA-${i}`,description:`Component ${i}: labor and materials with exclusions`,unit:i%2?'EA':'SF',amount:i+1,type:'Subcontractor',basis:'owner-average-cost',source:'Approved regional book. '+ 'Source qualification. '.repeat(20)}));
 const input={catalog,original:{text:'Preserve entire source',catalog},formatRepair:{priorResponse:{tasks:[{id:'one',evidence:'retain'}]}}};
 const result=compactCatalogInput(input) as any;
 const restore=(encoded:any)=>encoded.rows.map((row:unknown[])=>({...encoded.shared,...Object.fromEntries(encoded.columns.map((key:string,i:number)=>[key,row[i]]))}));
 assert.deepEqual(restore(result.catalog),catalog);
 assert.deepEqual(restore(result.original.catalog),catalog);
 assert.deepEqual(result.formatRepair,input.formatRepair);
 assert.equal(result.original.text,input.original.text);
 assert.ok(JSON.stringify(result).length<JSON.stringify(input).length/2);
 assert.equal(catalog.length,1484);
});
test('small or heterogeneous catalogs remain unchanged',()=>{
 const rows=Array.from({length:30},(_,i)=>i?{code:String(i),amount:1}:{code:'0',amount:2,qualification:'extra'});
 assert.deepEqual(compactCatalogInput({catalog:rows}),{catalog:rows});
 assert.deepEqual(compactCatalogInput({catalog:rows.slice(0,2)}),{catalog:rows.slice(0,2)});
});
