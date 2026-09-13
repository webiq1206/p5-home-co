import test from 'node:test';
import assert from 'node:assert/strict';
import {answersForEditedScope,answersForReplacedScope,analyzedScopeMatches,displayScopeText,normalizeScopeText,refreshAnalyzedScope,replaceAnalyzedScope,scopeFingerprint} from '../lib/p5/scopeReplacement.ts';
import {archiveBrowserDraft,listBrowserDraftRecoveries,replaceBrowserDraft,restoreBrowserDraft,type BrowserDraft} from '../lib/p5/browserDraft.ts';

const extraction=()=>({
  summary:'Old scope',
  facts:[
    {field:'sqft' as const,value:'800',confidence:.99,source:'old scope',evidence:'800 square feet'},
    {field:'taskList' as const,value:'Replace the flooring',confidence:.99,source:'old scope',evidence:'Replace the flooring'},
  ],
  conflicts:[{field:'sqft' as const,values:['800','900'],explanation:'Old conflict'}],
  missingInformation:[],
  reviewNotes:[],
});

test('scope text normalization covers the combined legacy instruction display',()=>{
  assert.equal(displayScopeText('Remodel the kitchen.','Keep the cabinets.'),'Remodel the kitchen.\n\nKeep the cabinets.');
  assert.equal(displayScopeText('Remodel the kitchen. '),'Remodel the kitchen. ','Typing a separator must retain the trailing space');
  assert.equal(normalizeScopeText('same\r\ntext\n'),'same\ntext');
  assert.equal(scopeFingerprint('same\r\ntext'),scopeFingerprint(' same\ntext '));
});

test('replacing analyzed text removes old derived facts and wizard state but retains uploads',()=>{
  const draft={
    text:'Old scope',
    answers:{service:'kitchen',sqft:'800',taskList:'Replace the flooring',location:'Boise',estimatingInstructions:'Old answer'},
    extraction:extraction(),
    conflicts:extraction().conflicts,
    wizard:{skipped:['sqft' as const],resolutions:{sqft:'800'},instructionAnswers:[{id:'old',question:'Old?',answer:'Yes'}]},
    analyzedText:'Old scope',
    analyzedAnswers:JSON.stringify([['taskList','Replace the flooring']]),
    pricedFields:['sqft' as const],
    uploads:[{id:'file',name:'plans.pdf',type:'application/pdf',size:1,sha256:'sha',status:'stored' as const}],
    step:2,
  };
  const replaced=replaceAnalyzedScope(draft,'New scope');
  assert.equal(replaced.text,'New scope');
  assert.deepEqual(replaced.answers,{});
  assert.equal(replaced.extraction,null);
  assert.deepEqual(replaced.conflicts,[]);
  assert.deepEqual(replaced.wizard,{skipped:[],resolutions:{},instructionAnswers:[]});
  assert.deepEqual(replaced.uploads,draft.uploads);
  assert.equal(replaced.analyzedText,undefined);
  assert.equal(replaced.analyzedAnswers,undefined);
  assert.deepEqual(replaced.pricedFields,[]);
  assert.equal(replaced.step,0);
  assert.equal((replaced as {dirty?:boolean}).dirty,true);
});

test('server-side source replacement does not retain old visitor answers',()=>{
  const retained=answersForReplacedScope({service:'kitchen',sqft:'900',taskList:'Keep the flooring',estimatingInstructions:'legacy'},extraction(),{});
  assert.deepEqual(retained,{});
});

test('analyzed match uses the fingerprint and does not treat contact saves as replacements',()=>{
  const state={text:'Scope',analyzedText:'Scope',analyzedFingerprint:scopeFingerprint('Scope')};
  assert.equal(analyzedScopeMatches(state,' Scope\n'),true);
  assert.equal(analyzedScopeMatches(state,'New scope'),false);
});

function browserDraft():BrowserDraft{
  return {
    id:'11111111-1111-4111-8111-111111111111',
    key:'a'.repeat(64),
    revision:4,
    text:'Old scope',
    answers:{service:'kitchen',taskList:'Old work'},
    extraction:null,
    contact:{name:'Visitor',email:'visitor@example.com',phone:''},
    step:2,
    updatedAt:1,
    uploads:[{id:'file',name:'plans.pdf',type:'application/pdf',size:1,sha256:'sha',status:'stored'}],
  };
}

