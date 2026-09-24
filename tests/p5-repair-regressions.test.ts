import test from 'node:test';
import assert from 'node:assert/strict';
import {answerEntries,compatibleAnswers,configurationIdentity,documentScopeFingerprint} from '../lib/p5/pricingCache.ts';
import {DEFAULT_FINANCE} from '../lib/p5/pricing.ts';
import {validateExtraction,type ReviewedScope} from '../lib/p5/scope.ts';
import type {CostRule,EstimatorConfiguration} from '../lib/p5/costBook.ts';
import {learnableLines,learnedCostRules} from '../lib/p5/learnedBook.ts';

const scope:ReviewedScope={text:'Repair clothesline posts',answers:{service:'handyman'},uploads:[],extraction:null,corrections:[],reviewedAt:'2026-09-24T00:00:00Z'};
const config:EstimatorConfiguration={finance:DEFAULT_FINANCE,costBooks:[]};
test('new or removed customer decisions cannot reuse a prior price',()=>{
  for(const [field,value] of Object.entries({finish:'luxury',exclusions:'No painting',ownerSupplied:'All posts',otherDetails:'Add a third post',estimatingInstructions:'Only price installation'})){
    const changed={...scope,answers:{...scope.answers,[field]:value}};
    assert.equal(compatibleAnswers(answerEntries(scope),answerEntries(changed)),false,field);
    assert.equal(compatibleAnswers(answerEntries(changed),answerEntries(scope)),false,field+' removed');
  }
  assert.equal(compatibleAnswers(answerEntries(scope),answerEntries(scope)),true);
});
test('corrections participate in the broader document lookup too',()=>{
  const changed={...scope,corrections:[{field:'otherDetails' as const,previous:'two',value:'three'}]};
  assert.notEqual(documentScopeFingerprint(scope,config),documentScopeFingerprint(changed,config));
});
test('changing a fixed rule without changing its count invalidates pricing reuse',()=>{
  const rule={id:'fixed',unitCost:100,quantity:{fixed:1,factor:1}} as CostRule;
  const configured={...config,costBooks:[{service:'handyman',rules:[rule],coverage:[],assumptions:[],exclusions:[],verifiedScope:'post',reviewedAt:'2026-09-24'}]} as EstimatorConfiguration;
  assert.notEqual(configurationIdentity(configured),configurationIdentity({...configured,costBooks:[{...configured.costBooks[0],rules:[{...rule,unitCost:200}]}]}));
});
test('dense evidence retains facts, conflicts and the end of the summary',()=>{
  const facts=Array.from({length:180},(_,i)=>({field:'otherDetails',value:`Post detail ${i}`,confidence:1,source:'drawing.pdf',evidence:`Item ${i}`,basis:'stated'}));
  const conflicts=Array.from({length:60},(_,i)=>({field:'otherDetails',values:[`first ${i}`,`second ${i}`],explanation:`Resolve detail ${i}`}));
  const summary='Detailed source '.repeat(700)+'FINAL REQUIREMENT';
  const result=validateExtraction({summary,facts,conflicts,missingInformation:[],reviewNotes:[]});
  assert.equal(result.facts.length,180);assert.equal(result.conflicts.length,60);assert.ok(result.summary.endsWith('FINAL REQUIREMENT'));
});

const now=new Date('2026-09-24T00:00:00Z');
const context={location:'Boise, ID',finish:'mid-range'};
const allowance:CostRule={id:'planning-1',description:'Replace clothesline posts',unit:'EA',quantity:{fixed:8,factor:1},unitCost:850,category:'subcontractors',priceBasis:'direct-cost',estimatingBasis:'regional-planning-average',
  unitRateContext:{currency:'USD',basis:'subcontractor-installed',includes:'Post and installation',excludes:'Concrete demolition',assumptions:['Standard soil']},
  evidence:{basis:'regional-planning-average',reference:'Provisional planning allowance',verifiedAt:'2026-09-24',validUntil:'2026-10-20',provenance:{status:'estimated',location:'Boise, ID',retrievedAt:now.toISOString(),assumptions:['Standard soil'],sources:[]}}};
