import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import {sendWithRetry} from '../app/lib/notifications/transport.ts';

test('P5 conversational mail captures one transient retry and stops permanent failures',async()=>{
 const sends:any[]=[];let failures:any[]=[];let sleeps=0;
 const modules:Record<string,any>={
  './leadAttribution.ts':{},'./emailReplyTo.ts':{safeEmailReplyTo:()=> 'reply@example.invalid'},
  nodemailer:{createTransport:()=>({sendMail:async(message:any)=>{sends.push(message);if(failures.length)throw failures.shift();return {messageId:'captured-id',accepted:['fixture@example.invalid']};}})},
  '../../app/lib/notifications/smtp-config.ts':{getSmtpConfig:()=>({from:'Fixture Sender',replyTo:'reply@example.invalid',options:{}}),assertSmtpAccepted:()=>{}},
  '../../app/lib/notifications/transport.ts':{sendWithRetry:(fn:()=>Promise<void>)=>sendWithRetry(fn,async()=>{sleeps++;})},
  '../../app/lib/notifications/dispatch.ts':{},'../../app/lib/leads/intake.ts':{},'../../app/lib/leads/synthetic-qa.ts':{},'../../app/lib/leads/settings.ts':{},
  './brand.ts':{ESTIMATOR_BRAND:{domain:'example.invalid'}},
 };
 const module={exports:{} as any};
 const source=readFileSync(new URL('../lib/p5/deliveryAdapter.ts',import.meta.url),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require:(id:string)=>{assert.ok(id in modules,`Unexpected dependency ${id}`);return modules[id];},process:{env:{}}});
 const input={to:'fixture@example.invalid',subject:'Fixture',text:'Captured only',attachments:[],key:'fixture-key',suppressFailureAlert:true};
 failures=[Object.assign(new Error('Socket reset'),{code:'ECONNRESET'})];
 assert.equal(await module.exports.sendEmail(input),'captured-id');assert.equal(sends.length,2);assert.equal(sleeps,1);assert.equal(sends[0].messageId,sends[1].messageId);
 sends.length=0;failures=[Object.assign(new Error('Authentication failed'),{code:'EAUTH'})];
 await assert.rejects(module.exports.sendEmail(input),/Authentication failed/);assert.equal(sends.length,1);assert.equal(sleeps,1);
 sends.length=0;failures=[Object.assign(new Error('Socket reset'),{code:'ECONNRESET'}),Object.assign(new Error('Timed out'),{code:'ETIMEDOUT'})];
 await assert.rejects(module.exports.sendEmail(input),/Timed out/);assert.equal(sends.length,2);assert.equal(sleeps,2);
});
