import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileActionsVisible} from '../lib/p5/mobileActionPolicy.ts';
test('Cabinet first-screen actions preserve all editing and suppression guards',()=>{
 for(const id of ['p5','construction','remodeling','cabinet','handyman']){
  assert.equal(mobileActionsVisible(id,false,false,false),id==='cabinet',id);
  assert.equal(mobileActionsVisible(id,true,false,false),true,id);
  for(const past of [false,true]){
   assert.equal(mobileActionsVisible(id,past,true,false),false,id);
   assert.equal(mobileActionsVisible(id,past,false,true),false,id);
   assert.equal(mobileActionsVisible(id,past,true,true),false,id);
  }
 }
});
