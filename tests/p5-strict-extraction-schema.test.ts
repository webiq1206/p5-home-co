import test from 'node:test';
import assert from 'node:assert/strict';
import {strictExtractionSchema} from '../lib/p5/strictExtractionSchema.ts';
test('provider grammar retains nested types without mutating local constraints',()=>{
 const original={type:'object',additionalProperties:false,required:['items'],properties:{items:{type:'array',minItems:2,items:{type:'object',additionalProperties:false,required:['value'],properties:{value:{type:'string',minLength:1,maxLength:200}}}}}};
 const adapted=strictExtractionSchema(original);
 assert.equal(adapted.properties.items.minItems,undefined);
 assert.equal(adapted.properties.items.items.properties.value.type,'string');
 assert.match(adapted.properties.items.items.properties.value.description,/minLength: 1/);
 assert.equal(original.properties.items.items.properties.value.minLength,1);
 assert.deepEqual(adapted.required,['items']);
 assert.equal(adapted.additionalProperties,false);
});
