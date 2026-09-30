import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverProjectReply} from '../lib/p5/projectReplyRecovery.ts';
import {projectHash} from '../lib/p5/projectRecord.ts';
const instructions='Contract: saved-stage-v1',input={record:{sourceHash:'unchanged',revision:4},catalog:[{code:'actual',amount:70}]};
const key=projectHash({instructions,context:input,search:false});
const reply={value:{candidates:['actual']},sourceUrls:[],provider:'openai',model:'gpt-4.1',responseModel:'gpt-4.1-2025-04-14',providerRequestIds:['saved-response']};
const row=()=>({work_key:'project-record-work:older-workflow',payload:{requests:{[key]:{instructions,input}},replies:{[key]:structuredClone(reply)}}});
test('an exact previously paid stage can be recovered without reusing its acceptance decision',()=>{
 const recovered=recoverProjectReply([row()],key,instructions,structuredClone(input));
 assert.deepEqual(recovered,{workKey:'project-record-work:older-workflow',reply});
 assert.equal(recoverProjectReply([row()],key,instructions,{...input,catalog:[{code:'actual',amount:71}]}),null);
 assert.equal(recoverProjectReply([row()],key,instructions+' revised',input),null);
});
test('missing request identity, wrong models and conflicting replies cannot be recovered',()=>{
 const bad=row();bad.payload.replies[key].responseModel='different-model';assert.equal(recoverProjectReply([bad],key,instructions,input),null);
 const missing=row();missing.payload.replies[key].providerRequestIds=[];assert.equal(recoverProjectReply([missing],key,instructions,input),null);
 assert.equal(recoverProjectReply([{work_key:'old',payload:{replies:{[key]:reply}}}],key,instructions,input),null);
 assert.equal(recoverProjectReply([{work_key:'old',payload:{requests:{[key]:{instructions}},replies:{[key]:reply}}}],key,instructions,input),null);
 const conflict=row();conflict.payload.replies[key].value.candidates=['invented'];
 assert.equal(recoverProjectReply([row(),conflict],key,instructions,input),null);
 assert.deepEqual(recoverProjectReply([row(),row()],key,instructions,input)?.reply,reply);
});
