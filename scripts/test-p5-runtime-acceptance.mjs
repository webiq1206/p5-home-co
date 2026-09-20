import assert from 'node:assert/strict';
import test from 'node:test';
import {chmod,mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runAcceptance,UnknownOperationError} from './p5-runtime-acceptance.mjs';
import {protectRequest} from '../lib/p5/http.ts';

const id='12345678-1234-4123-8123-123456789abc',key='a'.repeat(64);
const baseEnv={P5_ACCEPTANCE_BASE_URL:'https://example.test',P5_ACCEPTANCE_DRAFT_ID:id,P5_ACCEPTANCE_DRAFT_KEY:key};
const draft={id,revision:7,status:'draft',brand:'fixture',text:'Saved scope',answers:{service:'bathroom'},extraction:{summary:'saved'},reviewed:null,contact:{name:'',email:'',phone:''},wizard:{skipped:[],resolutions:{}},uploads:[],updatedAt:'2026-01-01T00:00:00.000Z'};
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});

test('default command is authenticated read-only and redacts contact and key',async()=>{
  const calls=[],output=[];
  await runAcceptance({argv:[],env:baseEnv,write:x=>output.push(x),fetchImpl:async(url,init)=>{calls.push({url,init});return reply({draft});}});
  assert.equal(calls.length,1);assert.equal(calls[0].init.method,'GET');
  assert.equal(calls[0].init.headers['x-p5-draft-key'],key);
  assert.doesNotMatch(output.join(''),new RegExp(key));assert.doesNotMatch(output.join(''),new RegExp(id));assert.doesNotMatch(output.join(''),/@/);
});

test('prepare follows the real route contract, preserves review state, and never sends extraction',async()=>{
  let calls=0;
  await assert.rejects(()=>runAcceptance({argv:['prepare'],env:{...baseEnv,P5_ACCEPTANCE_RECIPIENT:'qa@example.invalid'},write:()=>{},fetchImpl:async()=>{calls++;return reply({draft});}}),/QA draft write/);
  assert.equal(calls,1,'only the read-only inspection occurs before approval fails');
  const requests=[];
  await runAcceptance({argv:['prepare'],env:{...baseEnv,P5_ACCEPTANCE_RECIPIENT:'qa@example.invalid',P5_ACCEPTANCE_PREPARE_APPROVAL:'I_APPROVE_QA_DRAFT_WRITE'},write:()=>{},fetchImpl:async(url,init)=>{
    requests.push({url,init});
    if(init.method==='GET')return reply({draft});
    const request=new Request(url,init);assert.doesNotThrow(()=>protectRequest(request));
    assert.equal(init.redirect,'error');assert.equal(init.headers.origin,'https://example.test');
    const body=JSON.parse(init.body);assert.equal(body.revision,7);assert.equal(body.reviewed,false);assert.equal(body.text,'Saved scope');assert.equal('extraction' in body,false);
    return reply({draft:{...draft,revision:8,reviewed:null,contact:body.contact}});
  }});
  assert.equal(requests.length,2);assert.match(requests[1].url,/\/api\/p5-estimator\/draft$/);
});

test('scope answers and review confirmation are separate explicit writes',async()=>{
  const qaDraft={...draft,extraction:{summary:'saved',instructions:{questions:['Saved question']}},contact:{name:'[QA] P5 runtime acceptance',email:'qa@example.invalid',phone:''}};
  const writes=[];
  const fetchImpl=async(url,init)=>{
    if(init.method==='GET')return reply({draft:writes.length?{...qaDraft,revision:8,answers:{...qaDraft.answers,sqft:'80'},extraction:{summary:'saved',instructions:{questions:[]}}}:qaDraft});
    const request=new Request(url,init);assert.doesNotThrow(()=>protectRequest(request));
    const body=JSON.parse(init.body);writes.push(body);
    return reply({draft:{...qaDraft,revision:body.revision+1,answers:body.answers,reviewed:body.reviewed?{text:body.text}:null}});
  };
  await runAcceptance({argv:['answer-field'],env:{...baseEnv,P5_ACCEPTANCE_ANSWER_APPROVAL:'I_APPROVE_QA_SCOPE_ANSWER',P5_ACCEPTANCE_ANSWER_FIELD:'sqft',P5_ACCEPTANCE_ANSWER_VALUE:'80'},write:()=>{},fetchImpl});
  await runAcceptance({argv:['confirm-review'],env:{...baseEnv,P5_ACCEPTANCE_REVIEW_APPROVAL:'I_CONFIRM_QA_SCOPE_REVIEW'},write:()=>{},fetchImpl});
  assert.equal(writes[0].reviewed,false);assert.equal(writes[0].answers.sqft,'80');
  assert.equal(writes[1].reviewed,true);
});

