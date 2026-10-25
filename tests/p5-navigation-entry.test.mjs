import test from 'node:test';
import assert from 'node:assert/strict';
import {enterEstimator} from '../scripts/lib/navigationEntry.mjs';

for (const brand of ['boise-handyman-co','boise-remodeling-co','boise-cabinet-co','boise-construction-co','p5-home-co-nextjs']) {
  for (const route of ['/','/estimate','/estimate/scope','/quote','/re-10-repairs-boise','/remodel-plans-boise']) {
    test(`${brand} ${route} preserves the intended entry`, async () => {
      const actions=[];
      const page={url:()=> 'http://fixture.test/estimate?review=1',locator(selector){
        const locator={first:()=>locator,waitFor:async()=>actions.push(['wait',selector]),click:async()=>actions.push(['click',selector]),scrollIntoViewIfNeeded:async()=>actions.push(['scroll',selector])};return locator;
      }};
      const parent=brand==='p5-home-co-nextjs';
      await enterEstimator(page,{brand,route,parent});
      const expected=parent?[]:brand==='boise-handyman-co' && ['/', '/estimate'].includes(route)
        ? [['wait','#quick-request form'],['click','a[href="/estimate?review=1"]']]
        : brand==='boise-remodeling-co' && route==='/'
          ? [['click','a[href="/#calculator"]'],['scroll','#calculator']]
          : route==='/' ? [['scroll','#calculator']] : [];
      assert.deepEqual(actions,expected);
    });
  }
}
