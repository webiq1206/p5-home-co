import test from 'node:test';
import assert from 'node:assert/strict';
import {callbackPhone,callbackContext} from '../lib/p5/exitCallback.ts';

test('callback accepts US phone formatting and never truncates extensions or foreign numbers',()=>{
  for(const phone of ['2085550100','(208) 555-0100','+1 208-555-0100'])assert.equal(callbackPhone(phone),'2085550100');
  for(const phone of ['',null,'123','0000000000','2085550100123','+44 208 555 0100','2085550100 ext 12','call 2085550100'])assert.equal(callbackPhone(phone),null);
});
test('callback context carries a project reference without sending text, files or contact fields',()=>{
  const note=callbackContext({id:'aaaaaaaa-0000-4000-8000-000000000001',revision:6,answers:{service:'kitchen'}});
  assert.match(note,/Saved revision: 6/);assert.match(note,/Service: kitchen/);
  assert.match(note,/no marketing consent/);assert.match(note,/not a completed quote submission/);
  const unsafe=callbackContext({id:'secret?email@example.test',revision:NaN,answers:{service:'<script>'}});
  assert.doesNotMatch(unsafe,/secret|@|<|NaN/);
});
