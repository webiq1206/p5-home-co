import test from 'node:test';
import assert from 'node:assert/strict';
import {missingResearchSources,pricingFailureDetails} from '../lib/p5/pricingDiagnostics.ts';
import {readTakeoffs,pageCovered,combineCoverage,type PageRecord} from '../lib/p5/documentLedger.ts';
import {scopeQuestions} from '../lib/p5/adaptive.ts';
import {savedPricingTimeoutReason,retryablePricingProviderError} from '../lib/p5/pricingProgress.ts';

test('search diagnostics distinguish a returned tool error without leaking report text',()=>{
 const failure=missingResearchSources([{type:'web_search_tool_result',content:{type:'web_search_tool_result_error',error_code:'too_many_requests'}},{type:'text',text:'Private project details'}],'end_turn','req_saved');
 const details=pricingFailureDetails(new Error('wrapper',{cause:failure}));
 assert.equal(details[1].code,'pricing-search-unavailable');assert.equal(details[1].status,200);assert.equal(details[1].requestId,'req_saved');
 assert.deepEqual(details[1].research?.toolErrors,['too_many_requests']);assert.equal(JSON.stringify(details).includes('Private project'),false);
 assert.deepEqual(missingResearchSources([{type:'text',text:'No tools called'}],'end_turn').researchDiagnostics.blockTypes,['text']);
});
test('a saved empty-source failure retains its category instead of masquerading as a deadline',()=>{
 assert.equal(savedPricingTimeoutReason({timeouts:1,researchFailedAt:1000},true,false,1001),'pricing-search-unavailable');
 assert.equal(savedPricingTimeoutReason({timeouts:1},true,false),undefined);
});
test('location measurements survive as observations but cannot become priced repair lengths',()=>{
 const raw={id:'sewer',component:'sewer repair',description:'Repair damaged pipe',building:'house',floor:'',quantity:32,unit:'feet from entry',basis:'stated',evidence:'Damage at 32 feet from entry',sources:[{source:'inspection.pdf',page:1,sheet:'',revision:''}],issues:[],supersedes:[]};
 const [item]=readTakeoffs([raw]);assert.equal(item.quantity,null);assert.equal(item.basis,'uncertain');assert.deepEqual(item.observation,{quantity:32,unit:'feet from entry'});assert.equal(raw.quantity,32);
 const [actual]=readTakeoffs([{...raw,unit:'LF',measurementRole:'work-quantity',evidence:'Replace 32 LF of damaged pipe'}]);assert.equal(actual.quantity,32);
 const [extent]=readTakeoffs([{...raw,quantity:40,unit:'LF',measurementRole:'inspection-extent'}]);assert.equal(extent.quantity,null);
});
test('typed coverage distinguishes blank margins from unreadable content and preserves a failed detail',()=>{
 const good:PageRecord={source:'plans.pdf',page:6,sheet:'A301',revision:'',status:'partial',coverageState:'readable',notes:['Blank tiles (unreadable regions) inspected: opaque white; no content hidden.']};
 assert.equal(pageCovered(good),true);
 const bad:PageRecord={...good,coverageState:'illegible',notes:['Beam schedule cannot be read.']};
 assert.equal(combineCoverage([{pages:[good],expectedPages:1,complete:true},{pages:[bad],expectedPages:1,complete:false}]).complete,false);
 assert.equal(pageCovered({...good,coverageState:'outside-view'}),false);
 assert.equal(pageCovered({...good,coverageState:undefined}),false,'legacy failures are not silently upgraded');
});
test('answered question rationale cannot ask the owner to estimate production hours',()=>{
 const answers={service:'re10',taskList:'Mitigate radon',estimatingInstructions:'Question: Which radon system? Radon system scope affects labor hours.\nAnswer: Specialist to determine. Include a preliminary allowance.'};
 assert.equal(scopeQuestions(answers,null,[],[],['laborHours']).some(q=>q.field==='laborHours'),false);
 assert.equal(scopeQuestions({...answers,estimatingInstructions:'Hourly time and materials work'},null,[],[],['laborHours']).some(q=>q.field==='laborHours'),true);
});

