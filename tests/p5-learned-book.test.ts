import test from 'node:test';
import assert from 'node:assert/strict';
import {learnableLines,resemblesExisting,learnedRates} from '../lib/p5/learnedBook.ts';

const rule=(id:string,description:string,unit:string,unitCost:number,category='subcontractors')=>({id,description,unit,unitCost,category,quantity:{fixed:1,factor:1}} as any);

test('an allowance for work the book lacks is learned once, as a direct cost',()=>{
  const lines=learnableLines([rule('planning-1','Replace clothesline posts','EA',850)],'handyman','draft-1',[]);
  assert.equal(lines.length,1);assert.match(lines[0].code,/^PB-L-[0-9a-f]{10}$/);assert.equal(lines[0].amount,850);
  const again=learnableLines([rule('planning-7','Replace clothesline posts','EA',900)],'handyman','draft-2',lines);
  assert.equal(again.length,0,'the same work is never learned twice');
});
test('nothing that resembles a book line is ever added',()=>{
  // The book already has GFCI outlets, hose bib vacuum breakers and vent boots.
  for(const [description,unit] of [['GFCI outlet replacement','EA'],['Hose bib vacuum breaker install','EA'],['Replace plumbing vent pipe boot','EA']])
    assert.equal(learnableLines([rule('planning-2',description,unit,120)],'re10','draft-3',[]).length,0,description);
});
test('only planning or market allowances are learned, never book, saved or lump-sum lines',()=>{
  const rules=[rule('scope-1','Custom brass door knocker','EA',60),rule('planning-3','Custom brass door knocker install','LS',60),rule('planning-4','Custom brass door knocker install','EA',0)];
  assert.equal(learnableLines(rules,'handyman','draft-4',[]).length,0);
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
