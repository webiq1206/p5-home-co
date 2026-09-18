import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile,stat,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PDFDocument} from 'pdf-lib';
import {recoverSavedPages,withQualificationLock} from '../scripts/finish-sonnet-qualification.mjs';
import {runFixture} from '../scripts/check-sonnet-documents.mjs';
import {isolatedPool,privateJson} from '../scripts/model-qa-support.mjs';
import {DDL} from '../src/store.mjs';
import {hash} from '../src/core.mjs';

const source='ef5caf06821319350a3f672d98a1c42db2311d601d570cb5345d76f9808a3018';
const text='Well septic cabinetry painting appliances fireplace. Exclude land, financing and wallpaper. Project cost $ , .';
const evidence=n=>({page:n,sheet:'',revision:'',status:'read',notes:[],facts:[],items:[],inclusions:['Well septic cabinetry painting appliances fireplace.'],exclusions:['Land, financing and wallpaper'],responsibilities:[],regions:[]});
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
async function snapshot(root){
 const out=[];
 for(const e of await readdir(root,{withFileTypes:true})){
  const p=join(root,e.name);
  if(e.isDirectory())out.push(...await snapshot(p));else{const s=await stat(p);out.push([p,s.size,s.mtimeMs,hash(await readFile(p))]);}
 }return out.sort((a,b)=>a[0].localeCompare(b[0]));
}