test('learned costs preserve provisional evidence and scope of reuse',()=>{
  const lines=learnableLines([allowance],'handyman','source-project',[],now,context);
  assert.equal(lines.length,1);assert.equal(lines[0].status,'provisional');
  const [reused]=learnedCostRules(lines,'handyman',context,now);
  assert.equal(reused.estimatingBasis,'regional-planning-average');assert.equal(reused.evidence.provenance?.location,'Boise, ID');
  assert.equal(reused.unitRateContext?.excludes,'Concrete demolition');assert.equal(reused.quantity.fixed,1,'old project quantity cannot travel');
  assert.equal(learnedCostRules(lines,'handyman',{...context,location:'Portland, OR'},now).length,0);
  assert.equal(learnedCostRules(lines,'handyman',{...context,finish:'luxury'},now).length,0);
  assert.equal(learnedCostRules(lines,'re10',context,now).length,0);
  assert.equal(learnedCostRules(lines,'handyman',context,new Date('2026-11-01')).length,0);
  const another=learnableLines([{...allowance,evidence:{...allowance.evidence,provenance:{...allowance.evidence.provenance!,location:'Portland, OR'}}}],'handyman','another-project',lines,now,{...context,location:'Portland, OR'});
  assert.equal(another.length,1);assert.notEqual(another[0].code,lines[0].code);
});
test('old learned records remain reviewable but cannot become approved rates',()=>{
  const [line]=learnableLines([allowance],'handyman','source-project',[],now,context);
  const legacy={...line,version:undefined,rule:undefined};
  assert.equal(learnedCostRules([legacy],'handyman',context,now).length,0);
});


test('large handoffs preserve full text, answers and required original files',async()=>{
  const {cleanContinuation}=await import('../lib/p5/handoff.ts');
  const text='Room instructions '.repeat(12000)+'FINAL SCOPE',answer='Selection '.repeat(3000)+'FINAL DECISION';
  const transfer=cleanContinuation({text,answers:{otherDetails:answer},requiredFiles:[{name:'plans.pdf',size:1234}]});
  assert.equal(transfer?.text,text);assert.equal(transfer?.answers.otherDetails,answer);
  assert.deepEqual(transfer?.requiredFiles,[{name:'plans.pdf',size:1234}]);
  assert.equal(cleanContinuation({text:'x'.repeat(8*1024*1024+1),answers:{}}),null,'oversize must be refused, never shortened');
  assert.equal(cleanContinuation({text:'Review',answers:{},requiredFiles:[{name:'plans.pdf',size:0}]}),null);
});
test('assistant continuation includes unsent customer notes without treating old bot prices as facts',async()=>{
  const {assistantScope}=await import('../lib/p5/assistantContinuation.ts');
  assert.equal(assistantScope([{role:'user',content:'Replace the back door'},{role:'assistant',content:'Old estimate $1234'},{role:'user',content:'I supply the door'}],'Include new trim'),'Replace the back door\n\nI supply the door\n\nInclude new trim');
  const {assistantReplyWithoutPrice}=await import('../lib/p5/legacyContinuation.ts');
  for(const price of ['$1,234','USD 1234','1234 dollars'])assert.match(assistantReplyWithoutPrice('It will cost '+price),/Continue project/);
});
test('analysis time remaining includes downstream pricing and checking',async()=>{
  const {remainingRange}=await import('../lib/p5/processingStatus.ts');
  const materials={text:true,photos:0,documents:1,specifications:0};
  const pricing=remainingRange(null,materials,'pricing')!;
  const analysis=remainingRange({phase:'cross-referencing',message:'Review',updatedAt:now.toISOString()},materials,'analysis')!;
  assert.ok(analysis.low>pricing.low);assert.ok(analysis.high>pricing.high);
});
test('fresh evidence can replace an expired or legacy learned record',()=>{
  const [line]=learnableLines([allowance],'handyman','old',[],now,context);
  const later=new Date('2026-11-01');
  const fresh={...allowance,evidence:{...allowance.evidence,verifiedAt:'2026-11-01',validUntil:'2026-12-01',provenance:{...allowance.evidence.provenance!,retrievedAt:later.toISOString()}}};
  const replacement=learnableLines([fresh],'handyman','new',[line],later,context);
  assert.equal(replacement.length,1);assert.equal(replacement[0].code,line.code,'refresh one rate instead of duplicating it');
  assert.equal(learnableLines([allowance],'handyman','new',[{...line,version:undefined,rule:undefined}],now,context).length,1);
  assert.equal(learnableLines([allowance],'handyman','new',[line],now,context).length,0,'a current compatible rate is never duplicated');
});

test('a reader repeating a customer answer does not erase it from pricing identity',()=>{
  const changed={...scope,answers:{...scope.answers,otherDetails:'Add a third post'},extraction:{summary:'Review',facts:[{field:'otherDetails' as const,value:'Add a third post',confidence:1,source:'Customer clarification',evidence:'Add a third post'}],conflicts:[],missingInformation:[],reviewNotes:[]}};
  assert.equal(compatibleAnswers(answerEntries(scope),answerEntries(changed)),false);
});
