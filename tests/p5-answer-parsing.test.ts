import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNumericAnswer} from '../lib/p5/answerParsing.ts';
import {validateAnswer} from '../lib/p5/scope.ts';

const value=(field:Parameters<typeof parseNumericAnswer>[0],text:string)=>{const parsed=parseNumericAnswer(field,text);return parsed&&'value' in parsed?parsed.value:parsed;};

test('a sentence containing the number answers the question and keeps the qualifier',()=>{
  const parsed=parseNumericAnswer('tileSqft','40 square feet, only the bathroom floor');
  assert.deepEqual(parsed,{value:'40',note:'40 square feet, only the bathroom floor'});
  assert.equal(validateAnswer('tileSqft','40'),null);
});

test('common phrasings resolve to the field unit',()=>{
  assert.equal(value('tileSqft','about 40 sq ft'),'40');
  assert.equal(value('tileSqft','It is forty square feet'),'40');
  assert.equal(value('sqft','3,500 sf of living space'),'3500');
  assert.equal(value('garageSqft','the garage is 1,000 square feet'),'1000');
  assert.equal(value('trimLf','20 linear feet of baseboard'),'20');
  assert.equal(value('cabinetBaseLf','10 LF'),'10');
  assert.equal(value('cabinetTallLf',"12'6\""),'12.5');
  assert.equal(value('flooringSqft','12 x 10'),'120');
  assert.equal(value('flooringSqft','the room is 12 by 10 feet'),'120');
  assert.equal(value('bathrooms','two bathrooms'),'2');
  assert.equal(value('stories','2'),'2');
  assert.equal(value('projectMonths','roughly 6 months'),'6');
});

test('an explicit zero is an answer, not a missing value',()=>{
  assert.equal(value('cabinetTallLf','none'),'0');
  assert.equal(value('cabinetTallLf','0'),'0');
  assert.equal(value('garageSqft','No garage on this one'),'0');
  assert.equal(value('cabinetTallLf','zero'),'0');
});

test('a number carrying another unit never answers the question',()=>{
  assert.equal(parseNumericAnswer('tileSqft','there are 2 bathrooms'),null);
  assert.equal(value('tileSqft','2 bathrooms, 40 square feet each floor'),'40');
  assert.equal(parseNumericAnswer('sqft','not sure, maybe ask my builder'),null);
  assert.equal(parseNumericAnswer('sqft','the one upstairs'),null);
});

test('two possible numbers are offered back instead of guessed',()=>{
  assert.deepEqual(parseNumericAnswer('tileSqft','35 to 40 square feet'),{choices:['35','40'],note:'35 to 40 square feet'});
  const parsed=parseNumericAnswer('sqft','3500 plus 1000 for the garage');
  assert.ok(parsed&&'choices' in parsed);
});

test('non-numeric fields and fractional counts are left alone',()=>{
  assert.equal(parseNumericAnswer('materials','40 square feet'),null);
  assert.equal(parseNumericAnswer('bathrooms','2.5'),null);
});
