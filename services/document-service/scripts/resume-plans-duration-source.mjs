import {readFile,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {hash} from '../src/core.mjs';
import {Store} from '../src/store.mjs';
import {isolatedPool,privateJson} from './model-qa-support.mjs';
const LEDGER='049ff4a19b6bc34fa80118655278f78eeb3cea33446e2253ed10b46c5f3565a4';
export async function resumePlansDurationSource(directory){
 const marker=join(directory,'plans-page19-duration-source-v1.json');
 try{await stat(marker);throw Error('Plans duration-source recovery was already attempted.');}catch(e){if(e.code!=='ENOENT')throw e;}
 const ledger=await readFile(join(directory,'cost.json')),prior=await readFile(join(directory,'plans-page19-source-support-v1.json'));
 if(hash(ledger)!==LEDGER||JSON.parse(prior).action!=='resume-plans-source-support')throw Error('Recovery evidence changed. Nothing restarted.');
 const pool=await isolatedPool(join(directory,'database')),store=new Store(pool,{});
 try{
  const document=(await pool.query('SELECT * FROM p5ds_documents')).rows[0];
  const failed=(await pool.query("SELECT * FROM p5ds_jobs WHERE kind='read' AND state='failed' AND error_code='invalid-project-duration-source'")).rows;
  if(document?.state!=='failed'||document.error_code!=='invalid-project-duration-source'||failed.length!==1||failed[0].payload?.pages?.[0]!==19||failed[0].attempts!==2)throw Error('Saved page-19 duration state differs. Nothing restarted.');
  await privateJson(marker,{version:1,action:'resume-plans-duration-source',createdAt:new Date().toISOString(),plansLedgerSha256:hash(ledger),previousRecoverySha256:hash(prior),failedJobId:failed[0].id,attempts:2});
  await store.transaction(async c=>{
   const changed=await c.query("UPDATE p5ds_jobs SET state='queued',error_code=null,priority=0,created_at=now(),available_at=now(),lease_token=null,lease_until=null WHERE id=$1 AND state='failed' AND attempts=2 AND error_code='invalid-project-duration-source' RETURNING id",[failed[0].id]);
   if(changed.rowCount!==1)throw Error('Page-19 job changed during recovery.');
   await c.query("UPDATE p5ds_jobs SET created_at=now(),available_at=now() WHERE document_id=$1 AND state='queued'",[document.id]);
   await c.query("UPDATE p5ds_documents SET state='prepared',error_code=null,updated_at=now() WHERE id=$1 AND state='failed' AND error_code='invalid-project-duration-source'",[document.id]);
  });
 }finally{await pool.end();}
 return marker;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))resumePlansDurationSource(resolve(process.argv[2])).then(marker=>console.log(JSON.stringify({resumed:true,marker}))).catch(e=>{console.error(e.message);process.exitCode=1;});