import test from 'node:test';
import assert from 'node:assert/strict';
import {explicitLaborTotal} from '../lib/p5/explicitLabor.ts';
test('complete labor totals accept natural wording and preserve fractional values',()=>{
  for(const [text,value] of [
    ['Assembly 2 hours + installation 8 hours + selected top 4 hours = 14 total labor hours.','14'],
    ['Total labor: 14 hours','14'],
    ['Total labor hours are 14 hours','14'],
    ['Driveway excavation 16 plus concrete placement 24, totaling 40 labor hours.','40'],
    ['14.5 total labor hours','14.5'],
    ['Exclude 15 total labor hours; total labor is 14 hours.','14'],
  ])assert.equal(explicitLaborTotal(text),value);
});
test('partial quantities, excluded totals and conflicting totals never become a confirmed complete quantity',()=>{
  for(const text of ['Assembly 2 hours and installation 8 hours.','Cabinet subtotal = 10 labor hours.','Exclude 15 total labor hours.'])assert.equal(explicitLaborTotal(text),undefined);
  assert.throws(()=>explicitLaborTotal('14 total labor hours, or 15 total labor hours.'),/different complete labor totals/);
});
