import {readFile,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {hash,stable,validateEvidence} from '../src/core.mjs';
import {Store} from '../src/store.mjs';
import {isolatedPool,privateJson} from './model-qa-support.mjs';

const SOURCE='4565acfa74cc3590fc2c7b2baf532c99a069c9a572448de8a6f599a7cf135786';
const LEDGER='de50e95b4d3f50dc8c16a19122563998926e2a826b8dfe3ff2a22d2da358542a';
const SHORT='71c8be9a864a092066db6235cc7c42ead9989955b67ff5339ea0b58cc3ec02dc';
const PAGE9='448fba8518f0bac74efd9826de898c996ab51f1810880733609efedad3d0d290';
const NOTE=`The 1'-6 3/4" dimension in Building Section 2 spans the floor/truss assembly below Bed #3; it is retained as uncertain assembly depth, not a room, wall, or ceiling height.`;
const refuse=message=>{throw Error(message+'. Nothing changed.');};

export function correctPage9AssemblyDepth(evidence,native){
 const next=structuredClone(evidence),item=next.items?.find(value=>value.id==='9-item-1');
 if(next.page!==9||next.status!=='read'||!item||item.quantity!==null||item.basis!=='visual'||
  !item.description.includes(`ceiling/wall heights 20'-9", 1'-6 3/4", 9'-1 1/8", 10'-1 1/8"`))refuse('Page-9 evidence differs from the inspected semantic concern');
 item.basis='uncertain';
 item.component='Floor/truss assembly depth';
 item.description=`Building Section 2 shows Laundry, Foyer, Mud, WIC, and Bed #3. The 1'-6 3/4" dimension appears to span the floor/truss assembly below Bed #3; its exact semantic role remains uncertain. Other literal dimensions remain visible but are not reassigned here.`;
 next.notes=[...new Set([...next.notes,NOTE])];
 next.status='partial';
 return validateEvidence({pages:[next]},[native]).pages[0];
}

export async function correctSavedPlansPage9(store,document,directory){
 const marker=join(directory,'plans-page9-assembly-depth-v1.json');
 try{await stat(marker);refuse('Page-9 semantic correction was already applied');}catch(error){if(error.code!=='ENOENT')throw error;}
 const ledgerBytes=await readFile(join(directory,'cost.json'),'utf8');
 const shortBytes=await readFile(join(directory,'..','short-ef5caf0682131935','cost.json'),'utf8');
 const ledger=JSON.parse(ledgerBytes);
 if(hash(ledgerBytes)!==LEDGER||hash(shortBytes)!==SHORT||ledger.calls?.length!==86||!ledger.paused||
  ledger.calls.filter(call=>call.status==='usage-reported').length!==85||
  ledger.calls.filter(call=>call.status==='charge-unknown').length!==1||
  Math.abs(ledger.calls.reduce((sum,call)=>sum+call.reservedUsd,0)-5.952995)>1e-8)refuse('Saved accounting differs');
 if(document.digest!==SOURCE||document.state!=='complete'||document.page_count!==23)refuse('Saved document differs');
 const jobs=(await store.pool.query('SELECT state FROM p5ds_jobs')).rows;
 if(jobs.some(job=>job.state==='running'))refuse('A provider operation is active');
 const pages=await store.pages(document.id,null,true),page9=pages.find(page=>page.page===9);
 if(pages.length!==23||pages.some(page=>!page.evidence)||!page9||hash(stable(page9.evidence))!==PAGE9)refuse('Accepted page records differ');
 const corrected=correctPage9AssemblyDepth(page9.evidence,page9.native);
 const archive={version:1,action:'correct-plans-page9-assembly-depth',createdAt:new Date().toISOString(),
  sourceCommit:process.env.P5_QA_SOURCE_COMMIT||null,plansLedgerSha256:hash(ledgerBytes),shortLedgerSha256:hash(shortBytes),
  plansCalls:86,knownUsageUsd:5.418725,unknownReservationUsd:.53427,totalEstimatedUsd:5.952995,
  previousEvidence:page9.evidence,previousEvidenceSha256:PAGE9,correctedEvidenceSha256:hash(stable(corrected))};
 await privateJson(marker,archive);
 await store.transaction(async client=>{
  const changed=await client.query('UPDATE p5ds_pages SET evidence=$3::jsonb WHERE document_id=$1 AND page=9 AND evidence=$2::jsonb RETURNING page',
   [document.id,JSON.stringify(page9.evidence),JSON.stringify(corrected)]);
  if(changed.rowCount!==1)throw Error('Page-9 evidence changed during correction. Inspect the archive.');
 });
 return marker;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const directory=resolve(process.argv[2]||'.p5-model-qa/28ae638a423cc02f/plans-4565acfa74cc3590');
 const pool=await isolatedPool(join(directory,'database')),store=new Store(pool,{});
 try{
  const document=(await pool.query('SELECT * FROM p5ds_documents')).rows[0];
  console.log(JSON.stringify({corrected:true,marker:await correctSavedPlansPage9(store,document,directory)}));
 }catch(error){console.error(error.message);process.exitCode=1;}finally{await pool.end();}
}