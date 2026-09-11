import test from 'node:test';
import assert from 'node:assert/strict';
import {transferProjectFiles} from '../lib/p5/uploadTransfer.ts';

test('upload progress stays below complete until the server receipt arrives',async()=>{
  const old=globalThis.XMLHttpRequest;let instance:any;
  class Transport{upload:any={};status=200;responseText='{"draft":{"revision":1}}';timeout=0;onload:any;open(){}setRequestHeader(){}send(){instance=this;}}
  Object.assign(globalThis,{XMLHttpRequest:Transport});
  try{const values:number[]=[];const result=transferProjectFiles(new FormData(),{},value=>values.push(value));await new Promise(resolve=>setTimeout(resolve,0));instance.upload.onprogress({lengthComputable:true,loaded:10,total:10});assert.deepEqual(values,[99]);instance.onload();assert.deepEqual(await result,{draft:{revision:1}});assert.equal(instance.timeout,120000);}finally{Object.assign(globalThis,{XMLHttpRequest:old});}
});
test('failed uploads retain a clear retryable error',async()=>{
  const old=globalThis.XMLHttpRequest;let instance:any;
  class Transport{upload:any={};status=503;responseText='{"error":"Try again"}';timeout=0;onload:any;onerror:any;open(){}setRequestHeader(){}send(){instance=this;}}
  Object.assign(globalThis,{XMLHttpRequest:Transport});
  try{const result=transferProjectFiles(new FormData(),{},()=>{});await new Promise(resolve=>setTimeout(resolve,0));instance.onerror();await assert.rejects(result,/files are still in this tab/);const rejected=transferProjectFiles(new FormData(),{},()=>{});await new Promise(resolve=>setTimeout(resolve,0));instance.onload();await assert.rejects(rejected,/Try again/);}finally{Object.assign(globalThis,{XMLHttpRequest:old});}
});
