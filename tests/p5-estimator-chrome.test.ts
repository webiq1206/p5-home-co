import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {isEstimatorPath} from '../lib/p5/estimatorRoutes.ts';

// Owner report 2026-09-23, on a phone: the estimator rendered the marketing header AND a full
// marketing footer around a one-page app that already has its own brand bar, step progress and exit
// control. The footer carried its own path list naming "/estimate" and "/estimate/p5-preview" but
// not "/estimate/scope", which is the route customers actually use.
test('every estimator route is recognised, including the one customers use',()=>{
  for(const path of ['/estimate','/estimate/scope','/estimate/p5-preview','/estimate/anything-later'])
    assert.equal(isEstimatorPath(path),true,path);
  for(const path of ['/','/services','/contact','/re-10-repairs-boise','/estimates','/estimate-x',null,undefined,''])
    assert.equal(isEstimatorPath(path),false,String(path));
});
// Each brand site wires its own chrome, and not every one has both components; the ones that do must
// ask the shared list rather than keep a copy that can fall behind it.
test('site chrome defers to the shared estimator route list instead of its own copy',()=>{
  let checked=0;
  for(const name of ['ConditionalFooter','Navigation']){
    const url=new URL(`../components/${name}.tsx`,import.meta.url);
    if(!existsSync(url))continue;
    const source=readFileSync(url,'utf8');
    checked++;
    assert.match(source,/isEstimatorPath/,`${name} asks the shared list`);
    assert.doesNotMatch(source,/pathname\s*===\s*["']\/estimate["']/,`${name} keeps no private copy of the estimator paths`);
  }
  assert.ok(checked>0||!existsSync(new URL('../components/Navigation.tsx',import.meta.url)),'nothing to check is only acceptable when this site has no such chrome');
});