test('qualification recovers exact saved evidence free, preserves original files and reads only unfinished pages',async()=>{
 const root=await mkdtemp(join(tmpdir(),'p5-qualification-'));
 const directory=join(root,'e887478622096021','short-'+source.slice(0,16));
 await mkdir(directory,{recursive:true});
 const db=await isolatedPool(join(directory,'database'));await db.query(DDL);
 await db.query("INSERT INTO p5ds_documents(id,tenant,project,digest,name,bytes,size_bytes,page_count) VALUES('doc','qa','qa',$1,'fixture.pdf',$2,0,4)",[source,Buffer.alloc(0)]);
 for(let page=1;page<=4;page++)await db.query('INSERT INTO p5ds_pages(document_id,page,native,image,evidence) VALUES($1,$2,$3,$4,$5)',['doc',page,{page,kind:'text',text,textQuality:1},Buffer.from('synthetic-image'),page===1?evidence(1):null]);
 await db.end();
 const reportPath=join(directory,'report.json');
 await privateJson(reportPath,{id:'short',expectedPages:4,sourceSha256:source,model:'claude-sonnet-5',cost:{estimatedUsd:.935268}});
 await privateJson(join(directory,'cost.json'),{paused:true,estimatedUsd:.935268});
 const probeFile=join(root,'probes','sonnet-medium-page2-v1-'+source.slice(0,16),'report.json');
 const page2=evidence(2);
 page2.facts=[{field:'estimatingInstructions',value:'Source headings',basis:'stated',evidence:'Well septic cabinetry painting appliances fireplace. ... Project cost $ , .'}];
 page2.regions=[{x:.1,y:.1,width:.8,height:.5,reason:'Numeric amounts are redacted; verify for recoverable digits'}];
 const probe={profile:'sonnet-medium-page2-v1',model:'claude-sonnet-5',effort:'medium',sourceSha256:source,sourceReport:reportPath,page:2,requestSucceeded:true,structuralValidationPassed:true,nativeText:text,result:{pages:[page2]},cost:{estimatedUsd:.058087,unknownChargeRequests:0,usage:[{input_tokens:100,output_tokens:100}]}};
 await privateJson(probeFile,probe);
 try{
  const before=await snapshot(root),recovered=await recoverSavedPages({root});
  assert.deepEqual(await snapshot(root),before,'Recovery must leave all source checkpoints and ledgers byte-for-byte unchanged');
  assert.deepEqual(recovered.pages.filter(p=>p.evidence).map(p=>p.page),[1,2]);
  assert.equal(recovered.pages[1].evidence.regions.length,0);assert.equal(recovered.previousProbeEstimate,.058087);
  const pdf=await PDFDocument.create();for(let n=0;n<4;n++)pdf.addPage().drawText(text);
  const bytes=Buffer.from(await pdf.save());
  const fixture={id:'short',sha256:hash(bytes),pages:4,pdfBase64:bytes.toString('base64')};
  const paid=[],newRoot=join(root,'1234567890abcdef');
  const request=async(url,options)=>{
   if(url.endsWith('count_tokens'))return json({input_tokens:100});
   const body=JSON.parse(options.body),input=JSON.parse(body.messages[0].content[0].text);
   if(body.tools){
    paid.push('review');assert.equal(input.documents[0].pages.length,4);
    const result={summary:'Well septic cabinetry painting appliances fireplace',facts:[],conflicts:[],missingInformation:[],reviewNotes:[],clarifications:[],instructions:{inclusions:['Well septic cabinetry painting appliances fireplace'],exclusions:['Land, financing and wallpaper'],responsibilities:[],buildings:[],floors:[],separateBuildings:false,laborOnly:false,materialsOnly:false,questions:[]},pages:input.documents.flatMap(d=>d.pages.map(p=>({source:d.source,page:p.page,sheet:'',revision:''}))),takeoffs:[]};
    return json({stop_reason:'tool_use',usage:{input_tokens:100,output_tokens:100},content:[{type:'tool_use',name:'submit_document_review',id:'synthetic',input:result}]});
   }
   assert.equal(body.output_config.effort,'medium');assert.equal(input.pages.length,1);
   const page=input.pages[0].page;paid.push(page);assert.ok([3,4].includes(page),'A saved page must never be reread');
   return json({stop_reason:'end_turn',usage:{input_tokens:100,output_tokens:100},content:[{type:'text',text:JSON.stringify({pages:[evidence(page)]})}]});
  };
  const r=await runFixture(fixture,{root:newRoot,key:'synthetic-no-network',seedPages:recovered.pages,request,log:()=>{}});
  assert.equal(r.complete,true,r.error);assert.deepEqual(r.reusedPages,[1,2]);assert.deepEqual(paid,[3,4,'review']);
  assert.equal(r.runType,'resume-saved-source');assert.equal(r.productionPerformanceQualified,false);
  assert.ok(r.events.filter(e=>e.stage==='page-parse').every(e=>e.duration_ms===0&&e.detail.nativeMs===0&&e.detail.renderMs===0),'Saved native text/images bypass PDF parsing');
  const cost=JSON.stringify(r.cost);
  const cached=await runFixture(fixture,{root:newRoot,key:'synthetic-no-network',seedPages:recovered.pages,request,log:()=>{}});
  assert.equal(cached.complete,true);assert.equal(JSON.stringify(cached.cost),cost);assert.equal(paid.length,3);
  await privateJson(probeFile,{...probe,nativeText:'different source'});
  await assert.rejects(recoverSavedPages({root}),/manifest mismatch/);
  await privateJson(probeFile,{...probe,cost:{unknownChargeRequests:1,usage:[]}});
  await assert.rejects(recoverSavedPages({root}),/usage-reported/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('qualification lock prevents concurrent runs and retained crash locks prevent silent restarts',async()=>{
 const root=await mkdtemp(join(tmpdir(),'p5-qualification-lock-'));let enter,release,calls=0;
 const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);
 try{
  const first=withQualificationLock(root,async()=>{calls++;enter();await gate;});await entered;
  await assert.rejects(withQualificationLock(root,async()=>calls++),/already running/);
  release();await first;assert.equal(calls,1);
  await withQualificationLock(root,async()=>calls++);assert.equal(calls,2);
  await mkdir(join(root,'running.lock'));
  await assert.rejects(withQualificationLock(root,async()=>calls++),/interrupted/);assert.equal(calls,2);
 }finally{release?.();await rm(root,{recursive:true,force:true});}
});
