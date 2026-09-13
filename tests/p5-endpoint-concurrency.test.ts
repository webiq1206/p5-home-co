import test from 'node:test';
import assert from 'node:assert/strict';
import {guardScopeRequestRevision,guardUploadedSourceSnapshot} from '../lib/p5/scopeEndpoint.ts';
import {scopeFingerprint,sourceSnapshot} from '../lib/p5/scopeReplacement.ts';
import {clarificationRetryMatches} from '../lib/p5/draftEndpoint.ts';

test('scope request revision and source identity are checked before mutation',()=>{
  assert.throws(()=>guardScopeRequestRevision(7,6,'same scope','same scope'),/changed in another tab/);
  assert.throws(()=>guardScopeRequestRevision(7,undefined,'old scope','new scope'),/changed in another tab/);
  assert.deepEqual(guardScopeRequestRevision(7,undefined,'same\r\nscope',' same\nscope '),{changed:false,supplied:false});
  assert.deepEqual(guardScopeRequestRevision(7,'7','same scope','new scope'),{changed:true,supplied:true});
});

test('an upload reread cannot launder a newer source revision into an old analysis',()=>{
  const old={text:'Old scope',answers:{service:'kitchen'},contact:{name:'Visitor',email:'visitor@example.com',phone:''},wizard:{skipped:[],resolutions:{}}};
  const newer={...old,text:'New scope',answers:{service:'bathroom'}};
  assert.throws(()=>guardUploadedSourceSnapshot(4,5,sourceSnapshot(old),sourceSnapshot(newer)),/changed while its files were uploading/);
  assert.throws(()=>guardUploadedSourceSnapshot(4,4,sourceSnapshot(old),sourceSnapshot(newer)),/changed while its files were uploading/);
  assert.doesNotThrow(()=>guardUploadedSourceSnapshot(4,4,sourceSnapshot(old),sourceSnapshot(old)));
});

test('source fingerprints are stable for formatting but reject stale scope text',()=>{
  assert.equal(scopeFingerprint('Old bathroom scope'),scopeFingerprint('  Old bathroom scope\n'));
  assert.notEqual(scopeFingerprint('Old bathroom scope'),scopeFingerprint('Painting included; appliances excluded.'));
});

const clarification={id:'q1',question:'Include installation?',answer:'Yes'};
const existing={
  status:'draft',
  text:'Kitchen scope',
  answers:{service:'kitchen'},
  contact:{name:'Visitor',email:'visitor@example.com',phone:''},
  wizard:{
    skipped:[],
    resolutions:{estimatingInstructions:'Question: Include installation?\nAnswer: Yes'},
    sourceVersion:'source-1',
    instructionAnswers:[clarification],
  },
};

test('identical lost clarification retry is recognized despite stale revision',()=>{
  assert.equal(clarificationRetryMatches(existing,{
    text:'Kitchen scope',
    answers:{service:'kitchen'},
    contact:existing.contact,
    revision:3,
    wizard:{skipped:[],resolutions:{},sourceVersion:'source-1',instructionAnswers:[]},
    clarification,
  },'Kitchen scope',{service:'kitchen'},existing.contact),true);
});

test('clarification retry with substantive text or answer changes is rejected',()=>{
  const base={
    text:'Kitchen scope',
    answers:{service:'kitchen'},
    contact:existing.contact,
    revision:3,
    wizard:{skipped:[],resolutions:{},sourceVersion:'source-1',instructionAnswers:[]},
    clarification,
  };
  assert.equal(clarificationRetryMatches(existing,{...base,text:'Different scope'},'Different scope',{service:'kitchen'},existing.contact),false);
  assert.equal(clarificationRetryMatches(existing,{...base,answers:{service:'bathroom'}},'Kitchen scope',{service:'bathroom'},existing.contact),false);
  assert.equal(clarificationRetryMatches(existing,{...base,contact:{...existing.contact,name:'Other'}},'Kitchen scope',{service:'kitchen'},{...existing.contact,name:'Other'}),false);
});