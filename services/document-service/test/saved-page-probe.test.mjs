import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,readdir,stat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {checkSavedPage} from '../scripts/check-sonnet-saved-page.mjs';
import {isolatedPool,privateJson} from '../scripts/model-qa-support.mjs';
import {DDL} from '../src/store.mjs';
import {requestBody} from '../src/provider.mjs';
import {READER_SYSTEM,EVIDENCE_SCHEMA} from '../src/contracts.mjs';

const source='ef5caf06821319350a3f672d98a1c42db2311d601d570cb5345d76f9808a3018';
const text='Synthetic trim scope. Dimensions not supplied. Exclude demolition.';
const page={page:2,sheet:'',revision:'',status:'read',notes:[],facts:[{field:'otherDetails',value:'Dimensions not supplied',evidence:'Dimensions not supplied.',basis:'stated'}],items:[],inclusions:['Synthetic trim scope.'],exclusions:['Exclude demolition.'],responsibilities:[],regions:[]};
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'p5-page-probe-')),directory=join(root,'e887478622096021','short-'+source.slice(0,16));
 await mkdir(directory,{recursive:true});
 const pool=await isolatedPool(join(directory,'database'));await pool.query(DDL);
 await pool.query("INSERT INTO p5ds_documents(id,tenant,project,digest,name,bytes,size_bytes,page_count) VALUES('doc','qa','qa',$1,'fixture.pdf',$2,0,4)",[source,Buffer.alloc(0)]);
 for(let n=1;n<=4;n++)await pool.query('INSERT INTO p5ds_pages(document_id,page,native,image,evidence) VALUES($1,$2,$3,$4,$5)',[
  'doc',n,{page:n,kind:'text',text,textQuality:1,spans:[{text:'Not included in initial reader request'}]},Buffer.from('synthetic-image'),n===1?{...page,page:1}:null]);
 await pool.end();
 await privateJson(join(directory,'report.json'),{id:'short',expectedPages:4,sourceSha256:source,model:'claude-sonnet-5',complete:false});
 // Preserve the failed full-run budget as well as its pages.
 await privateJson(join(directory,'cost.json'),{paused:true,calls:[{status:'charge-unknown',reservedUsd:.93}]});
 return {root,directory,options:{root,key:'synthetic-no-network',env:{},log:()=>{}}};
}
async function snapshot(directory){
 const out=[];
 for(const entry of await readdir(directory,{withFileTypes:true})){
  const path=join(directory,entry.name);
  if(entry.isDirectory())out.push(...await snapshot(path));
  else {const s=await stat(path);out.push([path,s.size,s.mtimeMs]);}
 }return out.sort((a,b)=>a[0].localeCompare(b[0]));
}
const response=p=>json({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({pages:[p]})}],usage:{input_tokens:100,output_tokens:400,output_tokens_details:{thinking_tokens:50}}});

test('probe changes only effort, reads only missing page 2, preserves original checkpoint and never repeats',async()=>{
 const f=await fixture();let paid=0,counts=0;
 try{
  const before=await snapshot(f.directory);
  const request=async(url,options)=>{
   if(url.endsWith('count_tokens')){counts++;return json({input_tokens:100});}
   paid++;const body=JSON.parse(options.body),input=JSON.parse(body.messages[0].content[0].text);
   assert.deepEqual(input.pages.map(p=>p.page),[2]);assert.equal(input.pages[0].spans,undefined);
   const built=requestBody('anthropic','claude-sonnet-5',READER_SYSTEM,input,[{label:'Original page 2; overview, not proof of fine-detail legibility.',bytes:Buffer.from('synthetic-image')}],EVIDENCE_SCHEMA,10000,'read');
   built.body.output_config.effort='medium';assert.deepEqual(body,built.body);
   assert.equal(options.signal.aborted,false);return response(page);
  };
  const report=await checkSavedPage({...f.options,request});
  assert.equal(report.readyForSourceReview,true);assert.equal(report.accuracyQualified,false);
  assert.equal(report.sourceQuoteValidationPassed,true);assert.equal(report.thinkingTokens,50);
  assert.equal(report.cost.maxRequests,1);assert.equal(report.cost.estimatedLimitUsd,.2);assert.equal(report.timeoutMs,40000);
  assert.equal(report.cost.requests,1);assert.equal(report.maxOutputTokens,10000);
  const cached=await checkSavedPage({...f.options,key:undefined,request});assert.equal(cached.cached,true);
  assert.equal(paid,1);assert.equal(counts,1);assert.deepEqual(await snapshot(f.directory),before);
  const ordinary=requestBody('anthropic','claude-sonnet-5',READER_SYSTEM,{pages:[]},[],EVIDENCE_SCHEMA,10000,'read');
  assert.equal(ordinary.body.output_config.effort,'medium','Production Sonnet source reading now uses the measured profile');
 }finally{await rm(f.root,{recursive:true,force:true});}
});

