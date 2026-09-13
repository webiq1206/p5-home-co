import test from 'node:test';
import assert from 'node:assert/strict';
import {retainedScopeInventory} from '../lib/p5/scopeInventory.ts';
const item={id:'wall-1',description:'Frame addition walls',building:'Main',floor:'First',quantity:null,unit:'LF',basis:'uncertain',evidence:'Walls shown, dimensions not stated',sources:[{source:'plans.pdf',page:1,sheet:'A1',revision:'1'}],issues:['Wall length needs confirmation'],supersedes:[]};
const scope=()=>({text:'',answers:{},extraction:{takeoffs:[item],reviewNotes:[],documentCoverage:{complete:true}}} as any);
test('retained inventory preserves uncertainty and every work item',()=>{
 const result=retainedScopeInventory(scope());assert.equal(result?.tasks.length,1);assert.match(result!.tasks[0].evidence,/not stated/);assert.equal(result!.issues.length,1);
});
test('incomplete pages, duplicate identities and typed additions require a full scope inventory',()=>{
 const incomplete=scope();incomplete.extraction.documentCoverage.complete=false;assert.equal(retainedScopeInventory(incomplete),null);
 const duplicate=scope();duplicate.extraction.takeoffs.push({...item});assert.equal(retainedScopeInventory(duplicate),null);
 const typed=scope();typed.text='Add a second detached building';assert.equal(retainedScopeInventory(typed),null);
 const instructions=scope();instructions.answers.estimatingInstructions='Price trim only';assert.equal(retainedScopeInventory(instructions),null);
});
test('alternates, aggregates and revision replacements retain the reconciliation step',()=>{
 for(const extra of [{alternativeGroup:'tops'},{duplicateOf:'original'},{aggregateOf:['one','two']},{supersedes:['plans:A1:0']}]){const input=scope();input.extraction.takeoffs=[{...item,...extra}];assert.equal(retainedScopeInventory(input),null);}
});
