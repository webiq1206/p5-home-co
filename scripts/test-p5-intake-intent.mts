/** Genuine save and reconciliation code; disposable in-memory database, no transports. */
import '../scripts/offline-network-guard.cjs';
import assert from 'node:assert/strict';
import {mkdtemp,cp,writeFile,rm,mkdir} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
await mkdir('node_modules/.cache',{recursive:true});
const dir=await mkdtemp(path.join(process.cwd(),'node_modules/.cache/p5-intake-intent-'));
const previousFetch=globalThis.fetch;let network=0,db:any;
globalThis.fetch=async()=>{network++;throw Error('Network forbidden in synthetic intent test');};
try{
 await cp('lib/p5',dir,{recursive:true});
 await writeFile(path.join(dir,'database.ts'),`import {PGlite} from '@electric-sql/pglite';export const database=new PGlite();export async function query(s:string,v:unknown[]=[]){return (await database.query(s,v)).rows;}`);
 const load=(name:string)=>import(pathToFileURL(path.join(dir,name+'.ts')).href);
 db=await load('database');const api=await load('draftEndpoint'),store=await load('store'),reader=await load('reconcileScopeReading'),policy=await load('intakePolicy');
 const id=randomUUID(),key=randomBytes(32).toString('hex'),contact={name:'',email:'',phone:''};
 const text='I want to build a modern farmhouse 3200 ft.² and I currently owned a lot';
 const put=async(input:any)=>{
  const response=await api.putDraft(new Request('http://test.local/api/p5-estimator/draft',{method:'PUT',headers:{'Content-Type':'application/json','x-p5-draft-id':id,'x-p5-draft-key':key},body:JSON.stringify({contact,...input})}));
  const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body.draft;
 };
 let draft=await put({text,answers:{},revision:0});
 assert.equal(draft.answers.service,'new-construction');assert.equal(draft.answers.sqft,'3200');assert.equal(draft.analyzedFingerprint,undefined);
 assert.equal(policy.routeIntake('construction',draft.answers.service,[],policy.intakeRoutingContext(draft)).handoff,null);
 const file=await store.saveUpload(id,key,{name:'fictional-unread.txt',type:'text/plain',data:Buffer.from('Fictional original attachment')});
 draft=await store.readDraft(id,key);
 const warning='Automatic scope review is temporarily unavailable. Your saved work is intact.';
 const failed=reader.reconcileScopeReading(draft,text,draft.answers,null,{warning});
 assert.equal(failed.analysis,null);assert.equal(failed.payload.analyzedFingerprint,undefined);assert.ok(failed.payload.extraction.reviewNotes.includes(warning));assert.equal(draft.uploads[0].sha256,file.sha256);
 const reading={provider:'synthetic',model:'fixture',analyzedAt:'2026-10-09T00:00:00Z',extraction:{summary:text,facts:[{field:'service',value:'new-construction',confidence:1,basis:'stated',source:'typed scope',evidence:text}],conflicts:[],missingInformation:[],reviewNotes:[]}};
 const read=reader.reconcileScopeReading(draft,text,draft.answers,reading);assert.equal(read.analysis.provider,'synthetic');assert.ok(read.payload.analyzedFingerprint);assert.ok(!read.payload.extraction.reviewNotes.includes(warning));
 const changed=text+'. Actually 2800 and still buying a lot';
 draft=await put({text:changed,answers:draft.answers,revision:draft.revision});
 assert.equal(draft.answers.sqft,'2800');assert.match(draft.answers.workContext,/still buying/);assert.equal(draft.uploads[0].sha256,file.sha256);
 draft=await put({text:changed,answers:{...draft.answers,service:'remodel'},wizard:{skipped:[],resolutions:{service:'remodel'}},revision:draft.revision});
 assert.equal(draft.answers.service,'remodel');assert.equal(draft.wizard.resolutions.service,undefined);assert.ok(draft.extraction.conflicts.some((c:any)=>c.field==='service'));
 assert.equal(policy.routeIntake('remodeling','remodel',[],policy.intakeRoutingContext(draft)).handoff,null);
 draft=await put({text:changed,answers:draft.answers,wizard:{skipped:[],resolutions:{service:'remodel'}},revision:draft.revision});
 assert.equal(draft.wizard.resolutions.service,'remodel');assert.equal(policy.intakeRoutingContext(draft).serviceConflict,false);assert.equal(draft.uploads[0].sha256,file.sha256);
 assert.equal(network,0);console.log('PASS: real save, correction, explicit choice, unread originals, successful reading and provider-failure separation; zero network');
}finally{globalThis.fetch=previousFetch;await db?.database.close();await rm(dir,{recursive:true,force:true});}
