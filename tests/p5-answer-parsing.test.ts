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

test('inch dimensions convert to square feet before pricing',()=>{
  assert.equal(value('sqft','Only the drywall patch has an area: 12 by 12 inches = 1 square foot. The other repairs are exactly two GFCI receptacles and one P-trap; no whole-room work.'),'1');
  assert.equal(value('sqft','12 x 12 inches'),'1');
  assert.equal(value('sqft','12" x 24"'),'2');
  assert.equal(value('sqft','2 feet by 12 inches'),'2');
  assert.equal(value('sqft','12 inches by 2 feet'),'2');
  assert.equal(value('sqft','60 by 20 inches'),'8.33');
  assert.deepEqual(parseNumericAnswer('sqft','12 by 12 inches = 144 SF'),{choices:['1','144'],note:'12 by 12 inches = 144 SF'});
  assert.equal(parseNumericAnswer('sqft','12 by 12 cm'),null);
});

test('installed area is distinct from explicitly labelled material purchase quantity',()=>{
  for(const text of [
    '300 square feet installed. The plan specifies 330 square feet purchased, including 10% material waste.',
    'Order 330 SF and install area is 300 SF.',
    '300 SF net floor area; 330 SF ordered including waste.',
    '330 SF purchased, 300 SF installed',
  ])assert.deepEqual(parseNumericAnswer('flooringSqft',text),{value:'300',note:text});
  assert.equal(value('tileSqft','40 SF installed and 44 SF purchased'),'40');
});

test('distinct unlabelled areas and conflicting installation quantities remain unresolved',()=>{
  for(const text of [
    '300 SF or 330 SF installed',
    '300 SF installed; 330 SF installed',
    '300 SF installed, 330 SF elsewhere',
    '300 SF installed and purchased; 330 SF purchased',
  ]){
    const result=parseNumericAnswer('flooringSqft',text);
    assert.ok(result&&'choices' in result,text);
  }
});
