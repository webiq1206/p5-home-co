import test from 'node:test';
import assert from 'node:assert/strict';
import {questionFieldsForBook} from '../lib/p5/questionPolicy.ts';

test('pure cost-book question evaluation preserves conditional timing without a policy reread',()=>{
  const book={
    rules:[
      {when:{field:'garageIncluded',equals:'yes'},quantity:{field:'garageSqft'}},
      {when:{field:'service',equals:'bathroom'},quantity:{field:'tileSqft'}},
      {when:{field:'notAField',equals:'yes'},quantity:{field:'sqft'}},
      {quantity:{field:'countertopSqft'}},
    ],
  };
  assert.deepEqual(questionFieldsForBook({service:'bathroom'},book),['garageIncluded','tileSqft','countertopSqft']);
  assert.deepEqual(questionFieldsForBook({service:'bathroom',garageIncluded:'yes',garageSqft:'800',tileSqft:'40',countertopSqft:'12'},book),['garageSqft','tileSqft','countertopSqft']);
});

test('owner-planning books retain their existing deterministic quantity policy',()=>{
  const fields=questionFieldsForBook({service:'handyman',taskList:'Paint walls and install trim'},{
    mode:'owner-planning',
    rules:[{quantity:{field:'sqft'}}],
  });
  assert.deepEqual(fields,['sqft','trimLf']);
});