import {mergeInstructions,emptyInstructions} from '../lib/p5/instructions.ts';
import {instructionPrompts} from '../lib/p5/clarifications.ts';
import {answeredScopeQuestion} from '../lib/p5/clarifications.ts';
import {blockingExtractionNotes,blockingReviewNote} from '../lib/p5/documentLedger.ts';
test('a persisted decision answer survives rewording while different decisions remain separate',()=>{
 const old={id:'house-radon-system',subject:'house radon',aspect:'system design',question:'Radon mitigation scope: interior ductwork, system type, materials?',status:'deferred' as const,answer:'Specialist to determine; include an allowance.'};
 const question='Does radon mitigation include interior ductwork and penetrations, or is it limited to sub-slab depressurization work?';
 const instructions=mergeInstructions([{...emptyInstructions(),decisions:[old]},{...emptyInstructions(),questions:[question,'Who supplies the radon fan?'],decisions:[{...old,question,status:'pending',answer:undefined},{id:'house-radon-fan-supply',subject:'house radon fan',aspect:'supply responsibility',question:'Who supplies the radon fan?'}]}]);
 assert.equal(instructions.decisions?.[0].status,'deferred');
 const prompts=instructionPrompts({summary:'Radon',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],instructions},{service:'re10',taskList:'Mitigate radon'});
 assert.equal(prompts.some(prompt=>prompt.sourceQuestion===question),false);
 assert.equal(prompts.some(prompt=>prompt.sourceQuestion==='Who supplies the radon fan?'),true);
 assert.throws(()=>mergeInstructions([{...emptyInstructions(),decisions:[old,{...old,subject:'garage radon'}]}]),/identity/);
});
test('complete typed coverage retires only its own prose, never a preparation failure',()=>{
 const note='Blank tiles (unreadable regions) were inspected and contain no content.';
 const extraction={reviewNotes:[note,'Another file was not processed'],documentCoverage:{complete:true,expectedPages:1,pages:[{source:'plans.pdf',page:6,sheet:'A301',revision:'',status:'read' as const,coverageState:'readable' as const,notes:[note]}]}};
 assert.deepEqual(blockingExtractionNotes(extraction),['Another file was not processed']);
 assert.equal(blockingExtractionNotes({...extraction,documentCoverage:{...extraction.documentCoverage,complete:false}}).length,2);
});

test('mixed saved coverage preserves accepted region states without hiding a failed legacy view',()=>{
 const legacy:PageRecord={source:'plans.pdf',page:3,sheet:'A101',revision:'',status:'read',notes:['All supplied crops are readable.']};
 const note='Sheet scale noted as 1/4" = 1\'-0" but dimensions and areas not readable in provided crops';
 const reread:PageRecord={...legacy,status:'partial',coverageState:'unspecified',notes:[note]};
 const input=[legacy,legacy,legacy,reread].map(page=>({pages:[page],expectedPages:1,complete:pageCovered(page)}));
 assert.ok(input.every(part=>part.complete));
 const merged=combineCoverage(input);
 assert.equal(merged.complete,true,'individually accepted views stay accepted when their notes merge');
 assert.equal(merged.pages[0].coverageState,'unspecified');
 const coverage=combineCoverage([merged,{pages:[{...legacy,page:4}],expectedPages:1,complete:true}]);
 assert.equal(coverage.complete,true);
 assert.deepEqual(blockingExtractionNotes({reviewNotes:[note,'Another file was not processed'],documentCoverage:coverage}),['Another file was not processed'],'another legacy page cannot revive this typed page\'s explained note');
 for(const bad of [{...legacy,notes:['Beam schedule is not readable.']},{...legacy,status:'unreadable' as const,notes:[]}]){
  const failed=combineCoverage([...input,{pages:[bad],expectedPages:1,complete:false}]);
  assert.equal(failed.complete,false,'a readable sibling never conceals a failed original view');
 }
 assert.equal(legacy.coverageState,undefined,'original legacy records are not rewritten');
});

