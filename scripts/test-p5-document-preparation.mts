import assert from 'node:assert/strict';
import {mkdtemp,cp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {PDFDocument} from 'pdf-lib';
// Local reader preparation failures: a file that cannot be prepared must stay
// visible (placeholder section, incomplete coverage, review note), Retry must
// re-prepare it without duplicating it, a project with no provider result must
// still return an explicit incomplete extraction, and an over-limit PDF must be
// rejected before any provider call. Real isolated SQL; storage and AI simulated.
const root=process.cwd();await mkdir('node_modules/.cache',{recursive:true});const dir=await mkdtemp(path.join(root,'node_modules/.cache/p5-document-preparation-'));
const names=['DATABASE_URL','P5_DOCUMENT_SERVICE_MODE','P5_OBJECT_STORAGE_ENABLED','ANTHROPIC_API_KEY'];const previous=names.map(name=>process.env[name]);
try{
 await cp('lib/p5',dir,{recursive:true});
 await writeFile(path.join(dir,'database.ts'),`import {PGlite} from '@electric-sql/pglite';export const database=new PGlite();export async function query(statement:string,values:unknown[]=[]){return (await database.query(statement,values)).rows as any[];}`);
 await writeFile(path.join(dir,'storageFixture.ts'),`export const objects=new Map<string,Buffer>();export class Client{async uploadFromBytes(k:string,b:Buffer){objects.set(k,Buffer.from(b));return {ok:true,value:null};}async downloadAsBytes(k:string){return objects.has(k)?{ok:true,value:[objects.get(k)]}:{ok:false};}async delete(k:string){objects.delete(k);return {ok:true};}}`);
 for(const name of ['objectStorage','analysisWork']){const p=path.join(dir,name+'.ts');await writeFile(p,(await readFile(p,'utf8')).replace(/from ['"]@replit\/object-storage['"]/g,"from './storageFixture'"));}
 delete process.env.DATABASE_URL;delete process.env.P5_DOCUMENT_SERVICE_MODE;
 process.env.P5_OBJECT_STORAGE_ENABLED='true';process.env.ANTHROPIC_API_KEY='synthetic';
 const mod=(name:string)=>import(pathToFileURL(path.join(dir,name+'.ts')).href);
 const store=await mod('store'),db=await mod('database'),work=await mod('analysisWork'),client=await mod('documentServiceClient');
 let providerCalls=0;
 const provider=async(_url:any,options:any)=>{
  providerCalls++;
  const payload=JSON.parse(options.body),prompt=String(payload.messages[0].content[0].text||'');
  const manifest=prompt.includes('Original page manifest: ')?JSON.parse(prompt.split('Original page manifest: ')[1]):[];
  return Response.json({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({summary:'Hall bathroom',facts:[{field:'sqft',value:'64',confidence:.99,source:'notes.txt',evidence:'64 square feet',basis:'stated'}],conflicts:[],missingInformation:[],reviewNotes:[],clarifications:[],pages:manifest.map((p:any)=>({...p,sheet:'',revision:'',status:'read',notes:[]})),takeoffs:[]})}]});
 };
 const project=async(text:string,files:{name:string;type:string;bytes:Buffer}[])=>{
  const id=randomUUID(),key=randomBytes(32).toString('hex');
  const draft=await store.saveDraft(id,key,'synthetic',{text,answers:{},extraction:null,reviewed:null,contact:{name:'',email:'',phone:''}},0);
  draft.uploads=[];
  for(const file of files){
   const fileId=randomUUID(),sha256=createHash('sha256').update(file.bytes).digest('hex');
   await db.query('INSERT INTO p5_estimator_files(id,draft_id,name,mime_type,size_bytes,sha256,data_base64) VALUES($1,$2,$3,$4,$5,$6,$7)',[fileId,id,file.name,file.type,file.bytes.length,sha256,file.bytes.toString('base64')]);
   draft.uploads.push({id:fileId,name:file.name,type:file.type,size:file.bytes.length,sha256,status:'stored'});
  }
  return draft;
 };
 const finish=async(draft:any,text:string,retry=false)=>{let step:any,n=0;do{step=await work.advanceAnalysis(draft,text,{},provider,retry&&n===0);assert.ok(++n<40,'analysis pass budget');if(step.pending&&step.retryAfterMs)await new Promise(r=>setTimeout(r,Math.min(step.retryAfterMs,50)));}while(step.pending);return step;};
 const job=async(draft:any,text:string)=>(await db.query('SELECT payload FROM p5_estimator_work WHERE draft_id=$1 AND work_key=$2',[draft.id,work.analysisWorkKey(draft,text,{})]))[0].payload;
 const unreadable=Buffer.from('%PDF-1.7\nthis is not a parsable document\n%%EOF');
 const notes=Buffer.from('Hall bathroom is 64 square feet. Replace the vanity.');

 // 1. One unreadable PDF beside a readable text file.
 const mixedText='Bathroom remodel with notes';
 const mixed=await project(mixedText,[{name:'locked-plan.pdf',type:'application/pdf',bytes:unreadable},{name:'notes.txt',type:'text/plain',bytes:notes}]);
 if(client.SOURCE_COVERAGE_REQUIRED){
  await assert.rejects(finish(mixed,mixedText),/could not be completely read/,'the strict brand refuses to complete with an unprepared source');
 }else{
  const step=await finish(mixed,mixedText);
  assert.equal(step.analysis.extraction.facts.some((fact:any)=>fact.value==='64'),true,'the readable file is still read');
  assert.equal(step.analysis.extraction.documentCoverage?.complete,false,'an unprepared file can never count as complete coverage');
  assert.ok(step.analysis.extraction.reviewNotes.some((note:string)=>/locked-plan\.pdf: unreadable or encrypted PDF/.test(note)),'the unreadable file is named in a review note');
 }
 let saved=await job(mixed,mixedText);
 assert.deepEqual(saved.preparationFailures,['locked-plan.pdf']);
 let placeholders=saved.units.filter((unit:any)=>unit.lastCode==='preparation'&&!unit.object);
 assert.equal(placeholders.length,1,'the failed file leaves exactly one placeholder section');
 assert.equal(placeholders[0].name,'locked-plan.pdf');assert.equal(placeholders[0].uploadId,mixed.uploads[0].id);
 assert.equal(saved.processing.remainingItems>=1,true,'progress reports the section that still needs attention');
 assert.ok(Array.isArray(saved.processing.failedItems)&&saved.processing.failedItems.length>=1,'progress names failed sections');

 // 2. Retry re-prepares the failed file; it is neither dropped nor duplicated.
 const callsBeforeRetry=providerCalls;
 if(client.SOURCE_COVERAGE_REQUIRED)await assert.rejects(finish(mixed,mixedText,true),/could not be completely read/);else await finish(mixed,mixedText,true);
 saved=await job(mixed,mixedText);
 placeholders=saved.units.filter((unit:any)=>unit.lastCode==='preparation'&&!unit.object);
 assert.equal(placeholders.length,1,'Retry must not duplicate the placeholder');
 assert.deepEqual(saved.preparationFailures,['locked-plan.pdf']);
 assert.equal(saved.prepared,2,'every upload is prepared again after Retry');
 assert.ok(providerCalls>callsBeforeRetry,'sections after the rewound file are read again');

 // 3. Nothing readable at all: explicit incomplete result, never a crash or a false completion.
 const onlyText='Only an unreadable plan';
 const only=await project(onlyText,[{name:'locked-only.pdf',type:'application/pdf',bytes:unreadable}]);
 if(client.SOURCE_COVERAGE_REQUIRED)await assert.rejects(finish(only,onlyText),/could not be completely read/);
 else{
  const step=await finish(only,onlyText);
  assert.equal(step.analysis.provider,'P5 document reader');assert.equal(step.analysis.model,'none');
  assert.equal(step.analysis.extraction.documentCoverage?.complete,false);
  assert.ok(step.analysis.extraction.reviewNotes.some((note:string)=>/locked-only\.pdf/.test(note)));
 }

 // 4. Over the page limit: rejected during local inventory, before any provider call.
 const overText='Oversized plan';
 const overPdf=await PDFDocument.create();for(let i=0;i<251;i++)overPdf.addPage([200,200]);
 const over=await project(overText,[{name:'over-limit.pdf',type:'application/pdf',bytes:Buffer.from(await overPdf.save())}]);
 const callsBeforeOver=providerCalls;
 await assert.rejects(work.advanceAnalysis(over,overText,{},provider),/limited to 250 pages/);
 assert.equal(providerCalls,callsBeforeOver,'a 251-page source must not reach a provider');

 await db.database.close();
 console.log('PASS: preparation placeholders, incomplete coverage, Retry rewind without duplication, explicit empty result, and 251-page rejection before provider use. Real isolated SQL/PDF; storage and AI simulated.');
}finally{
 names.forEach((name,index)=>{if(previous[index]===undefined)delete process.env[name];else process.env[name]=previous[index];});
 await rm(dir,{recursive:true,force:true}).catch(()=>{});
}
