import test from 'node:test';
import assert from 'node:assert/strict';
import {learnableLines,resemblesExisting,learnedRates,learnedCostRules} from '../lib/p5/learnedBook.ts';

const rule=(id:string,description:string,unit:string,unitCost:number,category='subcontractors')=>({id,description,unit,unitCost,category,quantity:{fixed:1,factor:1}} as any);

test('a learned average is reused with provenance, and expired records remain available for refresh',()=>{
 const at=new Date('2026-09-28T00:00:00Z');
 const priced={...rule('planning-1','Replace clothesline posts','EA',850),priceBasis:'direct-cost',estimatingBasis:'regional-planning-average',unitCostRange:{low:700,high:1000},unitRateContext:{currency:'USD',basis:'subcontractor-installed',includes:'One standard clothesline post supplied and installed',excludes:'Company overhead and profit',assumptions:['Synthetic test allowance']},evidence:{basis:'regional-planning-average',verifiedAt:at.toISOString(),validUntil:'2026-10-28T00:00:00Z',provenance:{status:'estimated',location:'Boise',retrievedAt:at.toISOString(),assumptions:[],sources:[]}}};
 const lines=learnableLines([priced],'handyman','qa',[],at,{location:'Boise',finish:'mid-range'});
 assert.equal(lines.length,1);assert.equal(lines[0].status,'provisional');
 const saved=JSON.parse(JSON.stringify(lines));
 const reused=learnedCostRules(saved,'handyman',{location:'Boise',finish:'mid-range'},at);
 assert.equal(reused.length,1);assert.equal(reused[0].unitCost,850);assert.equal(reused[0].id,lines[0].code);assert.deepEqual(reused[0].quantity,{fixed:1,factor:1});
 assert.deepEqual(learnedCostRules(saved,'handyman',{location:'Boise',finish:'mid-range'},new Date('2026-11-01')),[]);
 assert.equal(saved.length,1,'expiry does not delete the permanent record');
});

test('an allowance for work the book lacks is learned once, as a direct cost',()=>{
  const lines=learnableLines([rule('planning-1','Replace clothesline posts','EA',850)],'handyman','draft-1',[]);
  assert.equal(lines.length,1);assert.match(lines[0].code,/^PB-L-[0-9a-f]{10}$/);assert.equal(lines[0].amount,850);
  const again=learnableLines([rule('planning-7','Replace clothesline posts','EA',900)],'handyman','draft-2',lines);
  assert.equal(again.length,0,'the same work is never learned twice');
});
test('similar approved-book wording cannot discard a newly researched pricing option',()=>{
  for(const [description,unit] of [['GFCI outlet replacement','EA'],['Hose bib vacuum breaker install','EA'],['Replace plumbing vent pipe boot','EA']]){
    const lines=learnableLines([rule('market-2',description,unit,120)],'re10','draft-3',[]);
    assert.equal(lines.length,1,description);
    assert.equal(lines[0].status,'review-required','retain evidence without overwriting an approved rate');
    assert.deepEqual(learnedRates(lines),[]);
  }
});
test('project-specific allowances are retained but never become portable or approved prices',()=>{
  const rules=[rule('scope-1','Custom brass door knocker','EA',60),rule('planning-3','Custom brass door knocker install','LS',60),rule('planning-4','Custom brass door knocker install','EA',0)];
  const learned=learnableLines(rules,'handyman','draft-4',[]);
  assert.equal(learned.length,1);assert.equal(learned[0].unit,'lump sum');assert.equal(learned[0].status,'review-required');
  assert.deepEqual(learnedRates(learned),[]);
});
test('a similar line in a different unit is a different price; in the same unit it is a duplicate',()=>{
  assert.equal(resemblesExisting({description:'Stone veneer wainscot',unit:'SF'},[{description:'Stone veneer wainscot',unit:'LF'}]),false);
  assert.equal(resemblesExisting({description:'Stone veneer wainscot, installed',unit:'SF'},[{description:'Stone veneer wainscot',unit:'SF'}]),true);
});
test('unverified learned lines never masquerade as owner-approved catalog rates',()=>{
  const [line]=learnableLines([rule('market-1','Replace clothesline posts','EA',850)],'handyman','draft-5',[]);
  assert.equal(line.description,'Replace clothesline posts');assert.equal(line.status,'review-required');
  assert.deepEqual(learnedRates([line]),[]);
});
