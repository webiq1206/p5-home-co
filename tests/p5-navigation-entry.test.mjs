import test from 'node:test';
import {readFileSync} from 'node:fs';
import {retainedEstimatorPath,isPublicQuotePath,verifyConstructionRe10Handoff} from '../scripts/lib/quoteEntry.mjs';
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
          ? [['click','a[href="/estimate"]:visible'],['wait','[data-testid="estimate-request-wizard"]']]
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

test('P5 keeps public quote qualification separate from retained estimator coverage',()=>{
  for(const brand of ['p5','p5-home-co-nextjs','cabinet','boise-cabinet-co','remodeling','boise-remodeling-co']) assert.equal(retainedEstimatorPath(brand),'/estimate/scope');
  for(const brand of ['handyman','boise-handyman-co']) assert.equal(retainedEstimatorPath(brand),'/estimate');
  for(const route of ['/estimate','/quote','/quote/adu','/quote/custom-cabinets']) assert.equal(isPublicQuotePath(route),true);
  for(const route of ['/estimate/scope','/estimate/p5-preview','/quote-other']) assert.equal(isPublicQuotePath(route),false);
  if(JSON.parse(readFileSync('package.json','utf8')).name!=='p5-home-co-nextjs')return;
  assert.match(readFileSync('app/estimate/page.tsx','utf8'),/redirect\("\/quote"\)/);
  assert.match(readFileSync('app/estimate/scope/page.tsx','utf8'),/<P5Estimator layout="page"/);
  assert.match(readFileSync('app/quote/QuoteLanding.tsx','utf8'),/<ShortRequestForm/);
});

test('Construction retains engine coverage separately from its public quote wizard',()=>{
 for(const brand of ['construction','boise-construction-co'])assert.equal(retainedEstimatorPath(brand),'/estimate/scope');
});

test('Construction handoff rejects the wrong canonical or destination',async()=>{
 const expected='https://boisehandyman.co/re-10-repairs-boise';
 const page=(canonical=expected,href=expected)=>({
  getByRole:role=>role==='heading'?{count:async()=>1,innerText:async()=> 'RE-10 repairs in Boise'}:{getAttribute:async()=>href,scrollIntoViewIfNeeded:async()=>{},evaluate:async()=>true},
  locator:selector=>selector==='link[rel=canonical]'?{getAttribute:async()=>canonical}:selector==='body'?{innerText:async()=> 'Inspection repairs are handled by Boise Handyman Co'}:{count:async()=>0},
  evaluate:async()=>true,
 });
 await verifyConstructionRe10Handoff(page());
 await assert.rejects(()=>verifyConstructionRe10Handoff(page('https://wrong.invalid/')));
 await assert.rejects(()=>verifyConstructionRe10Handoff(page(expected,'https://wrong.invalid/')));
});
