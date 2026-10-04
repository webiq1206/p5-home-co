import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNumericAnswer} from '../lib/p5/answerParsing.ts';
import {validateExtraction,protectPricingFacts,type ScopeExtraction} from '../lib/p5/scope.ts';
import {cabinetWidthFeet} from '../lib/p5/cabinetMeasurements.ts';

const description='Supply one unfinished shaker base cabinet 15 inches wide, 24 inches deep, 35 inches tall. Owner handles painting. No upper cabinets. No tall cabinets.';
const extraction=(value:string,evidence:string):ScopeExtraction=>({summary:description,facts:[{field:'cabinetBaseLf',value,evidence,source:'typed scope',basis:'stated',confidence:1}],conflicts:[],missingInformation:[],reviewNotes:[]});

test('single cabinet width in inches becomes linear feet, preserving the complete scope',()=>{
  assert.deepEqual(parseNumericAnswer('cabinetBaseLf',description),{value:'1.25',note:description});
  for(const text of ['15 inches','15 in','15"'])assert.equal((parseNumericAnswer('cabinetBaseLf',text) as {value:string})?.value,'1.25');
  assert.equal((parseNumericAnswer('sqft','15 x 24 inches') as {value:string})?.value,'2.5');
  assert.equal((parseNumericAnswer('cabinetBaseLf','15 LF') as {value:string})?.value,'15');
});

test('mentioning linear feet cannot approve an unconverted inch width',()=>{
  const evidence='Base cabinet 15 inches wide; base cabinet linear feet.';
  assert.deepEqual(validateExtraction(extraction('15',evidence)).facts,[]);
  assert.deepEqual(protectPricingFacts(extraction('15',evidence)).facts,[]);
  assert.equal(validateExtraction(extraction('1.25',evidence)).facts[0]?.value,'1.25');
  assert.equal(protectPricingFacts(extraction('1.25',evidence)).facts[0]?.value,'1.25');
});

test('cabinet width conversion respects counts, measurement roles and unresolved alternatives',()=>{
  assert.equal(cabinetWidthFeet('cabinetBaseLf','Two base cabinets each 15 inches wide'),2.5);
  for(const text of ['Base cabinets 15 inches wide','Base cabinet 24 inches deep, 35 inches tall','Base cabinet 15 inches wide or base cabinet 18 inches wide']){
    assert.equal(cabinetWidthFeet('cabinetBaseLf',text),null,text);
  }
  assert.equal(parseNumericAnswer('cabinetBaseLf','Base cabinet 15 inches wide (10 LF)'),null);
  assert.equal(cabinetWidthFeet('cabinetTallLf',description),null);
  assert.equal(validateExtraction({ ...extraction('1.25',description),facts:[{field:'cabinetTallLf',value:'0',evidence:'No tall cabinets',source:'typed scope',basis:'stated',confidence:1}] }).facts[0]?.value,'0');
});