test('clarification answer requires distinct paid-analysis approval before PUT',async()=>{
  const qaDraft={...draft,contact:{name:'[QA] P5 runtime acceptance',email:'qa@example.invalid',phone:''}};
  let calls=0;
  await assert.rejects(()=>runAcceptance({argv:['answer-clarification'],env:{...baseEnv,P5_ACCEPTANCE_ANSWER_APPROVAL:'I_APPROVE_QA_SCOPE_ANSWER',P5_ACCEPTANCE_CLARIFICATION_ID:'saved-id',P5_ACCEPTANCE_CLARIFICATION_ANSWER:'Verified answer'},write:()=>{},fetchImpl:async()=>{
    calls++;return reply({draft:qaDraft});
  }}),/paid clarification analysis/);
  assert.equal(calls,1,'only read-only inspection occurs without paid-analysis approval');
});

test('submit needs independent pricing and delivery approvals and calls submit once',async()=>{
  const ready={...draft,reviewed:{text:'Saved scope'},contact:{name:'[QA] P5 runtime acceptance',email:'qa@example.invalid',phone:''}};
  const common={...baseEnv,P5_ACCEPTANCE_RECIPIENT:'qa@example.invalid'};
  let calls=0;
  await assert.rejects(()=>runAcceptance({argv:['submit'],env:{...common,P5_ACCEPTANCE_DELIVERY_APPROVAL:'I_APPROVE_REAL_DELIVERY'},write:()=>{},fetchImpl:async()=>{calls++;return reply({draft:ready});}}),/paid pricing/);
  await assert.rejects(()=>runAcceptance({argv:['submit'],env:{...common,P5_ACCEPTANCE_PRICING_APPROVAL:'I_APPROVE_PAID_PRICING'},write:()=>{},fetchImpl:async()=>{calls++;return reply({draft:ready});}}),/real delivery/);
  const requests=[];
  await runAcceptance({argv:['submit'],env:{...common,P5_ACCEPTANCE_PRICING_APPROVAL:'I_APPROVE_PAID_PRICING',P5_ACCEPTANCE_DELIVERY_APPROVAL:'I_APPROVE_REAL_DELIVERY'},write:()=>{},fetchImpl:async(url,init)=>{
    requests.push(init);
    if(init.method!=='GET'){const request=new Request(url,init);assert.doesNotThrow(()=>protectRequest(request));assert.equal(init.redirect,'error');}
    return init.method==='GET'?reply({draft:ready}):reply({accepted:true,duplicate:false,delivery:[]});
  }});
  assert.deepEqual(requests.map(x=>x.method),['GET','POST']);
});

test('an unknown submit result is never retried',async()=>{
  const ready={...draft,reviewed:{},contact:{name:'[QA] P5 runtime acceptance',email:'qa@example.invalid',phone:''}};
  let calls=0;
  await assert.rejects(()=>runAcceptance({argv:['submit'],env:{...baseEnv,P5_ACCEPTANCE_RECIPIENT:'qa@example.invalid',P5_ACCEPTANCE_PRICING_APPROVAL:'I_APPROVE_PAID_PRICING',P5_ACCEPTANCE_DELIVERY_APPROVAL:'I_APPROVE_REAL_DELIVERY'},write:()=>{},fetchImpl:async(_url,init)=>{
    calls++;if(init.method==='GET')return reply({draft:ready});throw new Error('socket closed');
  }}),UnknownOperationError);
  assert.equal(calls,2);
});