test('explicit new project archives the browser draft and keeps it restorable',()=>{
  const previous=(globalThis as any).localStorage;
  const values=new Map<string,string>();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
    getItem:(key:string)=>values.get(key)||null,
    setItem:(key:string,value:string)=>{values.set(key,value);},
    removeItem:(key:string)=>{values.delete(key);},
  }});
  try{
    const original=browserDraft();
    const archived=archiveBrowserDraft(original);
    assert.equal(archived?.key,original.id);
    assert.equal(listBrowserDraftRecoveries()[0]?.draft.id,original.id);
    assert.deepEqual(restoreBrowserDraft(original.id),original);
    const replacement=replaceBrowserDraft(original,'bathroom');
    assert.notEqual(replacement.draft.id,original.id);
    assert.deepEqual(replacement.draft.answers,{});
    assert.deepEqual(replacement.draft.uploads,[]);
    assert.equal(replacement.draft.sourceDetached,true);
    assert.equal(restoreBrowserDraft(original.id)?.answers.service,'kitchen');
  }finally{
    if(previous===undefined)delete (globalThis as any).localStorage;
    else Object.defineProperty(globalThis,'localStorage',{configurable:true,value:previous});
  }
});

test('ordinary additive edits retain independent answers but remove stale analyzed facts',()=>{
  const previous={...extraction(),facts:extraction().facts.map(f=>f.field==='sqft'?{...f,value:'80',evidence:'80 square feet'}:f)};
  const current={service:'bathroom' as const,sqft:'80',taskList:'Replace the flooring',location:'Boise',estimatingInstructions:'Exclude painting; include appliances'};
  const answers=answersForEditedScope(current,previous,{},JSON.stringify([['estimatingInstructions',current.estimatingInstructions]]));
  assert.deepEqual(answers,{service:'bathroom',location:'Boise'});
  const refreshed=refreshAnalyzedScope({
    text:'Old bathroom scope',
    answers:current,
    extraction:previous,
    conflicts:previous.conflicts,
    wizard:{skipped:[],resolutions:{}},
    analyzedAnswers:JSON.stringify([['estimatingInstructions',current.estimatingInstructions]]),
    contact:{name:'',email:'',phone:''},
    step:2,
  },'Add painting to the living room.');
  assert.deepEqual(refreshed.answers,{service:'bathroom',location:'Boise'});
  assert.equal(refreshed.extraction,null);
  assert.equal(refreshed.step,0);
});

test('ordinary edits retain typed clarification choices and quantities',()=>{
  const clarification={version:'p5-retained-clarification-v1',clarifications:[{applied:{laborHours:14},selected:{option:2,key:'quartz',label:'quartz',laborHours:14}}]};
  const previous={
    ...extraction(),
    facts:[
      {field:'materials' as const,value:'quartz bench top',confidence:1,source:'Typed clarification',evidence:'Selected quartz'},
      {field:'laborHours' as const,value:'14',confidence:1,source:'Typed clarification',evidence:'Typed clarification: 14 labor hours.'},
    ],
    clarificationProvenance:clarification,
    sourceHistory:clarification,
  } as any;
  const instructions='Question: Which bench top should we use?\nAnswer: Option 2: quartz (+14h)';
  const answers={
    materials:'quartz bench top',
    laborHours:'14',
    estimatingInstructions:instructions,
    taskList:'quartz bench top; 14 labor hours',
  };
  assert.deepEqual(
    answersForEditedScope(answers,previous,{},JSON.stringify(Object.entries(answers))),
    answers,
  );
});

test('explicit replacement fails closed when recovery cannot be written',()=>{
  const previous=(globalThis as any).localStorage;
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
    getItem:()=>null,
    setItem:()=>{throw new Error('quota');},
  }});
  try{assert.throws(()=>replaceBrowserDraft(browserDraft()),/could not be archived/);}
  finally{
    if(previous===undefined)delete (globalThis as any).localStorage;
    else Object.defineProperty(globalThis,'localStorage',{configurable:true,value:previous});
  }
});