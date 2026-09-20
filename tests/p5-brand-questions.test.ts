import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeQuestions,scopeQuestionsForBrand} from '../lib/p5/adaptive.ts';
import {SCOPE_FIELDS} from '../lib/p5/scope.ts';
import {ESTIMATOR_BRAND} from '../lib/p5/brand.ts';
test('resolve unsupported company scope before unrelated technical questions',()=>{
 const unsupported=SCOPE_FIELDS.service.options.find(service=>!(ESTIMATOR_BRAND.services as readonly string[]).includes(service));
 if(!unsupported)return;
 const questions=scopeQuestionsForBrand({service:unsupported,taskList:'Complete project retained'},null);
 assert.equal(questions.length,1);assert.equal(questions[0].field,'service');
 if(questions[0].handoff){
  const destinations:Record<string,string>={handyman:'https://boisehandyman.co/estimate','cabinet-product':'https://boisecabinet.co/estimate','cabinet-install':'https://boisecabinet.co/estimate','new-construction':'https://boiseconstruction.co/estimate',kitchen:'https://boiseremodeling.co/estimate',bathroom:'https://boiseremodeling.co/estimate','whole-home':'https://boiseremodeling.co/estimate'};
  assert.equal(questions[0].handoff.url,destinations[unsupported]);
  assert.equal(questions[0].values,undefined,'a handoff must not force a different project type');
 }else assert.deepEqual(questions[0].values,[...ESTIMATOR_BRAND.services]);
});
test('brand scope keeps the existing dynamic questions for supported work',()=>{
 const answers={service:ESTIMATOR_BRAND.services[0]};
 assert.deepEqual(scopeQuestionsForBrand(answers,null),scopeQuestions(answers,null));
});
test('new builds on Remodeling route directly to Construction',()=>{
 if((ESTIMATOR_BRAND.id as string)!=='remodeling')return;
 const questions=scopeQuestionsForBrand({service:'new-construction',taskList:'Complete new home',sqft:'2400'},null);
 assert.equal(questions.length,1);assert.equal(questions[0].handoff?.url,'https://boiseconstruction.co/estimate');
});
test('remodels on Construction route directly to Remodeling',()=>{
 if((ESTIMATOR_BRAND.id as string)!=='construction')return;
 for(const service of ['kitchen','bathroom','whole-home']){
  const questions=scopeQuestionsForBrand({service,taskList:'Remodel existing space'},null);
  assert.equal(questions.length,1);assert.equal(questions[0].handoff?.url,'https://boiseremodeling.co/estimate');
 }
});
