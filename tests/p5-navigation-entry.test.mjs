import test from 'node:test';
import assert from 'node:assert/strict';
import {enterEstimator} from '../scripts/lib/navigationEntry.mjs';

for (const brand of ['boise-handyman-co','handyman','boise-remodeling-co','remodeling','boise-cabinet-co','boise-construction-co','p5-home-co-nextjs']) {
  for (const route of ['/','/estimate','/estimate/scope','/quote','/re-10-repairs-boise','/remodel-plans-boise']) {
    test(`${brand} ${route} preserves the intended entry`, async () => {
      const actions=[];
      const page={waitForURL:async predicate=>assert.equal(predicate(new URL('http://fixture.test/estimate')),true),url:()=> 'http://fixture.test/estimate',locator(selector){
        const locator={first:()=>locator,waitFor:async()=>actions.push(['wait',selector]),click:async()=>actions.push(['click',selector]),scrollIntoViewIfNeeded:async()=>actions.push(['scroll',selector])};return locator;
      }};
      const parent=brand==='p5-home-co-nextjs';
      await enterEstimator(page,{brand,route,parent});
      const expected=parent?[]:['boise-handyman-co','handyman'].includes(brand) && ['/', '/estimate'].includes(route)
        ? [...(route==='/' ? [['click','a[href="/estimate"]']] : []), ['wait','[data-p5-estimator]']]
        : ['boise-remodeling-co','remodeling'].includes(brand) && route==='/'
          ? [['click','a[href="/#calculator"]'],['scroll','#calculator']]
          : route==='/' ? [['scroll','#calculator']] : [];
      assert.deepEqual(actions,expected);
    });
  }
}

test('guided entry waits for navigation completion before reading the URL',async()=>{
 let location='http://fixture.test/',clicked=false,waited=false;
 const page={url:()=>{assert.equal(waited,true);return location;},waitForURL:async predicate=>{assert.equal(clicked,true);await Promise.resolve();location='http://fixture.test/estimate';assert.equal(predicate(new URL(location)),true);waited=true;},locator(){const l={first:()=>l,waitFor:async()=>{},click:async()=>{clicked=true;}};return l;}};
 await enterEstimator(page,{route:'/',brand:'handyman',parent:false});assert.equal(waited,true);
});
