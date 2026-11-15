import assert from 'node:assert/strict';
import test from 'node:test';
import {isExplicitSaveAttempt,saveIntentFor} from '../scripts/lib/browserSaveFaults.mjs';

test('background and already-in-flight saves cannot consume a manual-action fault',()=>{
 const intent={sequence:2,at:1000,name:'Send message'};
 assert.equal(isExplicitSaveAttempt(999,intent,'Send message'),false);
 assert.equal(isExplicitSaveAttempt(1000,null,'Send message'),false);
 assert.equal(isExplicitSaveAttempt(1001,{...intent,name:'Talk instead'},'Send message'),false);
 assert.equal(isExplicitSaveAttempt(1001,intent,'Send message'),true);
});

test('routed save identity uses the immutable fetch snapshot even before timing is available',()=>{
 const snapshot={startedAt:1001,intent:{sequence:2,at:1000,name:'Send answer'}};
 const request={headers:()=>({'x-p5-test-save-action':JSON.stringify(snapshot)}),timing:()=>({startTime:0})};
 assert.deepEqual(saveIntentFor(request),snapshot);
 assert.equal(isExplicitSaveAttempt(saveIntentFor(request).startedAt,saveIntentFor(request).intent,'Send answer',1),true);
 assert.equal(saveIntentFor({headers:()=>({})}),null);
 assert.equal(saveIntentFor({headers:()=>({'x-p5-test-save-action':'invalid'})}),null);
});

test('a later answer fault requires the new explicit answer action',()=>{
 const old={sequence:3,at:1000,name:'Send answer'};
 assert.equal(isExplicitSaveAttempt(1500,old,'Send answer',3),false);
 assert.equal(isExplicitSaveAttempt(1500,{...old,sequence:4,at:1501},'Send answer',3),false);
 assert.equal(isExplicitSaveAttempt(1502,{...old,sequence:4,at:1501},'Send answer',3),true);
 for(const value of [NaN,Infinity,-Infinity])assert.equal(isExplicitSaveAttempt(value,old,'Send answer'),false);
});
