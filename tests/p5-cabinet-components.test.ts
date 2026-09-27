import test from 'node:test';
import assert from 'node:assert/strict';
import {PRICE_BOOK} from '../lib/p5/priceBookData.ts';
import {cabinetComponentRates,priceBookRates,type FinishTier} from '../lib/p5/priceBook.ts';
import {relevantCatalog} from '../lib/p5/catalogSelection.ts';

test('supply-only cabinet quantities use the master book material share, excluding labor',()=>{
  const rates=priceBookRates({service:'cabinet-product',finish:'mid-range'});
  const base=rates.find(r=>r.code==='PB-12-32-01-M')!,upper=rates.find(r=>r.code==='PB-12-32-02-M')!;
  assert.equal(base.type,'Material');assert.equal(base.unit,'LF');assert.equal(base.amount,280);
  assert.equal(upper.type,'Material');assert.equal(upper.amount,200);
  assert.equal(12*base.amount+8*upper.amount,4960,'direct product cost only, before existing financial policy');
  assert.match(base.source,/350 × 80% material share/);
  const shown=relevantCatalog(rates,[{description:'Supply only 12 linear feet of base cabinets and 8 linear feet of upper cabinets; owner installs'}]);
  assert.ok(shown.some(r=>r.code===base.code));assert.ok(shown.some(r=>r.code===upper.code));
});
test('cabinet components preserve installed totals across every finish and remodel premium',()=>{
  for(const tier of ['builder','mid','high','luxury'] as FinishTier[])for(const remodel of [false,true]){
    for(const row of PRICE_BOOK){
      const components=cabinetComponentRates(row,tier,remodel);
      if(!components.length)continue;
      assert.equal(components.length,2);assert.equal(components[0].type,'Material');assert.equal(components[1].type,'Labor');
      const original=row[{builder:10,mid:11,high:12,luxury:13}[tier]] as number;
      const total=Math.round(original*(remodel?1+row[14]:1)*100)/100;
      assert.equal(Math.round((components[0].amount+components[1].amount)*100),Math.round(total*100));
      assert.equal(components[0].unit,components[1].unit);
    }
  }
});
test('a missing or invalid owner labor share never becomes an invented component price',()=>{
  const row=PRICE_BOOK.find(r=>r[0]==='12-32-01')!;
  for(const share of [null,0,1,-1,NaN])assert.deepEqual(cabinetComponentRates([...row.slice(0,7),share,...row.slice(8)] as typeof row,'mid',false),[]);
  assert.deepEqual(cabinetComponentRates(PRICE_BOOK.find(r=>r[0]==='08-71-01')!,'mid',false),[],'already labor-only lines stay intact');
});