test('submit HTTP 200 without accepted and duplicate is an ambiguous receipt, never false success',async()=>{
  const ready={...draft,reviewed:{},contact:{name:'[QA] P5 runtime acceptance',email:'qa@example.invalid',phone:''}};
  let calls=0;
  await assert.rejects(()=>runAcceptance({argv:['submit'],env:{...baseEnv,P5_ACCEPTANCE_RECIPIENT:'qa@example.invalid',P5_ACCEPTANCE_PRICING_APPROVAL:'I_APPROVE_PAID_PRICING',P5_ACCEPTANCE_DELIVERY_APPROVAL:'I_APPROVE_REAL_DELIVERY'},write:()=>{},fetchImpl:async(_url,init)=>{
    calls++;return init.method==='GET'?reply({draft:ready}):reply({delivery:[]});
  }}),UnknownOperationError);
  assert.equal(calls,2,'the malformed receipt is not retried');
});

test('known submitted draft stops mutations and can read actual delivery statuses through normal admin GET',async()=>{
  const submitted={...draft,status:'submitted',reviewed:{},contact:{name:'[QA] P5 runtime acceptance',email:'qa@example.invalid',phone:''}};
  const directory=await mkdtemp(path.join(os.tmpdir(),'p5-cli-cookie-'));const cookieFile=path.join(directory,'cookie');
  try{
    await writeFile(cookieFile,'session=private-value');await chmod(cookieFile,0o600);
    const calls=[],output=[];
    await runAcceptance({argv:['delivery-status'],env:{...baseEnv,P5_ACCEPTANCE_ADMIN_COOKIE_FILE:cookieFile},write:value=>output.push(value),fetchImpl:async(url,init)=>{
      calls.push({url,init});
      if(calls.length===1)return reply({draft:submitted});
      return reply({deliveries:[{destination:'customer:private@example.invalid',status:'sent',attempts:1,provider_id:'private'}]});
    }});
    assert.deepEqual(calls.map(call=>call.init.method),['GET','GET']);
    assert.match(calls[1].url,/\/api\/admin\/p5-estimators\?id=/);assert.equal(calls[1].init.redirect,'error');
    assert.equal(calls[1].init.headers.cookie,'session=private-value');
    assert.equal(calls[1].init.headers['x-p5-draft-key'],undefined);
    assert.doesNotMatch(output.join(''),/private-value|private@example|provider/);
    assert.match(output.join(''),/"channel": "customer"/);assert.match(output.join(''),/"status": "sent"/);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('mutation 5xx and unreadable bodies are ambiguous and server detail is never printed',async()=>{
  const qaDraft={...draft,contact:{name:'[QA] P5 runtime acceptance',email:'qa@example.invalid',phone:''}};
  const env={...baseEnv,P5_ACCEPTANCE_REVIEW_APPROVAL:'I_CONFIRM_QA_SCOPE_REVIEW'};
  for(const response of [reply({error:`secret-${key}`},503),new Response('<html>failed</html>',{status:400})]){
    const errors=[];
    await assert.rejects(()=>runAcceptance({argv:['confirm-review'],env,write:()=>{},fetchImpl:async(_url,init)=>init.method==='GET'?reply({draft:qaDraft}):response}),UnknownOperationError);
    assert.doesNotMatch(errors.join(''),new RegExp(key));
  }
});

test('plaintext 4xx rejection does not expose its body',async()=>{
  const qaDraft={...draft,contact:{name:'[QA] P5 runtime acceptance',email:'qa@example.invalid',phone:''}};
  let caught;
  try{await runAcceptance({argv:['confirm-review'],env:{...baseEnv,P5_ACCEPTANCE_REVIEW_APPROVAL:'I_CONFIRM_QA_SCOPE_REVIEW'},write:()=>{},fetchImpl:async(_url,init)=>init.method==='GET'?reply({draft:qaDraft}):reply({error:`recipient qa@example.invalid key ${key}`},409)});}catch(error){caught=error;}
  assert.match(caught.message,/HTTP 409/);assert.doesNotMatch(caught.message,/@|aaaaaa/);
});