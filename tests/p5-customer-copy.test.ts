import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bannedCustomerCopy,customerSafeQuestion,plainCustomerLine} from '../lib/p5/customerCopy.ts';
import {publicPricingText,customerPresentation} from '../lib/p5/customerProjection.ts';
import {processingTitles,pricingActivity} from '../lib/p5/processingStatus.ts';
import {customerPricingQuestions} from '../lib/p5/missingFields.ts';

test('progress cards use the approved plain wording',()=>{
  for(const title of Object.values(processingTitles))assert.equal(bannedCustomerCopy(title),null,title);
  for(const [instructions,search] of [['Inventory the scope',false],['You are a construction estimator',false],['Convert the supplied research',false],['anything',true],['Audit',false]] as const){
    const status=pricingActivity(instructions,{tasks:[{description:'Tile floor'}]},search);
    assert.equal(bannedCustomerCopy(status.message),null,status.message);
  }
  assert.equal(processingTitles.research,'Preparing your estimate');
});

test('a research failure never shows its raw cause to a customer',()=>{
  const internal='Published cost research was not used for Thinset and grout; Tile underlayment (pricing-provider-unavailable:500:{"error":{"message":"upstream timeout (req_abc)."}}). A regional planning average allowance is included instead; it is not verified local pricing.';
  const shown=publicPricingText(internal);
  assert.equal(shown,'Thinset and grout; Tile underlayment: Budget allowance; final selection to be confirmed.');
  assert.equal(bannedCustomerCopy(shown),null);
});

test('planning allowance notes become budget allowance wording and keep inclusions',()=>{
  const shown=plainCustomerLine('Porcelain floor tile: regional planning average allowance for 40 SF (medium confidence; not verified local pricing). Typical Boise mid-range tile from general knowledge. Includes tile and waste. Excludes heated floor. Confirm current local rates before a firm proposal.');
  assert.equal(shown,'Porcelain floor tile (40 SF): Budget allowance; final selection to be confirmed. Includes tile and waste. Excludes heated floor.');
  assert.equal(plainCustomerLine('Baseboard: reused published benchmark allowance, 20 LF. Measured by customer. Rate recorded 2026-09-01; valid until 2026-10-01.'),'Baseboard (20 LF): Budget allowance; final selection to be confirmed.');
});

test('anything still carrying ruled-out wording is withheld, not shown',()=>{
  const result=customerPresentation({status:'ok',range:{low:1,high:2},assumptions:['We are researching missing local rates for this item.','Floor only; no wall tile.'],lineItems:[{id:'a',category:'Tile',description:'Floor tile',quantity:40,unit:'SF',low:1,high:2,unitLow:1,unitHigh:2,verification:'Regional planning average, not verified local pricing. Confirm current local rates, quantities and selections before a firm proposal.'}]});
  assert.deepEqual(result.assumptions,['Floor only; no wall tile.']);
  assert.equal(result.lineItems[0].verification,'Budget allowance; final selection to be confirmed.');
});

test('only plain questions about the project reach the customer',()=>{
  assert.equal(customerSafeQuestion('Which tile size do you want on the bathroom floor?'),'Which tile size do you want on the bathroom floor?');
  for(const note of ['Which sources support the sourced-market-average basis for task 3?','Is the ALLOWANCE prefix quantityEvidence sufficient?','What is the unit cost for setting materials?','Does the mapping rule cover the audit finding?'])assert.equal(customerSafeQuestion(note),null,note);
  assert.deepEqual(customerPricingQuestions(['Tile: Should the old tile be removed by us? Also which sources support the benchmark rate?']),['Should the old tile be removed by us?']);
});

test('no customer-facing component or email template carries ruled-out wording',()=>{
  for(const file of ['components/P5Estimator.tsx','components/P5EstimateDetails.tsx','components/P5ProcessingStatus.tsx','lib/p5/estimateEmail.ts','lib/p5/processingStatus.ts','lib/p5/processingBudget.ts']){
    const text=readFileSync(new URL('../'+file,import.meta.url),'utf8');
    for(const rule of [/local averages?/i,/researching/i,/missing local rates/i,/pricing research/i])assert.doesNotMatch(text,rule,file);
  }
});

test('the progress card never shows the estimator\'s instructions to the pricing model',async()=>{
  const {customerProgressItems}=await import('../lib/p5/processingStatus.ts');
  const research=pricingActivity('anything',{tasks:[{description:'Research an average direct-cost rate per square foot for removing 40 SF of existing bathroom floor tile'}]},true);
  assert.deepEqual(research.currentItems,[]);
  assert.deepEqual(customerProgressItems(['PUBLIC: Obtain a current regional direct-cost rate per SF','Remove existing bathroom floor tile','Install porcelain floor tile']),['Remove existing bathroom floor tile','Install porcelain floor tile']);
});
