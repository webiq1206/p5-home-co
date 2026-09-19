import {readFile,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {hash,stable,retainInvalidDurationsAsUncertain,validateEvidence} from '../src/core.mjs';
import {Store} from '../src/store.mjs';
import {isolatedPool,privateJson} from './model-qa-support.mjs';

const SOURCE='4565acfa74cc3590fc2c7b2baf532c99a069c9a572448de8a6f599a7cf135786';
const LEDGER='de50e95b4d3f50dc8c16a19122563998926e2a826b8dfe3ff2a22d2da358542a';
const SHORT='71c8be9a864a092066db6235cc7c42ead9989955b67ff5339ea0b58cc3ec02dc';
const EVIDENCE='3149535409bc0fa528f41d15bafbf8d97078a67aa821a0a115722af3664241fc';
const PAGES=[6,8,14];
const refuse=message=>{throw Error(message+'. Nothing changed.');};

export async function correctSavedPlansIssueDates(store,document,directory){
 const marker=join(directory,'plans-issue-date-duration-v1.json');
 try{await stat(marker);refuse('Issue-date correction was already applied');}catch(error){if(error.code!=='ENOENT')throw error;}
 const ledgerBytes=await readFile(join(directory,'cost.json'),'utf8'),shortBytes=await readFile(join(directory,'..','short-ef5caf0682131935','cost.json'),'utf8');
 const pages=await store.pages(document.id,null,true),evidenceSha256=hash(stable(pages.map(page=>({page:page.page,evidence:page.evidence}))));
 if(hash(ledgerBytes)!==LEDGER||hash(shortBytes)!==SHORT||evidenceSha256!==EVIDENCE||document.digest!==SOURCE||document.state!=='complete'||pages.length!==23||pages.some(page=>!page.evidence))refuse('Saved plans state differs');
 const replacements=[];
 for(const number of PAGES){
  const page=pages.find(value=>value.page===number);
  const before=page.evidence,after=retainInvalidDurationsAsUncertain({pages:[structuredClone(before)]}).pages[0];
  const changed=(before.facts||[]).filter((fact,index)=>stable(fact)!==stable(after.facts[index]));
  if(changed.length!==1||after.status!=='partial')refuse(`Page ${number} issue-date evidence differs`);
  replacements.push({page,before,after:validateEvidence({pages:[after]},[page.native]).pages[0]});
 }
 const archive={version:1,action:'correct-plans-issue-date-durations',createdAt:new Date().toISOString(),sourceCommit:process.env.P5_QA_SOURCE_COMMIT||null,
  plansLedgerSha256:hash(ledgerBytes),shortLedgerSha256:hash(shortBytes),previousEvidenceSha256:EVIDENCE,
  correctedPages:replacements.map(value=>({page:value.page.page,previousEvidence:value.before,correctedEvidenceSha256:hash(stable(value.after))}))};
 await privateJson(marker,archive);
 await store.transaction(async client=>{
  for(const replacement of replacements){
   const changed=await client.query('UPDATE p5ds_pages SET evidence=$3::jsonb WHERE document_id=$1 AND page=$2 AND evidence=$4::jsonb RETURNING page',
    [document.id,replacement.page.page,JSON.stringify(replacement.after),JSON.stringify(replacement.before)]);
   if(changed.rowCount!==1)throw Error(`Page ${replacement.page.page} changed during correction. Inspect the archive.`);
  }
 });
 return marker;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const directory=resolve(process.argv[2]||'.p5-model-qa/28ae638a423cc02f/plans-4565acfa74cc3590');
 const pool=await isolatedPool(join(directory,'database')),store=new Store(pool,{});
 try{const document=(await pool.query('SELECT * FROM p5ds_documents')).rows[0];console.log(JSON.stringify({corrected:true,marker:await correctSavedPlansIssueDates(store,document,directory)}));}
 catch(error){console.error(error.message);process.exitCode=1;}finally{await pool.end();}
}