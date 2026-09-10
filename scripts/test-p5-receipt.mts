import assert from 'node:assert/strict';
import {mkdtemp,cp,writeFile,rm,mkdir} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
await mkdir('node_modules/.cache',{recursive:true});
const dir=await mkdtemp(path.join(process.cwd(),'node_modules/.cache/p5-receipt-'));
try{
 await cp('lib/p5',dir,{recursive:true});
 await writeFile(path.join(dir,'database.ts'),`import {PGlite} from '@electric-sql/pglite';export const database=new PGlite();export let stale=true;export function setStale(v:boolean){stale=v;}export async function query(s:string,v:unknown[]=[]){const rows=(await database.query(s,v)).rows;return stale&&s.startsWith('SELECT * FROM p5_estimator_drafts')?[]:rows;}`);
 const {saveDraft,readDraft}=await import(pathToFileURL(path.join(dir,'store.ts')).href);
 const {requireDraftReceipt}=await import(pathToFileURL(path.join(dir,'browserDraft.ts')).href);
 const db=await import(pathToFileURL(path.join(dir,'database.ts')).href);
 const id=randomUUID(),key=randomBytes(32).toString('hex');
 const payload={text:'Synthetic upload regression',answers:{},extraction:null,reviewed:null,contact:{name:'',email:'',phone:''}};
 const saved=await saveDraft(id,key,'test',payload,0);
 assert.equal(requireDraftReceipt({draft:saved}).revision,1);
 assert.equal(saved.id,id);assert.deepEqual(saved.uploads,[]);
 assert.throws(()=>requireDraftReceipt({draft:null}),/save was not confirmed/);
 assert.throws(()=>requireDraftReceipt({draft:{revision:1}}),/save was not confirmed/);
 db.setStale(false);assert.equal((await readDraft(id,key)).text,payload.text);
 const next=await saveDraft(id,key,'test',{...payload,text:'Updated synthetic scope'},1);assert.equal(next.revision,2);
 await assert.rejects(()=>saveDraft(id,key,'test',payload,1),/changed/);
 await db.database.close();console.log('PASS: acknowledged INSERT/UPDATE receipts, stale-read regression, null/malformed browser receipts, optimistic revisions. Real isolated SQL; no external delivery.');
}finally{await rm(dir,{recursive:true,force:true});}
