import test from 'node:test';
import assert from 'node:assert/strict';
import {tradeForScopeTask} from '../lib/p5/trades.ts';
test('window task summary follows its principal priced work while disposal remains separate',()=>{
 const task={id:'window',description:'Replace one window, including disposal and weatherproofing.'};
 const lines=[{id:'remove',category:'Cleanup & Disposal',low:196,high:213},{id:'window',category:'Windows & Doors',low:1447,high:1575}];
 const rules=lines.map(line=>({id:line.id,scopeTaskId:task.id}));
 assert.equal(tradeForScopeTask(task,lines,rules),'Windows & Doors');
 assert.deepEqual(lines.map(l=>l.category),['Cleanup & Disposal','Windows & Doors']);
 assert.equal(tradeForScopeTask({...task,id:'disposal',existingLineIds:['remove']},lines,rules),'Cleanup & Disposal');
});
test('unrelated high-value prices cannot change a trim-repair summary or an unpriced task',()=>{
 const task={id:'trim',description:'Repair and resecure existing interior window trim.'};
 const lines=[{id:'trim-line',category:'Trim & Finish Carpentry',low:57,high:62},{id:'roof',category:'Roofing',low:9000,high:10000}];
 assert.equal(tradeForScopeTask(task,lines,[{id:'trim-line',scopeTaskId:'trim'}]),'Trim & Finish Carpentry');
 assert.equal(tradeForScopeTask({id:'electric',description:'Replace two GFCI receptacles.'},lines,[]),'Electrical');
});