test('a saved sewer decision stays answered after it is rebound to utilities and folded into project text',()=>{
 const previous='Sewer pipe damage at 32 feet: repair vs. replacement method?';
 const question='Sewer line repair: estimated length of damaged section to be repaired, and method (spot repair, cured-in-place pipe, section replacement)?';
 const answer='Not sure. Estimate a localized repair of the damaged section, with the exact method and length to be confirmed by a licensed plumber. Do not assume full sewer-line replacement.';
 const history=`Question: ${previous}\nAnswer: ${answer}`;
 const answers={service:'re10',taskList:'Repair the damaged sewer section and retain the existing pump.'};
 const extraction={summary:'Sewer repairs',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],instructions:{...emptyInstructions(),questions:[question]},clarifications:[{field:'utilities' as const,question,reason:'Method and length affect pricing.'}]};
 for(const [context,source] of [[{...answers,estimatingInstructions:history},''],[answers,`Estimate these repairs.\n\n${history}`]] as const){
  assert.equal(answeredScopeQuestion(question,context,source),true);
  assert.deepEqual(instructionPrompts(extraction,context,source),[],'field binding cannot bypass the saved decision');
  assert.equal(scopeQuestions(context,extraction,[],[],[],source).some(q=>q.field==='utilities'),false,'the removed repeat cannot return as a generic utilities question');
  const electrical='What is the length and method for the new electrical service connection?';
  const withOther={...extraction,instructions:{...extraction.instructions,questions:[question,electrical]},clarifications:[...extraction.clarifications,{field:'utilities' as const,question:electrical,reason:'A separate requested connection.'}]};
  assert.ok(scopeQuestions(context,withOther,[],[],[],source).some(q=>q.reason===electrical),'another utility is not treated as the sewer decision');
  assert.equal(answeredScopeQuestion(question.replaceAll('Sewer','Water'),context,source),false,'identical repair wording for a water pipe is a separate physical decision');
  const conflict={field:'utilities' as const,values:['spot repair','full replacement'],explanation:'The current scope contains conflicting repair instructions.'};
  assert.ok(scopeQuestions(context,{...extraction,conflicts:[conflict]},[conflict],[],[],source).some(q=>q.conflict),'a real current conflict still requires confirmation');
 }
 assert.equal(answeredScopeQuestion(question,answers,`Question: ${previous}\nAnswer: `),false,'an empty answer never resolves scope');
 assert.ok(scopeQuestions(answers,extraction).some(q=>q.field==='utilities'),'a genuinely unanswered decision remains');
 assert.equal(answeredScopeQuestion('How many linear feet of wall cabinets?',{estimatingInstructions:'Question: How many linear feet of base cabinets?\nAnswer: 12'}),false,'different measured components remain separate');
});

test('legacy readable-region negation does not become an unreadable-file failure',()=>{
 const note='All six detail regions (1-6) within the crop grid are legible. No regions were blank or unreadable.';
 assert.equal(blockingReviewNote(note),false);
 assert.equal(blockingReviewNote(note+' However, the separate beam schedule is unreadable.'),true,'a separate actual failure stays blocking');
 assert.equal(blockingReviewNote('The supplied regions were blank or unreadable.'),true);
 assert.equal(blockingReviewNote('No readable regions; the schedule is unreadable.'),true);
});

test('only documented transient search errors enter bounded provider backoff',()=>{
 for(const code of ['too_many_requests','unavailable'])assert.equal(retryablePricingProviderError(missingResearchSources([{type:'web_search_tool_result',content:{error_code:code}}],'end_turn')),true);
 for(const code of ['max_uses_exceeded','invalid_tool_input','query_too_long'])assert.equal(retryablePricingProviderError(missingResearchSources([{type:'web_search_tool_result',content:{error_code:code}}],'end_turn')),false);
 assert.equal(retryablePricingProviderError(missingResearchSources([],'end_turn')),false);
});
