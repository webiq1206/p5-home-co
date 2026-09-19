import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,readdir,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {isolatedPool,privateJson} from '../scripts/model-qa-support.mjs';
import {withSavedRun,inspectSavedRun} from '../scripts/inspect-sonnet-run.mjs';
import {Store} from '../src/store.mjs';
import {hash} from '../src/core.mjs';

async function snapshot(directory){
 const result=[];
 for(const entry of await readdir(directory,{withFileTypes:true})){
  const path=join(directory,entry.name);
  if(entry.isDirectory())result.push(...await snapshot(path));
  else {const s=await stat(path);result.push([path,s.size,s.mtimeMs]);}
 }
 return result.sort((a,b)=>a[0].localeCompare(b[0]));
}
test('authentic plans inspection uses a read-only copy and refuses locks, relabeled reports and mismatched storage',async()=>{
 const root=await mkdtemp(join(tmpdir(),'p5-plan-inspection-')),profile=join(root,'1234567890abcdef'),bytes=Buffer.from('%PDF synthetic inspection'),digest=hash(bytes),directory=join(profile,'plans-'+digest.slice(0,16)),file=join(directory,'report.json');
 await mkdir(directory,{recursive:true});
 const pool=await isolatedPool(join(directory,'database')),store=new Store(pool,{maxTenantBytes:1000000,maxQueue:30});await store.init();
 const {document}=await store.putDocument('qa','plans','synthetic.pdf',bytes);
 await pool.query('UPDATE p5ds_documents SET page_count=23 WHERE id=$1',[document.id]);await pool.end();
 const report={id:'plans',sourceSha256:digest,expectedPages:23,complete:false};await privateJson(file,report);
 try{
  const before=await snapshot(directory);
  const inspection=await inspectSavedRun({root,reportPath:file});assert.equal(inspection.complete,false);assert.equal(inspection.jobs.length,1);
  await assert.rejects(withSavedRun({root,reportPath:file},({db})=>db.query('DELETE FROM p5ds_jobs')),/read-only/);
  assert.deepEqual(await snapshot(directory),before);
  await mkdir(join(profile,'running.lock'));
  await assert.rejects(inspectSavedRun({root,reportPath:file}),/running or was interrupted/);await rm(join(profile,'running.lock'),{recursive:true});
  await privateJson(file,{...report,id:'short',expectedPages:4});await assert.rejects(inspectSavedRun({root,reportPath:file}),/source directory/);
  await privateJson(file,report);
  const changed=await isolatedPool(join(directory,'database'));await changed.query('UPDATE p5ds_documents SET page_count=4');await changed.end();
  await assert.rejects(inspectSavedRun({root,reportPath:file}),/database does not match/);
  assert.equal(JSON.parse(await readFile(file,'utf8')).id,'plans');
 }finally{await rm(root,{recursive:true,force:true});}
});
