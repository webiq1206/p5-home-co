import test from 'node:test';
import {runInNewContext} from 'node:vm';
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
          ? [['click','a[href="/#request"]:visible'],['wait','#request-form form']]
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

const HANDYMAN_RE10='https://boisehandyman.co/re-10-repairs-boise';

function constructionHandoffFixture({
 canonical=HANDYMAN_RE10,
 hrefs=[HANDYMAN_RE10,HANDYMAN_RE10],
 unobstructed=[true,true],
 h1Count=1,
 h1Text='RE-10 repairs in Boise',
 body='Inspection repairs are handled by Boise Handyman Co',
 estimatorCount=0,
 overflowFree=true,
}={}){
 const checked=[];
 const links=hrefs.map((href,index)=>{
  const element={
   getBoundingClientRect:()=>({left:100,top:200,width:100,height:48}),
   scrollIntoView:options=>{assert.deepEqual({...options},{block:'center',behavior:'instant'});checked.push(['scroll',index]);},
   contains:node=>node===element,
  };
  return {
   getAttribute:async name=>{assert.equal(name,'href');checked.push(['href',index]);return href;},
   evaluate:async fn=>runInNewContext('('+fn.toString()+')(element)',{
    element,innerWidth:1024,innerHeight:900,
    document:{elementFromPoint:()=>{checked.push(['hit-test',index]);return (unobstructed[index]??true)?element:{};}},
   }),
  };
 });
 const page={
  getByRole:(role,options)=>{
   if(role==='heading'){assert.deepEqual(options,{level:1});return {count:async()=>h1Count,innerText:async()=>h1Text};}
   assert.equal(role,'link');assert.deepEqual(options,{name:'Go to Boise Handyman Co',exact:true});
   return {count:async()=>links.length,all:async()=>links};
  },
  locator:selector=>{
   if(selector==='link[rel=canonical]')return {getAttribute:async name=>{assert.equal(name,'href');return canonical;}};
   if(selector==='body')return {innerText:async()=>body};
   assert.equal(selector,'[data-p5-estimator]');return {count:async()=>estimatorCount};
  },
  evaluate:async()=>overflowFree,
 };
 return {page,checked};
}

const rejectsExactDestination=error=>error.code==='ERR_ASSERTION'&&error.expected===HANDYMAN_RE10&&error.actual==='https://wrong.invalid/';

test('Construction handoff rejects the wrong canonical or destination',async()=>{
 await verifyConstructionRe10Handoff(constructionHandoffFixture().page);
 await assert.rejects(()=>verifyConstructionRe10Handoff(constructionHandoffFixture({canonical:'https://wrong.invalid/'}).page),rejectsExactDestination);
 await assert.rejects(()=>verifyConstructionRe10Handoff(constructionHandoffFixture({hrefs:['https://wrong.invalid/',HANDYMAN_RE10]}).page),rejectsExactDestination);
});

test('Construction handoff checks both hero and sidebar placements',async()=>{
 const {page,checked}=constructionHandoffFixture();
 await verifyConstructionRe10Handoff(page);
 assert.deepEqual(checked,[['href',0],['scroll',0],['hit-test',0],['href',1],['scroll',1],['hit-test',1]]);
});

test('Construction handoff rejects a wrong second destination',async()=>{
 const {page}=constructionHandoffFixture({hrefs:[HANDYMAN_RE10,'https://wrong.invalid/']});
 await assert.rejects(()=>verifyConstructionRe10Handoff(page),rejectsExactDestination);
});

for(const index of [0,1]){
 test(`Construction handoff rejects obstruction at placement ${index+1}`,async()=>{
  const unobstructed=[true,true];unobstructed[index]=false;
  await assert.rejects(()=>verifyConstructionRe10Handoff(constructionHandoffFixture({unobstructed}).page),/Each RE-10 handoff must be unobstructed/);
 });
}

for(const count of [0,1,3]){
 test(`Construction handoff rejects ${count} matching links`,async()=>{
  await assert.rejects(()=>verifyConstructionRe10Handoff(constructionHandoffFixture({hrefs:Array(count).fill(HANDYMAN_RE10)}).page),/RE-10 hero and sidebar handoffs must both remain available/);
 });
}

for(const [label,options,acceptsError] of [
 ['multiple H1s',{h1Count:2},error=>error.code==='ERR_ASSERTION'&&error.actual===2&&error.expected===1],
 ['wrong H1 text',{h1Text:'Other repairs'},error=>error.code==='ERR_ASSERTION'&&error.actual==='Other repairs'],
 ['missing handoff explanation',{body:'Other body copy'},error=>error.code==='ERR_ASSERTION'&&error.actual==='Other body copy'],
 ['an estimator on the handoff page',{estimatorCount:1},error=>error.code==='ERR_ASSERTION'&&error.actual===1&&error.expected===0],
 ['horizontal overflow',{overflowFree:false},error=>error.code==='ERR_ASSERTION'&&error.actual===false],
]){
 test(`Construction handoff retains rejection for ${label}`,async()=>{
  await assert.rejects(()=>verifyConstructionRe10Handoff(constructionHandoffFixture(options).page),acceptsError);
 });
}