for(const mode of ['timeout','quote','truncated','visual','schema','cap'])test('probe stops safely on '+mode+' without retrying or promoting accuracy',async()=>{
 const f=await fixture();let calls=0;
 try{
  const request=async(url)=>{
   if(url.endsWith('count_tokens'))return json({input_tokens:mode==='cap'?1000000:100});
   calls++;
   if(mode==='timeout')throw new DOMException('Synthetic provider timeout','TimeoutError');
   if(mode==='truncated')return json({stop_reason:'max_tokens',usage:{input_tokens:100,output_tokens:10000},content:[]});
   const value=structuredClone(page);
   if(mode==='quote')value.facts[0].evidence='Invented nonexistent source quote.';
   if(mode==='visual')value.facts[0].basis='visual';
   if(mode==='schema')delete value.items;
   return response(value);
  };
  const r=await checkSavedPage({...f.options,request});assert.equal(r.accuracyQualified,false);assert.ok(!r.readyForSourceReview);
  if(mode==='visual'){assert.equal(r.requiresVisualVerification,true);assert.equal(r.error,undefined);}
  else assert.ok(r.error);
  if(mode==='timeout'){assert.equal(r.cost.paused,true);assert.equal(r.cost.unknownChargeRequests,1);}
  if(mode==='quote')assert.equal(r.sourceQuoteValidationPassed,false);
  await checkSavedPage({...f.options,request});assert.equal(calls,mode==='cap'?0:1);
 }finally{await rm(f.root,{recursive:true,force:true});}
});

test('probe uses one permanent attempt lock even across a crash or concurrent invocation',async()=>{
 const f=await fixture();let enter,release,calls=0;
 const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);
 try{
  const request=async url=>{if(url.endsWith('count_tokens'))return json({input_tokens:100});calls++;enter();await gate;return response(page);};
  const first=checkSavedPage({...f.options,request});await entered;
  await assert.rejects(checkSavedPage({...f.options,request}),/already started/);
  release();const report=await first;assert.equal(calls,1);
  await rm(report.report); // Emulate an interrupted invocation with no final report.
  await assert.rejects(checkSavedPage({...f.options,request}),/already started/);assert.equal(calls,1);
 }finally{release?.();await rm(f.root,{recursive:true,force:true});}
});

test('invalid saved source and already-completed page are rejected before spending',async()=>{
 const f=await fixture();let calls=0;
 try{
  const request=async()=>{calls++;throw Error('No network permitted');};
  const file=join(f.directory,'report.json'),report=JSON.parse(await readFile(file,'utf8'));
  await writeFile(file,JSON.stringify({...report,sourceSha256:'wrong'}));
  await assert.rejects(checkSavedPage({...f.options,request}),/Saved QA report does not match its source directory/);
  await writeFile(file,JSON.stringify(report));
  const pool=await isolatedPool(join(f.directory,'database'));
  await pool.query('UPDATE p5ds_pages SET evidence=$1 WHERE page=2',[page]);await pool.end();
  await assert.rejects(checkSavedPage({...f.options,request}),/completed page/);assert.equal(calls,0);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
