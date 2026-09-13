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
 assert.deepEqual(questions[0].values,[...ESTIMATOR_BRAND.services]);
});
test('brand scope keeps the existing dynamic questions for supported work',()=>{
 const answers={service:ESTIMATOR_BRAND.services[0]};
 assert.deepEqual(scopeQuestionsForBrand(answers,null),scopeQuestions(answers,null));
});
